"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtDate, fmtMoney, fmtSignedMoney } from "@/lib/format";
import type { DailyPnlView } from "@/lib/types";

export default function DailyPnlChart({ rows }: { rows: DailyPnlView[] }) {
  const data = [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-30)
    .map((r) => ({ ...r, label: fmtDate(r.date) }));

  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Daily P&L (last 30 sessions)
      </h2>
      <div className="mt-2 h-64">
        {data.length === 0 ? (
          <p className="pt-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            No daily P&L yet — rows appear after the first trading day.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }} barCategoryGap="25%">
              <CartesianGrid stroke="var(--gridline)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--baseline)" }}
                minTickGap={32}
              />
              <YAxis
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={64}
                tickFormatter={(v: number) => fmtMoney(v, 0)}
              />
              <ReferenceLine y={0} stroke="var(--baseline)" />
              <Tooltip
                cursor={{ fill: "var(--gridline)", opacity: 0.4 }}
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 12,
                }}
                formatter={(value) => [fmtSignedMoney(value as number), "P&L"]}
              />
              <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={22}>
                {data.map((d) => (
                  <Cell
                    key={d.date}
                    fill={d.pnl >= 0 ? "var(--series-1)" : "var(--series-neg)"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
