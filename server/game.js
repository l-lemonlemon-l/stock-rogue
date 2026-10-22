// One room = one run. The server is authoritative: clients only send intents.
const { makeRng } = require('./rng');
const { Market, round } = require('./market');
const { PERKS, EVENTS, ITEMS, RARITY_WEIGHT } = require('./content');
const { generateStocks } = require('./stockgen');
const META = require('../shared/meta');

const usd = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const PERK_BY_ID = Object.fromEntries(PERKS.map((p) => [p.id, p]));
const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

const DEFAULT_CONFIG = {
  mode: 'versus',        // 'versus' = last trader standing wins, 'coop' = play together
  fair: false,           // true = ignore everyone's permanent upgrades (even playing field)
  startCash: 1000,
  ticksPerDay: 90,
  tickMs: 500,           // 90 ticks * 0.5s = 45s trading days (slower, calmer market)
  feeRate: 0.0025,      // 0.25% per trade
  shopSize: 3,
  rerollBase: 30,
  midDayEventChance: 0.8,
};

const newStats = () => ({
  trades: 0, buys: 0, sells: 0, lossSells: 0, biggestTrade: 0, bestProfit: 0, memeBestProfit: 0,
  whale: false, perksBought: 0, legendary: false, rerolls: 0, activesUsed: 0, itemsBought: 0, itemsUsed: 0,
  cashedOut: false, bankrupt: 0, loansTaken: 0, loansRepaid: 0, sharkRepaid: false,
  daysOnLoan: 0, loanDefault: false, heldThreeDays: false, haltedTry: false, flashCrashGreen: false,
  peakNetWorth: 0, lastStanding: false, coop: false, daysSurvived: 0,
});

class Game {
  constructor({ code, seed, config, io }) {
    this.code = code;
    this.seed = seed;
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.io = io; // { broadcast(msg), send(playerId, msg) }
    this.rng = makeRng(seed, 'market');
    this.eventRng = makeRng(seed, 'events');
    this.market = new Market(generateStocks(makeRng(seed, 'stocks')), this.rng, this.cfg.ticksPerDay, this.cfg.tickMs);
    this.players = new Map();
    this.phase = 'lobby';
    this.day = 0;
    this.tickN = 0;
    this.hostId = null;
    this.timer = null;
    this.midEvent = null;
    this.nextOpen = null;
    this.flashToday = false;
  }

  // ---------- lobby ----------
  addPlayer(id, name, meta) {
    if (this.players.has(id)) { this.players.get(id).connected = true; return this.players.get(id); }
    const m = this.cfg.fair ? META.sanitizeMeta({}) : META.sanitizeMeta(meta);
    const startCash = (this.cfg.startCash + 100 * (m.upgrades.seed_money || 0)) * META.startCashBonusMult(m);
    const p = {
      id, name: String(name || 'Trader').slice(0, 16), meta: m,
      cash: startCash, holdings: {}, perks: [], items: {}, buffs: {},
      loan: null, bankrupt: false, outReason: null,
      alive: this.phase === 'lobby', ready: false, connected: true,
      offers: [], rerolls: 0, cooldowns: {}, index: this.players.size,
      stats: newStats(), dayStartNW: startCash, startCash,
    };
    p.stats.coop = this.cfg.mode === 'coop';
    this.players.set(id, p);
    if (!this.hostId) this.hostId = id;
    this.log(`${p.name} joined.`);
    this.broadcastLobby();
    return p;
  }

  disconnect(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    if (this.phase === 'lobby') { this.players.delete(id); if (this.hostId === id) this.hostId = [...this.players.keys()][0] || null; }
    this.broadcastLobby();
  }

  start(byId) {
    if (this.phase !== 'lobby' || byId !== this.hostId) return;
    // Head Start upgrade: a free random perk
    for (const p of this.players.values()) {
      const lvl = p.meta.upgrades.head_start || 0;
      if (!lvl) continue;
      const rng = makeRng(this.seed, 'headstart', p.index);
      const pool = PERKS.filter((x) => (lvl >= 2 ? x.rarity !== 'common' : x.rarity === 'common'));
      const perk = rng.weighted(pool, (x) => RARITY_WEIGHT[x.rarity]);
      p.perks.push(perk.id);
      this.note(p, `Head Start: you begin with ${perk.name}.`);
    }
    this.beginRun();
  }

