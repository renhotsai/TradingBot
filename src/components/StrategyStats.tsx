"use client";

import { fmtSignedMoney, strategyLabel } from "@/lib/format";
import type { TradeView } from "@/lib/types";

interface Stat {
  strategy: string;
  count: number;
  wins: number;
  pnl: number;
}

export default function StrategyStats({ trades }: { trades: TradeView[] }) {
  const byStrategy = new Map<string, Stat>();
  for (const t of trades) {
    const s =
      byStrategy.get(t.strategy) ??
      ({ strategy: t.strategy, count: 0, wins: 0, pnl: 0 } as Stat);
    s.count += 1;
    if (t.pnl > 0) s.wins += 1;
    s.pnl += t.pnl;
    byStrategy.set(t.strategy, s);
  }
  const stats = [...byStrategy.values()].sort((a, b) => b.pnl - a.pnl);

  if (stats.length === 0) return null;

  return (
    <section className="flex flex-wrap gap-3">
      {stats.map((s) => (
        <div key={s.strategy} className="card flex-1 min-w-52 px-4 py-3">
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {strategyLabel(s.strategy)}
          </p>
          <p className="mt-1 text-lg font-semibold tabular">
            <span
              style={{
                color: s.pnl >= 0 ? "var(--delta-up)" : "var(--delta-down)",
              }}
            >
              {fmtSignedMoney(s.pnl)}
            </span>
          </p>
          <p className="text-xs tabular" style={{ color: "var(--text-secondary)" }}>
            {s.count} trades · {((s.wins / s.count) * 100).toFixed(0)}% win rate
          </p>
        </div>
      ))}
    </section>
  );
}
