import { neon } from "@neondatabase/serverless";
import { NextRequest, NextResponse } from "next/server";
import { hasDatabase } from "@/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One-time, idempotent schema setup — the hosted equivalent of running
 * `npm run db:push` locally. Protected by the same CRON_SECRET as the bot
 * tick. Safe to call repeatedly: every statement is IF NOT EXISTS.
 */
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "bot_state" (
    "id" integer PRIMARY KEY NOT NULL,
    "last_bars" jsonb NOT NULL,
    "last_heartbeat" timestamp with time zone,
    "last_error" text,
    "locked_until" timestamp with time zone
  )`,
  `CREATE TABLE IF NOT EXISTS "daily_pnl" (
    "date" date PRIMARY KEY NOT NULL,
    "start_equity" double precision NOT NULL,
    "end_equity" double precision NOT NULL,
    "pnl" double precision NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "equity_snapshots" (
    "id" serial PRIMARY KEY NOT NULL,
    "time" timestamp with time zone NOT NULL,
    "equity" double precision NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "positions" (
    "id" serial PRIMARY KEY NOT NULL,
    "symbol" text NOT NULL,
    "strategy" text NOT NULL,
    "direction" text NOT NULL,
    "qty" double precision NOT NULL,
    "entry_price" double precision NOT NULL,
    "entry_time" timestamp with time zone NOT NULL,
    "atr_at_entry" double precision NOT NULL,
    "hard_stop" double precision NOT NULL,
    "watermark" double precision NOT NULL,
    "trail_stop" double precision,
    "trail_atr_mult" double precision,
    "last_price" double precision,
    CONSTRAINT "positions_symbol_unique" UNIQUE("symbol")
  )`,
  `CREATE TABLE IF NOT EXISTS "trades" (
    "id" serial PRIMARY KEY NOT NULL,
    "closed_at" timestamp with time zone NOT NULL,
    "symbol" text NOT NULL,
    "strategy" text NOT NULL,
    "direction" text NOT NULL,
    "qty" double precision NOT NULL,
    "entry_price" double precision NOT NULL,
    "exit_price" double precision NOT NULL,
    "pnl" double precision NOT NULL,
    "exit_reason" text NOT NULL,
    "entry_time" timestamp with time zone NOT NULL
  )`,
];

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "change_me") return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("token") === secret;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const sql = neon(process.env.DATABASE_URL!);
  const created: string[] = [];
  try {
    for (const statement of STATEMENTS) {
      await sql.query(statement);
      created.push(statement.match(/"(\w+)"/)![1]);
    }
    const tables = (await sql.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
    )) as { tablename: string }[];
    return NextResponse.json({
      ok: true,
      ensured: created,
      tablesInDatabase: tables.map((t) => t.tablename),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
