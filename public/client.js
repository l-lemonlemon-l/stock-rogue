// Stock Rogue client (TradeOS desktop, boxy). Renders server state into windows and sends intents.
// No game rules live here, except the permanent profile (Item Shop, rebirth, achievements).

const desk = window.stockRogue; // set by the desktop (Steam) build only
const CFG = window.SR_CONFIG || null; // set by the static web and Android builds (config.js); they can host solo runs in the page
const DEVICE = CFG?.platform === 'android' ? 'This phone' : 'This device';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const cls = (n) => (n >= 0 ? 'up' : 'down');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function setHTML(el, html) { if (el && el._html !== html) { el._html = html; el.innerHTML = html; } }

const S = {
  ws: null, connected: false, me: null, lobby: null, market: {}, order: [], sel: null,
  day: 0, ticksPerDay: 90, tick: 0, board: [], shopTab: 'perks', news: [], newsDirty: true,
  inRun: false, results: null, server: localStorage.getItem('sr_server') || (CFG ? 'local' : 'online'), mode: 'versus', fair: false,
  lastStats: null, bankruptShown: false, tickMs: 500, lastTickAt: 0, marks: {},
  myId: null, chat: [], unread: 0, panel: 'market',
};
const GAME_WINDOWS = ['market', 'chart', 'order', 'account', 'perks', 'leaders', 'news', 'shop', 'bank', 'lobby', 'chat'];

// ---------- sound (small original chimes) ----------
let actx;
function chime(notes) {
  if (!Profile.data.settings.sound) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)();
    notes.forEach(([f, t, d = 0.18]) => {
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, actx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, actx.currentTime + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + t + d);
      o.connect(g).connect(actx.destination);
      o.start(actx.currentTime + t); o.stop(actx.currentTime + t + d + 0.05);
    });
  } catch {}
}
const SFX = {
  ach: () => chime([[659, 0], [880, 0.1], [1319, 0.2, 0.35]]),
  error: () => chime([[220, 0, 0.25], [196, 0.12, 0.3]]),
  start: () => chime([[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36, 0.5]]),
  cash: () => chime([[1319, 0, 0.08], [1568, 0.06, 0.12]]),
};

// ---------- balloons ----------
function balloon(title, text, icon = 'info', extra = '') {
  const b = document.createElement('div');
  b.className = 'balloon ' + extra;
  b.innerHTML = `${ICONS[icon] || ''}<div><b>${esc(title)}</b>${esc(text)}</div>`;
  b.onclick = () => b.remove();
  $('balloons').appendChild(b);
  while ($('balloons').children.length > 2) $('balloons').firstChild.remove();
  setTimeout(() => b.remove(), 6000);
}

// ---------- achievements ----------
function checkAch(run, outcome) {
  const got = Profile.checkAchievements(run, outcome);
  for (const a of got) { balloon('Achievement unlocked', `${a.name}: ${a.desc}`, 'trophy', 'ach'); desk?.achieve(a.id); }
  if (got.length) { SFX.ach(); dirty(); }
  return got;
}
for (const id of Object.keys(Profile.data.achievements)) desk?.achieve(id);

// ---------- networking ----------
function serverUrl() {
  if (desk) return S.server === 'online' ? desk.onlineServer : `ws://localhost:${desk.localPort}`;
  if (CFG) return CFG.onlineServer;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
}
function connect(first) {
  if (S.ws) { S.ws.onclose = null; S.ws.close(); }
  S.ws = CFG && (S.server === 'local' || !CFG.onlineServer) ? LocalServer.connect() : new WebSocket(serverUrl());
  S.ws.onerror = () => { SFX.error(); WM.dialog({ title: 'Network', icon: 'error', html: `Could not reach the trading server. Pick <b>${desk ? 'This computer' : DEVICE}</b> to play solo.` }); };
  S.ws.onopen = () => { S.connected = true; S.ws.send(JSON.stringify({ ...first, meta: Profile.meta() })); renderTray(); };
  S.ws.onmessage = (e) => onMsg(JSON.parse(e.data));
  S.ws.onclose = () => { S.connected = false; renderTray(); if (S.inRun && !S.results) addNews('Connection lost. Use Start a Run > Join with the same room code to reconnect.'); };
}
const send = (msg) => S.ws?.readyState === 1 && S.ws.send(JSON.stringify(msg));

function onMsg(m) {
  switch (m.t) {
    case 'error': SFX.error(); WM.dialog({ title: 'Trading Server', icon: 'error', html: esc(m.text) }); break;
    case 'joined': localStorage.setItem('sr_token_' + m.code, m.token); S.myId = m.token; WM.close('newgame'); break;
    case 'rtc': P2P.onSignal(m.from, m.d); break;
    case 'lobby':
      S.lobby = m; S.board = m.players;
      P2P.sync(S.myId, m.players);
      if (m.phase === 'lobby') openLobby();
      dirty();
      break;
    case 'day':
      Object.assign(S, { day: m.day, ticksPerDay: m.ticksPerDay, tick: 0, lastTickAt: performance.now() });
      S.order = m.market.map((s) => s.ticker);
      for (const s of m.market) S.market[s.ticker] = s;
      if (!S.sel) S.sel = S.order[0];
      if (!S.inRun) { S.inRun = true; S.results = null; S.bankruptShown = false; S.marks = {}; WM.close('lobby'); openGameWindows(); if (WM.isOpen('chat')) { WM.place('chat', chatPos()); WM.focus('chat'); } SFX.start(); }
      dirty();
      break;
    case 'newday': // days roll over without stopping the market
      S.day = m.day; S.tick = 0;
      for (const [t, open] of Object.entries(m.opens)) if (S.market[t]) S.market[t].dayOpen = open;
      dirty();
      break;
    case 'tick': {
      const now = performance.now();
      if (S.lastTickAt) S.tickMs = Math.max(80, Math.min(2000, S.tickMs * 0.7 + (now - S.lastTickAt) * 0.3));
      S.lastTickAt = now;
      S.tick = m.tick;
      for (const p of m.prices) {
        const s = S.market[p.ticker];
        s.prevPrice = s.price;
        Object.assign(s, p);
        s.history.push(p.price);
        if (s.history.length > 600) { s.history.shift(); if (S.marks[p.ticker]) S.marks[p.ticker] = S.marks[p.ticker].map((x) => ({ ...x, i: x.i - 1 })).filter((x) => x.i >= 0); }
      }
      S.board = m.board;
      P2P.sync(S.myId, m.board);
      dirty();
      break;
    }
    case 'you':
      S.me = m;
      if (m.stats) { S.lastStats = m.stats; checkAch(m.stats); }
      if (!m.bankrupt) S.bankruptShown = false;
      dirty();
      break;
    case 'bankrupt': showBankrupt(); break;
    case 'log':
      addNews(m.text);
      if (/^Breaking/.test(m.text)) balloon('Breaking news', m.text.replace(/^Breaking: /, ''), 'news');
      if (/is out\.|cashed out|last trader standing/i.test(m.text)) balloon('Trading floor', m.text, 'users');
      break;
    case 'note': {
      addNews(m.text, true);
      const tm = m.text.match(/^(?:Stop-loss: s|S)old (\d+) (\w+)|^Bought (\d+) (\w+)/);
      if (tm) { const t = tm[2] || tm[4]; if (S.market[t]) (S.marks[t] ||= []).push({ i: S.market[t].history.length - 1, side: tm[3] ? 'buy' : 'sell' }); SFX.cash(); }
      if (/^(Loan reminder|Market Research|Head Start|Insider tip|Loan from|You were broke)/.test(m.text)) {
        const loan = m.text.includes('oan') || m.text.startsWith('You were');
        balloon(loan ? 'Bank' : 'Tip', m.text, loan ? 'shark' : 'info');
      }
      if (/^Not enough|halted|broke/i.test(m.text)) SFX.error();
      break;
    }
    case 'results': showResults(m); break;
    case 'over':
      S.board = m.board;
      if (!S.results) WM.dialog({ title: 'Market Closed', icon: 'info', html: 'The run is over. Everyone is out or has cashed out.', buttons: [{ label: 'OK', primary: true, action: leaveRun }] });
      dirty();
      break;
  }
}

function addNews(text, mine = false) {
  S.news.unshift({ t: S.day ? `Day ${S.day} ${clock()}` : '', text, mine });
  if (S.news.length > 120) S.news.pop();
  S.newsDirty = true;
  dirty();
}
function clock() {
  const mins = 570 + Math.round((390 * S.tick) / S.ticksPerDay); // 9:30 to 16:00
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ---------- actions ----------
const tradeable = () => S.me?.alive && S.me.phase === 'trading' && !S.me.bankrupt;
const A = {
  sel: (t) => { S.sel = t; dirty(); },
  prevstock: () => stepStock(-1),
  nextstock: () => stepStock(1),
  shop: () => openShop(),
  buy: (pctArg) => tradeable() ? send({ t: 'buy', ticker: S.sel, pct: pctArg ?? pctOf('oBuyPct', 25) }) : SFX.error(),
  sell: (pctArg) => tradeable() ? send({ t: 'sell', ticker: S.sel, pct: pctArg ?? pctOf('oSellPct', 100) }) : SFX.error(),
  active: (id) => send({ t: 'active', perk: id, ticker: S.sel }),
  useitem: (id) => send({ t: 'item_use', item: id, ticker: S.sel }),
  shopbuy: (id) => send({ t: 'shop_buy', perk: id }),
  itembuy: (id) => send({ t: 'item_buy', item: id }),
  reroll: () => send({ t: 'reroll' }),
  tab: (t) => { S.shopTab = t; dirty(); },
  loan: (tier) => confirmLoan(tier),
  repay: (frac) => { const l = S.me?.loan; if (l) send({ t: 'loan_repay', amount: Math.min(S.me.cash, l.owed * Number(frac)) }); },
  bank: () => openApp('bank'),
  cashout: () => {
    if (!S.me?.alive) return SFX.error();
    WM.dialog({ title: 'Cash Out', icon: 'flag', html: `End your run now with <b>${money(S.me.netWorth)}</b>${S.me.loan ? ' (your debt is counted)' : ''}?<br><br>You keep your score and earn certificates.`,
      buttons: [{ label: 'Cash Out', primary: true, action: () => send({ t: 'cash_out' }) }, { label: 'Keep Trading' }] });
  },
  upgrade: (id) => { if (Profile.buyUpgrade(id)) { SFX.cash(); checkAch(S.lastStats || {}); dirty(); renderStartMenu(); } else SFX.error(); },
  open: (id) => openApp(id),
  start: () => send({ t: 'start' }),
  rebirth: () => confirmRebirth(),
  chat: () => toggleChat(),
  panel: (id) => { S.panel = id; dirty(); },
  mic: () => toggleMic(),
  peermute: (id) => { const p = P2P.peers().find((x) => x.id === id); if (p) P2P.mute(id, !p.muted); },
  savecode: () => openApp('savecode'),
  newrun: () => { leaveRun(); WM.close('results'); openApp('newgame'); },
};
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  A[el.dataset.act]?.(el.dataset.arg);
});