  // ---------- day loop ----------
  // The market never closes: days roll over seamlessly while trading continues.
  // A "day" is just a time unit for loans, events, dividends and the shop restock.
  beginRun() {
    this.phase = 'trading';
    this.newDay();
    this.timer = setInterval(() => this.onTick(), this.cfg.tickMs);
  }

  newDay() {
    this.day += 1;
    this.tickN = 0;
    this.market.startDay();

    const open = this.rollEvent();
    open.def.apply(this.market, open.args);
    this.flashToday = open.def.id === 'flash_crash';
    this.log(`Day ${this.day}. ${open.def.text(open.args)}`);

    this.midEvent = this.eventRng() < this.cfg.midDayEventChance
      ? { ...this.rollEvent(), atTick: Math.floor(this.cfg.ticksPerDay * (0.3 + this.eventRng() * 0.5)) }
      : null;

    for (const p of this.alivePlayers()) {
      p.dayStartNW = this.netWorth(p);
      p.rerolls = 0;
      p.offers = this.rollOffers(p); // the shop restocks every day
      this.hooks(p, 'onDayStart');
    }
    if (this.day === 1) this.io.broadcast({ t: 'day', day: this.day, ticksPerDay: this.cfg.ticksPerDay, market: this.market.snapshot(true) });
    else this.io.broadcast({ t: 'newday', day: this.day, opens: Object.fromEntries(this.market.stocks.map((s) => [s.ticker, round(s.dayOpen)])) });
    this.sendAllPrivate();
  }

  onTick() {
    this.tickN += 1;
    this.market.tick();
    if (this.midEvent && this.tickN === this.midEvent.atTick) {
      this.midEvent.def.apply(this.market, this.midEvent.args);
      if (this.midEvent.def.id === 'flash_crash') this.flashToday = true;
      this.log(`Breaking: ${this.midEvent.def.text(this.midEvent.args)}`);
      this.midEvent = null;
    }
    for (const p of this.alivePlayers()) {
      this.hooks(p, 'onTick');
      if (p.buffs.stopLoss === this.day) {
        for (const [t, h] of Object.entries(p.holdings)) {
          if (this.market.price(t) < h.avgCost * 0.9) this.execSell(p, t, h.qty, 'Stop-loss');
        }
      }
      this.payDividends(p);
      this.checkBroke(p);
      p.stats.peakNetWorth = Math.max(p.stats.peakNetWorth, this.netWorth(p));
    }
    this.io.broadcast({ t: 'tick', tick: this.tickN, prices: this.market.snapshot(), board: this.board() });
    this.sendAllPrivate();
    if (this.tickN >= this.cfg.ticksPerDay) this.rollover();
  }

  // Owning a stock pays its yield (a % of the position's current value per day), a little every tick.
  payDividends(p) {
    for (const [t, h] of Object.entries(p.holdings)) {
      const s = this.market.get(t);
      if (!s.yield || s.halted) continue;
      const amt = (h.qty * s.price * s.yield) / this.cfg.ticksPerDay;
      p.cash += amt;
      h.divs = (h.divs || 0) + amt;
      p.stats.dividends = (p.stats.dividends || 0) + amt;
    }
  }

  // end-of-day bookkeeping, then the next day starts immediately
  rollover() {
    for (const p of this.alivePlayers()) {
      this.hooks(p, 'onDayEnd');
      p.stats.daysSurvived = this.day;
      for (const h of Object.values(p.holdings)) if (this.day - h.openedDay >= 2) p.stats.heldThreeDays = true;
      if (this.flashToday && this.netWorth(p) > p.dayStartNW) p.stats.flashCrashGreen = true;
      // broke at the end of the day with no loan taken: the bank picks the smallest loan for you
      if (p.bankrupt && !p.loan) this.takeLoan(p, 'small', true);
      this.checkLoan(p);
    }
    if (this.endIfDecided()) return;
    this.newDay();
  }

