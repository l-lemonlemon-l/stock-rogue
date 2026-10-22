// Shared market. Every player in a room trades on the same prices,
// and their orders move those prices (market impact).
const HISTORY_LIMIT = 600;

class Market {
  constructor(stockDefs, rng, ticksPerDay, tickMs = 500) {
    this.rng = rng;
    this.ticksPerDay = ticksPerDay;
    // Cycle stocks: up for 3 seconds, plummet, then climb back over 2 seconds
    this.cycle = { up: Math.max(1, Math.round(3000 / tickMs)), drop: 1, climb: Math.max(1, Math.round(2000 / tickMs)),
      upGain: 0.06, dropLoss: 0.10, climbGain: 0.055 };
    this.stocks = stockDefs.map((d) => ({
      ...d,
      history: [d.price],
      dayOpen: d.price,
      dayDrift: 0,
      dayVolMult: 1,
      halted: false,
      trend: 0,      // slow-moving drift that wanders, so charts form real trends instead of pure noise
    }));
    this.byTicker = Object.fromEntries(this.stocks.map((s) => [s.ticker, s]));
  }

  get(t) { return this.byTicker[t]; }
  tickers() { return this.stocks.map((s) => s.ticker); }
  price(t) { return this.byTicker[t].price; }
  all(fn) { this.stocks.forEach(fn); }
  forSector(sector, fn) { this.stocks.filter((s) => s.sector === sector).forEach(fn); }
  sectors() { return [...new Set(this.stocks.map((s) => s.sector))].filter((x) => x !== 'meme' && x !== 'cycle'); }

  startDay() {
    for (const s of this.stocks) {
      // no overnight gap: the market runs continuously
      s.dayOpen = s.price;
      s.dayDrift = 0;
      s.dayVolMult = 1;
      s.halted = false;
    }
  }

  // Geometric Brownian motion step plus event modifiers.
  tick() {
    const dt = 1 / this.ticksPerDay;
    for (const s of this.stocks) {
      if (s.halted) { this.push(s); continue; }
      if (s.pattern) { this.cycleStep(s); this.push(s); continue; }
      const vol = s.vol * s.dayVolMult;
      // trend regime: drifts toward a target that changes every so often
      if (this.rng() < 1 / (this.ticksPerDay * 0.6)) s.trendTarget = this.rng.normal() * s.vol * 1.6;
      s.trend += ((s.trendTarget || 0) - s.trend) * 0.03;
      const mu = s.drift + s.dayDrift + s.trend;
      const ret = mu * dt + vol * Math.sqrt(dt) * this.rng.normal(); // no volatility drag: prices drift up on average
      s.price = Math.max(0.5, s.price * Math.exp(ret));
      this.push(s);
    }
  }

  cycleStep(s) {
    const c = this.cycle, len = c.up + c.drop + c.climb;
    const i = (s.pt = ((s.pt ?? -1) + 1) % len);
    let m;
    if (i < c.up) m = Math.pow(1 + c.upGain, 1 / c.up);                // rising for 3s
    else if (i < c.up + c.drop) m = 1 - c.dropLoss;                    // plummet
    else m = Math.pow(1 + c.climbGain, 1 / c.climb);                   // climbing back over 2s
    m *= 1 + (this.rng() - 0.5) * 0.002;                               // a hair of noise
    s.price = Math.max(0.5, s.price * m);
    s.cyclePhase = i < c.up ? 'rising' : i < c.up + c.drop ? 'plummet' : 'climbing';
  }

  shock(t, pct) {
    const s = this.byTicker[t];
    s.price = Math.max(0.5, s.price * (1 + pct));
    s.history[s.history.length - 1] = s.price;
  }

  // Player orders push the price. Capped so one whale can't break a stock instantly.
  impact(t, value, side) {
    const s = this.byTicker[t];
    const pct = Math.min(0.03, value / s.liquidity * 0.02) * side;
    s.price = Math.max(0.5, s.price * (1 + pct));
    s.history[s.history.length - 1] = s.price;
    return Math.abs(pct);
  }

  push(s) {
    s.history.push(s.price);
    if (s.history.length > HISTORY_LIMIT) s.history.shift();
  }

  snapshot(full = false) {
    return this.stocks.map((s) => ({
      ticker: s.ticker,
      name: s.name,
      sector: s.sector,
      price: round(s.price),
      dayOpen: round(s.dayOpen),
      halted: s.halted,
      yield: s.yield,
      ...(full ? { history: s.history.map(round) } : {}),
    }));
  }
}

const round = (n) => Math.round(n * 100) / 100;

module.exports = { Market, round };