function stepStock(d) {
  if (!S.order.length) return;
  const i = S.order.indexOf(S.sel);
  S.sel = S.order[(i + d + S.order.length) % S.order.length];
  dirty();
}

function confirmLoan(tier) {
  const o = S.me?.loanOffers.find((x) => x.id === tier);
  if (!o) return;
  WM.dialog({
    title: o.name, icon: tier === 'shark' ? 'shark' : 'bank',
    html: `Borrow <b>${money(o.amount)}</b> now and pay back <b>${money(o.owed)}</b> within <b>${o.days} days</b> (${Math.round(o.rate * 100)}% interest).<br><br>
      Your debt counts against your net worth. <b>If you don't pay it back in time, you lose the run.</b>`,
    buttons: [{ label: 'Take the loan', primary: true, action: () => send({ t: 'loan_take', tier }) }, { label: 'Cancel' }],
  });
}

function showBankrupt() {
  if (S.bankruptShown || !S.me) return;
  S.bankruptShown = true;
  SFX.error();
  WM.dialog({
    title: 'Insufficient Funds', icon: 'warning', width: 470,
    html: `<b>You have hit $0.</b><br><br>To keep trading you have to take out a loan. Debt counts against your net worth,
      and if a loan isn't paid back by its due date, <b>the loan sharks get you and the run is over</b>.<br><br>
      If you don't choose, the bank gives you the smallest loan at the closing bell.`,
    buttons: [...S.me.loanOffers.map((o) => ({ label: `${o.id === 'shark' ? 'Loan Shark' : o.name}: ${money(o.amount)}`, primary: o.id === 'small',
      action: () => send({ t: 'loan_take', tier: o.id }) })), { label: 'Later' }],
  });
}

function confirmRebirth() {
  if (!Profile.canRebirth() || S.inRun) return SFX.error();
  const gain = META.rebirthReward(Profile.data);
  WM.dialog({
    title: 'Rebirth', icon: 'rebirth', width: 440,
    html: `Rebirth now? You will lose all certificates and Item Shop upgrades.<br><br>
      You gain <b>${gain} Golden Share${gain > 1 ? 's' : ''}</b>, the title <b>${META.title(Profile.data.rebirths + 1)}</b>, and Seed Money can go one level higher.<br><br>
      Loans will cost <b>${Math.round(META.REBIRTH_LOAN_PENALTY * 100 * (Profile.data.rebirths + 1))}%</b> more interest.`,
    buttons: [{ label: 'Rebirth', primary: true, action: () => { const g = Profile.rebirth(); SFX.start(); balloon('Reborn', `+${g} Golden Shares. Your title is now ${META.title(Profile.data.rebirths)}.`, 'rebirth', 'ach'); checkAch({}); dirty(); renderStartMenu(); } }, { label: 'Cancel' }],
  });
}

function leaveRun() {
  P2P.closeAll();
  S.chat = []; S.unread = 0; S.myId = null;
  if (S.ws) { S.ws.onclose = null; S.ws.close(); S.ws = null; }
  Object.assign(S, { connected: false, inRun: false, me: null, lobby: null, market: {}, order: [], sel: null, day: 0, tick: 0, news: [], board: [], marks: {} });
  WM.closeAll((id) => GAME_WINDOWS.includes(id));
  chartCanvas = null;
  renderTray();
}

// ---------- apps ----------
const APPS = {
  newgame: { title: 'Start a Run', icon: 'start-green', render: renderNewGame, w: 430, h: 400, center: true },
  itemshop: { title: 'Item Shop', icon: 'bag', render: renderItemShop, w: 560, h: 520, center: true },
  achievements: { title: 'Achievements', icon: 'trophy', render: renderAchievements, w: 460, h: 540, center: true },
  rebirth: { title: 'Rebirth', icon: 'rebirth', render: renderRebirth, w: 460, h: 420, center: true },
  history: { title: 'Run History', icon: 'news', render: renderHistory, w: 640, h: 380, center: true },
  help: { title: 'Help and Support', icon: 'help', render: renderHelp, w: 560, h: 520, center: true },
  savecode: { title: 'Save Code', icon: 'disk', render: renderSaveCode, w: 470, h: 420, center: true },
  chat: { title: 'Room Chat', icon: 'chat', render: renderChat, w: 300, h: 330 },
  cmd: { title: 'Command Prompt', icon: 'cmd', render: renderCmd, w: 600, h: 340, bodyClass: 'flush', center: true },
  market: { title: 'Market Watch', icon: 'market', render: renderMarket, game: true },
  chart: { title: 'Performance', icon: 'chart', render: renderChart, game: true, bodyClass: 'flush' },
  order: { title: 'Order Ticket', icon: 'order', render: renderOrder, game: true },
  account: { title: 'My Portfolio', icon: 'briefcase', render: renderAccount, game: true },
  perks: { title: 'Perks and Items', icon: 'star', render: renderPerks, game: true },
  leaders: { title: 'Leaderboard', icon: 'users', render: renderLeaders, game: true },
  news: { title: 'News Wire', icon: 'news', render: renderNews, game: true },
  bank: { title: 'First Ledger Bank', icon: 'bank', render: renderBank, w: 470, h: 380, center: true, game: true },
};

function openApp(id, pos) {
  const a = APPS[id];
  if (!a) return;
  if (a.game && !S.inRun) return WM.dialog({ title: a.title, icon: 'info', html: 'Start or join a run first.' });
  if (!pos && a.game && !a.center && S.inRun) pos = gameLayout()[id];
  const w = WM.open(id, { title: a.title, icon: a.icon, w: a.w, h: a.h, center: a.center, bodyClass: a.bodyClass, noClose: a.game && !a.center, ...pos,
    onResize: () => a.render(), onClose: () => { if (id === 'chart') chartCanvas = null; } });
  a.render(w);
  hideStart();
}

function openLobby() {
  WM.open('lobby', { title: `Room ${S.lobby.code} - Lobby`, icon: 'users', w: 440, h: 380, center: true, noMax: true });
  renderLobby();
}

// Phones (touch screens under 600px on the short side) get their own layout:
// chart and order ticket on the left, one tabbed panel on the right for everything else.
const isPhone = () => /[?&]phone\b/.test(location.search) || CFG?.platform === 'android' ||
  (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 600);
const PANELS = [['market', 'Market'], ['account', 'Portfolio'], ['perks', 'Perks'], ['leaders', 'Leaders'], ['news', 'News']];
const TAB_H = 26;
function renderPanelTabs() {
  let t = $('mtabs');
  const show = document.body.classList.contains('phone') && S.inRun;
  if (!t) { t = document.createElement('div'); t.id = 'mtabs'; $('desktop').appendChild(t); }
  t.classList.toggle('hidden', !show);
  if (!show) { for (const [id] of PANELS) WM.get(id)?.el.classList.remove('phide'); return; }
  const L = gameLayout().market;
  Object.assign(t.style, { left: L.x + 'px', top: (L.y - TAB_H) + 'px', width: L.w + 'px', height: TAB_H + 'px' });
  setHTML(t, PANELS.map(([id, label]) => `<div class="mtab ${S.panel === id ? 'on' : ''}" data-act="panel" data-arg="${id}">${label}</div>`).join(''));
  for (const [id] of PANELS) WM.get(id)?.el.classList.toggle('phide', id !== S.panel);
}

function gameLayout() {
  const W = $('desktop').offsetWidth, H = $('desktop').offsetHeight, g = 6;
  if (document.body.classList.contains('phone')) {
    const lw = Math.round(W * 0.6), rx = lw + g * 2, rw = W - rx - g;
    const ch = Math.round((H - g * 3) * 0.57), oh = H - ch - g * 3;
    const panel = { x: rx, y: g + TAB_H, w: rw, h: H - g * 2 - TAB_H };
    return {
      chart: { x: g, y: g, w: lw, h: ch },
      order: { x: g, y: g * 2 + ch, w: lw, h: oh },
      market: panel, account: { ...panel }, perks: { ...panel }, leaders: { ...panel }, news: { ...panel },
    };
  }
  const lw = Math.max(250, Math.min(340, W * 0.26)), rw = Math.max(210, Math.min(300, W * 0.19));
  const mw = W - lw - rw - g * 4, mx = lw + g * 2, rx = W - rw - g;
  const ch = Math.round((H - g * 3) * 0.58), oh = H - ch - g * 3;
  const mh = Math.round((H - g * 3) * 0.48);
  const ph = Math.round((H - g * 4) * 0.45), lh = Math.round((H - g * 4) * 0.27);
  return {
    chart: { x: mx, y: g, w: mw, h: ch },
    order: { x: mx, y: g * 2 + ch, w: mw, h: oh },
    market: { x: g, y: g, w: lw, h: mh },
    account: { x: g, y: g * 2 + mh, w: lw, h: H - mh - g * 3 },
    perks: { x: rx, y: g, w: rw, h: ph },
    leaders: { x: rx, y: g * 2 + ph, w: rw, h: lh },
    news: { x: rx, y: g * 3 + ph + lh, w: rw, h: H - ph - lh - g * 4 },
  };
}
function openGameWindows() {
  for (const [id, p] of Object.entries(gameLayout())) openApp(id, p);
  WM.focus('order');
}