  // Runs are endless. A run ends when nobody is left trading,
  // or in Versus when only one trader is still standing.
  endIfDecided() {
    const alive = this.alivePlayers();
    if (alive.length === 0) { this.finish(false); return true; }
    if (this.cfg.mode === 'versus' && this.players.size > 1 && alive.length === 1) {
      alive[0].stats.lastStanding = true;
      alive[0].outReason = `Last trader standing after ${this.day} days.`;
      this.log(`${alive[0].name} is the last trader standing!`);
      this.finish(true);
      return true;
    }
    return false;
  }

  // Player ends their own run and keeps what they made.
  cashOut(p) {
    if (!p.alive || !this.phase === 'trading') return;
    const nw = this.netWorth(p);
    p.stats.cashedOut = true;
    p.stats.peakNetWorth = Math.max(p.stats.peakNetWorth, nw);
    p.stats.cashOutValue = round(nw);
    p.stats.daysSurvived = this.day;
    p.alive = false;
    p.outReason = `Cashed out with ${usd(nw)} after ${this.day} day${this.day === 1 ? '' : 's'}.`;
    this.log(`${p.name} cashed out with ${usd(nw)}.`);
    this.sendResults(p, true);
    if (this.endIfDecided()) return;
  }

  // Golden Parachute: forgives one loan that would have ended your run.
  parachute(p) {
    const save = p.perks.find((id) => PERK_BY_ID[id].saveOnce);
    if (!save || !p.loan) return false;
    p.perks = p.perks.filter((id) => id !== save);
    this.log(`${p.name} was saved by Golden Parachute. Their debt is forgiven.`);
    p.loan = null;
    return true;
  }

  eliminate(p, reason) {
    if (!p.alive) return;
    p.alive = false;
    p.outReason = reason;
    this.log(`${p.name} is out. ${reason}`);
    this.sendResults(p, false);
  }

  finish(won) {
    clearInterval(this.timer);
    clearTimeout(this.timer);
    this.phase = 'over';
    for (const p of this.players.values()) if (p.alive) this.sendResults(p, won);
    this.io.broadcast({ t: 'over', survived: won, board: this.board() });
  }

  // Personal end-of-run report (sent when you are knocked out, or when the run ends)
  sendResults(p, won) {
    if (p.resultsSent) return;
    p.resultsSent = true;
    this.io.send(p.id, {
      t: 'results', won, alive: p.alive, reason: p.outReason, mode: this.cfg.mode, day: this.day,
      stats: p.stats, netWorth: round(p.stats.cashOutValue ?? this.netWorth(p)), startCash: round(p.startCash), fair: this.cfg.fair,
    });
  }

  // ---------- money trouble ----------
  checkBroke(p) {
    if (!p.alive) return;
    const broke = p.cash < 1 && this.holdingsValue(p) < 1;
    if (!broke) { p.bankrupt = false; return; }
    if (p.loan) {
      if (this.parachute(p)) { this.checkBroke(p); return; }
      p.stats.loanDefault = true;
      this.eliminate(p, `Broke with an unpaid loan of ${usd(p.loan.owed)}. The loan sharks got you after ${p.stats.daysOnLoan} days on borrowed money.`);
      this.endIfDecided();
      return;
    }
    if (!p.bankrupt) {
      p.bankrupt = true;
      p.stats.bankrupt += 1;
      this.log(`${p.name} hit $0.`);
      this.io.send(p.id, { t: 'bankrupt' });
    }
  }

