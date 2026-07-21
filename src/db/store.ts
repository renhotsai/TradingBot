import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "./index";
import type {
  BotState,
  Position,
  Store,
  TradeRecord,
} from "@/bot/store";
import type { StrategyName } from "@/config";
import type { Direction } from "@/bot/strategies/types";

const STATE_ID = 1;

/** Postgres-backed store used in production (Neon over HTTP). */
export class DbStore implements Store {
  private get db() {
    return getDb();
  }

  private async ensureStateRow(): Promise<void> {
    await this.db
      .insert(schema.botState)
      .values({ id: STATE_ID, lastBars: {} })
      .onConflictDoNothing();
  }

  async getBotState(): Promise<BotState> {
    await this.ensureStateRow();
    const [row] = await this.db
      .select()
      .from(schema.botState)
      .where(eq(schema.botState.id, STATE_ID));
    return {
      lastBars: row.lastBars ?? {},
      lastHeartbeat: row.lastHeartbeat?.toISOString() ?? null,
      lastError: row.lastError,
    };
  }

  async saveBotState(state: BotState): Promise<void> {
    await this.db
      .update(schema.botState)
      .set({
        lastBars: state.lastBars,
        lastHeartbeat: state.lastHeartbeat ? new Date(state.lastHeartbeat) : null,
        lastError: state.lastError,
      })
      .where(eq(schema.botState.id, STATE_ID));
  }

  async acquireLock(now: Date, ttlSeconds: number): Promise<boolean> {
    await this.ensureStateRow();
    const until = new Date(now.getTime() + ttlSeconds * 1000);
    const rows = await this.db
      .update(schema.botState)
      .set({ lockedUntil: until })
      .where(
        and(
          eq(schema.botState.id, STATE_ID),
          or(
            isNull(schema.botState.lockedUntil),
            lt(schema.botState.lockedUntil, now),
          ),
        ),
      )
      .returning({ id: schema.botState.id });
    return rows.length > 0;
  }

  async releaseLock(): Promise<void> {
    await this.db
      .update(schema.botState)
      .set({ lockedUntil: null })
      .where(eq(schema.botState.id, STATE_ID));
  }

  async getPositions(): Promise<Position[]> {
    const rows = await this.db.select().from(schema.positions);
    return rows.map((r) => ({
      symbol: r.symbol,
      strategy: r.strategy as StrategyName,
      direction: r.direction as Direction,
      qty: r.qty,
      entryPrice: r.entryPrice,
      entryTime: r.entryTime.toISOString(),
      atrAtEntry: r.atrAtEntry,
      hardStop: r.hardStop,
      watermark: r.watermark,
      trailStop: r.trailStop,
      trailAtrMult: r.trailAtrMult,
      lastPrice: r.lastPrice,
    }));
  }

  async upsertPosition(p: Position): Promise<void> {
    const values = {
      symbol: p.symbol,
      strategy: p.strategy,
      direction: p.direction,
      qty: p.qty,
      entryPrice: p.entryPrice,
      entryTime: new Date(p.entryTime),
      atrAtEntry: p.atrAtEntry,
      hardStop: p.hardStop,
      watermark: p.watermark,
      trailStop: p.trailStop,
      trailAtrMult: p.trailAtrMult,
      lastPrice: p.lastPrice,
    };
    await this.db
      .insert(schema.positions)
      .values(values)
      .onConflictDoUpdate({ target: schema.positions.symbol, set: values });
  }

  async deletePosition(symbol: string): Promise<void> {
    await this.db
      .delete(schema.positions)
      .where(eq(schema.positions.symbol, symbol));
  }

  async insertTrade(t: TradeRecord): Promise<void> {
    await this.db.insert(schema.trades).values({
      closedAt: new Date(t.closedAt),
      symbol: t.symbol,
      strategy: t.strategy,
      direction: t.direction,
      qty: t.qty,
      entryPrice: t.entryPrice,
      exitPrice: t.exitPrice,
      pnl: t.pnl,
      exitReason: t.exitReason,
      entryTime: new Date(t.entryTime),
    });
  }

  async insertEquitySnapshot(time: string, equity: number): Promise<void> {
    await this.db
      .insert(schema.equitySnapshots)
      .values({ time: new Date(time), equity });
  }

  async upsertDailyPnl(date: string, equity: number): Promise<void> {
    await this.db
      .insert(schema.dailyPnl)
      .values({ date, startEquity: equity, endEquity: equity, pnl: 0 })
      .onConflictDoUpdate({
        target: schema.dailyPnl.date,
        set: {
          endEquity: equity,
          pnl: sql`${equity} - ${schema.dailyPnl.startEquity}`,
        },
      });
  }
}
