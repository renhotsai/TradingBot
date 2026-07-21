"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/types";
import StatusBar from "./StatusBar";
import EquityCurve from "./EquityCurve";
import DailyPnlChart from "./DailyPnlChart";
import PositionsTable from "./PositionsTable";
import TradesTable from "./TradesTable";
import StrategyStats from "./StrategyStats";

const REFRESH_MS = 15_000;

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/dashboard", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as DashboardData;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!data) {
    return (
      <main className="mx-auto max-w-6xl px-4 py-10">
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          {error ? `Failed to load dashboard: ${error}` : "Loading…"}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">TradingBot Monitor</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            SPY · QQQ · BTC/USD · GLD · USO — mean reversion, momentum
            breakout, trend following
          </p>
        </div>
        <nav className="flex gap-3 text-sm">
          <a
            className="underline underline-offset-2"
            style={{ color: "var(--text-secondary)" }}
            href="/api/export/trades.csv"
          >
            trades.csv
          </a>
          <a
            className="underline underline-offset-2"
            style={{ color: "var(--text-secondary)" }}
            href="/api/export/daily_pnl.csv"
          >
            daily_pnl.csv
          </a>
        </nav>
      </header>

      {data.sample && (
        <p
          className="card px-4 py-2 text-sm"
          style={{ color: "var(--text-secondary)" }}
        >
          Showing sample data — set <code>DATABASE_URL</code> (and run{" "}
          <code>npm run db:push</code>) to connect the live database.
        </p>
      )}

      <StatusBar status={data.status} positionCount={data.positions.length} />

      <div className="grid gap-4 lg:grid-cols-2">
        <EquityCurve points={data.equityHistory} />
        <DailyPnlChart rows={data.dailyPnl} />
      </div>

      <PositionsTable positions={data.positions} />
      <StrategyStats trades={data.trades} />
      <TradesTable trades={data.trades} />

      <footer
        className="pb-4 text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        Read-only monitor. Refreshes every {REFRESH_MS / 1000}s.
      </footer>
    </main>
  );
}
