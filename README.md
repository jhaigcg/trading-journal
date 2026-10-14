# Ledger. — personal trading journal

Next.js (App Router) · TypeScript · Tailwind v4 · Prisma · PostgreSQL. Single user. Designed to deploy on **Vercel Hobby + Neon**.
Architecture and decisions: [PROPOSAL.md](PROPOSAL.md). Schema: [prisma/schema.prisma](prisma/schema.prisma).

## Local setup

```bash
npm install
cp .env.example .env        # then fill AUTH_SECRET (openssl rand -hex 32), SEED_EMAIL, SEED_PASSWORD
npm run db:up               # Postgres in Docker (local dev only)
npm run db:migrate          # create tables
npm run db:seed             # your login + settings, tags, strategies, ~500 demo XAUUSD trades
npm run dev                 # http://localhost:3000
npm test                    # Vitest (metrics, date ranges)
```

The seed creates a demo account named "MT4 · Main account (demo data)". Re-running the seed replaces only that account's trades.

## MT4 auto-sync (free): the LedgerSync Expert Advisor

MT4 has no public API, so a small read-only EA ([mt4/LedgerSync.mq4](mt4/LedgerSync.mq4)) running in your terminal pushes trades to `/api/ingest/mt4`.

1. **Accounts & import → Connect your MT4 account (free)**: enter the account number and pick your broker's server time (most brokers: "GMT+2 / GMT+3 with US daylight saving"). You get a token **once**; only its hash is stored.
2. Download `LedgerSync.mq4` from that screen (your address is pre-filled) into MT4's `MQL4\Experts` folder and restart MT4.
3. **Tools → Options → Expert Advisors**: allow WebRequest for your app's address.
4. In the Terminal window's **Account History** tab choose **All History**.
5. Drag the EA onto any chart, paste the token, and enable AutoTrading. The chart corner shows "connected".

The first run uploads your full history; afterwards new trades arrive within seconds. MT4 does not need to be open all the time: when it next starts, the EA re-sends anything it missed. Pushes are idempotent, partial closes (MT4 splits them into two tickets) are merged into one trade even if the halves arrive in different requests, and nothing you edit in the journal is overwritten.

**Broker time matters.** MT4 reports times in the broker's server clock. The accounts page shows a warning if the EA reports a clock that disagrees with your setting. Changing the setting re-converts every stored trade time (raw server times are kept for this).

The EA source was written without access to MetaEditor: if it fails to compile, the error line shown in MetaEditor is all that is needed to fix it.

## MT4 auto-sync (optional, paid): MetaApi

