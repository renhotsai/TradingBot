import type { DashboardData } from "./types";

/**
 * Deterministic sample dataset served when DATABASE_URL isn't configured, so
 * the dashboard can be previewed before any infrastructure exists.
 */

// Small seeded PRNG (mulberry32) — keeps the sample data stable across renders.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildSampleData(): DashboardData {
  const rand = mulberry32(42);
  const now = new Date("2026-07-21T15:30:00Z");
  const days = 30;
  const startEquity = 100_000;

  const dailyPnl: DashboardData["dailyPnl"] = [];
  const equityHistory: DashboardData["equityHistory"] = [];
  let equity = startEquity;
  for (let d = days; d >= 1; d--) {
    const dayStart = equity;
    const drift = (rand() - 0.45) * 900;
    const date = new Date(now.getTime() - d * 86_400_000);
    const dow = date.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    for (let h = 0; h < 7; h++) {
      equity += drift / 7 + (rand() - 0.5) * 250;
      equityHistory.push({
        time: new Date(date.getTime() + (13 + h) * 3_600_000).toISOString(),
        equity: Math.round(equity * 100) / 100,
      });
    }
    dailyPnl.push({
      date: date.toISOString().slice(0, 10),
      startEquity: Math.round(dayStart * 100) / 100,
      endEquity: Math.round(equity * 100) / 100,
      pnl: Math.round((equity - dayStart) * 100) / 100,
    });
  }

  const symbols = [
    { symbol: "SPY", strategy: "mean_reversion", price: 632 },
    { symbol: "QQQ", strategy: "mean_reversion", price: 561 },
    { symbol: "BTC/USD", strategy: "momentum_breakout", price: 117_400 },
    { symbol: "GLD", strategy: "trend_following", price: 310 },
    { symbol: "USO", strategy: "trend_following", price: 76 },
  ] as const;

  const trades: DashboardData["trades"] = [];
  const reasons = ["signal", "signal", "signal", "trail_stop", "hard_stop"] as const;
  for (let i = 0; i < 26; i++) {
    const s = symbols[Math.floor(rand() * symbols.length)];
    // Alpaca spot crypto is long-only, so sample BTC trades are always long.
    const direction =
      s.symbol === "BTC/USD" || rand() > 0.35 ? "long" : "short";
    const entryPrice = s.price * (0.95 + rand() * 0.1);
    const move = entryPrice * (rand() * 0.02 - 0.007);
    const exitPrice = direction === "long" ? entryPrice + move : entryPrice - move;
    const qty =
      s.symbol === "BTC/USD"
        ? Math.round((1000 / entryPrice) * 1e4) / 1e4
        : Math.max(1, Math.round(1000 / (entryPrice * 0.01)));
    const closedAt = new Date(now.getTime() - rand() * days * 86_400_000);
    trades.push({
      closedAt: closedAt.toISOString(),
      entryTime: new Date(closedAt.getTime() - (4 + rand() * 40) * 3_600_000).toISOString(),
      symbol: s.symbol,
      strategy: s.strategy,
      direction,
      qty,
      entryPrice: Math.round(entryPrice * 100) / 100,
      exitPrice: Math.round(exitPrice * 100) / 100,
      pnl: Math.round((exitPrice - entryPrice) * qty * (direction === "long" ? 1 : -1) * 100) / 100,
      exitReason: reasons[Math.floor(rand() * reasons.length)],
    });
  }
  trades.sort((a, b) => b.closedAt.localeCompare(a.closedAt));

  const positions: DashboardData["positions"] = [
    {
      symbol: "SPY",
      strategy: "mean_reversion",
      direction: "long",
      qty: 210,
      entryPrice: 629.4,
      entryTime: new Date(now.getTime() - 5 * 3_600_000).toISOString(),
      atrAtEntry: 4.7,
      hardStop: 624.7,
      watermark: 633.1,
      trailStop: null,
      trailAtrMult: null,
      lastPrice: 632.2,
    },
    {
      symbol: "BTC/USD",
      strategy: "momentum_breakout",
      direction: "long",
      qty: 0.0084,
      entryPrice: 115_900,
      entryTime: new Date(now.getTime() - 26 * 3_600_000).toISOString(),
      atrAtEntry: 1190,
      hardStop: 114_710,
      watermark: 118_050,
      trailStop: 115_670,
      trailAtrMult: 2,
      lastPrice: 117_400,
    },
    {
      symbol: "GLD",
      strategy: "trend_following",
      direction: "long",
      qty: 340,
      entryPrice: 302.1,
      entryTime: new Date(now.getTime() - 9 * 86_400_000).toISOString(),
      atrAtEntry: 2.9,
      hardStop: 299.2,
      watermark: 311.6,
      trailStop: 302.9,
      trailAtrMult: 3,
      lastPrice: 310.4,
    },
  ];

  return {
    sample: true,
    status: {
      botOnline: true,
      lastHeartbeat: new Date(now.getTime() - 40_000).toISOString(),
      lastError: null,
      equity: Math.round(equity * 100) / 100,
    },
    positions,
    trades,
    dailyPnl: dailyPnl.reverse(),
    equityHistory,
  };
}