function openShop() {
  if (!S.inRun) return WM.dialog({ title: 'Shop', icon: 'info', html: 'Start or join a run first. For permanent upgrades, open the Item Shop.' });
  WM.open('shop', { title: 'Shop', icon: 'bag', w: 640, h: 470, center: true });
  renderShop();
  hideStart();
}

// ---------- render loop ----------
let isDirty = true;
function dirty() { isDirty = true; }
function renderAll() {
  for (const [id, a] of Object.entries(APPS)) { const w = WM.get(id); if (w && !w.minimized) a.render(w); }
  if (WM.isOpen('shop')) renderShop();
  if (WM.isOpen('lobby')) renderLobby();
  renderTray();
  renderPanelTabs();
}
function loop() {
  if (isDirty) { isDirty = false; renderAll(); }
  drawChartFrame();
  requestAnimationFrame(loop);
}

// ---------- windows ----------
const body = (id) => WM.get(id)?.body;

function renderNewGame() {
  const b = body('newgame');
  if (!b || b.dataset.built) return;
  b.dataset.built = 1;
  b.innerHTML = `
    <div class="panel-title">Start a new run</div>
    ${desk ? `<fieldset><legend>Server</legend>
      <label class="check"><input type="radio" name="srv" value="online" ${S.server === 'online' ? 'checked' : ''}> Online (play with anyone)</label><br>
      <label class="check"><input type="radio" name="srv" value="local" ${S.server === 'local' ? 'checked' : ''}> This computer (solo or LAN)</label>
      ${desk.lanAddresses?.length ? `<div class="muted" style="margin-top:4px">LAN friends join at http://${esc(desk.lanAddresses[0])}:${desk.localPort}</div>` : ''}
    </fieldset>` : CFG ? `<fieldset><legend>Server</legend>
      <label class="check"><input type="radio" name="srv" value="local" ${S.server === 'local' ? 'checked' : ''}> ${DEVICE} (solo, works offline)</label><br>
      ${CFG.onlineServer ? `<label class="check"><input type="radio" name="srv" value="online" ${S.server === 'online' ? 'checked' : ''}> Online (play with anyone)</label>` : '<div class="muted">This copy plays solo. Online rooms are in the downloadable game.</div>'}
    </fieldset>` : ''}
    <fieldset><legend>Mode</legend>
      <label class="check"><input type="radio" name="mode" value="versus" checked> Versus: last trader standing wins</label><br>
      <label class="check"><input type="radio" name="mode" value="coop"> Co-op: trade together, cash out when you want</label><br>
      <label class="check" style="margin-top:4px"><input type="checkbox" id="ngFair"> Fair play (ignore everyone's Item Shop upgrades)</label>
    </fieldset>
    <div class="row" style="margin-bottom:10px">Seed <input type="text" id="ngSeed" maxlength="12" placeholder="random" style="width:120px">
      <span class="grow"></span><button class="primary go" id="ngCreate">Create Room</button></div>
    <fieldset><legend>Join a friend</legend>
      <div class="row">Room code <input type="text" id="ngCode" maxlength="8" style="width:100px;text-transform:uppercase"
        value="${esc(new URLSearchParams(location.search).get('room') || '')}"><button id="ngJoin">Join</button></div>
    </fieldset>`;
  const pick = () => {
    S.server = b.querySelector('input[name=srv]:checked')?.value || S.server;
    localStorage.setItem('sr_server', S.server);
    S.mode = b.querySelector('input[name=mode]:checked').value;
    S.fair = $('ngFair').checked;
  };
  $('ngCreate').onclick = () => { pick(); connect({ t: 'create', name: Profile.data.name, mode: S.mode, fair: S.fair, seed: $('ngSeed').value || undefined }); };
  $('ngJoin').onclick = () => {
    pick();
    const code = $('ngCode').value.trim().toUpperCase();
    if (!code) return SFX.error();
    connect({ t: 'join', code, name: Profile.data.name, token: localStorage.getItem('sr_token_' + code) });
  };
  $('ngCode').onkeydown = (e) => { if (e.key === 'Enter') $('ngJoin').click(); };
}

function renderLobby() {
  const b = body('lobby');
  if (!b || !S.lobby) return;
  const l = S.lobby, host = S.me?.id === l.hostId;
  setHTML(b, `
    <div class="row"><div class="grow"><div class="muted">Room code</div><div class="big">${esc(l.code)}</div></div>
      <div class="right"><div>${l.mode === 'coop' ? 'Co-op' : 'Versus'}${l.fair ? ', fair play' : ''}</div><div class="muted">Seed ${esc(l.seed)}</div></div></div>
    <p class="note">Give friends the room code. They pick <b>Start a Run</b> and type it under <b>Join a friend</b>.</p>
    <div class="list" style="height:160px"><table><tr><th>Trader</th><th>Title</th><th></th></tr>
      ${l.players.map((p) => `<tr><td>${esc(p.name)}</td><td>${esc(META.title(p.rebirths || 0))}</td><td class="muted">${p.id === l.hostId ? 'Host' : ''}</td></tr>`).join('')}
    </table></div>
    <div class="row" style="margin-top:10px"><span class="muted">${host ? 'Start when everyone is in.' : 'Waiting for the host to start.'}</span><span class="grow"></span>
      <button class="go primary" data-act="start" ${host ? '' : 'disabled'}>Start Run</button></div>`);
}

function renderMarket() {
  const b = body('market');
  if (!b) return;
  setHTML(b, `<div class="list" style="height:100%"><table>
    <tr><th>Ticker</th><th>Company</th><th class="num">Last</th><th class="num">Change</th></tr>
    ${S.order.map((t) => {
      const s = S.market[t], ch = (s.price / s.dayOpen - 1) * 100;
      return `<tr class="click ${t === S.sel ? 'sel' : ''}" data-act="sel" data-arg="${t}" title="${esc(cap(s.sector))}">
        <td><b>${t}</b></td><td class="trunc">${s.halted ? '<span class="down">Halted</span>' : esc(s.name)}</td>
        <td class="num">${num(s.price)}</td><td class="num ${cls(ch)}">${pct(ch)}</td></tr>`;
    }).join('')}</table></div>`);
}

// chart: header text on data change, canvas redrawn every frame (glides between ticks)
let chartCanvas = null;
const chartView = { lo: 0, hi: 0, ticker: null };
function renderChart() {
  const w = WM.get('chart');
  if (!w || !S.sel) return;
  const s = S.market[S.sel];
  WM.setTitle('chart', `Performance - ${s.ticker}`);
  if (!chartCanvas || !w.body.contains(chartCanvas)) {
    w.body.innerHTML = `<div class="chartwrap">
      <div class="head stockbar">
        <button class="arrow" data-act="prevstock" title="Previous stock (Left arrow)">${ICONS.left}</button>
        <div class="grow stockname"><b id="cTick"></b> <span id="cName"></span><div class="muted" id="cOpen"></div></div>
        <div class="stockprice"><span id="cLast"></span> <span id="cChg"></span></div>
        <button class="arrow" data-act="nextstock" title="Next stock (Right arrow)">${ICONS.right}</button>
      </div>
      <canvas></canvas>
      <div class="row muted"><span id="cPos"></span><span class="grow"></span><span>Last 2 trading days</span></div></div>`;
    chartCanvas = w.body.querySelector('canvas');
  }
  const ch = (s.price / s.dayOpen - 1) * 100;
  const set = (id, v) => { const el = $(id); if (el.textContent !== v) el.textContent = v; };
  set('cTick', s.ticker); set('cName', s.name); set('cLast', num(s.price)); set('cChg', pct(ch));
  $('cChg').className = cls(ch);
  set('cOpen', `${cap(s.sector)}  |  ${s.yield ? `Yield ${(s.yield * 100).toFixed(2)}%/day` : 'No dividend'}  |  Open today ${num(s.dayOpen)}${s.halted ? '  |  HALTED' : ''}  |  ${S.order.indexOf(s.ticker) + 1} of ${S.order.length}`);
  const h = S.me?.holdings[s.ticker];
  set('cPos', h ? `You own ${h.qty}: got at ${num(h.avgCost)}, sells at ${num(s.price)}, dividends ${money(h.divs || 0)}` : 'You own none');
}

