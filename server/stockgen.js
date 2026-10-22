// Procedurally generated companies. Yield = dividend paid per day as a share of your position's value.
// Every run (seed) gets a new market:
// new names, tickers, sectors, prices and personalities.

const PREFIX = ['Nova', 'Quantum', 'Bluefin', 'Ironwood', 'Silverline', 'Apex', 'Hyperion', 'Lunar', 'Pixel', 'Vertex', 'Solaris', 'Atlas',
  'Orbit', 'Echo', 'Cobalt', 'Zenith', 'Titan', 'Crystal', 'Rapid', 'Neon', 'Granite', 'Harbor', 'Maple', 'Summit', 'Falcon', 'Vortex',
  'Copper', 'Willow', 'Beacon', 'Polar', 'Redstone', 'Kestrel', 'Meridian', 'Onyx', 'Pioneer', 'Quill', 'Ridge', 'Sable', 'Tundra', 'Umbra'];

const SECTORS = {
  tech: { suffix: ['Systems', 'Robotics', 'Software', 'Networks', 'Labs', 'Dynamics', 'Computing', 'Micro'],
    vol: [0.035, 0.06], drift: [0.002, 0.007], yield: [0.004, 0.008], price: [20, 220], liq: [15000, 50000] },
  energy: { suffix: ['Energy', 'Power', 'Petroleum', 'Solar', 'Grid', 'Fuels'],
    vol: [0.025, 0.045], drift: [0.001, 0.005], yield: [0.010, 0.016], price: [15, 120], liq: [20000, 60000] },
  health: { suffix: ['Medical', 'Pharma', 'Health', 'Bio', 'Care', 'Genetics'],
    vol: [0.03, 0.065], drift: [0.001, 0.006], yield: [0.006, 0.010], price: [10, 180], liq: [12000, 50000] },
  finance: { suffix: ['Bank', 'Capital', 'Holdings', 'Trust', 'Financial', 'Insurance'],
    vol: [0.015, 0.03], drift: [0.002, 0.004], yield: [0.012, 0.020], price: [25, 140], liq: [40000, 90000] },
  retail: { suffix: ['Foods', 'Retail', 'Brands', 'Mart', 'Apparel', 'Outfitters'],
    vol: [0.015, 0.035], drift: [0.001, 0.004], yield: [0.008, 0.014], price: [8, 90], liq: [25000, 70000] },
  // scripted stock: rises for 3 seconds, plummets, then climbs back over 2 seconds, forever
  cycle: { suffix: ['Yo-Yo Co', 'Boomerang', 'Pendulum', 'Rollercoaster', 'Bungee Inc'],
    vol: [0, 0], drift: [0, 0], yield: [0, 0], price: [20, 60], liq: [20000, 30000] },
  meme: { suffix: ['Meme Co', 'Moonshot', 'Coin Corp', 'Rocket Inc', 'Hype Ltd'],
    vol: [0.10, 0.16], drift: [-0.002, 0.006], yield: [0, 0], price: [2, 14], liq: [3000, 7000] },
};

const between = (rng, [a, b]) => a + (b - a) * rng();

function makeTicker(name, used) {
  const letters = name.replace(/[^A-Za-z]/g, '').toUpperCase();
  const tries = [letters.slice(0, 4), letters[0] + letters.slice(2, 5), letters.slice(0, 3) + letters.slice(-1), letters.slice(0, 2) + letters.slice(-2)];
  for (const t of tries) if (t.length === 4 && !used.has(t)) { used.add(t); return t; }
  for (let i = 0; ; i++) { const t = letters.slice(0, 3) + String.fromCharCode(65 + (i % 26)); if (!used.has(t)) { used.add(t); return t; } }
}

// Always: 2 tech, 1 energy, 1 health, 1 finance, 1 retail, 1 meme, 1 cycle, + 1 random
function generateStocks(rng, count = 9) {
  const plan = ['tech', 'tech', 'energy', 'health', 'finance', 'retail', 'meme', 'cycle'];
  while (plan.length < count) plan.push(rng.pick(['tech', 'energy', 'health', 'finance', 'retail']));
  const usedNames = new Set(), usedTickers = new Set(), usedPrefixes = new Set();
  return plan.map((sector) => {
    const S = SECTORS[sector];
    let prefix;
    do prefix = rng.pick(PREFIX); while (usedPrefixes.has(prefix));
    usedPrefixes.add(prefix);
    let name = `${prefix} ${rng.pick(S.suffix)}`;
    if (usedNames.has(name)) name += ' Group';
    usedNames.add(name);
    const price = Math.round(Math.exp(between(rng, [Math.log(S.price[0]), Math.log(S.price[1])])) * 100) / 100;
    return {
      ticker: makeTicker(prefix, usedTickers), name, sector, price,
      vol: Math.round(between(rng, S.vol) * 10000) / 10000,
      drift: Math.round(between(rng, S.drift) * 100000) / 100000,
      liquidity: Math.round(between(rng, S.liq)),
      yield: Math.round(between(rng, S.yield) * 10000) / 10000, // dividend: share of position value paid per day
      ...(sector === 'cycle' ? { pattern: true } : {}),
    };
  });
}

module.exports = { generateStocks, SECTOR_NAMES: Object.keys(SECTORS) };
