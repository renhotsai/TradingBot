import { desc } from "drizzle-orm";
import { getDb, hasDatabase, schema } from "@/db";
import { csvResponse, toCsv } from "@/lib/csv";
import { buildSampleData } from "@/lib/sampleData";
import type { DailyPnlView } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  let rows: DailyPnlView[];
  if (hasDatabase()) {
    const dbRows = await getDb()
      .select()
      .from(schema.dailyPnl)
      .orderBy(desc(schema.dailyPnl.date));
    rows = dbRows.map((r) => ({
      date: r.date,
      startEquity: r.startEquity,
      endEquity: r.endEquity,
      pnl: r.pnl,
    }));
  } else {
    rows = buildSampleData().dailyPnl;
  }

  const csv = toCsv(
    ["date", "start_equity", "end_equity", "pnl"],
    rows.map((r) => [r.date, r.startEquity, r.endEquity, r.pnl]),
  );
  return csvResponse("daily_pnl.csv", csv);
}
