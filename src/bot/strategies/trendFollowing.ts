import type { TrendFollowingParams } from "@/config";
import type { Candle, Direction, StrategyDecision } from "./types";

/** Standard EMA seeded with the SMA of the first `period` values. */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  const seed =
    values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const out: number[] = [seed];
  for (let i = period; i < values.length; i++) {
    out.push(values[i] * k + out[out.length - 1] * (1 - k));
  }
  return out;
}

/**
 * Trend following on 4-hour candles (GLD, USO).
 * Long when the 50 EMA crosses above the 200 EMA; exit and go short when it
 * crosses below. Trailing-stop exits (3x ATR) are handled by the risk manager.
 */
export function trendFollowingSignal(
  candles: Candle[],
  _position: Direction | null,
  params: TrendFollowingParams,
): StrategyDecision {
  if (candles.length < params.emaSlow + 1) return "none";

  const closes = candles.map((c) => c.close);
  const fast = emaSeries(closes, params.emaFast);
  const slow = emaSeries(closes, params.emaSlow);
  if (fast.length < 2 || slow.length < 2) return "none";

  const curFast = fast[fast.length - 1];
  const prevFast = fast[fast.length - 2];
  const curSlow = slow[slow.length - 1];
  const prevSlow = slow[slow.length - 2];

  if (prevFast <= prevSlow && curFast > curSlow) return "long";
  if (prevFast >= prevSlow && curFast < curSlow) return "short";
  return "none";
}
