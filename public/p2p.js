// Peer-to-peer text and voice chat between players in the same room (WebRTC mesh).
// The game server only relays connection offers ("signaling"); messages and audio go directly between players.
// If a direct connection cannot be made, text falls back to being relayed through the room server; voice needs the direct link
// (add a TURN server to ICE_SERVERS for players behind strict networks).
const P2P = (() => {
  const desk = window.stockRogue;
  const ICE_SERVERS = desk?.iceServers?.length ? desk.iceServers : [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const MAX_TEXT = 200;

  let signal = () => {};      // (to, data) -> send through the game server
  let myId = null;
  let hooks = { chat() {}, change() {} };
  const peers = new Map();    // id -> { pc, dc, sid, audio, tr, state, speaking, muted, pending: [] }
  let mic = null;             // MediaStream from the microphone
  let micOn = false;

  const initiator = (id) => myId < id;   // lower id makes the offer, so only one side ever does
  const newSid = () => Math.random().toString(36).slice(2, 10);

  function setup({ send, onChat, onChange }) {
    signal = send;
    hooks = { chat: onChat || (() => {}), change: onChange || (() => {}) };
  }

  // Called whenever the room's player list changes.
  function sync(id, players) {
    myId = id;
    if (!myId) return;
    const want = new Set(players.filter((p) => p.id !== myId && p.connected !== false).map((p) => p.id));
    for (const pid of [...peers.keys()]) if (!want.has(pid)) drop(pid);
    for (const pid of want) {
      if (peers.has(pid)) continue;
      if (initiator(pid)) call(pid);
      else { peers.set(pid, blank()); signal(pid, { k: 'hello' }); }   // ask the other side to call us
    }
  }

  function blank() { return { pc: null, dc: null, sid: null, audio: null, tr: null, state: 'connecting', speaking: false, muted: false, pending: [] }; }

  function makePc(pid, sid) {
    const old = peers.get(pid);
    if (old?.pc) old.pc.close();
    const P = { ...blank(), sid, muted: old?.muted || false };
    peers.set(pid, P);
    const pc = (P.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS }));
    // Fixed data channel id on both sides, so neither has to wait for the other to announce it.
    P.dc = pc.createDataChannel('chat', { negotiated: true, id: 0 });
    P.dc.onopen = () => { P.state = 'direct'; hooks.change(); };
    P.dc.onclose = () => { if (peers.get(pid) === P) { P.state = 'connecting'; hooks.change(); } };
    P.dc.onmessage = (e) => receive(pid, e.data);
    pc.onicecandidate = (e) => { if (e.candidate) signal(pid, { k: 'ice', sid, c: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (!P.audio) { P.audio = new Audio(); P.audio.autoplay = true; }
      P.audio.srcObject = new MediaStream([e.track]);
      P.audio.muted = P.muted;
      P.audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (peers.get(pid) !== P) return;
      if (pc.connectionState === 'failed') { P.state = 'relay'; hooks.change(); if (initiator(pid)) setTimeout(() => peers.get(pid) === P && call(pid), 4000); }
      if (pc.connectionState === 'connected' && P.dc.readyState === 'open') { P.state = 'direct'; hooks.change(); }
    };
    return P;
  }

  async function call(pid) {
    const P = makePc(pid, newSid());
    // One audio slot per peer, set up front. Turning the mic on or off just swaps the track, no renegotiation.
    P.tr = P.pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (micOn && mic) await P.tr.sender.replaceTrack(mic.getAudioTracks()[0]);
    const offer = await P.pc.createOffer();
    await P.pc.setLocalDescription(offer);
    signal(pid, { k: 'offer', sid: P.sid, sdp: P.pc.localDescription.sdp });
    hooks.change();
  }

  async function onSignal(from, d) {
    if (!d || typeof d !== 'object' || !myId) return;
    try {
      if (d.k === 'hello') {
        if (initiator(from) && peers.get(from)?.pc?.signalingState !== 'have-local-offer') await call(from);   // an offer already on its way covers it
        return;
      }
      if (d.k === 'offer' && !initiator(from)) {
        const P = makePc(from, String(d.sid));
        await P.pc.setRemoteDescription({ type: 'offer', sdp: String(d.sdp) });
        P.tr = P.pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio') || null;
        if (P.tr) { P.tr.direction = 'sendrecv'; if (micOn && mic) await P.tr.sender.replaceTrack(mic.getAudioTracks()[0]); }
        await P.pc.setLocalDescription(await P.pc.createAnswer());
        signal(from, { k: 'answer', sid: P.sid, sdp: P.pc.localDescription.sdp });
        for (const c of P.pending.splice(0)) await P.pc.addIceCandidate(c).catch(() => {});
        hooks.change();
        return;
      }
      const P = peers.get(from);
      if (!P?.pc || d.sid !== P.sid) return;   // left over from an older connection attempt
      if (d.k === 'answer' && P.pc.signalingState === 'have-local-offer') {
        await P.pc.setRemoteDescription({ type: 'answer', sdp: String(d.sdp) });
        for (const c of P.pending.splice(0)) await P.pc.addIceCandidate(c).catch(() => {});
      }
      if (d.k === 'ice') {
        if (P.pc.remoteDescription) await P.pc.addIceCandidate(d.c).catch(() => {});
        else P.pending.push(d.c);
      }
      if (d.k === 'chat') receive(from, JSON.stringify({ text: d.text }), true);
    } catch (e) { console.warn('p2p', e); }
  }

  function receive(pid, raw, relayed = false) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const text = String(m.text || '').slice(0, MAX_TEXT).trim();
    if (text) hooks.chat(pid, text, relayed);
  }

  // Returns how many players the message went to directly and how many through the relay.
  function say(text) {
    text = String(text).slice(0, MAX_TEXT).trim();
    if (!text) return null;
    let direct = 0, relay = 0;
    for (const [pid, P] of peers) {
      if (P.dc?.readyState === 'open') { P.dc.send(JSON.stringify({ text })); direct++; }
      else { signal(pid, { k: 'chat', text }); relay++; }
    }
    return { text, direct, relay };
  }

  async function setMic(on) {
    if (on && !mic) {
      if (desk?.askMic && !(await desk.askMic())) throw new Error('Microphone access was denied in system settings.');
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    }
    micOn = !!on && !!mic;
    const track = micOn ? mic.getAudioTracks()[0] : null;
    for (const P of peers.values()) if (P.tr) await P.tr.sender.replaceTrack(track).catch(() => {});
    if (!micOn && mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }   // release the mic so the system indicator turns off
    hooks.change();
    return micOn;
  }

  function mute(pid, muted) {
    const P = peers.get(pid);
    if (!P) return;
    P.muted = muted;
    if (P.audio) P.audio.muted = muted;
    hooks.change();
  }

  function drop(pid) {
    const P = peers.get(pid);
    if (!P) return;
    try { P.pc?.close(); } catch {}
    if (P.audio) { P.audio.srcObject = null; }
    peers.delete(pid);
    hooks.change();
  }

  function closeAll() {
    for (const pid of [...peers.keys()]) drop(pid);
    if (mic) { mic.getTracks().forEach((t) => t.stop()); mic = null; }
    micOn = false;
    myId = null;
    hooks.change();
  }

  // Speaking lights: read incoming audio levels a few times a second.
  setInterval(async () => {
    let changed = false;
    for (const P of peers.values()) {
      if (!P.pc || P.pc.connectionState !== 'connected') continue;
      // average loudness since the last check, from the running energy totals
      let level = 0;
      try {
        (await P.pc.getStats()).forEach((r) => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'audio' || r.totalAudioEnergy == null) return;
          const dE = r.totalAudioEnergy - (P.lastE ?? r.totalAudioEnergy), dT = r.totalSamplesDuration - (P.lastT ?? r.totalSamplesDuration);
          P.lastE = r.totalAudioEnergy; P.lastT = r.totalSamplesDuration;
          if (dT > 0) level = Math.sqrt(dE / dT);
        });
      } catch {}
      const speaking = !P.muted && level > 0.02;
      if (speaking !== P.speaking) { P.speaking = speaking; changed = true; }
    }
    if (changed) hooks.change();
  }, 300);

  return {
    setup, sync, onSignal, say, setMic, mute, closeAll,
    get micOn() { return micOn; },
    async debugStats() { const o = []; for (const [id, P] of peers) { if (!P.pc) continue; (await P.pc.getStats()).forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') o.push({ id: id.slice(0, 4), bytes: r.bytesReceived, level: r.audioLevel, energy: r.totalAudioEnergy }); }); } return o; },
    peers: () => [...peers.entries()].map(([id, P]) => ({ id, state: P.state, speaking: P.speaking, muted: P.muted })),
  };
})();
