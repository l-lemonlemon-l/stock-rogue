// Seeded RNG so a run can be replayed / shared as a "daily seed" challenge.
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts) {
  let h = 2166136261;
  for (const ch of parts.join('|')) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function makeRng(...seedParts) {
  const r = mulberry32(hashSeed(...seedParts));
  const rng = () => r();
  rng.int = (min, max) => min + Math.floor(r() * (max - min + 1));
  rng.pick = (arr) => arr[Math.floor(r() * arr.length)];
  rng.normal = () => {
    let u = 0;
    while (u === 0) u = r();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  rng.weighted = (items, weightFn) => {
    const total = items.reduce((s, it) => s + weightFn(it), 0);
    let x = r() * total;
    for (const it of items) {
      x -= weightFn(it);
      if (x <= 0) return it;
    }
    return items[items.length - 1];
  };
  return rng;
}

module.exports = { makeRng, hashSeed };