  takeLoan(p, tierId, forced = false) {
    if (!p.alive || p.loan || !this.phase === 'trading') return;
    const offer = this.loanOffers(p).find((o) => o.id === tierId);
    if (!offer) return;
    p.loan = { tier: offer.id, name: offer.name, principal: offer.amount, owed: offer.owed, takenDay: this.day,
      dueDay: this.day + offer.days };
    p.cash += offer.amount;
    p.bankrupt = false;
    p.stats.loansTaken += 1;
    this.note(p, `${forced ? 'You were broke at the bell, so the bank gave you a loan. ' : ''}` +
      `Borrowed ${usd(offer.amount)} from ${offer.name}. Pay back ${usd(offer.owed)} by the end of day ${p.loan.dueDay}.`);
    this.log(`${p.name} took a loan from ${offer.name}.`);
  }

  repayLoan(p, amount) {
    if (!p.alive || !p.loan) return;
    const pay = Math.min(Number(amount) || p.loan.owed, p.loan.owed, Math.max(0, p.cash));
    if (pay <= 0) return this.note(p, 'Not enough cash to make a payment.');
    p.cash -= pay;
    p.loan.owed = round(p.loan.owed - pay);
    if (p.loan.owed <= 0.005) {
      p.stats.loansRepaid += 1;
      if (p.loan.tier === 'shark') p.stats.sharkRepaid = true;
      this.note(p, `Loan from ${p.loan.name} paid off.`);
      this.log(`${p.name} paid off their loan.`);
      p.loan = null;
    } else this.note(p, `Paid ${usd(pay)}. Still owe ${usd(p.loan.owed)}.`);
  }

  // runs at every market close
  checkLoan(p) {
    if (!p.alive || !p.loan) return;
    p.stats.daysOnLoan += 1;
    const left = p.loan.dueDay - this.day;
    if (left > 0) return this.note(p, `Loan reminder: ${usd(p.loan.owed)} due in ${left} day${left > 1 ? 's' : ''}.`);
    // due today. Auto-pay from cash if possible.
    if (p.cash >= p.loan.owed) { this.repayLoan(p, p.loan.owed); return; }
    if (this.parachute(p)) return;
    p.stats.loanDefault = true;
    this.eliminate(p, `Did not repay ${usd(p.loan.owed)} to ${p.loan.name}. The loan sharks got you after ${p.stats.daysOnLoan} days on borrowed money.`);
  }

  // ---------- shop (open any time) ----------
  rollOffers(p) {
    const rng = makeRng(this.seed, 'shop', this.day, p.index, p.rerolls);
    const pool = PERKS.filter((perk) => !p.perks.includes(perk.id));
    const offers = [];
    const size = this.cfg.shopSize + (p.meta.upgrades.extra_shelf || 0);
    while (offers.length < size && pool.length) {
      const pick = rng.weighted(pool, (x) => RARITY_WEIGHT[x.rarity]);
      offers.push(pick.id);
      pool.splice(pool.indexOf(pick), 1);
    }
    return offers;
  }

  rerollCost(p) {
    const free = this.stat(p, 'freeRerolls', 0, (a, b) => a + b) + (p.meta.upgrades.lucky_charm || 0);
    return p.rerolls < free ? 0 : this.cfg.rerollBase * (p.rerolls - free + 1);
  }

  // ---------- intents from clients ----------
  handle(id, msg) {
    const p = this.players.get(id);
    if (!p) return;
    try {
      switch (msg.t) {
        case 'start': return this.start(id);
        case 'buy': return this.tradeGuard(p, msg) && this.execBuy(p, msg.ticker, msg.qty);
        case 'sell': return this.tradeGuard(p, msg) && this.execSell(p, msg.ticker, msg.qty);
        case 'active': return this.useActive(p, msg.perk, msg.ticker);
        case 'shop_buy': return this.shopBuy(p, msg.perk);
        case 'item_buy': return this.itemBuy(p, msg.item);
        case 'item_use': return this.itemUse(p, msg.item, msg.ticker);
        case 'reroll': return this.reroll(p);
        case 'loan_take': return this.takeLoan(p, msg.tier);
        case 'loan_repay': return this.repayLoan(p, msg.amount);
        case 'cash_out': return this.cashOut(p);
      }
    } finally {
      if (p.alive) this.checkBroke(p);
      this.sendPrivate(p);
    }
  }

