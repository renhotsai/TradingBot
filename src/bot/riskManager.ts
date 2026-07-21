import { RISK } from "@/config";
import type { Candle, Direction } from "./strategies/types";
import type { Position } from "./store";

/** Wilder-smoothed Average True Range. */
export function computeAtr(
  candles: Candle[],
  period: number = RISK.atrPeriod,
): number | null {
  if (candles.length < period + 1) return null;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(
      Math.max(
        c.high - c.low,
        Math.abs(c.high - prevClose),
        Math.abs(c.low - prevClose),
      ),
    );
  }

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
}

/**
 * ATR-based sizing: a 1-ATR move against the position equals exactly
 * `riskPerTrade` (1%) of account equity. Quiet instruments therefore get more
 * size, volatile ones less. Equities round down to whole shares (required for
 * shorts); crypto allows fractional quantities. The result is additionally
 * capped by available buying power so orders aren't rejected.
 */
export function positionSize(args: {
  equity: number;
  buyingPower: number;
  atr: number;
  price: number;
  isCrypto: boolean;
}): number {
  const { equity, buyingPower, atr, price, isCrypto } = args;
  if (atr <= 0 || price <= 0 || equity <= 0) return 0;

  let qty = (equity * RISK.riskPerTrade) / atr;
  const maxAffordable = buyingPower / price;
  qty = Math.min(qty, maxAffordable);

  qty = isCrypto
    ? Math.floor(qty * 1e6) / 1e6
    : Math.floor(qty);
  return qty > 0 ? qty : 0;
}

export function hardStopPrice(
  entryPrice: number,
  direction: Direction,
  atr: number,
): number {
  return direction === "long" ? entryPrice - atr : entryPrice + atr;
}

/**
 * Advance the high/low watermark and recompute the trailing stop
 * (watermark -/+ trailAtrMult x ATR-at-entry). Returns the updated position
 * and whether anything moved. Trailing stops only ratchet in the position's
 * favor — they never widen.
 */
export function updateTrailingStop(
  position: Position,
  latestPrice: number,
): { position: Position; changed: boolean } {
  const improved =
    position.direction === "long"
      ? latestPrice > position.watermark
      : latestPrice < position.watermark;
  if (!improved) return { position, changed: false };

  const updated: Position = { ...position, watermark: latestPrice };
  if (position.trailAtrMult !== null) {
    const dist = position.trailAtrMult * position.atrAtEntry;
    updated.trailStop =
      position.direction === "long" ? latestPrice - dist : latestPrice + dist;
  }
  return { position: updated, changed: true };
}

/**
 * The hard stop (1 ATR = 1% equity) always applies; the trailing stop applies
 * when the strategy defines one. Whichever is tighter triggers first.
 */
export function checkStops(
  position: Position,
  latestPrice: number,
): "hard_stop" | "trail_stop" | null {
  if (position.direction === "long") {
    if (latestPrice <= position.hardStop) return "hard_stop";
    if (position.trailStop !== null && latestPrice <= position.trailStop)
      return "trail_stop";
  } else {
    if (latestPrice >= position.hardStop) return "hard_stop";
    if (position.trailStop !== null && latestPrice >= position.trailStop)
      return "trail_stop";
  }
  return null;
}

/**
 * Correlation filter: when SPY and QQQ are both long the portfolio is already
 * loaded with risk-on exposure, so new BTC/USD longs are blocked.
 */
export function correlationBlocked(
  symbol: string,
  direction: Direction,
  openPositions: Position[],
): boolean {
  if (symbol !== "BTC/USD" || direction !== "long") return false;
  const isLong = (s: string) =>
    openPositions.some((p) => p.symbol === s && p.direction === "long");
  return isLong("SPY") && isLong("QQQ");
}
