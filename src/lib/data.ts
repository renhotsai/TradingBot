import { desc } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/db";
import { buildSampleData } from "./sampleData";
import type { DashboardData } from "./types";

/** Heartbeats older than this mean the scheduler has stopped calling the tick. */
const OFFLINE_AFTER_MS = 3 * 60_000;

export async function getDashboardData(): Promise<DashboardData> {
  if (!hasDatabase()) return buildSampleData();

  const db = getDb();
  const [stateRows, positionRows, tradeRows, dailyRows, equityRows] =
    await Promise.all([
      db.select().from(schema.botState).limit(1),
      db.select().from(schema.positions),
      db
        .select()
        .from(schema.trades)
        .orderBy(desc(schema.trades.closedAt))
        .limit(200),
      db
        .select()
        .from(schema.dailyPnl)
        .orderBy(desc(schema.dailyPnl.date))
        .limit(90),
      db
        .select()
        .from(schema.equitySnapshots)
        .orderBy(desc(schema.equitySnapshots.time))
        .limit(1000),
    ]);

  const state = stateRows[0];
  const lastHeartbeat = state?.lastHeartbeat?.toISOString() ?? null;
  const equityHistory = equityRows
    .map((r) => ({ time: r.time.toISOString(), equity: r.equity }))
    .reverse();

  return {
    sample: false,
    status: {
      botOnline: lastHeartbeat
        ? Date.now() - new Date(lastHeartbeat).getTime() < OFFLINE_AFTER_MS
        : false,
      lastHeartbeat,
      lastError: state?.lastError ?? null,
      equity: equityHistory.length
        ? equityHistory[equityHistory.length - 1].equity
        : null,
    },
    positions: positionRows.map((r) => ({
      symbol: r.symbol,
      strategy: r.strategy,
      direction: r.direction as "long" | "short",
      qty: r.qty,
      entryPrice: r.entryPrice,
      entryTime: r.entryTime.toISOString(),
      atrAtEntry: r.atrAtEntry,
      hardStop: r.hardStop,
      watermark: r.watermark,
      trailStop: r.trailStop,
      trailAtrMult: r.trailAtrMult,
      lastPrice: r.lastPrice,
    })),
    trades: tradeRows.map((r) => ({
      closedAt: r.closedAt.toISOString(),
      entryTime: r.entryTime.toISOString(),
      symbol: r.symbol,
      strategy: r.strategy,
      direction: r.direction as "long" | "short",
      qty: r.qty,
      entryPrice: r.entryPrice,
      exitPrice: r.exitPrice,
      pnl: r.pnl,
      exitReason: r.exitReason,
    })),
    dailyPnl: dailyRows.map((r) => ({
      date: r.date,
      startEquity: r.startEquity,
      endEquity: r.endEquity,
      pnl: r.pnl,
    })),
    equityHistory,
  };
}
