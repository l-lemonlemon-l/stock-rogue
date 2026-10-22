# Stock Rogue - Design Ideas

## Core loop (what the framework already does)
1. Trading day: ~30s of live prices. Buy/sell on a shared market.
2. Every 3 days = one quota. Net worth (cash + stock value) must hit the target or you are out.
3. Between days: shop. Spend cash on perks. Cash spent on perks lowers net worth, so every purchase is a bet that it pays back before the next quota.
4. Survive 8 quotas to clear the run. Quotas grow 35% each time.

Online twist: everyone trades the same market and every order moves the price. Five players piling into one stock pumps it; one dumping crashes it for everyone else.

## Modes
- Versus (built): own quota each, last trader standing. Your trades hurt rivals.
- Co-op (built): team net worth vs team quota. Players can "carry" a weak teammate.
- Daily seed: everyone in the world plays the same seed solo, global leaderboard. Seeds are already deterministic for market, events and shops.
- Battle royale: 20+ players, bottom 25% cut at each quota instead of a fixed target.
- Async ghosts: race against a recording of a friend's run on the same seed.

## Perk ideas (next to add)
Economy
- Compound Interest: Savings rate grows +1% every quota.
- Day Trader: no fees for the first 10 ticks of each day.
- Hedge: losses on one stock are reduced 30% if you hold another stock in the same sector.
- Bagholder: holdings you have kept 3+ days gain 2% per day.
Information
- Ticker Tape: see other players' trades in the feed in real time.
- Analyst: shows a hidden "true value" line on the chart that prices drift toward.
- Chart Reader: shows a predicted price arrow for the next 5 ticks (sometimes wrong).
Player vs player
- Short Seller: unlock shorting (borrow and sell, buy back later).
- Front Runner: see the largest order placed by any player 2 ticks before it executes.
- Audit: once per quota, freeze a rival's trading for 5 ticks.
- Copycat: mirror a chosen player's next 3 trades automatically.
Risk
- Leverage 3x: triple buying power, but a margin call liquidates you if net worth drops 40%.
- All In: perks cost 50% less but you can only hold one stock at a time.
- Cursed perks: big upside with a drawback (e.g. +50% profits, quotas +20%).

## Consumables (one-use cards, like tarot in Balatro)
- Options contract: pay 50, get 10x the stock's move if it goes your direction by end of day.
- Press Release: trigger an Earnings Surprise on a stock you choose (direction random).
- Time Freeze: pause the market 10 seconds for yourself only to think.
- Insider Report: reveal tomorrow's opening event.

## Bosses (special quota days)
- The Regulator: fees x3 all day.
- The Whale: an AI trader dumps huge orders on random stocks.
- Bear Market: every stock drifts down; only shorters thrive.
- Blackout: prices are hidden for 10 ticks at a time.
- Bubble: one stock goes parabolic then crashes at a random tick.

## Meta progression
- Unlock new starting brokers (classes): Value Investor (more dividends), Degenerate (meme stocks, leverage), Quant (info perks), Lobbyist (cheaper quotas).
- Unlock new stocks/sectors (crypto, commodities, IPOs that appear mid-run).
- Ascension levels: higher quota growth, higher fees, fewer shop slots.

## Market depth ideas
- IPOs: new tickers appear mid-run and can be bought before they open.
- Bankruptcy: a stock that falls below 1 is delisted and holders lose it.
- Stock splits and dividends as events.
- Order book instead of instant fills: limit orders, slippage, players trade with each other.
- AI traders (bots) that react to events so the market feels alive in small lobbies.

## Online and anti-cheat notes
- Server is authoritative already; clients only send intents.
- Add rate limits per socket (e.g. 10 orders/second) before public hosting.
- Room config overrides are only accepted when the server runs with DEV=1.
- For public play: host on Fly.io / Railway / a VPS; WebSocket runs on the same port as the page.
- Persistence: store finished runs (seed, perks, final net worth) in SQLite for leaderboards.
