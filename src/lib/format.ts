export function fmtMoney(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined) return "—";
  return v.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtSignedMoney(v: number): string {
  return (v >= 0 ? "+" : "") + fmtMoney(v);
}

export function fmtQty(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function strategyLabel(s: string): string {
  switch (s) {
    case "mean_reversion":
      return "Mean Reversion";
    case "momentum_breakout":
      return "Momentum Breakout";
    case "trend_following":
      return "Trend Following";
    default:
      return s;
  }
}

export function unrealizedPnl(p: {
  direction: "long" | "short";
  qty: number;
  entryPrice: number;
  lastPrice: number | null;
}): number | null {
  if (p.lastPrice === null) return null;
  const sign = p.direction === "long" ? 1 : -1;
  return (p.lastPrice - p.entryPrice) * p.qty * sign;
}
