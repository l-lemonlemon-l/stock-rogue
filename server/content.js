// All game content lives here: stocks, perks (relics), market events.
// Add new content by appending to these arrays; the engine picks it up automatically.

// Stocks are generated fresh for every run: see stockgen.js

// Perk hooks (all optional):
//   feeMult, buyingPowerMult, loanDays, freeRerolls  -> stacked numbers
//   gainMult(ctx)            -> multiplier on realized profit of a sell
//   onDayStart(p, game)      -> runs before trading each day
//   onDayEnd(p, game)        -> runs after trading each day
//   onTick(p, game)          -> runs every tick
//   active { name, cooldownDays, needsTicker, use(p, game, ticker) } -> button the player can press
const PERKS = [
  { id: 'discount_broker', name: 'Discount Broker', rarity: 'common', cost: 120,
    desc: 'Trading fees halved.', feeMult: 0.5 },
  { id: 'savings', name: 'Savings Account', rarity: 'common', cost: 150,
    desc: 'Earn 2% interest on cash at the end of each day.',
    onDayEnd: (p, g) => g.grant(p, Math.max(0, p.cash) * 0.02, 'Savings interest') },
  { id: 'dividends', name: 'Dividend Hunter', rarity: 'common', cost: 180,
    desc: 'Earn 1% of your stock value at the end of each day.',
    onDayEnd: (p, g) => g.grant(p, g.holdingsValue(p) * 0.01, 'Dividends') },
  { id: 'lucky_coin', name: 'Lucky Coin', rarity: 'common', cost: 90,
    desc: 'One free shop reroll every shop.', freeRerolls: 1 },
  { id: 'safety_net', name: 'Safety Net', rarity: 'uncommon', cost: 200,
    desc: 'Automatically sells any holding that falls 15% below your average cost.',
    onTick: (p, g) => {
      for (const [t, h] of Object.entries(p.holdings)) {
        if (h.qty > 0 && g.market.price(t) < h.avgCost * 0.85) g.execSell(p, t, h.qty, 'Safety Net');
      }
    } },
  { id: 'margin', name: 'Margin Account', rarity: 'uncommon', cost: 250,
    desc: 'Buying power is 150% of your net worth (you can go into debt).', buyingPowerMult: 1.5 },
  { id: 'tech_fan', name: 'Tech Fanatic', rarity: 'uncommon', cost: 220,
    desc: 'Profits from selling tech stocks are worth 30% more.',
    gainMult: (c) => (c.stock.sector === 'tech' ? 1.3 : 1) },
  { id: 'contrarian', name: 'Contrarian', rarity: 'uncommon', cost: 230,
    desc: 'Profits are worth 25% more on stocks that are down today.',
    gainMult: (c) => (c.price < c.dayOpen ? 1.25 : 1) },
  { id: 'lobbyist', name: 'Lobbyist', rarity: 'rare', cost: 350,
    desc: 'Every loan gives you 2 extra days to pay it back.', loanDays: 2 },
  { id: 'insider', name: 'Insider Whisper', rarity: 'rare', cost: 300,
    desc: "At the start of each day, learn which event is coming next.",
    onDayStart: (p, g) => g.whisper(p) },
  { id: 'rumor_mill', name: 'Rumor Mill', rarity: 'rare', cost: 320,
    desc: 'Active, once per day: spread a rumor that drops a stock 6%. Affects every player.',
    active: { name: 'Spread rumor', cooldownDays: 1, needsTicker: true,
      use: (p, g, t) => { g.market.shock(t, -0.06); g.log(`${p.name} spread a rumor about ${t}.`); } } },
  { id: 'pump', name: 'Hype Machine', rarity: 'rare', cost: 320,
    desc: 'Active, once per day: hype a stock up 6%. Affects every player.',
    active: { name: 'Hype stock', cooldownDays: 1, needsTicker: true,
      use: (p, g, t) => { g.market.shock(t, 0.06); g.log(`${p.name} is hyping ${t}.`); } } },
  { id: 'golden_parachute', name: 'Golden Parachute', rarity: 'legendary', cost: 500,
    desc: 'Forgives one loan that would have ended your run. Used up when it saves you.', saveOnce: true },
];

