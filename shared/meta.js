// Meta progression shared by server and client: permanent upgrades (Item Shop),
// loans, rebirth, certificates, and achievements.
// Works in Node (require) and the browser (window.META).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.META = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // ---------- rebirth tuning ----------
  const REBIRTH_DAYS_NEEDED = 12;     // survive this many days in one run (since last rebirth) to unlock rebirth
  const REBIRTH_LOAN_PENALTY = 0.05;  // each rebirth adds 5% interest to every loan

  // ---------- permanent upgrades (bought with Certificates in the Item Shop) ----------
  // cost(level) = price to go from `level` to `level + 1`
  const UPGRADES = [
    { id: 'seed_money', name: 'Seed Money', icon: 'cash', max: 5, rebirthBonusMax: 1,
      desc: '+$100 starting cash per level. Max level rises by 1 with every rebirth.',
      cost: (l) => 20 + l * 15 },
    { id: 'broker_license', name: 'Broker License', icon: 'license', max: 3,
      desc: 'Trading fees -15% per level.', cost: (l) => 30 + l * 25 },
    { id: 'credit_score', name: 'Credit Score', icon: 'card', max: 3,
      desc: 'Loans cost 5% less interest and give 1 extra day to repay, per level.', cost: (l) => 25 + l * 20 },
    { id: 'deep_pockets', name: 'Deep Pockets', icon: 'wallet', max: 2,
      desc: 'Loan amounts +25% per level.', cost: (l) => 35 + l * 35 },
    { id: 'extra_shelf', name: 'Extra Shelf', icon: 'shelf', max: 2,
      desc: '+1 perk offered in every shop.', cost: (l) => 60 + l * 60 },
    { id: 'lucky_charm', name: 'Lucky Charm', icon: 'clover', max: 2,
      desc: '+1 free reroll in every shop.', cost: (l) => 40 + l * 40 },
    { id: 'head_start', name: 'Head Start', icon: 'rocket', max: 2,
      desc: 'Start every run with a free random perk. Level 2: uncommon or better.', cost: (l) => 80 + l * 80 },
    { id: 'market_research', name: 'Market Research', icon: 'magnifier', max: 1,
      desc: "While shopping, see the next day's opening news.", cost: () => 70 },
  ];
  const UPGRADE_BY_ID = Object.fromEntries(UPGRADES.map((u) => [u.id, u]));

  function maxLevel(u, rebirths) { return u.max + (u.rebirthBonusMax || 0) * (rebirths || 0); }

  // Clean up an untrusted profile coming from a client.
  function sanitizeMeta(m) {
    const rebirths = clampInt(m && m.rebirths, 0, 99);
    const goldenShares = clampInt(m && m.goldenShares, 0, 9999);
    const upgrades = {};
    for (const u of UPGRADES) {
      const lvl = clampInt(m && m.upgrades && m.upgrades[u.id], 0, maxLevel(u, rebirths));
      if (lvl) upgrades[u.id] = lvl;
    }
    return { rebirths, goldenShares, upgrades };
  }
  function clampInt(v, lo, hi) { v = Math.floor(Number(v) || 0); return Math.max(lo, Math.min(hi, v)); }

  // ---------- loans ----------
  const LOAN_TIERS = [
    { id: 'small', name: 'Corner Bank', amount: 300, rate: 0.20, days: 3 },
    { id: 'medium', name: 'Credit Union', amount: 800, rate: 0.30, days: 3 },
    { id: 'shark', name: 'Vinnie the Loan Shark', amount: 2000, rate: 0.60, days: 2 },
  ];
  function loanOffers(meta) {
    const cs = (meta.upgrades && meta.upgrades.credit_score) || 0;
    const dp = (meta.upgrades && meta.upgrades.deep_pockets) || 0;
    return LOAN_TIERS.map((t) => {
      const amount = Math.round(t.amount * (1 + 0.25 * dp));
      const rate = Math.max(0.05, t.rate - 0.05 * cs) + REBIRTH_LOAN_PENALTY * (meta.rebirths || 0);
      return { id: t.id, name: t.name, amount, rate, days: t.days + cs, owed: Math.round(amount * (1 + rate) * 100) / 100 };
    });
  }

  // ---------- rebirth ----------
  const TITLES = ['Intern', 'Analyst', 'Trader', 'Vice President', 'Partner', 'Tycoon', 'Market Legend'];
  function title(rebirths) { return TITLES[Math.min(rebirths, TITLES.length - 1)] + (rebirths >= TITLES.length ? ` ${rebirths - TITLES.length + 2}` : ''); }
  function rebirthReward(profile) {
    return 1 + Math.floor((profile.certsSinceRebirth || 0) / 400);
  }

  // Certificates earned at the end of a run
  // result = { days, peakNetWorth, cashedOut, lastStanding, loanDefault }
  function certificatesFor(result, meta) {
    let c = result.days * 4 + Math.floor(result.peakNetWorth / 400) + (result.cashedOut ? 15 : 0) + (result.lastStanding ? 40 : 0);
    if (result.loanDefault) c = Math.floor(c / 2);
    return Math.max(1, Math.floor(c * (1 + 0.05 * (meta.goldenShares || 0))));
  }
  function startCashBonusMult(meta) { return 1 + 0.02 * (meta.goldenShares || 0); }

  // ---------- achievements ----------
  // ctx = { run: live run stats from server, life: lifetime stats, profile, outcome (only at run end) }
  const ACH = (id, name, desc, check, hidden = false) => ({ id, name, desc, check, hidden });
  const r = (c) => c.run || {};
  const ACHIEVEMENTS = [
    ACH('FIRST_TRADE', 'Opening Bell', 'Make your first trade.', (c) => r(c).trades >= 1),
    ACH('DAY_TRADER', 'Day Trader', 'Make 100 trades in one run.', (c) => r(c).trades >= 100),
    ACH('PAPER_HANDS', 'Paper Hands', 'Sell at a loss 10 times in one run.', (c) => r(c).lossSells >= 10),
    ACH('DIAMOND_HANDS', 'Diamond Hands', 'Hold a position through 3 market closes.', (c) => r(c).heldThreeDays),
    ACH('TO_THE_MOON', 'To The Moon', 'Make $500 profit on a single MEME sale.', (c) => r(c).memeBestProfit >= 500),
    ACH('BIG_FISH', 'Big Fish', 'Place a single order worth $5,000 or more.', (c) => r(c).biggestTrade >= 5000),
    ACH('WHALE', 'Whale', 'Move a stock price the maximum amount with one order.', (c) => r(c).whale),
    ACH('BIG_WIN', 'Big Win', 'Make $1,000 profit on a single sale.', (c) => r(c).bestProfit >= 1000),
    ACH('SURVIVOR', 'Survivor', 'Survive 3 trading days.', (c) => r(c).daysSurvived >= 3),
    ACH('TWO_WEEKS', 'Two Weeks Notice', 'Survive 10 trading days in one run.', (c) => r(c).daysSurvived >= 10),
    ACH('MARATHON', 'Marathon', 'Survive 25 trading days in one run.', (c) => r(c).daysSurvived >= 25),
    ACH('CASHED_OUT', 'Take The Money', 'Cash out with at least double your starting money.', (c) => r(c).cashedOut && c.outcome && c.outcome.netWorth >= 2 * c.outcome.startCash),
    ACH('FIVE_FIGURES', 'Five Figures', 'Reach $10,000 net worth.', (c) => r(c).peakNetWorth >= 10000),
    ACH('SIX_FIGURES', 'Six Figures', 'Reach $100,000 net worth.', (c) => r(c).peakNetWorth >= 100000),
    ACH('BROKE', 'Rock Bottom', 'Hit $0.', (c) => r(c).bankrupt >= 1),
    ACH('IN_DEBT', 'In Debt', 'Take out a loan.', (c) => r(c).loansTaken >= 1),
    ACH('DEBT_FREE', 'Debt Free', 'Pay back a loan in full.', (c) => r(c).loansRepaid >= 1),
    ACH('BORROWED_TIME', 'Borrowed Time', 'Spend 5 days on borrowed money in one run.', (c) => r(c).daysOnLoan >= 5),
    ACH('SHARK_TAMER', 'Shark Tamer', 'Pay back a loan shark in full.', (c) => r(c).sharkRepaid),
    ACH('LOAN_SHARK_BAIT', 'Sleeping With The Fishes', 'Fail to pay back a loan.', (c) => r(c).loanDefault, true),
    ACH('SHOPAHOLIC', 'Shopaholic', 'Buy 5 perks in one run.', (c) => r(c).perksBought >= 5),
    ACH('LEGENDARY_PERK', 'Legendary', 'Buy a legendary perk.', (c) => r(c).legendary),
    ACH('REROLL_ADDICT', 'Reroll Addict', 'Reroll the shop 10 times in one run.', (c) => r(c).rerolls >= 10),
    ACH('MARKET_MOVER', 'Market Mover', 'Use active perks 10 times in one run.', (c) => r(c).activesUsed >= 10),
    ACH('GADGET_FAN', 'Gadget Fan', 'Use 10 items in one run.', (c) => r(c).itemsUsed >= 10),
    ACH('HALTED', 'Hold It Right There', 'Try to trade a halted stock.', (c) => r(c).haltedTry, true),
    ACH('FLASH_CRASH_GREEN', 'Buy The Dip', 'Finish a Flash Crash day with more net worth than you started.', (c) => r(c).flashCrashGreen),
    ACH('TEAM_PLAYER', 'Team Player', 'Survive 5 days in Co-op.', (c) => r(c).coop && r(c).daysSurvived >= 5),
    ACH('LAST_ONE_STANDING', 'Last One Standing', 'Be the last trader alive in Versus.', (c) => r(c).lastStanding),
    ACH('UPGRADED', 'Upgraded', 'Max out any Item Shop upgrade.', (c) => UPGRADES.some((u) => ((c.profile.upgrades || {})[u.id] || 0) >= u.max)),
    ACH('FULLY_LOADED', 'Fully Loaded', 'Max out every Item Shop upgrade.', (c) => UPGRADES.every((u) => ((c.profile.upgrades || {})[u.id] || 0) >= u.max)),
    ACH('REBORN', 'Reborn', 'Rebirth for the first time.', (c) => c.profile.rebirths >= 1),
    ACH('PHOENIX', 'Phoenix', 'Rebirth 5 times.', (c) => c.profile.rebirths >= 5),
    ACH('VETERAN', 'Veteran', 'Finish 10 runs.', (c) => c.life.runs >= 10),
    ACH('CENTURION', 'Centurion', 'Make 1,000 trades in total.', (c) => (c.life.trades || 0) + (r(c).trades || 0) >= 1000),
    ACH('CERTIFIED', 'Certified', 'Earn 1,000 certificates in total.', (c) => c.life.certificatesEarned >= 1000),
    ACH('COMPLETIONIST', 'Completionist', 'Unlock 30 other achievements.', (c) => Object.keys(c.profile.achievements || {}).length >= 30),
  ];

  return {
    UPGRADES, UPGRADE_BY_ID, maxLevel, sanitizeMeta,
    LOAN_TIERS, loanOffers,
    TITLES, title, REBIRTH_DAYS_NEEDED, REBIRTH_LOAN_PENALTY, rebirthReward,
    certificatesFor, startCashBonusMult,
    ACHIEVEMENTS,
  };
});
