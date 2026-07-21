import { NextRequest, NextResponse } from "next/server";
import { AlpacaBroker } from "@/bot/broker";
import { TradingEngine } from "@/bot/engine";
import { hasDatabase } from "@/db";
import { DbStore } from "@/db/store";

export const dynamic = "force-dynamic";
// Vercel Hobby allows up to 60s — enough for a full tick including retries.
export const maxDuration = 60;

const LOCK_TTL_SECONDS = 55;

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret === "change_me") return false;
  const header = req.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;
  // Fallback for schedulers that can't set headers.
  return req.nextUrl.searchParams.get("token") === secret;
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!hasDatabase()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  const store = new DbStore();
  const now = new Date();

  const locked = await store.acquireLock(now, LOCK_TTL_SECONDS);
  if (!locked) {
    return NextResponse.json(
      { skipped: true, reason: "previous tick still running" },
      { status: 200 },
    );
  }

  try {
    const engine = new TradingEngine(new AlpacaBroker(), store);
    const report = await engine.runTick(now);
    return NextResponse.json(report);
  } catch (e) {
    // A failed tick must never take the endpoint down — report and let the
    // scheduler try again next minute.
    const msg = e instanceof Error ? e.message : String(e);
    try {
      const state = await store.getBotState();
      state.lastError = msg;
      state.lastHeartbeat = now.toISOString();
      await store.saveBotState(state);
    } catch {
      // state save is best-effort here
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    await store.releaseLock().catch(() => {});
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
