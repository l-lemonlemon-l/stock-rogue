// Rooms and per-connection message handling, shared by the Node server (server/index.js)
// and the in-browser host used for solo play on the web and Android (server/local.js).
// A "socket" here is anything with send(string), readyState (1 = open) and close().
const { Game } = require('./game');
const META = require('../shared/meta');

const rnd = globalThis.crypto;
const randomHex = (bytes) => Array.from(rnd.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
const randomId = () => rnd.randomUUID();
const randomSeed = () => rnd.getRandomValues(new Uint32Array(1))[0] % 1e9;

function createHub({ devConfig = false } = {}) {
  const rooms = new Map();   // code -> { game, sockets: Map<playerId, socket> }
  const presence = new Map(); // friend code -> { room, socket } for players currently in a room

  // Friends list lookup: which of these friend codes are in a room right now, and which room.
  function friendStatus(codes) {
    const out = {};
    for (const raw of (Array.isArray(codes) ? codes : []).slice(0, 100)) {
      const fc = META.cleanFriendCode(raw);
      if (!fc) continue;
      const pr = presence.get(fc);
      const g = pr && rooms.get(pr.room)?.game;
      out[fc] = g ? { room: g.code, phase: g.phase, day: g.day, players: g.players.size, mode: g.cfg.mode } : null;
    }
    return out;
  }

  function newCode() {
    let code;
    do { code = randomHex(3).toUpperCase(); } while (rooms.has(code));
    return code;
  }

  function createRoom({ mode, seed, config }) {
    const code = newCode();
    const sockets = new Map();
    const send = (id, msg) => { const ws = sockets.get(id); if (ws?.readyState === 1) ws.send(JSON.stringify(msg)); };
    const io = {
      send,
      broadcast: (msg) => { const s = JSON.stringify(msg); for (const ws of sockets.values()) if (ws.readyState === 1) ws.send(s); },
    };
    const game = new Game({ code, seed: String(seed || randomSeed()), config: { ...config, mode }, io });
    const room = { game, sockets };
    rooms.set(code, room);
    return room;
  }

  // Returns handlers for one connection: onMessage(raw), onClose().
  function connection(ws) {
    let room = null;
    let playerId = null;
    let friendCode = '';
    const reply = (msg) => ws.send(JSON.stringify(msg));
    let windowStart = Date.now(), count = 0, rtcCount = 0;   // rate limits: 20 game messages and 200 chat-signaling messages per second

    function onMessage(raw) {
      if (Date.now() - windowStart > 1000) { windowStart = Date.now(); count = 0; rtcCount = 0; }
      if (raw.length > 16384) return;
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      // Peer-to-peer chat signaling: the server only passes connection offers between players in the same room.
      // Text and voice then flow directly between the players.
      if (msg.t === 'rtc') {
        if (!room || ++rtcCount > 200) return;
        const target = room.sockets.get(String(msg.to));
        if (target && target !== ws && target.readyState === 1) target.send(JSON.stringify({ t: 'rtc', from: playerId, d: msg.d }));
        return;
      }
      if (++count > 20) return;

      if (msg.t === 'friends') return reply({ t: 'friends', status: friendStatus(msg.codes) });

      if (!room) {
        if (msg.t === 'create') {
          room = createRoom({ mode: msg.mode === 'coop' ? 'coop' : 'versus', seed: msg.seed,
            config: { ...(devConfig ? msg.config : {}), fair: !!msg.fair } });
        } else if (msg.t === 'join') {
          room = rooms.get(String(msg.code || '').toUpperCase());
          if (!room) return reply({ t: 'error', text: 'Room not found.' });
        } else return;

        // reconnect with a token, otherwise new player
        const g = room.game;
        // late joiners (after the run started) are added as spectators by Game.addPlayer
        playerId = msg.token && g.players.has(msg.token) ? msg.token : randomId();
        room.sockets.set(playerId, ws);
        friendCode = META.cleanFriendCode(msg.fc);
        if (friendCode) presence.set(friendCode, { room: g.code, socket: ws });
        g.addPlayer(playerId, msg.name, msg.meta, friendCode);
        reply({ t: 'joined', code: g.code, token: playerId });
        g.resync(playerId);
        return;
      }

      room.game.handle(playerId, msg);
    }

    function onClose() {
      if (friendCode && presence.get(friendCode)?.socket === ws) presence.delete(friendCode);
      if (!room) return;
      if (room.sockets.get(playerId) === ws) room.sockets.delete(playerId);
      room.game.disconnect(playerId);
      if (room.sockets.size === 0) {
        // keep empty rooms briefly so people can reconnect
        const r = room;
        setTimeout(() => {
          if (r.sockets.size === 0 && rooms.get(r.game.code) === r) { r.game.destroy(); rooms.delete(r.game.code); }
          for (const [fc, pr] of presence) if (pr.room === r.game.code && !rooms.has(pr.room)) presence.delete(fc);
        }, 60_000);
      }
    }

    return { onMessage, onClose };
  }

  return { rooms, connection };
}

module.exports = { createHub };
