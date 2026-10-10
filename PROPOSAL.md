# Trading Journal — Architecture Proposal (for approval)

Decisions so far: sync = pull via investor login when I sign in · hosting = Vercel (or Netlify) · folder = `Journaling Software\trading-journal`.

## 1. MT4 auto-sync design

A Vercel/Netlify function cannot speak the MT4 protocol directly, so the pull goes through **MetaApi** (cloud MT4/MT5 gateway). It supports **read-only investor-password** accounts, which fits your plan.

Flow:
1. **Accounts → Connect MT4**: you enter MT login, investor password, and broker server. The server forwards them once to MetaApi to provision the account, then keeps only the `metaapiAccountId`. **The investor password is never stored in our database or logs.**
2. **On every sign-in** (and a manual "Sync now" button, plus an optional daily Vercel Cron), the app calls `POST /api/sync`. It pulls deals from `syncCursor` to now, normalises them, builds positions, upserts, and advances the cursor. It is **chunked and resumable** (e.g. 7-day windows per call) so the 7,000-trade backfill never hits serverless time limits; the UI shows a progress bar and the dashboard renders immediately with existing data.
3. Idempotent: trades are upserted on `(accountId, brokerTicket)`, so re-pulls never duplicate.

Pipeline: `ImportAdapter(MetaApi | MT4 HTML | MT4 CSV | generic CSV) → RawDeal[] → normalise (symbol aliases, broker tz → UTC) → PositionBuilder (partial closes → Execution rows) → upsert Trade → refresh DailySummary for touched days → ImportBatch log`.

Things you should know:
- **MetaApi is a paid third-party service** (small free tier, then monthly per-account pricing; check current pricing). Your broker login details will live with MetaApi. The investor password is read-only (cannot trade), which limits the risk, but it does expose your account history to them.
- Investor-password access depends on your broker allowing it (most do).
- Fallback if you'd rather not use a third party: HTML/CSV statement upload (still built in phase 2).

## 2. Hosting on Vercel
- Next.js on Vercel; **Postgres hosted** (Neon or Supabase — Vercel has no database for Docker). `docker-compose.yml` is for local dev only.
- Screenshots: **Vercel Blob / S3-compatible** (no local disk on serverless).
- Secrets (`DATABASE_URL`, `NEXTAUTH_SECRET`, `METAAPI_TOKEN`) in Vercel env vars.
- Use Prisma with a pooled connection string (Neon pooler) for serverless.

## 3. Schema
See `schema.prisma`. Notable choices:
- Single user: no `userId` on data tables (`User` only for auth).
- `Trade` unique on `(accountId, brokerTicket)`; `Execution` unique on `(tradeId, brokerTicket)`.
- `DailySummary` materialised table + indexes → dashboard < 1 s at 10k+ trades.
- `Trade.openDay/closeDay` precomputed in display timezone.
- Notes: TipTap JSON + `plainText`; `tsvector` GIN index via raw SQL migration.
- Money = `Decimal`; `SymbolConfig` holds pip size and aliases (`GOLD`, `XAUUSD.a` → `XAUUSD`).
- `BalanceEvent` captures deposits/withdrawals for correct balance/drawdown curves.
- Account holds `metaapiAccountId`, `syncCursor`, `lastSyncAt`, `lastSyncError` (drives the sync-status badge).

## 4. Folder structure

```
trading-journal/
├─ docker-compose.yml            # local Postgres only
├─ README.md   vercel.json (optional cron)
├─ prisma/ { schema.prisma, migrations/, seed.ts }
├─ src/
│  ├─ app/
│  │  ├─ (auth)/login/
│  │  ├─ (app)/                  # sidebar layout + filter bar
│  │  │  ├─ dashboard/ trades/ notebook/ reports/[tab]/
│  │  │  ├─ playbooks/[id]/ replay/ progress/ accounts/ settings/
│  │  ├─ share/[token]/          # read-only public trade
│  │  └─ api/ { auth/, sync/, import/, export/, uploads/, cron/ }
│  ├─ components/ { ui/, layout/, kpi/, charts/, trades/, notes/, filters/ }
│  ├─ lib/
│  │  ├─ metrics/                # pure, unit-tested
│  │  ├─ import/ { adapter.ts, metaapi.ts, mt4-html.ts, mt4-csv.ts, generic-csv.ts, position-builder.ts }
│  │  ├─ market-data/ { provider.ts, dukascopy.ts, candle-cache.ts }
│  │  ├─ filters/  queries/  discipline/  storage/  currency.ts  time.ts
│  └─ styles/tokens.css          # design tokens from your spec
├─ tests/ { metrics/, import/, fixtures/ }
└─ tailwind.config.ts, vitest.config.ts
```

## 5. Defaults I'll use unless you object
- Next.js 15 App Router, server actions + Zod, NextAuth credentials (argon2), Vercel Blob for files.
- Candles from Dukascopy (cached in `Candle`); prices differ slightly from your broker's. MetaApi can also supply broker candles later via `MarketDataProvider`.
- **Phase 1** = scaffold, design tokens + base components, schema, auth, seed (500 XAUUSD trades), metrics + tests. Then I stop for your review.
