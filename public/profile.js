// Your permanent save: certificates, Item Shop upgrades, rebirths, achievements, lifetime stats.
// Saved in local storage (the desktop app keeps this in its user data folder).
const Profile = (() => {
  const KEY = 'sr_profile_v1';
  const fresh = () => ({
    name: '', certificates: 0, certsSinceRebirth: 0, rebirths: 0, goldenShares: 0,
    bestDaysSinceRebirth: 0, upgrades: {}, achievements: {},
    life: { runs: 0, wins: 0, trades: 0, certificatesEarned: 0, bestNetWorth: 0, maxLoanDays: 0, bankruptcies: 0, loanDefaults: 0 },
    history: [],
    settings: { crt: true, sound: true },
  });
  let data = fresh();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (raw) data = { ...fresh(), ...raw, life: { ...fresh().life, ...raw.life }, settings: { ...fresh().settings, ...raw.settings } };
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} };

  const listeners = [];
  const changed = () => { save(); listeners.forEach((f) => f()); };

  function meta() { return { rebirths: data.rebirths, goldenShares: data.goldenShares, upgrades: data.upgrades }; }

  // ---------- Item Shop ----------
  function upgradeLevel(id) { return data.upgrades[id] || 0; }
  function upgradeCost(u) { return u.cost(upgradeLevel(u.id)); }
  function upgradeMax(u) { return META.maxLevel(u, data.rebirths); }
  function buyUpgrade(id) {
    const u = META.UPGRADE_BY_ID[id];
    if (!u || upgradeLevel(id) >= upgradeMax(u)) return false;
    const cost = upgradeCost(u);
    if (data.certificates < cost) return false;
    data.certificates -= cost;
    data.upgrades[id] = upgradeLevel(id) + 1;
    changed();
    return true;
  }

  // ---------- rebirth ----------
  function canRebirth() { return (data.bestDaysSinceRebirth || 0) >= META.REBIRTH_DAYS_NEEDED; }
  function rebirth() {
    if (!canRebirth()) return 0;
    const gained = META.rebirthReward(data);
    data.rebirths += 1;
    data.goldenShares += gained;
    data.certificates = 0;
    data.certsSinceRebirth = 0;
    data.upgrades = {};
    data.bestDaysSinceRebirth = 0;
    changed();
    return gained;
  }

  // ---------- end of run ----------
  function recordRun(res) {
    const s = res.stats;
    const days = s.daysSurvived || res.day;
    const result = { days, peakNetWorth: s.peakNetWorth, cashedOut: s.cashedOut, lastStanding: s.lastStanding, loanDefault: s.loanDefault };
    const won = s.cashedOut || s.lastStanding;
    const certs = META.certificatesFor(result, meta());
    data.certificates += certs;
    data.certsSinceRebirth += certs;
    const L = data.life;
    L.runs += 1;
    if (won) L.wins += 1;
    L.trades += s.trades;
    L.certificatesEarned += certs;
    L.bestNetWorth = Math.max(L.bestNetWorth, s.peakNetWorth);
    L.maxLoanDays = Math.max(L.maxLoanDays, s.daysOnLoan);
    L.bankruptcies += s.bankrupt;
    if (s.loanDefault) L.loanDefaults += 1;
    data.bestDaysSinceRebirth = Math.max(data.bestDaysSinceRebirth || 0, days);
    L.bestDays = Math.max(L.bestDays || 0, days);
    data.history.unshift({ date: new Date().toISOString(), mode: res.mode, won, result: s.lastStanding ? 'Last standing' : s.cashedOut ? 'Cashed out' : 'Lost',
      day: days, netWorth: res.netWorth, certs, daysOnLoan: s.daysOnLoan, reason: res.reason || '' });
    data.history = data.history.slice(0, 25);
    changed();
    return certs;
  }

  // ---------- achievements ----------
  // Returns the achievements that just unlocked.
  function checkAchievements(run, outcome) {
    const ctx = { run: run || {}, life: data.life, profile: data, outcome };
    const fresh = [];
    for (const a of META.ACHIEVEMENTS) {
      if (data.achievements[a.id]) continue;
      let ok = false;
      try { ok = !!a.check(ctx); } catch {}
      if (ok) { data.achievements[a.id] = new Date().toISOString(); fresh.push(a); }
    }
    if (fresh.length) {
      changed();
      // Completionist may unlock as a result of the others
      fresh.push(...checkAchievements(run, outcome));
    }
    return fresh;
  }

  // ---------- hex save codes ----------
  // Layout: "SR" + version byte + deflate-compressed JSON + CRC32 (4 bytes), written as hex.
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }
  async function exportHex() {
    const body = await pipe(new TextEncoder().encode(JSON.stringify(data)), new CompressionStream('deflate-raw'));
    const out = new Uint8Array(3 + body.length + 4);
    out.set([0x53, 0x52, 1]); out.set(body, 3);
    new DataView(out.buffer).setUint32(out.length - 4, crc32(out.subarray(0, out.length - 4)));
    const hex = [...out].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    return hex.match(/.{1,8}/g).join(' ');
  }
  // Checks a code and returns the save inside it (without loading it). Throws a readable error.
  async function readHex(code) {
    const hex = String(code).replace(/[^0-9a-fA-F]/g, '');
    if (hex.length < 16 || hex.length % 2) throw new Error('That is not a complete save code.');
    const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
    if (bytes[0] !== 0x53 || bytes[1] !== 0x52) throw new Error('That is not a Stock Rogue save code.');
    if (bytes[2] !== 1) throw new Error('This save code is from a newer version of the game.');
    const want = new DataView(bytes.buffer).getUint32(bytes.length - 4);
    if (crc32(bytes.subarray(0, bytes.length - 4)) !== want) throw new Error('The save code is damaged or was edited (checksum does not match).');
    let raw;
    try { raw = JSON.parse(new TextDecoder().decode(await pipe(bytes.subarray(3, bytes.length - 4), new DecompressionStream('deflate-raw')))); }
    catch { throw new Error('The save code could not be read.'); }
    if (!raw || typeof raw !== 'object') throw new Error('The save code is empty.');
    return { ...fresh(), ...raw, life: { ...fresh().life, ...raw.life }, settings: { ...fresh().settings, ...raw.settings } };
  }
  function load(save) { data = save; changed(); }

  return {
    get data() { return data; }, save, changed, onChange: (f) => listeners.push(f),
    exportHex, readHex, load,
    meta, upgradeLevel, upgradeCost, upgradeMax, buyUpgrade,
    canRebirth, rebirth, recordRun, checkAchievements,
    reset() { data = fresh(); changed(); },
  };
})();
