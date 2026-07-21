import { desc } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { buildSampleData } from "@/lib/sampleData";
import type { TradeView } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  let trades: TradeView[];
  if (hasDatabase()) {
    const rows = await getDb()
      .select()
      .from(schema.trades)
      .orderBy(desc(schema.trades.closedAt));
    trades = rows.map((r) => ({
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
    }));
  } else {
    trades = buildSampleData().trades;
  }

  const csv = toCsv(
    [
      "timestamp",
      "instrument",
      "direction",
      "entry_price",
      "exit_price",
      "pnl",
      "position_size",
      "strategy",
      "exit_reason",
      "entry_time",
    ],
    trades.map((t) => [
      t.closedAt,
      t.symbol,
      t.direction,
      t.entryPrice,
      t.exitPrice,
      t.pnl,
      t.qty,
      t.strategy,
      t.exitReason,
      t.entryTime,
    ]),
  );
  return csvResponse("trades.csv", csv);
}
