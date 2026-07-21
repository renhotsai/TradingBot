"use client";

import { fmtDateTime, fmtMoney } from "@/lib/format";
import type { StatusView } from "@/lib/types";

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="card flex-1 min-w-40 px-4 py-3">
      <p className="text-xs" style={{ color: "var(--text-muted)" }}>
        {label}
      </p>
      <div className="mt-1 text-lg font-semibold tabular">{children}</div>
    </div>
  );
}

export default function StatusBar({
  status,
  positionCount,
}: {
  status: StatusView;
  positionCount: number;
}) {
  return (
    <section className="flex flex-wrap gap-3">
      <Tile label="Bot status">
        <span
          className="inline-flex items-center gap-2"
          style={{
            color: status.botOnline ? "var(--status-good)" : "var(--status-critical)",
          }}
        >
          <span aria-hidden>{status.botOnline ? "●" : "○"}</span>
          {status.botOnline ? "Online" : "Offline"}
        </span>
      </Tile>
      <Tile label="Account equity">{fmtMoney(status.equity)}</Tile>
      <Tile label="Open positions">{positionCount}</Tile>
      <Tile label="Last heartbeat">
        <span className="text-base">{fmtDateTime(status.lastHeartbeat)}</span>
      </Tile>
      {status.lastError && (
        <div className="card w-full px-4 py-2 text-sm" role="alert">
          <span style={{ color: "var(--status-critical)" }}>⚠ Last error: </span>
          <span style={{ color: "var(--text-secondary)" }}>{status.lastError}</span>
        </div>
      )}
    </section>
  );
}