function drawChartFrame() {
  const w = WM.get('chart');
  if (!chartCanvas || !w || w.minimized || !S.sel || !S.market[S.sel]) return;
  const s = S.market[S.sel];
  const c = chartCanvas, dpr = 1; // drawn at the low logical resolution, then scaled up blocky
  const cw = c.clientWidth, chh = c.clientHeight;
  if (!cw || !chh) return;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(chh * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(chh * dpr); }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#000'; g.fillRect(0, 0, cw, chh);

  const trading = S.me?.phase === 'trading' && S.inRun;
  const f = trading ? Math.max(0, Math.min(1, (performance.now() - S.lastTickAt) / S.tickMs)) : 1;
  const ease = f * f * (3 - 2 * f);

  const step = 12, off = ((S.tick + f) * 3) % step;
  g.strokeStyle = '#00602a'; g.lineWidth = 1;
  g.beginPath();
  for (let x = cw - off; x > 0; x -= step) { g.moveTo(Math.round(x) + 0.5, 0); g.lineTo(Math.round(x) + 0.5, chh); }
  for (let y = step; y < chh; y += step) { g.moveTo(0, y + 0.5); g.lineTo(cw, y + 0.5); }
  g.stroke();

  const data = s.history.slice(-S.ticksPerDay * 2 - 1);
  if (data.length < 3) return;
  const prev = s.prevPrice ?? s.price;
  const live = prev + (s.price - prev) * ease;
  data[data.length - 1] = live;

  const min = Math.min(...data), max = Math.max(...data), padv = (max - min) * 0.12 || 1;
  if (chartView.ticker !== s.ticker || !chartView.hi) { chartView.lo = min - padv; chartView.hi = max + padv; chartView.ticker = s.ticker; }
  chartView.lo += (min - padv - chartView.lo) * 0.12;
  chartView.hi += (max + padv - chartView.hi) * 0.12;
  const lo = Math.min(chartView.lo, min), hi = Math.max(chartView.hi, max);
  const plotW = cw - 56, N = data.length;
  const py = (v) => chh - ((v - lo) / (hi - lo)) * chh;
  const px = (i) => (plotW * (i - (trading ? f : 1))) / (N - 2);

  g.save();
  g.beginPath(); g.rect(0, 0, plotW, chh); g.clip();
  g.strokeStyle = '#d4d400'; g.setLineDash([4, 4]); g.lineWidth = 1;
  g.beginPath(); g.moveTo(0, py(s.dayOpen)); g.lineTo(plotW, py(s.dayOpen)); g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#00ff3c'; g.lineWidth = 2; g.lineJoin = 'miter';
  g.beginPath();
  data.forEach((v, i) => (i ? g.lineTo(px(i), py(v)) : g.moveTo(px(i), py(v))));
  g.stroke();
  // your trades: green square = buy, red square = sell
  const offset = s.history.length - N;
  for (const m of S.marks[s.ticker] || []) {
    const i = m.i - offset;
    if (i < 0 || i >= N) continue;
    g.fillStyle = m.side === 'buy' ? '#00ff3c' : '#ff4b4b';
    g.fillRect(Math.round(px(i)) - 4, Math.round(py(data[i])) - 4, 8, 8);
    g.strokeStyle = '#000'; g.lineWidth = 1; g.strokeRect(Math.round(px(i)) - 4.5, Math.round(py(data[i])) - 4.5, 9, 9);
  }
  g.restore();

  g.fillStyle = '#00ff3c'; g.font = '13px Pixel, Tahoma, sans-serif';
  g.fillText(num(hi), cw - 52, 12); g.fillText(num(lo), cw - 52, chh - 4);
  const ly = Math.max(8, Math.min(chh - 8, py(live)));
  g.fillStyle = live >= s.dayOpen ? '#00ff3c' : '#ff4b4b';
  g.fillRect(cw - 54, ly - 8, 54, 16);
  g.fillStyle = '#000'; g.fillText(num(live), cw - 51, ly + 4);
}

// One Buy and one Sell: type the percent you want.
// Buy % = share of your buying power to spend. Sell % = share of your shares in this stock to sell.
const pctOf = (id, def) => Math.max(0, Math.min(100, Number($(id)?.value ?? def) || 0));
function orderPreview() {
  const s = S.market[S.sel], me = S.me;
  if (!s || !me) return null;
  const fee = me.feeRate ?? 0.0025;
  const buyBudget = me.buyingPower * pctOf('oBuyPct', 25) / 100;
  const buyQty = Math.max(0, Math.floor(buyBudget / (s.price * (1 + fee))));
  const held = me.holdings[S.sel]?.qty || 0;
  const sp = pctOf('oSellPct', 100);
  const sellQty = held ? (sp >= 100 ? held : Math.max(sp > 0 ? 1 : 0, Math.floor(held * sp / 100))) : 0;
  return { s, fee, buyQty, buyCost: buyQty * s.price * (1 + fee), held, sellQty, sellGet: sellQty * s.price * (1 - fee) };
}
function renderOrder() {
  const b = body('order');
  if (!b) return;
  if (!b.dataset.built) {
    b.dataset.built = 1;
    b.innerHTML = `
      <div class="row"><b id="oTick" style="font-size:18px;min-width:56px"></b><span id="oPrice"></span><span class="grow"></span><span id="oYield" class="muted"></span></div>
      <div id="oPos" class="note" style="margin:4px 0;padding:4px 6px"></div>
      <div class="trade-row">
        <span class="lbl">Buy</span><input type="number" inputmode="numeric" id="oBuyPct" min="1" max="100" value="25"><span>% cash</span>
        <span class="grow muted" id="oBuyPrev"></span><button class="go" data-act="buy" id="bBuy" style="min-width:90px">Buy<span class="fkey"> (F5)</span></button></div>
      <div class="trade-row">
        <span class="lbl">Sell</span><input type="number" inputmode="numeric" id="oSellPct" min="1" max="100" value="100"><span>% shares</span>
        <span class="grow muted" id="oSellPrev"></span><button class="stop" data-act="sell" id="bSell" style="min-width:90px">Sell<span class="fkey"> (F6)</span></button></div>
      <div id="oMsg" style="margin-top:6px"></div>`;
    $('oBuyPct').oninput = $('oSellPct').oninput = () => dirty();
  }
  const pv = orderPreview();
  if (!pv) return;
  const { s } = pv, me = S.me, h = me.holdings[S.sel];
  $('oTick').textContent = s.ticker;
  $('oPrice').textContent = `${money(s.price)}  ${pct((s.price / s.dayOpen - 1) * 100)}`;
  $('oPrice').className = cls(s.price - s.dayOpen);
  $('oYield').textContent = s.yield ? `Dividend ${(s.yield * 100).toFixed(2)}%/day while owned` : 'No dividend';
  if (h) {
    const worth = h.qty * s.price * (1 - pv.fee), paid = h.qty * h.avgCost, pl = worth - paid + (h.divs || 0);
    setHTML($('oPos'), `Own <b>${h.qty}</b> | Got for <b>${money(h.avgCost)}</b> | Sells for <b>${money(s.price * (1 - pv.fee))}</b><br>
      Worth <b>${money(worth)}</b> | Dividends <b class="up">+${money(h.divs || 0)}</b> | Profit <b class="${cls(pl)}">${money(pl)}</b>`);
  } else setHTML($('oPos'), `You own none.<br>Costs <b>${money(s.price * (1 + pv.fee))}</b> per share with the ${(pv.fee * 100).toFixed(2)}% fee.`);
  $('oBuyPrev').textContent = pv.buyQty ? `= ${pv.buyQty} for ${money(pv.buyCost)}` : '= not enough';
  $('oSellPrev').textContent = pv.sellQty ? `= ${pv.sellQty} for ${money(pv.sellGet)}` : '= none owned';
  const ok = tradeable() && !s.halted;
  $('bBuy').disabled = !ok || !pv.buyQty;
  $('bSell').disabled = !ok || !pv.sellQty;
  const msg = !S.me.alive ? `<div class="danger">Your run is over. ${esc(S.me.outReason || '')}</div>`
    : S.me.bankrupt ? '<div class="danger">You have hit $0. <a data-act="bank">Take out a loan</a> to keep trading.</div>'
    : s.halted ? `<div class="danger">${s.ticker} is halted for the rest of the day.</div>` : '';
  setHTML($('oMsg'), msg);
}

function renderAccount() {
  const b = body('account');
  if (!b || !S.me) return;
  const me = S.me, loan = me.loan;
  const best = Math.max(Profile.data.life.bestNetWorth || 0, me.stats?.peakNetWorth || 0, me.startCash * 2);
  const frac = me.netWorth / best;
  const loanLeft = loan ? loan.dueDay - S.day + 1 : 0;
  const rows = Object.entries(me.holdings);
  setHTML(b, `
    <div class="kv">
      <span>Cash</span><span class="v">${money(me.cash)}</span>
      ${loan ? `<span>Debt</span><span class="v down">-${money(loan.owed)}</span>` : ''}
      <span><b>Net worth</b></span><span class="v"><b class="${me.netWorth >= me.startCash ? 'up' : 'down'}">${money(me.netWorth)}</b></span>
      <span>Buying power</span><span class="v">${money(me.buyingPower)}</span>
      <span>Day</span><span class="v">${S.day}</span>
    </div>
    <div class="progress ${frac >= 1 ? '' : 'warn'}" style="margin:6px 0 2px"><div style="width:${Math.max(0, Math.min(100, frac * 100))}%"></div></div>
    <div class="muted" style="font-size:11px">${Math.round(Math.max(0, frac) * 100)}% of your ${Profile.data.life.bestNetWorth > me.startCash * 2 ? 'record' : 'goal'} (${money(best)})</div>
    ${loan ? `<div class="danger" style="margin-top:8px"><b>${esc(loan.name)}</b>: owe ${money(loan.owed)}, due at the close of day ${loan.dueDay}
      (${loanLeft <= 1 ? '<b>today</b>' : `${loanLeft} days`}).
      <div class="row" style="margin-top:6px"><button class="small" data-act="repay" data-arg="0.25">Pay 25%</button><button class="small" data-act="repay" data-arg="1">Pay all</button></div></div>`
      : ''}
    <div class="row" style="margin-top:8px"><button class="small" data-act="bank">Bank...</button><span class="grow"></span>
      <button class="small" data-act="cashout" ${me.alive ? '' : 'disabled'}>Cash Out...</button></div>
    <div class="panel-title" style="margin-top:10px">Positions</div>
    <div class="list"><table><tr><th>Stock</th><th class="num">Qty</th><th class="num">Got at</th><th class="num">Sells at</th><th class="num">P/L</th></tr>
      ${rows.length ? rows.map(([t, h]) => { const px = S.market[t].price, pl = (px - h.avgCost) * h.qty + (h.divs || 0);
        return `<tr class="click ${t === S.sel ? 'sel' : ''}" data-act="sel" data-arg="${t}"><td>${t}</td><td class="num">${h.qty}</td><td class="num">${num(h.avgCost)}</td><td class="num">${num(px)}</td><td class="num ${cls(pl)}" title="includes ${money(h.divs || 0)} dividends">${num(pl)}</td></tr>`; }).join('')
        : '<tr><td colspan="5" class="muted">No open positions</td></tr>'}
    </table></div>`);
}