  // Orders can be a share count (qty) or a percent: buy = % of buying power, sell = % of your shares.
  tradeGuard(p, msg) {
    const s = this.market.get(msg.ticker);
    if (this.phase !== 'trading' || !p.alive || !s) return false;
    if (p.bankrupt) { this.note(p, 'You are broke. Take out a loan to keep trading.'); return false; }
    if (s.halted) { p.stats.haltedTry = true; this.note(p, `${s.ticker} is halted.`); return false; }
    let qty = Math.floor(Number(msg.qty));
    if (msg.pct !== undefined) {
      const pct = Math.max(0, Math.min(100, Number(msg.pct) || 0));
      if (msg.t === 'buy') {
        const budget = this.buyingPower(p) * pct / 100;
        qty = Math.floor(budget / (s.price * (1 + this.cfg.feeRate)) - 1e-9);
        while (qty > 0 && s.price * qty + this.fee(p, s.price * qty) > this.buyingPower(p)) qty -= 1;
        if (qty < 1) { this.note(p, `${pct}% of your cash is not enough for one share of ${s.ticker}.`); return false; }
      } else {
        const held = p.holdings[s.ticker]?.qty || 0;
        if (!held) { this.note(p, `You don't own any ${s.ticker}.`); return false; }
        qty = pct >= 100 ? held : Math.max(1, Math.floor(held * pct / 100));
      }
    }
    if (!(qty > 0)) return false;
    msg.qty = qty;
    return true;
  }

  fee(p, value) {
    if (p.buffs.noFees === this.day) return 0;
    const lic = p.meta.upgrades.broker_license || 0;
    const mult = this.stat(p, 'feeMult', 1, (a, b) => a * b) * (1 - 0.15 * lic);
    return Math.max(0.1, value * this.cfg.feeRate * mult);
  }

  buyingPower(p) {
    let mult = this.stat(p, 'buyingPowerMult', 1, Math.max);
    if (p.buffs.margin === this.day) mult += 0.5;
    return p.cash + (mult - 1) * Math.max(0, this.netWorth(p));
  }

  execBuy(p, t, qty) {
    const price = this.market.price(t);
    const cost = price * qty;
    const fee = this.fee(p, cost);
    if (cost + fee > this.buyingPower(p)) return this.note(p, 'Not enough buying power.');
    const h = (p.holdings[t] ||= { qty: 0, avgCost: 0, openedDay: this.day });
    h.avgCost = (h.avgCost * h.qty + cost) / (h.qty + qty);
    h.qty += qty;
    p.cash -= cost + fee;
    this.trackTrade(p, cost, this.market.impact(t, cost, +1));
    p.stats.buys += 1;
    this.note(p, `Bought ${qty} ${t} at ${round(price)} (fee ${round(fee)}).`);
  }

  execSell(p, t, qty, reason) {
    const h = p.holdings[t];
    if (!h || h.qty < qty) return this.note(p, `You don't hold ${qty} ${t}.`);
    const s = this.market.get(t);
    const price = s.price;
    const proceeds = price * qty;
    const fee = this.fee(p, proceeds);
    const gain = (price - h.avgCost) * qty;
    let bonus = 0;
    if (gain > 0) {
      const ctx = { stock: s, price, dayOpen: s.dayOpen, qty, gain };
      const mult = p.perks.reduce((m, id) => m * (PERK_BY_ID[id].gainMult ? PERK_BY_ID[id].gainMult(ctx) : 1), 1);
      bonus = gain * (mult - 1);
      p.stats.bestProfit = Math.max(p.stats.bestProfit, gain + bonus);
      if (s.sector === 'meme') p.stats.memeBestProfit = Math.max(p.stats.memeBestProfit, gain + bonus);
    } else if (gain < 0) p.stats.lossSells += 1;
    p.cash += proceeds - fee + bonus;
    h.qty -= qty;
    if (h.qty === 0) delete p.holdings[t];
    this.trackTrade(p, proceeds, this.market.impact(t, proceeds, -1));
    p.stats.sells += 1;
    this.note(p, `${reason ? reason + ': s' : 'S'}old ${qty} ${t} at ${round(price)}` +
      `${bonus ? ` (+${round(bonus)} perk bonus)` : ''}.`);
  }

