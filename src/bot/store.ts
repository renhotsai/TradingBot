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

/**
 * Write-ahead record of an order the engine has submitted (or is about to
 * submit) but hasn't yet reflected in the positions/trades tables. Created
 * before the broker call, finalized (and deleted) once the fill is
 * confirmed, so a tick that dies mid-flight leaves a trail the next tick can
 * pick back up instead of a silently desynced position.
 */
export interface PendingOrder {
  id: number;
  /** Sent to the broker as client_order_id so the order can be found again
   * even if the response to the initial submit is lost. */
  clientOrderId: string;
  /** Filled in once the broker accepts the order. */
  brokerOrderId: string | null;
  symbol: string;
  side: "buy" | "sell";
  purpose: "open" | "close";
  /** Requested quantity — the actual fill is read back from the broker at
   * finalize time rather than assumed to match exactly. */
  qty: number;
  strategy: StrategyName;
  /** For "open": the new position's direction. For "close": the direction
   * of the position being closed. */
  direction: Direction;
  /** Set for "open" orders — needed to compute hard/trailing stops once the
   * real fill price is known. */
  atrAtEntry: number | null;
  trailAtrMult: number | null;
  /** Set for "close" orders — the position being closed, needed to compute
   * P&L and write the trade record. */
  entryPrice: number | null;
  entryTime: string | null;
  exitReason: TradeRecord["exitReason"] | null;
  createdAt: string;
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
  getPendingOrders(): Promise<PendingOrder[]>;
  createPendingOrder(order: Omit<PendingOrder, "id">): Promise<PendingOrder>;
  attachBrokerOrderId(id: number, brokerOrderId: string): Promise<void>;
  deletePendingOrder(id: number): Promise<void>;
}
