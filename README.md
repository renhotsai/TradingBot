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
- **Resilience** — Alpaca calls retry with exponential backoff (2s/4s/8s); a
  failing instrument or a failed tick never crashes the endpoint — errors are
  recorded and the next minute's tick retries.

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
src/bot/broker.ts             Alpaca REST client (bars, orders, account, clock) + retries
src/bot/engine.ts             one full tick cycle (pure orchestration, unit-tested)
src/bot/store.ts              storage interface used by the engine
src/db/                       Drizzle schema + Neon store implementation
src/app/api/cron/tick/        the scheduled bot endpoint (auth + lock + engine)
src/app/api/…                 dashboard JSON endpoints + CSV exports
src/components/               dashboard UI (Recharts)
tests/                        vitest suites with synthetic candles + fake broker
```

## Known limitations

- Entry price is the order's fill price when it fills within ~2s, otherwise the
  latest bar close — fine for liquid ETFs/BTC, but slippage isn't modeled.
- Positions live in the bot's database; if you close a position manually in
  Alpaca the bot won't know until its close order fails. Don't co-trade the
  account.
- Free-tier market data (IEX feed) has slightly different volumes than the
  consolidated tape; set `ALPACA_DATA_FEED=sip` if you have a data
  subscription.
- 4-hour "bars closed" checks run at most once a minute, so signals can lag a
  bar close by up to a minute. Irrelevant at these timeframes.
