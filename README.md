# Stock Rogue

Roguelike stock trading game with online multiplayer. Node.js server, plain browser client.

## Run
```
npm install
npm start            # http://localhost:8080
```
Open the page, create a room, share the room code (or the URL). Friends on your network use your LAN IP; for internet play, host it on a VPS or Fly.io / Railway, or tunnel with `cloudflared tunnel --url http://localhost:8080`.

Fast testing: `DEV=1 npm start` lets the create message override config (tick speed, quotas, etc.).
On Windows PowerShell: `$env:DEV=1; npm start`

Desktop app (Steam build): `npm run desktop`. Full Steam guide: STEAM.md

## Web and Android
`npm run build:web` builds the static web version into `www/`. It runs solo games inside the page (no server needed, works offline) and connects to the online server from `desktop/config.json` for multiplayer. Host `www/` anywhere static; the Web GitHub Action publishes it to GitHub Pages (Settings > Pages > Source: GitHub Actions). The Node server (`npm start`) also still serves the game at its own address.

Android (Capacitor, project in `android/`):
- APK without installing anything: push to GitHub, open Actions > Android > the latest run > Artifacts > Stock-Rogue-Android. Unzip and open `app-debug.apk` on the phone (allow installing from unknown sources).
- With Android Studio: `npm run build:android`, then `npx cap open android` and press Run.
- Phones use a landscape layout: chart and order ticket on the left, tabbed Market/Portfolio/Perks/Leaders/News panel on the right. Add `?phone` to the URL to preview it on a computer.
- For the Play Store, build a signed bundle in Android Studio (Build > Generate Signed App Bundle). App id: `com.lemonlemon.stockrogue` in `capacitor.config.json`.

Controls: arrow buttons on the chart (or arrow keys) switch stocks, F5 buy, F6 sell, F7 buy max, F8 sell all, F1 help. The Command Prompt window takes typed orders (`buy nova 25`, `cashout`).

## Systems
- **Endless runs**: no quotas. Cash Out whenever you want to bank your score; in Versus the last trader standing wins.
- **Procedural market**: every run generates new companies, tickers, sectors and prices (`server/stockgen.js`). Prices follow slow-moving trends.
- **Loans**: hit $0 and you must borrow to keep trading. You can also borrow any time from the Bank. An unpaid loan at its due date ends your run; the report logs how many days you lasted on borrowed money.
- **Shop any time**: Perks (whole run), Items (one-use), Bank. Restocks every day. The market never closes; days roll over continuously.
- **Item Shop**: permanent upgrades bought with certificates earned after each run.
- **Rebirth**: after surviving 12 days in one run, reset upgrades for Golden Shares (+5% certificates, +2% starting cash each), a new title, a higher Seed Money cap, and 5% pricier loans per rebirth.
- **Achievements**: 37, tracked in-game and synced to Steam. List: `node tools/steam-achievements.js`.
- **Fair play rooms** ignore everyone's upgrades.
- **Cycle stock**: one stock per run rises for 3 seconds, plummets, then climbs back over 2 seconds (`this.cycle` in `server/market.js`).
- **Room chat**: peer-to-peer text and voice (WebRTC, `public/p2p.js`). The server only relays connection offers. Text falls back to the server relay if a direct link fails; voice needs the direct link. For players behind strict networks, add a TURN server to `iceServers` in `desktop/config.json`.
- **Save codes**: Start menu > Save Code exports the permanent save as hex (compressed, CRC32-checked) and loads one back.

## Layout
```
server/
  index.js    HTTP + WebSocket, rooms, reconnect tokens
  game.js     run state machine: lobby -> trading -> shop -> ... -> over; trades, loans, perks, cash out
  stockgen.js procedural companies for each run
  market.js   shared price sim (random walk + events + player price impact)
  content.js  perks, items, events  <- add content here
  rng.js      seeded RNG (same seed = same run)
  rooms.js    rooms and connections, shared by the Node server and the in-browser host
  local.js    in-browser host for solo play (web and Android)
desktop/      Electron shell, Steam hooks, config.json (App ID, online server URL)
android/      Android app project (Capacitor)
tools/build-web.js  builds www/ for web and Android
steam/        SteamPipe upload configs and scripts
.github/      GitHub Action that builds Windows + Mac
shared/
  meta.js     Item Shop upgrades, loans, rebirth, certificates, achievements (used by server and client)
public/
  index.html  desktop shell (boot, log-on screen, taskbar, wallpaper)
  xp.css      boxy TradeOS theme (square everything, blue title bars, CRT overlay)
  wm.js       window manager (fixed windows, focus, close, message boxes)
  icons.js    original icon set
  profile.js  permanent save, Item Shop, rebirth, achievement checks
  client.js   all windows, chart, networking, sounds, balloons, chat window, save code window
  p2p.js      peer-to-peer text and voice chat
tools/
  steam-achievements.js  prints the achievement list for Steamworks
IDEAS.md      design ideas and roadmap
```

## Adding content
Item: add to `ITEMS` in `content.js` with `use(p, game, ticker)`.
Upgrade: add to `UPGRADES` in `shared/meta.js`, then apply it in `Game.addPlayer`/wherever it matters.
Achievement: add to `ACHIEVEMENTS` in `shared/meta.js` with a `check(ctx)` function, and create it in Steamworks.

Perk: add an object to `PERKS` in `content.js`. Available hooks:
`feeMult`, `buyingPowerMult`, `loanDays`, `freeRerolls`, `gainMult(ctx)`, `onDayStart(p, game)`, `onDayEnd(p, game)`, `onTick(p, game)`, `active { name, cooldownDays, needsTicker, use(p, game, ticker) }`, `saveOnce`.

Event: add to `EVENTS` with `roll(rng, market)`, `text(args)`, `apply(market, args)`.

Stocks: edit name parts and sector ranges in `server/stockgen.js`.

## Messages (client -> server)
`create {name, mode, seed}`, `join {code, name, token}`, `start`, `buy {ticker, qty}`, `sell {ticker, qty}`, `active {perk, ticker}`, `shop_buy {perk}`, `item_buy {item}`, `item_use {item, ticker}`, `reroll`, `loan_take`, `loan_repay`, `cash_out`, `rtc {to, d}` (chat signaling, relayed to one player)

Server -> client: `joined`, `lobby`, `day`, `newday`, `tick`, `you`, `bankrupt`, `log`, `note`, `results`, `over`, `error`, `rtc {from, d}`
