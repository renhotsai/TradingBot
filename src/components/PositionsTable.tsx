"use client";

import {
  fmtDateTime,
  fmtMoney,
  fmtQty,
  fmtSignedMoney,
  strategyLabel,
  unrealizedPnl,
} from "@/lib/format";
import type { PositionView } from "@/lib/types";

export default function PositionsTable({
  positions,
}: {
  positions: PositionView[];
}) {
  return (
    <section className="card p-4">
      <h2 className="text-sm font-medium" style={{ color: "var(--text-secondary)" }}>
        Open positions
      </h2>
      {positions.length === 0 ? (
        <p className="mt-3 text-sm" style={{ color: "var(--text-muted)" }}>
          No open positions.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm tabular">
            <thead>
              <tr
                className="text-left text-xs"
                style={{ color: "var(--text-muted)" }}
              >
                <th className="py-2 pr-4 font-medium">Instrument</th>
                <th className="py-2 pr-4 font-medium">Strategy</th>
                <th className="py-2 pr-4 font-medium">Side</th>
                <th className="py-2 pr-4 text-right font-medium">Qty</th>
                <th className="py-2 pr-4 text-right font-medium">Entry</th>
                <th className="py-2 pr-4 text-right font-medium">Last</th>
                <th className="py-2 pr-4 text-right font-medium">Hard stop</th>
                <th className="py-2 pr-4 text-right font-medium">Trail stop</th>
                <th className="py-2 pr-4 text-right font-medium">Unrealized</th>
                <th className="py-2 font-medium">Opened</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((p) => {
                const u = unrealizedPnl(p);
                return (
                  <tr
                    key={p.symbol}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 pr-4 font-medium">{p.symbol}</td>
                    <td className="py-2 pr-4" style={{ color: "var(--text-secondary)" }}>
                      {strategyLabel(p.strategy)}
                    </td>
                    <td className="py-2 pr-4 uppercase">{p.direction}</td>
                    <td className="py-2 pr-4 text-right">{fmtQty(p.qty)}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(p.entryPrice)}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(p.lastPrice)}</td>
                    <td className="py-2 pr-4 text-right">{fmtMoney(p.hardStop)}</td>
                    <td className="py-2 pr-4 text-right">
                      {p.trailStop === null ? "—" : fmtMoney(p.trailStop)}
                    </td>
                    <td
                      className="py-2 pr-4 text-right"
                      style={{
                        color:
                          u === null
                            ? "var(--text-muted)"
                            : u >= 0
                              ? "var(--delta-up)"
                              : "var(--delta-down)",
                      }}
                    >
                      {u === null ? "—" : fmtSignedMoney(u)}
                    </td>
                    <td className="py-2" style={{ color: "var(--text-secondary)" }}>
                      {fmtDateTime(p.entryTime)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
