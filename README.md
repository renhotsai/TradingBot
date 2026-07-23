# TradingBot

A multi-strategy trading bot for [Alpaca Markets](https://alpaca.markets) with a
read-only monitoring dashboard, built as a single Next.js (TypeScript) project
designed to run **entirely on free tiers**: Vercel Hobby for the app,
[Neon](https://neon.tech) for Postgres, and a free external scheduler
([cron-job.org](https://cron-job.org)) to drive the bot.

> ⚠️ **This bot places real orders on whatever Alpaca account you point it at.**
> The default configuration targets Alpaca's **paper trading** API. Test
> thoroughly on paper before even thinking about live keys. Nothing here is
> financial advice.

## How it works

Vercel is serverless, so there is no long-running loop. Instead the whole bot
cycle lives in one API route:

```
cron-job.org ──every minute──▶ GET /api/cron/tick  (Authorization: Bearer CRON_SECRET)
                                   │
                                   ├─ read state from Neon Postgres
                                   ├─ finish any order a previous tick submitted but didn't
                                   │    see through to a filled/rejected outcome
                                   ├─ adopt any Alpaca position the DB has no record of
                                   ├─ check hard stops / trailing stops on open positions
                                   ├─ for each instrument with a newly closed bar:
                                   │    fetch candles from Alpaca → compute signal →
                                   │    apply risk rules → submit market orders
                                   └─ write positions, trades, equity, daily P&L back to Neon

Dashboard (/)  ──reads──▶ Neon  (never sends orders)
```

Each invocation is stateless and idempotent per bar: an instrument only acts
when a *new* bar of its timeframe has completed, and a DB lock prevents
overlapping ticks from double-ordering.

## Instruments & strategies

| Instrument | Strategy | Timeframe | Rules |
|---|---|---|---|
| SPY | Mean reversion | 15 min | 20-period SMA ± std-dev; enter beyond ±1.5σ, exit at the SMA |
| QQQ | Mean reversion | 15 min | Same, with a ±1.8σ threshold |
| BTC/USD | Momentum breakout | 1 hour | 20-period high/low breakout with ≥1.5× avg volume; 2×ATR trailing stop |
| GLD | Trend following | 4 hour | 50/200 EMA cross; 3×ATR trailing stop |
| USO | Trend following | 4 hour | 50/200 EMA cross; 3×ATR trailing stop |

**Risk management (all strategies)**

- **ATR-based sizing** — position size = (equity × 1%) / ATR(14), so a 1-ATR
  adverse move costs exactly 1% of equity; quiet instruments get bigger
  positions, volatile ones smaller.
- **Hard stop** — every trade has a stop 1 ATR from entry (= 1% of equity).
  Checked on every tick.
- **Trailing stops** — 2×ATR for the BTC breakout, 3×ATR for trend following,
  ratcheting from the best price seen (never widening).
- **Correlation filter** — if SPY *and* QQQ are both long, new BTC/USD longs
  are blocked (no doubling up on risk-on exposure).
- **Market hours** — equities only trade while the market is open (Alpaca
  clock); BTC/USD trades 24/7. Alpaca spot crypto cannot be shorted, so BTC
  "short" signals flatten the long instead.
- **Small-account guard** — equity instruments (SPY/QQQ/GLD/USO) only *open
  new* positions when account equity is ≥ `RISK.equityTradingMinEquity`
  (default **$25,000**, the US Pattern Day Trader threshold); below it the
  bot trades crypto only. Sub-$25k margin accounts are capped at 3
  day-trades per 5 days, which the mean-reversion churn would trip almost
  immediately; crypto is exempt from PDT and its larger ATR keeps the
  1%-risk sizing from over-leveraging. Existing equity positions are always
  still stop-managed and closed regardless — the gate only blocks new
  entries.
- **Resilience** — Alpaca calls retry with exponential backoff (2s/4s/8s); a
  failing instrument or a failed tick never crashes the endpoint — errors are
  recorded and the next minute's tick retries.

## Order execution & reconciliation

The bot's database and Alpaca's account are two independently-updated
systems, so the engine never just assumes they agree:

- **Pending-order log** — before submitting any order, the engine writes a
  `pending_orders` row with everything needed to finalize it (symbol, side,
  qty, strategy, and Alpaca's `client_order_id`). The `positions` /
  `trades` tables are only written once the fill is *confirmed* by the
  broker — immediately if it fills within the short poll window,
  otherwise on a later tick once reconciliation confirms it. This closes
  the gap where a tick could die between "order submitted" and "position
  recorded," which used to leave a real Alpaca position untracked or a DB
  position Alpaca no longer had.
- **Broker checks around every order** — before opening, the engine
  confirms the symbol is actually flat at Alpaca; before closing, it closes
  whatever Alpaca actually holds (not the DB's recorded quantity — crypto
  fills can differ fractionally from the requested size); after a fill,
  it re-reads the position back from Alpaca and flags a `RECONCILE
  mismatch` if it doesn't match what was just written.
- **Untracked-position sweep** — every tick, the engine lists everything
  Alpaca actually holds and adopts anything the DB has no record of
  (a manual trade, or a position predating this logic): it computes a real
  ATR-based hard/trailing stop from fresh candles and the broker's own
  average entry price, so it comes under the same protection as a
  bot-opened position starting that same tick rather than sitting exposed
  indefinitely. Logged as a `RECONCILE mismatch` either way, visible in
  `lastError` / the dashboard.

Symbol note: Alpaca's positions endpoints identify crypto without the
slash (`BTCUSD`) while orders/bars use it (`BTC/USD`, matching
`src/config.ts`) — the broker layer normalizes this internally so the rest
of the engine only ever deals in the canonical (slash) form.

## Setup

### 1. Alpaca keys

Create an account at [alpaca.markets](https://app.alpaca.markets), generate
**paper trading** API keys.

### 2. Database (Neon)

Create a free Postgres at [neon.tech](https://neon.tech) (or Vercel →
Storage → Neon) and copy the connection string. Then create the tables:

```bash
cp .env.example .env.local   # fill in your values
npm install
npm run db:push              # creates tables from src/db/schema.ts
```

### 3. Run locally

```bash
npm run dev                  # dashboard at http://localhost:3000
# trigger one bot cycle manually:
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/tick
```

Without a `DATABASE_URL` the dashboard shows built-in **sample data** so you
can preview it before wiring anything up.

### 4. Deploy to Vercel

1. Push this repo to GitHub and import it in [vercel.com](https://vercel.com)
   (framework auto-detected: Next.js).
2. In the project's **Settings → Environment Variables**, add:
   `APCA_API_KEY_ID`, `APCA_API_SECRET_KEY`, `APCA_API_BASE_URL`,
   `DATABASE_URL`, `CRON_SECRET` (generate with `openssl rand -hex 32`).
3. Deploy.

### 5. Schedule the bot (free)

Create a job at [cron-job.org](https://cron-job.org) (free, supports
per-minute schedules):

- **URL**: `https://<your-app>.vercel.app/api/cron/tick`
- **Schedule**: every 1 minute
- **Headers**: `Authorization: Bearer <your CRON_SECRET>`

The bot only *acts* when a 15-minute / 1-hour / 4-hour bar closes; the
per-minute cadence is for timely stop-loss checks. (Vercel's built-in Cron
works too, but per-minute schedules require the Pro plan — the external
scheduler keeps everything free.)

## Dashboard

Read-only monitor at `/`, refreshing every 15s: bot online/offline (heartbeat),
account equity, equity curve, daily P&L, open positions with stops and
unrealized P&L, trade history, and per-strategy stats.

CSV exports (the classic `trades.csv` / `daily_pnl.csv` logs, generated from
the database):

- `/api/export/trades.csv` — timestamp, instrument, direction, entry/exit
  price, P&L, position size, strategy, exit reason
- `/api/export/daily_pnl.csv` — date, start/end equity, daily P&L

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest: strategy math, risk rules, engine behavior
npm run build       # production build (what Vercel runs)
```

Project layout:

```
src/config.ts                 instruments, timeframes, strategy + risk parameters
src/bot/strategies/           meanReversion.ts, momentumBreakout.ts, trendFollowing.ts
src/bot/riskManager.ts        ATR, sizing, hard/trailing stops, correlation filter
src/bot/broker.ts             Alpaca REST client (bars, orders, positions, account, clock) + retries
src/bot/engine.ts             one full tick cycle: pending-order reconciliation, untracked-
                               position adoption, stops, signals (pure orchestration, unit-tested)
src/bot/store.ts              storage interface used by the engine
src/db/                       Drizzle schema (positions, trades, pending_orders, …) + Neon store
src/app/api/cron/tick/        the scheduled bot endpoint (auth + lock + engine)
src/app/api/admin/migrate/    one-time/idempotent hosted schema setup (CREATE TABLE IF NOT EXISTS)
src/app/api/…                 dashboard JSON endpoints + CSV exports
src/components/               dashboard UI (Recharts)
tests/                        vitest suites with synthetic candles + fake broker
```

## Known limitations

- Free-tier market data (IEX feed) has slightly different volumes than the
  consolidated tape; set `ALPACA_DATA_FEED=sip` if you have a data
  subscription.
- 4-hour "bars closed" checks run at most once a minute, so signals can lag a
  bar close by up to a minute. Irrelevant at these timeframes.
- A manually-placed trade (or one from outside the configured instrument
  list) is adopted with a *synthetic* entry time (the tick it was first
  noticed, not when it actually happened) — the price and stop are still
  computed from Alpaca's real average entry price, just not the original
  timestamp.
