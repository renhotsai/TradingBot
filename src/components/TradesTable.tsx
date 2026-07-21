"use client";

import {
  fmtDateTime,
  fmtMoney,
  fmtQty,
  fmtSignedMoney,
  strategyLabel,
} from "@/lib/format";
import type { TradeView } from "@/lib/types";

const REASON_LABEL: Record<string, string> = {
  signal: "Signal",
  hard_stop: "Hard stop",
  trail_stop: "Trail stop",
};

export default function TradesTable({ trades }: { trades: TradeView[] }) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Trade history
      </h2>
      {trades.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          No closed trades yet.
        </p>
      ) : (
        <div className="mt-2 max-h-96 overflow-auto">
          <table className="w-full text-sm tabular">
            <thead className="sticky top-0" style={{ background: "var(--surface)" }}>
              <tr
                className="text-left text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="py-2 pr-4 font-medium">Closed</th>
                <th className="py-2 pr-4 font-medium">Instrument</th>
                <th className="py-2 pr-4 font-medium">Strategy</th>
                <th className="py-2 pr-4 font-medium">Side</th>
                <th className="py-2 pr-4 text-right font-medium">Qty</th>
                <th className="py-2 pr-4 text-right font-medium">Entry</th>
                <th className="py-2 pr-4 text-right font-medium">Exit</th>
                <th className="py-2 pr-4 text-right font-medium">P&L</th>
                <th className="py-2 font-medium">Exit via</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => (
                <tr
                  key={`${t.closedAt}-${t.symbol}-${i}`}
                  className="border-t"
                  style={{ borderColor: "var(--border)" }}
                >
                  <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>
                    {fmtDateTime(t.closedAt)}
                  </td>
                  <td className="py-2 pr-4 font-medium">{t.symbol}</td>
                  <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>
                    {strategyLabel(t.strategy)}
                  </td>
                  <td className="py-2 pr-4 uppercase">{t.direction}</td>
                  <td className="py-2 pr-4 text-right">{fmtQty(t.qty)}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(t.entryPrice)}</td>
                  <td className="py-2 pr-4 text-right">{fmtMoney(t.exitPrice)}</td>
                  <td
                    className="py-2 pr-4 text-right"
                    style={{
                      color: t.pnl >= 0 ? "var(--delta-up)" : "var(--delta-down)",
                    }}
                  >
                    {fmtSignedMoney(t.pnl)}
                  </td>
                  <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                    {REASON_LABEL[t.exitReason] ?? t.exitReason}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