const BUFF_NAMES = { stopLoss: 'Stop-Loss', noFees: 'Fee Waiver', margin: 'Margin Boost' };
function renderPerks() {
  const b = body('perks');
  if (!b || !S.me) return;
  const me = S.me, trading = tradeable();
  setHTML(b, `
    <div class="panel-title">Perks</div>
    ${me.perks.length ? me.perks.map((p) => `<div class="card" style="margin-bottom:6px">
      <div class="row"><h4 class="grow">${esc(p.name)}</h4><span class="rar ${p.rarity}">${p.rarity}</span></div><p>${esc(p.desc)}</p>
      ${p.active ? `<div><button class="small" data-act="active" data-arg="${p.id}" ${p.active.ready && trading ? '' : 'disabled'}>${esc(p.active.name)} on ${S.sel}</button></div>` : ''}
    </div>`).join('') : '<p class="muted">No perks yet. Buy them in the Shop.</p>'}
    <div class="panel-title">Items</div>
    ${me.buffs.length ? `<p class="note" style="margin:0 0 6px">Active today: ${me.buffs.map((x) => esc(BUFF_NAMES[x] || x)).join(', ')}</p>` : ''}
    ${me.items.length ? me.items.map((i) => `<div class="row" style="margin-bottom:4px"><span class="grow"><b>${esc(i.name)}</b> x${i.count}</span>
      <button class="small" data-act="useitem" data-arg="${i.id}" ${trading ? '' : 'disabled'}>Use${i.needsTicker ? ` on ${S.sel}` : ''}</button></div>`).join('')
      : '<p class="muted">No items. Buy them in the Shop.</p>'}`);
}

function renderLeaders() {
  const b = body('leaders');
  if (!b) return;
  setHTML(b, `<div class="list" style="height:100%"><table><tr><th>#</th><th>Trader</th><th class="num">Net worth</th><th></th></tr>
    ${S.board.map((p, i) => `<tr class="${p.id === S.me?.id ? 'sel' : ''}"><td>${i + 1}</td><td>${esc(p.name)}</td>
      <td class="num">${num(p.netWorth)}</td><td>${!p.alive ? 'Out' : p.inDebt ? 'In debt' : p.connected ? '' : 'Offline'}</td></tr>`).join('')}
  </table></div>`);
}

function renderNews() {
  const b = body('news');
  if (!b || !S.newsDirty) return;
  S.newsDirty = false;
  setHTML(b, `<div class="news">${S.news.slice(0, 60).map((n) =>
    `<div${n.mine ? ' style="color:#0a3a8a"' : ''}><span class="t">${esc(n.t)}</span>${esc(n.text)}</div>`).join('')}</div>`);
}

function renderShop() {
  const w = WM.get('shop');
  if (!w || !S.me) return;
  const me = S.me, tab = S.shopTab;
  setHTML(w.body, `
    <div class="row" style="margin-bottom:6px"><span>Cash <b>${money(me.cash)}</b></span>
      <span>Net worth <b>${money(me.netWorth)}</b></span><span class="grow"></span><span class="muted">Restocks every day. The market keeps moving while you shop.</span></div>
    <div class="tabs">${[['perks', 'Perks'], ['items', 'Items'], ['bank', 'Bank']].map(([k, l]) => `<div class="tab ${tab === k ? 'on' : ''}" data-act="tab" data-arg="${k}">${l}</div>`).join('')}</div>
    <div style="height:calc(100% - 60px);overflow:auto">${!me.alive ? '<p class="muted">Your run is over.</p>' : tab === 'perks' ? shopPerks(me) : tab === 'items' ? shopItems(me) : bankHTML(me)}</div>`);
}

function shopPerks(me) {
  return `<div class="cards">${me.offers.map((o) => `<div class="card"><span class="rar ${o.rarity}">${o.rarity}</span><h4>${esc(o.name)}</h4>
    <p>${esc(o.desc)}</p><div class="row"><b class="grow">${money(o.cost)}</b><button class="small" data-act="shopbuy" data-arg="${o.id}" ${me.cash >= o.cost ? '' : 'disabled'}>Buy</button></div></div>`).join('')
    || '<p class="muted">Sold out.</p>'}</div>
    <div class="row" style="margin-top:8px"><button data-act="reroll" ${me.cash >= me.rerollCost ? '' : 'disabled'}>Reroll (${me.rerollCost ? money(me.rerollCost) : 'free'})</button></div>`;
}
function shopItems(me) {
  return `<p class="muted" style="margin-top:0">One-use items. Use them from the Perks and Items window.</p>
    <div class="cards">${me.itemShop.map((i) => { const have = me.items.find((x) => x.id === i.id)?.count || 0;
      return `<div class="card"><h4>${esc(i.name)}${have ? ` <span class="muted">(have ${have})</span>` : ''}</h4><p>${esc(i.desc)}</p>
      <div class="row"><b class="grow">${money(i.cost)}</b><button class="small" data-act="itembuy" data-arg="${i.id}" ${me.cash >= i.cost ? '' : 'disabled'}>Buy</button></div></div>`; }).join('')}</div>`;
}
function bankHTML(me) {
  if (me.loan) {
    const l = me.loan;
    return `<div class="danger"><b>${esc(l.name)}</b><br>You owe <b>${money(l.owed)}</b>, due at the close of day <b>${l.dueDay}</b>.
      If it isn't paid by then, you lose the run.</div>
      <div class="row" style="margin-top:8px"><button data-act="repay" data-arg="0.25">Pay 25%</button><button data-act="repay" data-arg="0.5">Pay 50%</button>
      <button class="primary" data-act="repay" data-arg="1">Pay in full</button></div>
      <p class="muted">You can only have one loan at a time.</p>`;
  }
  return `<p style="margin-top:0">Borrow cash now, pay it back with interest. <b>Debt counts against your net worth, and an unpaid loan ends your run.</b></p>
    <div class="list"><table><tr><th>Lender</th><th class="num">You get</th><th class="num">You repay</th><th class="num">Days</th><th></th></tr>
    ${me.loanOffers.map((o) => `<tr><td>${esc(o.name)}</td><td class="num">${money(o.amount)}</td><td class="num">${money(o.owed)}</td><td class="num">${o.days}</td>
      <td><button class="small" data-act="loan" data-arg="${o.id}">Borrow</button></td></tr>`).join('')}</table></div>
    <p class="muted">Better terms: Credit Score and Deep Pockets in the Item Shop.</p>`;
}
function renderBank() { const b = body('bank'); if (b && S.me) setHTML(b, bankHTML(S.me)); }

// ---------- meta windows ----------
function renderItemShop() {
  const b = body('itemshop');
  if (!b) return;
  const P = Profile.data;
  setHTML(b, `
    <div class="row" style="margin-bottom:8px">${ICONS.certificate.replace(/<(svg|img)/, '<$1 style="width:28px;height:28px"')}
      <div><div class="big">${P.certificates} certificates</div><div class="muted">Earned after every run. Upgrades are permanent until you rebirth.</div></div></div>
    ${S.inRun ? '<p class="note">Upgrades you buy now apply from your next run.</p>' : ''}
    <div class="cards">${META.UPGRADES.map((u) => {
      const lvl = Profile.upgradeLevel(u.id), max = Profile.upgradeMax(u), cost = Profile.upgradeCost(u), done = lvl >= max;
      return `<div class="card"><div class="row"><h4 class="grow">${esc(u.name)}</h4><span class="badge" style="color:${done ? '#18892c' : '#555'}">Lv ${lvl}/${max}</span></div>
        <p>${esc(u.desc)}</p><div class="progress" style="height:10px"><div style="width:${(lvl / max) * 100}%"></div></div>
        <div class="row"><span class="grow">${done ? '<span class="up">Maxed</span>' : `${cost} certificates`}</span>
        <button class="small" data-act="upgrade" data-arg="${u.id}" ${done || P.certificates < cost ? 'disabled' : ''}>${done ? 'Max' : 'Upgrade'}</button></div></div>`;
    }).join('')}</div>`);
}

function renderAchievements() {
  const b = body('achievements');
  if (!b) return;
  const got = Profile.data.achievements, total = META.ACHIEVEMENTS.length, n = Object.keys(got).length;
  const list = [...META.ACHIEVEMENTS].sort((a, c) => (got[c.id] ? 1 : 0) - (got[a.id] ? 1 : 0));
  setHTML(b, `
    <div class="row" style="margin-bottom:6px"><b>${n} of ${total}</b> unlocked</div>
    <div class="progress" style="margin-bottom:8px"><div style="width:${(n / total) * 100}%"></div></div>
    <div class="list">${list.map((a) => {
      const on = got[a.id], secret = a.hidden && !on;
      return `<div class="ach ${on ? '' : 'locked'}">${on ? ICONS.trophy : ICONS.lock}<div><b>${secret ? 'Secret achievement' : esc(a.name)}</b>
        <small>${secret ? 'Keep playing to find out.' : esc(a.desc)}${on ? ` Unlocked ${new Date(on).toLocaleDateString()}.` : ''}</small></div></div>`;
    }).join('')}</div>`);
}