  trackTrade(p, value, impactPct) {
    p.stats.trades += 1;
    p.stats.biggestTrade = Math.max(p.stats.biggestTrade, value);
    if (impactPct >= 0.0299) p.stats.whale = true;
  }

  useActive(p, perkId, ticker) {
    const perk = PERK_BY_ID[perkId];
    if (this.phase !== 'trading' || !p.alive || !perk?.active || !p.perks.includes(perkId)) return;
    if (perk.active.needsTicker && !this.market.get(ticker)) return;
    if ((p.cooldowns[perkId] || 0) + perk.active.cooldownDays > this.day) return this.note(p, `${perk.name} is on cooldown.`);
    p.cooldowns[perkId] = this.day;
    p.stats.activesUsed += 1;
    perk.active.use(p, this, ticker);
  }

  shopBuy(p, perkId) {
    if (this.phase !== 'trading' || !p.alive || !p.offers.includes(perkId)) return;
    const perk = PERK_BY_ID[perkId];
    if (p.cash < perk.cost) return this.note(p, 'Not enough cash.');
    p.cash -= perk.cost;
    p.perks.push(perkId);
    p.offers = p.offers.filter((x) => x !== perkId);
    p.stats.perksBought += 1;
    if (perk.rarity === 'legendary') p.stats.legendary = true;
    this.log(`${p.name} bought ${perk.name}.`);
  }

  itemBuy(p, itemId) {
    const item = ITEM_BY_ID[itemId];
    if (this.phase !== 'trading' || !p.alive || !item) return;
    if (p.cash < item.cost) return this.note(p, 'Not enough cash.');
    p.cash -= item.cost;
    p.items[itemId] = (p.items[itemId] || 0) + 1;
    p.stats.itemsBought += 1;
    this.note(p, `Bought ${item.name}.`);
  }

  itemUse(p, itemId, ticker) {
    const item = ITEM_BY_ID[itemId];
    if (this.phase !== 'trading' || !p.alive || !item || !p.items[itemId]) return;
    if (item.needsTicker && !this.market.get(ticker)) return;
    p.items[itemId] -= 1;
    if (!p.items[itemId]) delete p.items[itemId];
    p.stats.itemsUsed += 1;
    item.use(p, this, ticker);
    this.note(p, `Used ${item.name}${item.needsTicker ? ` on ${ticker}` : ''}.`);
  }

  reroll(p) {
    if (this.phase !== 'trading' || !p.alive) return;
    const cost = this.rerollCost(p);
    if (p.cash < cost) return this.note(p, 'Not enough cash to reroll.');
    p.cash -= cost;
    p.rerolls += 1;
    p.stats.rerolls += 1;
    p.offers = this.rollOffers(p);
  }

  // ---------- helpers used by perks and items ----------
  grant(p, amount, label) {
    if (amount <= 0) return;
    p.cash += amount;
    this.note(p, `${label}: +${round(amount)}`);
  }

  whisper(p) {
    const e = this.midEvent;
    this.note(p, e ? `Insider tip: later today, ${e.def.text(e.args)}` : 'Insider tip: nothing big is planned today.');
  }

  // ---------- math ----------
  loanOffers(p) {
    const extraDays = this.stat(p, 'loanDays', 0, (a, b) => a + b);
    return META.loanOffers(p.meta).map((o) => ({ ...o, days: o.days + extraDays }));
  }

  holdingsValue(p) {
    return Object.entries(p.holdings).reduce((s, [t, h]) => s + h.qty * this.market.price(t), 0);
  }

  // Debt counts against you
  netWorth(p) { return p.cash + this.holdingsValue(p) - (p.loan ? p.loan.owed : 0); }

