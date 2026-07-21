import type { StrategyName } from "@/config";
import type { Direction } from "./strategies/types";

export interface Position {
  symbol: string;
  strategy: StrategyName;
  direction: Direction;
  qty: number;
  entryPrice: number;
  entryTime: string;
  atrAtEntry: number;
  /** Entry -/+ 1 ATR: a full 1-ATR adverse move = 1% of equity lost. */
  hardStop: number;
  /** Best price seen since entry; anchors the trailing stop. */
  watermark: number;
  /** null when the strategy has no trailing stop (mean reversion). */
  trailStop: number | null;
  trailAtrMult: number | null;
  /** Latest observed price, refreshed each tick; feeds unrealized P&L. */
  lastPrice: number | null;
}

export interface TradeRecord {
  closedAt: string;
  symbol: string;
  strategy: StrategyName;
  direction: Direction;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  exitReason: "signal" | "hard_stop" | "trail_stop";
  entryTime: string;
}

export interface BotState {
  /** symbol -> ISO time of the last completed bar the strategy acted on. */
  lastBars: Record<string, string>;
  lastHeartbeat: string | null;
  lastError: string | null;
}

export interface Store {
  getBotState(): Promise<BotState>;
  saveBotState(state: BotState): Promise<void>;
  /** Returns false when another tick currently holds the lock. */
  acquireLock(now: Date, ttlSeconds: number): Promise<boolean>;
  releaseLock(): Promise<void>;
  getPositions(): Promise<Position[]>;
  upsertPosition(position: Position): Promise<void>;
  deletePosition(symbol: string): Promise<void>;
  insertTrade(trade: TradeRecord): Promise<void>;
  insertEquitySnapshot(time: string, equity: number): Promise<void>;
  /** Creates today's row on first sight (start = end = equity), then keeps end fresh. */
  upsertDailyPnl(date: string, equity: number): Promise<void>;
}