function renderRebirth() {
  const b = body('rebirth');
  if (!b) return;
  const P = Profile.data, can = Profile.canRebirth(), gain = META.rebirthReward(P), best = P.bestDaysSinceRebirth || 0;
  setHTML(b, `
    <div class="row">${ICONS.rebirth.replace(/<(svg|img)/, '<$1 style="width:48px;height:48px"')}
      <div><div class="big">${esc(META.title(P.rebirths))}</div><div class="muted">${P.rebirths} rebirth${P.rebirths === 1 ? '' : 's'}, ${P.goldenShares} Golden Shares</div></div></div>
    <fieldset style="margin-top:10px"><legend>What rebirth does</legend>
      <ul style="margin:0;padding-left:18px;line-height:1.6">
        <li>Resets your certificates and every Item Shop upgrade.</li>
        <li>Gives Golden Shares: each one is +5% certificates and +2% starting cash, forever.</li>
        <li>Raises your title and lets Seed Money go one level higher.</li>
        <li>Makes every loan ${Math.round(META.REBIRTH_LOAN_PENALTY * 100)}% more expensive per rebirth.</li>
      </ul></fieldset>
    <fieldset><legend>Requirement</legend>
      Survive ${META.REBIRTH_DAYS_NEEDED} days in one run since your last rebirth. Best so far: <b>${best}</b>.
      <div class="progress" style="margin-top:6px"><div style="width:${Math.min(100, (best / META.REBIRTH_DAYS_NEEDED) * 100)}%"></div></div>
    </fieldset>
    <div class="row"><span class="grow">Reward now: <b>${gain} Golden Share${gain > 1 ? 's' : ''}</b></span>
      <button class="primary" data-act="rebirth" ${can && !S.inRun ? '' : 'disabled'}>Rebirth...</button></div>
    ${S.inRun ? '<p class="muted">Finish your current run first.</p>' : ''}`);
}