MT4 has no public API, so trades can also be pulled through [MetaApi](https://metaapi.cloud) using your broker's **investor (read-only) password**.

1. Create a MetaApi account and generate an API token. Put it in `.env` as `METAAPI_TOKEN` (and `METAAPI_REGION` if yours is not new-york). Check MetaApi's current pricing and free allowance.
2. In the app: **Accounts & import → Connect an MT4 account**. Enter the MT login, investor password, broker server name (exactly as in MT4, e.g. `ICMarketsSC-Live01`) and the date to import history from.
3. The first sync backfills history in 30-day chunks with a progress bar; after that it runs automatically each time you sign in, from **Resync**, and once a day via Vercel Cron (`/api/cron/sync`, set `CRON_SECRET`).

The investor password is sent to MetaApi once and is never stored in this app's database. Syncing is idempotent (trades are keyed on account + MT4 ticket) and never overwrites what you edit in the journal (strategy, rating, tags, reviewed flag, your own stop/target). MT4 partial closes are merged into a single trade with several exits.

Manual entry (**Accounts & import → Add trade manually**) supports multiple fills for scale-in/out.

## Deploy (Vercel + Neon)

1. **Database.** Create a free Neon project. Copy the **pooled** connection string (host contains `-pooler`) for `DATABASE_URL` and the **direct** one for `DIRECT_URL`.
2. **Create your login once**, from your computer, pointing at Neon (this adds no fake trades):
   ```bash
   DATABASE_URL="<direct string>" DIRECT_URL="<direct string>" npx prisma migrate deploy
   DATABASE_URL="<direct string>" DIRECT_URL="<direct string>" SEED_DEMO=0 SEED_EMAIL="you@example.com" SEED_PASSWORD="a long password" npx prisma db seed
   ```
3. **Vercel.** Import this GitHub repository (Framework: Next.js; the `vercel-build` script applies new database migrations on every deploy) and set these environment variables:
   - `DATABASE_URL`, `DIRECT_URL`: from Neon
   - `AUTH_SECRET`: 32+ random characters (`openssl rand -hex 32`)
   - `CRON_SECRET`: any random string (the daily safety-net sync uses it)
   - `BLOB_READ_WRITE_TOKEN`: create a Vercel Blob store (Storage tab) so screenshots persist
   - `METAAPI_TOKEN`, `METAAPI_REGION`: only if you use the paid MetaApi option
4. Open the Vercel URL, sign in, then connect your MT4 on **Accounts & import**. The EA needs your Vercel address added to MT4's WebRequest list (the page shows it).

## Project layout

- `src/lib/metrics` — pure, unit-tested metric definitions (win %, profit factor, expectancy, drawdown, R, performance score)
- `src/lib/filters` — URL filter state → date ranges / queries
- `src/components` — design-system pieces (card, KPI tile, pill, drawer, data table, sidebar, filter bar)
- `src/proxy.ts` — redirects unauthenticated requests to `/login` (Next 16 renamed middleware to proxy)
- `prisma/seed.ts` — deterministic demo data

## Status

Phases 1 (foundation), 2 (MT4 sync, accounts page, manual add-trade), 3 (dashboard, global and advanced filters, calendar) 4 (Trades views, preview drawer, trade details) 5 (Notebook, Playbooks) 6 (Reports, PDF and CSV export) and 7 (Progress tracker, Trade and Day replay) are complete. Every page in the sidebar is now built.

**Trades (phase 4).** `/trades` has Day, Week and All views (all server-side: sorting, paging 25/50/100, filters in the URL), bulk actions (strategy, tags, reviewed, delete), a column picker and a preview drawer. `/trades/[id]` has prev/next within the list you came from, editable stop/target/rating/strategy (risk and R recalculate on the server), the strategy rule checklist, tags by category, screenshots (paste, drop or choose), a TipTap note per trade plus the daily journal (autosaves), a candlestick chart framed around the trade, with the trade drawn as a shaded box from entry to exit (green for a win, red for a loss, with fainter stop and target zones and dashed lines at the entry and exit moments; it can be switched off), entry/exit markers and SL/TP lines, and the journal editor directly under the chart, and running P&L. Trades can be shared through an optional public read-only link (no notes, tags, screenshots, account or ticket are shown).

**Notebook (phase 5).** Sections for all notes, favorites, trade notes, daily journal, session recaps, your own notes and the trash; custom folders (deleting a folder keeps its notes); tags; search across titles and text (case-insensitive substring, so it works for Chinese as well as English); templates you can insert (trade review, daily journal, session recap, weekly review); and an "Insert day stats" button that drops a snapshot of that day's numbers into a journal entry. Notes autosave. Trashed notes are read-only until restored, and only trashed notes can be deleted permanently. "Start my day" opens today's journal with a pre-market checklist and records when you started it.

**Playbooks (phase 5).** A table of every playbook (missed trades, avg loser/winner, net P&L, profit factor, trades, expectancy, win rate) that follows the global filters, with highlight cards for best, least, most active and best win rate (a win rate needs 5+ trades). Each playbook has a cover, description and colour, a stats tab, editable rule groups and rules with how often you actually followed each one, its trades, a missed-trade log, and linked notes. Six starter playbooks in Smart Money Concepts terms can be copied from the New playbook dialog.


**Training.** `/training` is a practice area built from real market moments. You create a scenario from a date and time (Settings → your timezone applies), mark the expert answer on the real chart (an entry *zone*, a stop-loss level and a take-profit level), and optionally attach your own annotated screenshot and write why. Two kinds:
- *Mark the setup* (15m, 5m, 1m, 1h): the chart is cut at the decision point and the server never sends any later candle. You pick buy or sell and click the chart to place entry, stop and target, then reveal. The trade is replayed on the real minute candles that followed (a resting order fills when price first reaches the entry; if one candle reaches both stop and target the stop is assumed, so the result never flatters you), and you see your result in R, how far it went against and for you, and a score out of 100 for how closely you matched the expert: direction 30 (wrong direction scores zero), entry 25 (anywhere inside the zone is full marks), stop 20, target 15, risk to reward 10, with plain-words notes such as "tighter than the invalidation level: it can be swept". Your screenshot and notes appear after the attempt.
- *News event* (CPI, NFP): 5-second candles built from Dukascopy tick data, played forward live from the decision moment at real time up to ×50. You trade with a stop and a target set as distances, either at market or with a limit order placed at a price you choose (the usual pullback entry after the break). A limit rests until price touches it, can be cancelled and replaced while unfilled, and if it never fills you finish with no trade; a buy limit must be below the price now and a sell limit above.  the server re-plays the trade on the stored candles for the verdict. This version has no manual close: the trade runs to its stop, its target or the end of the window.
The list shows attempts, average match, average result in R, your training streak, and your average by playbook (weakest first). Tick files for an hour are downloaded once and kept. Screenshots on the live site need a Vercel Blob store (\`BLOB_READ_WRITE_TOKEN\`), as for trade screenshots.

**Chart tools.** On a trade's page the chart has a toolbar: select, trend line, horizontal line, box, note (type what happened at that spot, for example "entered before the sweep"), and a ruler that measures price, percent, bars and time between two points. Six colours. Drawings are saved with the trade automatically (a moment after the last change), stay in place on every timeframe, and can be selected and removed with the Delete key, the bin button or Clear all. Esc cancels. The Indicators menu has EMA 20, 50 and 200, VWAP (restarting each UTC day) and RSI 14 in its own pane; extra history is loaded so the averages have settled by the time the trade starts, and your choice is remembered in the browser. Drawings are not shown on shared links or in the quick-preview drawer. This is built on TradingView's open-source Lightweight Charts, not their full Advanced Charts product, which TradingView licenses on application.

**FVG and OB.** On the 5m and 15m charts (a trade's page and the Training setup chart) the FVG and OB boxes find fair value gaps and order blocks automatically. An FVG is a gap between the first candle's high and the third candle's low (or the reverse for a bearish gap); an OB is the last push the other way before a close that breaks the latest swing high or low (blue = demand, amber = supply). A box runs from where it formed until price trades through it (FVG) or closes through it (OB), and stays open to the right edge until then. Gaps and blocks that are tiny against the average candle range are skipped, and only the newest 40 of each are drawn. They look only at closed candles, so the Training chart never reveals anything from after the decision point. In Training they start switched off. The rules live in \`src/lib/smc.ts\`.

**Calendar drill-down.** Clicking a day with trades on the dashboard calendar opens a pop-up for that day: net and gross P&L, a running-P&L line through the day, win rate, winners and losers, profit factor, volume and fees, and a table of every trade (open time, side, net P&L, ROI, R, playbook) with a replay button on each row. It follows the active filters, so it always matches the cell you clicked. "View details" opens the Trades day view and "Journal" opens that day's daily journal. The pop-up has its own address (`?day=`), so it can be bookmarked, and Esc or Cancel closes it.

**Reports (phase 6).** `/reports` follows the global filters (account, date range, currency, advanced filters) and covers closed trades only. Tabs: Overview (17-number summary plus equity curve and daily P&L), Performance (two charts where you choose up to four metrics, at most two different units, grouped by day, week or month), Day & time (weekday, hour, session, weekday-by-hour heatmap), Symbols, Risk (R multiples, stop-loss coverage, P&L distribution), Playbooks, Tags (a trade with several tags counts under each), Wins vs losses, Compare (this period against the period of equal length just before it; needs a date range), Calendar (a whole year at a glance) and Recap (a factual written summary). Every tab has PDF and CSV buttons that export exactly what is on screen; the filters are written out in words under the title. In the PDF, text outside the standard Latin set (for example Chinese tag names) is shown as "?" and tables stop at 70 rows; the CSV keeps all text and all rows, and guards against spreadsheet formula injection.


**Progress (phase 7).** `/progress` tracks discipline rules. Five types: "Start my day" by a time (uses the moment you first pressed the button), a share of the day's trades that have a stop loss, playbook, profit target or review, a maximum loss per trade, a maximum net loss per day, and a manual daily tick. Automatic rules are evaluated live from your trades and journal for every trading day, so editing a trade changes the result straight away. Days a rule does not apply to (a stop-loss rule on a day without trades) are skipped, not counted as misses. The start-my-day and manual rules only count from the first day you used them, so history from before you began journaling is not marked as missed. Each rule shows current streak, best streak, follow rate, and your average daily result on days you followed it versus broke it. The page also shows today's progress (x of y), the perfect-day streak, the period score, and a 12-month heatmap where clicking a day shows how it went. Trading days (which weekdays count) are configurable on the same page. Money limits are in your account currency.

**Replay (phase 7).** `/replay` steps through a trade or a whole day one candle at a time: play and pause, 1× to 30× speed, step back and forward, jump to the previous or next entry or exit, a scrubber, and a timeframe switch. Entry, stop and target lines appear only while the trade is open, entry and exit arrows appear when they happen, and a running P&L (before fees) follows the price. Results stay hidden until the replay reaches the exit. Day replay uses the day's most traded symbol. Keyboard: Space plays or pauses, the arrow keys step. It uses the same Dukascopy prices as the trade chart, so it has the same limits: today's prices are not available until after 00:00 UTC, and a replay is not drawn with a running P&L if the feed's price differs clearly from your entry (different broker or symbol).


**Settings.** `/settings` holds: display timezone, home currency and breakeven threshold (changing the timezone or threshold recalculates every trade's trading day, intraday flag and win/loss/breakeven, and rebuilds the daily summaries, so the stored numbers never disagree with the setting); trading days; tag groups and tags (create, rename, delete; deleting shows how many trades are affected); manual currency rates; pip and contract size per symbol; a CSV export of every trade as a plain backup; and change password (current password required, 10+ characters). Journal entries keep the dates they were written under when the timezone changes.

**Polish.** Each page has its own browser-tab title, a loading skeleton, a friendly error page with a retry button (the sidebar keeps working), a 404 page, and a skip-to-content link for keyboard users. Every page was checked at phone width (375 px) for sideways scrolling.

**Price data.** Charts use Dukascopy's free historical feed (`src/lib/market-data`), downloaded politely one period at a time and cached in Postgres (`Candle`, `CandleCoverage`), so each day is fetched once. Things to know:

- Prices come from Dukascopy, not your broker, and can differ slightly. If the feed disagrees with a trade's entry price by more than about 0.3% the app says so and does not draw a running P&L.
- Dukascopy publishes a day of minute prices only **after the day ends (00:00 UTC)**, so a trade made today gets its chart tomorrow.
- Only symbols with a feed get charts (gold, silver and standard FX pairs). Cotton futures have none.
- If your network needs a proxy to reach overseas sites, set `HTTPS_PROXY` before starting the server.
- Screenshots are stored in `./.data/uploads` in development and in Vercel Blob in production (`BLOB_READ_WRITE_TOKEN`).

**Filters** live in the URL (`?account=&range=&from=&to=&ccy=&side=&tags=&dow=&hour=&session=&strategy=&flags=…`), are whitelisted in `src/lib/filters/params.ts` and turned into parameterised SQL in `src/lib/filters/where.ts`. Dashboard and Trades numbers are aggregated in Postgres; at 10,000 trades the dashboard answers in about 12 ms locally. **Display currency** only offers currencies with a known manual rate (table `FxRate`); no rate is ever assumed.