  stat(p, key, init, combine) {
    return p.perks.reduce((acc, id) => (PERK_BY_ID[id][key] !== undefined ? combine(acc, PERK_BY_ID[id][key]) : acc), init);
  }

  hooks(p, name) {
    for (const id of p.perks) PERK_BY_ID[id][name]?.(p, this);
  }

  rollEvent() {
    const def = this.eventRng.weighted(EVENTS, (e) => e.weight);
    return { def, args: def.roll(this.eventRng, this.market) };
  }

  alivePlayers() { return [...this.players.values()].filter((p) => p.alive); }

  board() {
    return [...this.players.values()]
      .map((p) => ({ id: p.id, name: p.name, netWorth: round(this.netWorth(p)), alive: p.alive, connected: p.connected,
        perks: p.perks.length, inDebt: !!p.loan, rebirths: p.meta.rebirths }))
      .sort((a, b) => b.netWorth - a.netWorth);
  }

  // ---------- networking ----------
  log(text) { this.io.broadcast({ t: 'log', text }); }
  note(p, text) { this.io.send(p.id, { t: 'note', text }); }

  broadcastLobby() {
    this.io.broadcast({ t: 'lobby', code: this.code, seed: this.seed, mode: this.cfg.mode, fair: this.cfg.fair,
      hostId: this.hostId, phase: this.phase, players: this.board() });
  }

  privateState(p) {
    return {
      t: 'you', id: p.id, cash: round(p.cash), netWorth: round(this.netWorth(p)),
      buyingPower: round(this.buyingPower(p)), startCash: round(p.startCash), alive: p.alive, outReason: p.outReason,
      holdings: Object.fromEntries(Object.entries(p.holdings).map(([t, h]) => [t, { qty: h.qty, avgCost: round(h.avgCost), divs: round(h.divs || 0) }])),
      feeRate: this.cfg.feeRate * this.stat(p, 'feeMult', 1, (a, b) => a * b) * (1 - 0.15 * (p.meta.upgrades.broker_license || 0)) * (p.buffs.noFees === this.day ? 0 : 1),
      perks: p.perks.map((id) => perkView(PERK_BY_ID[id], p, this.day)),
      offers: p.offers.map((id) => perkView(PERK_BY_ID[id])),
      items: Object.entries(p.items).map(([id, n]) => ({ ...itemView(ITEM_BY_ID[id]), count: n })),
      itemShop: ITEMS.map(itemView),
      buffs: Object.keys(p.buffs).filter((k) => p.buffs[k] === this.day),
      loan: p.loan && { ...p.loan, owed: round(p.loan.owed) },
      loanOffers: this.loanOffers(p),
      bankrupt: p.bankrupt,
      rerollCost: this.rerollCost(p), phase: this.phase, day: this.day,
      stats: p.stats,
    };
  }

  sendPrivate(p) { this.io.send(p.id, this.privateState(p)); }
  sendAllPrivate() { for (const p of this.players.values()) this.sendPrivate(p); }

  // full resync for a reconnecting client
  resync(id) {
    this.broadcastLobby();
    if (this.phase !== 'lobby') {
      this.io.send(id, { t: 'day', day: this.day, ticksPerDay: this.cfg.ticksPerDay,
        market: this.market.snapshot(true) });
    }
    const p = this.players.get(id);
    if (p) this.sendPrivate(p);
  }

  destroy() { clearInterval(this.timer); clearTimeout(this.timer); }
}

function perkView(perk, p, day) {
  const v = { id: perk.id, name: perk.name, desc: perk.desc, rarity: perk.rarity, cost: perk.cost };
  if (perk.active) {
    v.active = { name: perk.active.name, needsTicker: !!perk.active.needsTicker,
      ready: p ? (p.cooldowns[perk.id] || 0) + perk.active.cooldownDays <= day : false };
  }
  return v;
}

function itemView(i) {
  return { id: i.id, name: i.name, desc: i.desc, cost: i.cost, needsTicker: !!i.needsTicker };
}

module.exports = { Game, DEFAULT_CONFIG };