function renderHistory() {
  const b = body('history');
  if (!b) return;
  const H = Profile.data.history, L = Profile.data.life;
  setHTML(b, `
    <div class="row muted" style="margin-bottom:6px">Runs ${L.runs} | Best net worth ${money(L.bestNetWorth)} | Longest run ${L.bestDays || 0} days | Longest on loans ${L.maxLoanDays} days | Loans defaulted ${L.loanDefaults}</div>
    <div class="list" style="height:calc(100% - 26px)"><table><tr><th>Date</th><th>Mode</th><th>Result</th><th class="num">Days</th><th class="num">Net worth</th><th class="num">Days on loan</th><th class="num">Certs</th></tr>
    ${H.map((h) => `<tr title="${esc(h.reason)}"><td>${new Date(h.date).toLocaleDateString()}</td><td>${h.mode === 'coop' ? 'Co-op' : 'Versus'}</td>
      <td class="${h.won ? 'up' : 'down'}">${esc(h.result || (h.won ? 'Cashed out' : 'Lost'))}</td><td class="num">${h.day}</td>
      <td class="num">${num(h.netWorth)}</td><td class="num">${h.daysOnLoan}</td><td class="num">${h.certs}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No runs yet.</td></tr>'}
    </table></div>`);
}

// ---------- room chat (peer to peer, see p2p.js) ----------
const playerName = (id) => (S.board.find((p) => p.id === id) || S.lobby?.players.find((p) => p.id === id))?.name || 'Trader';
P2P.setup({
  send: (to, d) => send({ t: 'rtc', to, d }),
  onChat: (from, text) => {
    S.chat.push({ name: playerName(from), text, at: clockNow() });
    if (S.chat.length > 100) S.chat.shift();
    if (!WM.isOpen('chat')) { S.unread++; balloon(playerName(from), text, 'chat'); }
    chime([[880, 0, 0.06]]);
    dirty();
  },
  onChange: () => dirty(),
});
const clockNow = () => new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
// In a run the chat sits over the Leaderboard and News Wire column, so it never hides the Order Ticket.
function chatPos() {
  const W = $('desktop').offsetWidth, H = $('desktop').offsetHeight;
  if (S.inRun && document.body.classList.contains('phone')) { const L = gameLayout().market; return { x: L.x, y: L.y - TAB_H, w: L.w, h: L.h + TAB_H }; }
  if (S.inRun) { const L = gameLayout(); return { x: L.leaders.x, y: L.leaders.y, w: L.leaders.w, h: H - L.leaders.y - 6 }; }
  return { x: W - 306, y: H - 336, w: 300, h: 330 };
}
function openChat() {
  if (!S.lobby) return WM.dialog({ title: 'Room Chat', icon: 'info', html: 'Join a room to chat with the other players.' });
  if (!WM.isOpen('chat')) openApp('chat', chatPos());
  WM.focus('chat');
  S.unread = 0;
  setTimeout(() => $('chatIn')?.focus(), 0);
  dirty();
}
function toggleChat() { if (WM.isOpen('chat')) { WM.close('chat'); dirty(); } else openChat(); }
async function toggleMic() {
  if (!S.lobby) return SFX.error();
  try {
    const on = await P2P.setMic(!P2P.micOn);
    balloon('Voice chat', on ? 'Microphone on. Everyone in the room can hear you.' : 'Microphone off.', on ? 'mic' : 'micoff');
  } catch (e) {
    SFX.error();
    WM.dialog({ title: 'Microphone', icon: 'error', html: esc(e.message || 'Could not open the microphone.') });
  }
  dirty();
}
function sendChat() {
  const inp = $('chatIn');
  const r = P2P.say(inp.value);
  if (!r) return;
  inp.value = '';
  S.chat.push({ name: Profile.data.name || 'You', text: r.text, at: clockNow(), me: true });
  if (!r.direct && !r.relay) S.chat.push({ sys: true, text: 'Nobody else is in the room yet.' });
  dirty();
}
function renderChat() {
  const b = body('chat');
  if (!b) return;
  if (!b.dataset.built) {
    b.dataset.built = 1;
    b.innerHTML = `<div class="chat">
      <div class="chat-peers" id="chatPeers"></div>
      <div class="chat-log" id="chatLog"></div>
      <div class="row"><input id="chatIn" class="grow" maxlength="200" placeholder="Message (Enter sends)"><button class="small" id="chatSend">Send</button></div>
      <div class="row"><button class="small" data-act="mic" id="chatMic"></button><span class="grow muted" id="chatNote"></span></div></div>`;
    $('chatSend').onclick = sendChat;
    $('chatIn').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } if (e.key === 'Escape') { $('chatIn').blur(); } };
  }
  const peers = P2P.peers();
  const label = { direct: 'Direct', connecting: 'Connecting', relay: 'Relay (no voice)' };
  setHTML($('chatPeers'), peers.length
    ? peers.map((p) => `<div class="row chat-peer"><span class="dot ${p.speaking ? 'talk' : p.state}"></span><b class="grow">${esc(playerName(p.id))}</b>
        <span class="muted">${label[p.state] || p.state}</span><button class="small" data-act="peermute" data-arg="${esc(p.id)}" title="Mute or unmute this player for you">${p.muted ? 'Unmute' : 'Mute'}</button></div>`).join('')
    : '<div class="muted">No one else here yet.</div>');
  const log = $('chatLog');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 4;
  setHTML(log, S.chat.map((m) => m.sys ? `<div class="muted">${esc(m.text)}</div>`
    : `<div><span class="muted">${esc(m.at)}</span> <b class="${m.me ? 'me' : ''}">${esc(m.name)}:</b> ${esc(m.text)}</div>`).join(''));
  if (atBottom) log.scrollTop = log.scrollHeight;
  setHTML($('chatMic'), `${P2P.micOn ? ICONS.mic : ICONS.micoff} Mic ${P2P.micOn ? 'on' : 'off'}`);
  const direct = peers.filter((p) => p.state === 'direct').length;
  setHTML($('chatNote'), peers.length ? `${direct}/${peers.length} direct` : '');
}

// ---------- save code ----------
function renderSaveCode() {
  const b = body('savecode');
  if (!b || b.dataset.built) return;
  b.dataset.built = 1;
  b.innerHTML = `<p>Your progress (certificates, upgrades, rebirths, achievements, history) as a hex code. Keep it somewhere safe, or paste it on another computer to move your save.</p>
    <textarea id="hexOut" class="hex" readonly rows="6">Building code...</textarea>
    <div class="row"><button class="small" id="hexCopy">Copy</button><span class="grow muted" id="hexInfo"></span></div>
    <p style="margin-top:10px"><b>Load a save code</b></p>
    <textarea id="hexIn" class="hex" rows="4" placeholder="Paste a save code here"></textarea>
    <div class="row"><button class="small" id="hexLoad">Load...</button><span class="grow"></span></div>`;
  Profile.exportHex().then((h) => { $('hexOut').value = h; $('hexInfo').textContent = `${h.replace(/ /g, '').length / 2} bytes`; });
  $('hexCopy').onclick = async () => {
    $('hexOut').select();
    try { await navigator.clipboard.writeText($('hexOut').value); } catch { document.execCommand('copy'); }
    $('hexInfo').textContent = 'Copied.';
  };
  $('hexLoad').onclick = async () => {
    let save;
    try { save = await Profile.readHex($('hexIn').value); }
    catch (e) { SFX.error(); return WM.dialog({ title: 'Save Code', icon: 'error', html: esc(e.message) }); }
    WM.dialog({ title: 'Load save code', icon: 'warning',
      html: `Replace your current progress with this save?<br><br><b>${esc(save.name || 'Trader')}</b>: ${esc(META.title(save.rebirths))}, ${save.certificates} certificates, ${Object.keys(save.achievements || {}).length} achievements, ${save.life.runs} runs.`,
      buttons: [{ label: 'Load', primary: true, action: () => {
        Profile.load(save);
        for (const id of Object.keys(save.achievements || {})) desk?.achieve(id);
        applySettings(); applyRes(); renderStartMenu(); dirty();
        WM.close('savecode');
        balloon('Save Code', 'Progress loaded.', 'disk');
      } }, { label: 'Cancel' }] });
  };
}

function renderHelp() {
  const b = body('help');
  if (!b || b.dataset.built) return;
  b.dataset.built = 1;
  b.innerHTML = `
    <div class="panel-title">How to play</div>
    <p>Every run has a brand new market: new companies, new prices, new personalities. Grow your net worth (cash + shares - debt) as high as you can.
    The market never closes. <b>Cash Out</b> from My Portfolio whenever you want to bank your score. In Versus, the last trader standing wins.</p>
    <p>Everyone in the room trades the same market, so big orders move prices for everybody.</p>
    <div class="panel-title">Shop</div>
    <p>Open the <b>Shop</b> from the taskbar any time. <b>Perks</b> last the whole run, <b>Items</b> are one-use, and the <b>Bank</b> lends money. It restocks every day. Anything you buy lowers your net worth.</p>
    <div class="panel-title">Loans</div>
    <p>If you hit $0 you must borrow to keep trading. Debt counts against your net worth. <b>If a loan isn't paid back by its due date, you lose.</b>
    Your run report shows how many days you lasted on borrowed money.</p>
    <div class="panel-title">Item Shop and rebirth</div>
    <p>Each run earns certificates for permanent <b>Item Shop</b> upgrades. Survive ${META.REBIRTH_DAYS_NEEDED} days in a run to unlock <b>Rebirth</b>:
    reset upgrades for Golden Shares, a new title, and pricier loans.</p>
    <div class="panel-title">Keys</div>
    <p>Left/Right or the arrow buttons on the chart switch stocks. F5 buys and F6 sells, using the percents in the Order Ticket. Stocks pay dividends (a % of their value per day) while you own them. The Command Prompt accepts typed orders such as <code>buy nova 25</code>.</p>
    <p><b>Chat:</b> press Enter or click the chat icon by the clock to talk to the room. Click the microphone icon to turn voice on or off. Text and voice go directly between players (peer to peer).</p>
    <p><b>Save Code</b> (Start menu) turns your progress into a hex code you can back up or paste on another computer.</p>`;
}

function renderCmd() {
  const b = body('cmd');
  if (!b || b.dataset.built) return;
  b.dataset.built = 1;
  b.innerHTML = `<div class="cmd"><div id="cmdOut">TradeOS [Version 1.0]<br>Type HELP for a list of commands.<br><br></div><div>C:\\TRADER&gt;<input id="cmdIn" autocomplete="off" spellcheck="false"></div></div>`;
  const out = $('cmdOut'), inp = $('cmdIn');
  const print = (t) => { out.innerHTML += esc(t).replace(/\n/g, '<br>') + '<br>'; out.parentElement.scrollTop = 1e9; };
  b.onclick = () => inp.focus();
  inp.focus();
  inp.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    const line = inp.value.trim(); inp.value = '';
    print('C:\\TRADER>' + line);
    const [c, a, x] = line.toUpperCase().split(/\s+/);
    const t = S.market[a] ? a : S.sel;
    const n = Number(S.market[a] ? x : a);
    if (!c) return;
    if (c === 'HELP') return print('BUY [TICKER] [PERCENT]   SELL [TICKER] [PERCENT]   SELECT TICKER\nPRICES   PORTFOLIO   LOAN SMALL|MEDIUM|SHARK   REPAY   CASHOUT   CLS   EXIT');
    if (c === 'CLS') { out.innerHTML = ''; return; }
    if (c === 'EXIT') return WM.close('cmd');
    if (!S.inRun) return print('Not in a run. Open Start a Run first.');
    if (c === 'SELECT' && S.market[a]) { S.sel = a; dirty(); return print('Selected ' + a); }
    if (c === 'PRICES') return print(S.order.map((k) => `${k.padEnd(6)} ${num(S.market[k].price).padStart(10)}  ${S.market[k].name}`).join('\n'));
    if (c === 'PORTFOLIO') return print(`Cash ${money(S.me.cash)}  Net worth ${money(S.me.netWorth)}` + (S.me.loan ? `  Debt ${money(S.me.loan.owed)} due day ${S.me.loan.dueDay}` : ''));
    if (c === 'BUY') { send({ t: 'buy', ticker: t, pct: n || 25 }); return print(`Buying ${t} with ${n || 25}% of your cash.`); }
    if (c === 'SELL') { send({ t: 'sell', ticker: t, pct: n || 100 }); return print(`Selling ${n || 100}% of your ${t}.`); }
    if (c === 'LOAN') { send({ t: 'loan_take', tier: (a || 'small').toLowerCase() }); return print('Loan requested.'); }
    if (c === 'REPAY') { A.repay(1); return print('Payment sent.'); }
    if (c === 'CASHOUT') { A.cashout(); return print('Confirm in the dialog.'); }
    print(`'${line}' is not recognized as an internal or external command.`);
  };
}

// ---------- run report ----------
function showResults(m) {
  S.results = m;
  const s = m.stats;
  const won = !!(s.cashedOut || s.lastStanding);
  const outcome = { won, netWorth: m.netWorth, startCash: m.startCash };
  const before = checkAch(s, outcome);
  const certs = Profile.recordRun(m);
  const after = checkAch({}, outcome);
  const unlocked = [...before, ...after];
  WM.close('shop');
  const title = s.lastStanding ? 'Last Trader Standing' : s.cashedOut ? 'Cashed Out' : s.loanDefault ? 'The Loan Sharks Got You' : 'Game Over';
  const icon = won ? 'trophy' : s.loanDefault ? 'shark' : 'warning';
  const w = WM.open('results', { title: 'Run Report', icon: won ? 'trophy' : 'warning', w: 480, h: 500, center: true, forcePos: true });
  w.body.innerHTML = `
    <div class="row" style="flex-wrap:nowrap">${ICONS[icon].replace(/<(svg|img)/, '<$1 style="width:44px;height:44px;flex:0 0 44px"')}
      <div class="grow" style="min-width:0"><div class="big ${won ? 'up' : 'down'}">${title}</div><div class="muted">${esc(m.reason || '')}</div></div></div>
    <fieldset style="margin-top:10px"><legend>Statement</legend><div class="kv">
      <span>Days survived</span><span class="v">${s.daysSurvived || m.day}</span>
      <span>Starting money</span><span class="v">${money(m.startCash)}</span>
      <span>Final net worth</span><span class="v">${money(m.netWorth)}</span>
      <span>Peak net worth</span><span class="v">${money(s.peakNetWorth)}</span>
      <span>Trades</span><span class="v">${s.trades}</span>
      <span>Times you hit $0</span><span class="v">${s.bankrupt}</span>
      <span>Loans taken / repaid</span><span class="v">${s.loansTaken} / ${s.loansRepaid}</span>
      <span><b>Days on borrowed money</b></span><span class="v"><b>${s.daysOnLoan}</b></span>
    </div></fieldset>
    <fieldset><legend>Rewards</legend>
      <div class="row">${ICONS.certificate.replace(/<(svg|img)/, '<$1 style="width:24px;height:24px"')}<b>+${certs} certificates</b><span class="muted">${m.fair ? '(fair play room)' : ''}</span></div>
      ${unlocked.length ? `<div style="margin-top:6px">New achievements: ${unlocked.map((a) => `<b>${esc(a.name)}</b>`).join(', ')}</div>` : ''}
      ${Profile.canRebirth() ? '<div class="note" style="margin-top:6px">Rebirth is available.</div>' : ''}
    </fieldset>
    <div class="row"><span class="grow"></span>
      ${Profile.canRebirth() ? '<button data-act="open" data-arg="rebirth">Rebirth...</button>' : ''}
      <button data-act="open" data-arg="itemshop">Item Shop</button>
      <button class="primary go" data-act="newrun">New Run</button></div>`;
  renderStartMenu();
}

// ---------- shell: icons, start menu, tray ----------
const DESKTOP_ICONS = [
  ['newgame', 'Start a Run', 'start-green'], ['itemshop', 'Item Shop', 'bag'], ['achievements', 'Achievements', 'trophy'],
  ['rebirth', 'Rebirth', 'rebirth'], ['history', 'Run History', 'news'], ['cmd', 'Command Prompt', 'cmd'], ['help', 'Help', 'help'],
];
function renderIcons() {
  $('icons').innerHTML = DESKTOP_ICONS.map(([id, label, icon]) => `<div class="icon" data-app="${id}">${ICONS[icon]}<span>${label}</span></div>`).join('');
  $('icons').querySelectorAll('.icon').forEach((el) => {
    el.onclick = () => { $('icons').querySelectorAll('.icon').forEach((x) => x.classList.remove('sel')); el.classList.add('sel'); };
    el.ondblclick = () => openApp(el.dataset.app);
  });
}

function renderStartMenu() {
  const P = Profile.data;
  const item = (id, label, icon, sub = '') => `<div class="sm-item" data-act="open" data-arg="${id}">${ICONS[icon]}<div><b>${label}</b>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
  $('startmenu').innerHTML = `
    <div class="top">${ICONS.user.replace(/<(svg|img)/, '<$1 style="width:46px;height:46px;border:2px solid #fff;background:#fff"')}<div>${esc(P.name || 'Trader')}<small>${esc(META.title(P.rebirths))} | ${P.certificates} certificates | ${P.goldenShares} Golden Shares</small></div></div>
    <div class="cols"><div class="col">
      ${item('newgame', 'Start a Run', 'start-green', 'Create or join a room')}
      ${S.inRun ? '<div class="sm-item" data-act="shop">' + ICONS.bag + '<div><b>Shop</b><small>Perks, items and loans</small></div></div>' : ''}
      ${S.inRun ? `${item('market', 'Market Watch', 'market')}${item('chart', 'Performance', 'chart')}${item('order', 'Order Ticket', 'order')}
        ${item('account', 'My Portfolio', 'briefcase')}${item('perks', 'Perks and Items', 'star')}${item('news', 'News Wire', 'news')}${item('leaders', 'Leaderboard', 'users')}` : ''}
      ${item('cmd', 'Command Prompt', 'cmd')}
    </div><div class="col r">
      ${item('itemshop', 'Item Shop', 'bag', 'Permanent upgrades')}
      ${item('achievements', 'Achievements', 'trophy', `${Object.keys(P.achievements).length} of ${META.ACHIEVEMENTS.length}`)}
      ${item('rebirth', 'Rebirth', 'rebirth', Profile.canRebirth() ? 'Available' : '')}
      ${S.inRun ? item('bank', 'Bank', 'bank') : ''}
      ${S.inRun && S.me?.alive ? '<div class="sm-item" data-act="cashout">' + ICONS.flag + '<div><b>Cash Out</b><small>End the run, keep your score</small></div></div>' : ''}
      ${item('history', 'Run History', 'news')}
      ${item('savecode', 'Save Code', 'disk', 'Back up or move your progress')}
      <div class="sm-item" id="smSettings">${ICONS.settings}<div><b>Settings</b></div></div>
      ${item('help', 'Help and Support', 'help')}
    </div></div>
    <div class="bottom"><button id="smLogoff">${ICONS.logoff}Log Off</button><button id="smOff">${ICONS.power}Turn Off Computer</button></div>`;
  $('smSettings').onclick = () => { hideStart(); openSettings(); };
  $('smLogoff').onclick = () => { hideStart(); leaveRun(); WM.closeAll(); showWelcome(); };
  $('smOff').onclick = () => { hideStart(); desk ? desk.quit() : window.Capacitor?.Plugins?.App ? window.Capacitor.Plugins.App.exitApp() : WM.dialog({ title: 'Turn Off Computer', icon: 'info', html: 'Close this browser tab to quit.' }); };
}
function toggleStart() {
  const hidden = $('startmenu').classList.toggle('hidden');
  $('start').classList.toggle('on', !hidden);
  if (!hidden) renderStartMenu();
}
function hideStart() { $('startmenu').classList.add('hidden'); $('start').classList.remove('on'); }
$('start').onclick = (e) => { e.stopPropagation(); toggleStart(); };
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#startmenu') && !e.target.closest('#start')) hideStart(); });

function openSettings() {
  const st = Profile.data.settings;
  WM.dialog({
    title: 'Settings', icon: 'settings', width: 400,
    html: `<fieldset><legend>Screen resolution</legend>${RES_OPTIONS.map(([v, l]) => `<label class="check"><input type="radio" name="setRes" value="${v}" ${String(st.res ?? DEFAULT_RES) === String(v) ? 'checked' : ''}> ${l}</label><br>`).join('')}</fieldset>
      <label class="check"><input type="checkbox" id="setCrt" ${st.crt ? 'checked' : ''}> CRT monitor effect (scanlines)</label><br>
      <label class="check"><input type="checkbox" id="setSnd" ${st.sound ? 'checked' : ''}> Sounds</label><br><br>
      <a data-act="savecode">Save code (back up or load progress)...</a><br><br>
      <a id="setWipe" style="color:#a3080e">Erase all progress...</a>`,
    buttons: [{ label: 'OK', primary: true, action: () => { st.crt = $('setCrt').checked; st.sound = $('setSnd').checked; st.res = document.querySelector('input[name=setRes]:checked')?.value ?? DEFAULT_RES; Profile.changed(); applySettings(); applyRes(); } }, { label: 'Cancel' }],
  });
  $('setWipe').onclick = () => WM.dialog({ title: 'Erase progress', icon: 'warning', html: 'Erase certificates, upgrades, rebirths, achievements and history? This cannot be undone.',
    buttons: [{ label: 'Erase', action: () => { Profile.reset(); dirty(); } }, { label: 'Cancel', primary: true }] });
}
function applySettings() { document.body.classList.toggle('crt', !!Profile.data.settings.crt); }

// ---------- low resolution ----------
// The desktop is laid out at a small logical height and scaled up to fill the window.
const RES_OPTIONS = [['480', 'Very low (480 lines)'], ['600', 'Low (600 lines)'], ['720', 'Medium (720 lines)'], ['native', 'Native (sharp)']];
const DEFAULT_RES = '600';
function applyRes() {
  document.body.classList.toggle('phone', isPhone());
  const r = isPhone() ? 'native' : String(Profile.data.settings.res ?? DEFAULT_RES);
  const W = innerWidth, H = innerHeight;
  const h = r === 'native' ? H : Math.min(H, Number(r));
  const k = H / h;
  const w = Math.round(W / k);
  window.UI_SCALE = k;
  const root = $('root').style;
  root.setProperty('--w', w + 'px'); root.setProperty('--h', h + 'px'); root.setProperty('--k', k);
}
addEventListener('resize', () => {
  applyRes();
  if (S.inRun) for (const [id, p] of Object.entries(gameLayout())) WM.place(id, p);
  if (WM.isOpen('chat')) WM.place('chat', chatPos());
  WM.recenter();
  WM.clampAll();
  for (const id of Object.keys(APPS)) if (WM.isOpen(id)) APPS[id].render();
});

// Turn the vector icons into small bitmaps, so they scale up blocky like old desktop icons.
async function pixelateIcons() {
  await Promise.all(Object.entries(ICONS).map(([key, svgStr]) => new Promise((done) => {
    const size = /viewBox="0 0 (\d+)/.exec(svgStr)?.[1] || 32;
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = c.height = Number(size);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      ICONS[key] = `<img class="px" alt="" src="${c.toDataURL()}">`;
      done();
    };
    img.onerror = done;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  })));
}

