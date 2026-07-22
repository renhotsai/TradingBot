import {
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const positions = pgTable("positions", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull().unique(),
  strategy: text("strategy").notNull(),
  direction: text("direction").notNull(),
  qty: doublePrecision("qty").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
  atrAtEntry: doublePrecision("atr_at_entry").notNull(),
  hardStop: doublePrecision("hard_stop").notNull(),
  watermark: doublePrecision("watermark").notNull(),
  trailStop: doublePrecision("trail_stop"),
  trailAtrMult: doublePrecision("trail_atr_mult"),
  lastPrice: doublePrecision("last_price"),
});

export const trades = pgTable("trades", {
  id: serial("id").primaryKey(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  symbol: text("symbol").notNull(),
  strategy: text("strategy").notNull(),
  direction: text("direction").notNull(),
  qty: doublePrecision("qty").notNull(),
  entryPrice: doublePrecision("entry_price").notNull(),
  exitPrice: doublePrecision("exit_price").notNull(),
  pnl: doublePrecision("pnl").notNull(),
  exitReason: text("exit_reason").notNull(),
  entryTime: timestamp("entry_time", { withTimezone: true }).notNull(),
});

export const equitySnapshots = pgTable("equity_snapshots", {
  id: serial("id").primaryKey(),
  time: timestamp("time", { withTimezone: true }).notNull(),
  equity: doublePrecision("equity").notNull(),
});

export const dailyPnl = pgTable("daily_pnl", {
  date: date("date").primaryKey(),
  startEquity: doublePrecision("start_equity").notNull(),
  endEquity: doublePrecision("end_equity").notNull(),
  pnl: doublePrecision("pnl").notNull(),
});

/**
 * Write-ahead record of an in-flight broker order. Created before the order
 * is submitted, updated with the broker's order id once accepted, and
 * deleted once the corresponding positions/trades row has been written (or
 * the order is confirmed to have never filled). This lets a tick that dies
 * between "order submitted" and "position table updated" pick the order back
 * up and finish it on the next tick instead of leaving Alpaca and the
 * database permanently out of sync.
 */
export const pendingOrders = pgTable("pending_orders", {
  id: serial("id").primaryKey(),
  /** Generated before submission and passed to Alpaca as client_order_id, so
   * the order can be found again even if the response to the initial POST
   * is lost (network error, timeout) before a broker order id is captured. */
  clientOrderId: text("client_order_id").notNull().unique(),
  brokerOrderId: text("broker_order_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),
  purpose: text("purpose").notNull(),
  qty: doublePrecision("qty").notNull(),
  strategy: text("strategy").notNull(),
  direction: text("direction").notNull(),
  atrAtEntry: doublePrecision("atr_at_entry"),
  trailAtrMult: doublePrecision("trail_atr_mult"),
  entryPrice: doublePrecision("entry_price"),
  entryTime: timestamp("entry_time", { withTimezone: true }),
  exitReason: text("exit_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const botState = pgTable("bot_state", {
  id: integer("id").primaryKey(),
  lastBars: jsonb("last_bars").$type<Record<string, string>>().notNull(),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  lastError: text("last_error"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
