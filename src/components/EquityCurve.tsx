"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney } from "@/lib/format";
import type { EquityPoint } from "@/lib/types";

export default function EquityCurve({ points }: { points: EquityPoint[] }) {
  const data = points.map((p) => ({
    ...p,
    label: new Date(p.time).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Equity curve
      </h2>
      <div className="mt-2 h-64">
        {data.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--series-1)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--series-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--gridline)" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "var(--baseline)" }}
                minTickGap={48}
              />
              <YAxis
                tick={{ fill: "var(--text-muted)", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                width={72}
                domain={["auto", "auto"]}
                tickFormatter={(v: number) => fmtMoney(v, 0)}
              />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: "var(--text-primary)",
                  fontSize: 12,
                }}
                labelFormatter={(_, payload) =>
                  payload?.[0]
                    ? new Date(
                        (payload[0].payload as EquityPoint).time,
                      ).toLocaleString()
                    : ""
                }
                formatter={(value) => [fmtMoney(value as number), "Equity"]}
              />
              <Area
                type="monotone"
                dataKey="equity"
                stroke="var(--series-1)"
                strokeWidth={2}
                fill="url(#equityFill)"
                dot={false}
                activeDot={{ r: 4 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function Empty() {
  return (
    <p className="pt-16 text-center text-sm" style={{ color: "var(--text-muted)" }}>
      No equity snapshots yet — data appears after the first bot tick.
    </p>
  );
}