// Market events. Applied by the market at day start (scheduled) or randomly mid-day.
const EVENTS = [
  { id: 'sector_boom', name: 'Sector Boom', weight: 3,
    roll: (rng, m) => ({ sector: rng.pick(m.sectors()) }),
    text: (a) => `${a.sector} stocks are surging today.`,
    apply: (m, a) => m.forSector(a.sector, (s) => { s.dayDrift += 0.06; }) },
  { id: 'sector_bust', name: 'Sector Bust', weight: 3,
    roll: (rng, m) => ({ sector: rng.pick(m.sectors()) }),
    text: (a) => `${a.sector} stocks are getting hammered today.`,
    apply: (m, a) => m.forSector(a.sector, (s) => { s.dayDrift -= 0.06; }) },
  { id: 'earnings', name: 'Earnings Surprise', weight: 4,
    roll: (rng, m) => ({ ticker: rng.pick(m.tickers()), dir: rng() < 0.5 ? -1 : 1 }),
    text: (a) => `${a.ticker} earnings ${a.dir > 0 ? 'beat' : 'missed'} expectations.`,
    apply: (m, a) => m.shock(a.ticker, 0.15 * a.dir) },
  { id: 'flash_crash', name: 'Flash Crash', weight: 1,
    roll: () => ({}),
    text: () => 'Flash crash: everything drops, then tends to recover.',
    apply: (m) => m.all((s) => { m.shock(s.ticker, -0.08); s.dayDrift += 0.05; }) },
  { id: 'meme_mania', name: 'Meme Mania', weight: 2,
    roll: (rng, m) => ({ ticker: rng.pick(m.tickers()) }),
    text: (a) => `${a.ticker} is trending online. Expect wild swings.`,
    apply: (m, a) => { m.get(a.ticker).dayVolMult *= 3; } },
  { id: 'rate_hike', name: 'Rate Hike', weight: 2,
    roll: () => ({}),
    text: () => 'Interest rates raised. The whole market leans down.',
    apply: (m) => m.all((s) => { s.dayDrift -= 0.025; }) },
  { id: 'halt', name: 'Trading Halt', weight: 2,
    roll: (rng, m) => ({ ticker: rng.pick(m.tickers()) }),
    text: (a) => `${a.ticker} is halted for the rest of the day.`,
    apply: (m, a) => { m.get(a.ticker).halted = true; } },
  { id: 'quiet', name: 'Quiet Day', weight: 3,
    roll: () => ({}),
    text: () => 'A quiet day on the market.',
    apply: (m) => m.all((s) => { s.dayVolMult *= 0.6; }) },
];

// One-use items, bought in the between-day shop and used during trading.
// use(p, game, ticker) runs when the player uses it. Buffs last until the end of the current day.
const ITEMS = [
  { id: 'stop_loss', name: 'Stop-Loss Order', cost: 60,
    desc: 'For the rest of today, auto-sells any position that falls 10% below your cost.',
    use: (p, g) => { p.buffs.stopLoss = g.day; } },
  { id: 'insider_report', name: 'Insider Report', cost: 80,
    desc: "Reveals today's breaking news before it happens.",
    use: (p, g) => g.whisper(p) },
  { id: 'fee_waiver', name: 'Fee Waiver', cost: 50,
    desc: 'No trading fees for the rest of today.',
    use: (p, g) => { p.buffs.noFees = g.day; } },
  { id: 'margin_boost', name: 'Margin Boost', cost: 120,
    desc: '+50% buying power for the rest of today.',
    use: (p, g) => { p.buffs.margin = g.day; } },
  { id: 'pump_kit', name: 'Pump Kit', cost: 110, needsTicker: true,
    desc: 'Pushes the selected stock up 4%. Affects everyone.',
    use: (p, g, t) => { g.market.shock(t, 0.04); g.log(`Someone is pumping ${t}.`); } },
  { id: 'short_report', name: 'Short Report', cost: 110, needsTicker: true,
    desc: 'Publishes a nasty report that drops the selected stock 4%. Affects everyone.',
    use: (p, g, t) => { g.market.shock(t, -0.04); g.log(`A short report hits ${t}.`); } },
];

const RARITY_WEIGHT = { common: 10, uncommon: 6, rare: 3, legendary: 1 };

module.exports = { PERKS, EVENTS, ITEMS, RARITY_WEIGHT };