// Taskbar: fixed quick-launch buttons (no per-window buttons)
const TASKS = [['shop', 'Shop', 'bag'], ['perks', 'Perks', 'star'], ['achievements', 'Achievements', 'trophy'], ['rebirth', 'Rebirth', 'rebirth']];
function renderTaskbar() {
  setHTML($('tasks'), TASKS.map(([id, label, icon]) => {
    const off = (id === 'shop' || id === 'perks') && !S.inRun;
    return `<div class="task ${off ? 'off' : ''}" data-task="${id}">${ICONS[icon]}<span>${label}</span></div>`;
  }).join(''));
}
$('tasks').addEventListener('click', (e) => {
  const t = e.target.closest('[data-task]');
  if (!t || t.classList.contains('off')) return;
  const id = t.dataset.task;
  if (id === 'perks') { S.panel = 'perks'; dirty(); return WM.focus('perks'); }
  if (WM.isOpen(id)) return WM.close(id); // click again to close
  if (id === 'shop') openShop(); else openApp(id);
});

function renderTray() {
  renderTaskbar();
  const loan = S.me?.loan;
  setHTML($('trayIcons'),
    (loan ? `<span title="Loan due day ${loan.dueDay}">${ICONS.shark}</span>` : '') +
    (S.lobby ? `<span class="trayc" title="Room chat (Enter)" data-act="chat">${ICONS.chat}${S.unread ? `<i>${Math.min(S.unread, 9)}</i>` : ''}</span>` +
      `<span title="Microphone ${P2P.micOn ? 'on' : 'off'} (click to switch)" data-act="mic">${P2P.micOn ? ICONS.mic : ICONS.micoff}</span>` : '') +
    `<span title="${Object.keys(Profile.data.achievements).length} achievements" data-act="open" data-arg="achievements">${ICONS.trophy}</span>` +
    `<span title="${S.connected ? 'Connected' : 'Offline'}" style="opacity:${S.connected ? 1 : 0.45}">${ICONS.network}</span>`);
}
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }, 1000);

// ---------- keys ----------
addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !['oBuyPct', 'oSellPct'].includes(document.activeElement.id);
  if (e.key === 'F1') { e.preventDefault(); openApp('help'); }
  if (e.key === 'Enter' && S.lobby && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement?.tagName)) { e.preventDefault(); openChat(); return; }
  if (!S.inRun || typing) return;
  if (e.key === 'F5') { e.preventDefault(); A.buy(); }
  if (e.key === 'F6') { e.preventDefault(); A.sell(); }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && !['oBuyPct', 'oSellPct'].includes(document.activeElement?.id)) {
    e.preventDefault();
    stepStock(e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1);
  }
});

// ---------- boot / logon ----------
function showWelcome() {
  $('welcome').classList.remove('hidden');
  const P = Profile.data;
  $('wPic').innerHTML = ICONS.user;
  $('wOffIcon').innerHTML = ICONS.power;
  $('wName').value = P.name || desk?.steamName || '';
  $('wWho').firstChild.textContent = P.name || 'New Trader';
  $('wInfo').textContent = `${META.title(P.rebirths)} | ${P.certificates} certificates | ${Object.keys(P.achievements).length} achievements`;
  $('wOff').style.visibility = desk ? 'visible' : 'hidden';
  setTimeout(() => $('wName').focus(), 50);
}
function logon() {
  const name = $('wName').value.trim();
  if (!name) { SFX.error(); $('wName').focus(); return; }
  Profile.data.name = name;
  Profile.changed();
  $('welcome').classList.add('hidden');
  SFX.start();
  openApp('newgame');
}
$('wGo').onclick = logon;
$('wName').onkeydown = (e) => { if (e.key === 'Enter') logon(); };
$('wOff').onclick = () => desk?.quit();

(async function init() {
  applyRes();
  await pixelateIcons();
  try { await document.fonts.load('13px Pixel'); await document.fonts.load('bold 13px Pixel'); } catch {}
  $('startIcon').innerHTML = ICONS.start;
  renderIcons();
  renderTray();
  applySettings();
  requestAnimationFrame(loop);
  const skip = () => { $('boot').classList.add('hidden'); if (!$('welcome').dataset.shown) { $('welcome').dataset.shown = 1; showWelcome(); } };
  setTimeout(skip, 2600);
  $('boot').onclick = skip;
})();
