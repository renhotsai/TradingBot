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

export const botState = pgTable("bot_state", {
  id: integer("id").primaryKey(),
  lastBars: jsonb("last_bars").$type<Record<string, string>>().notNull(),
  lastHeartbeat: timestamp("last_heartbeat", { withTimezone: true }),
  lastError: text("last_error"),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});
