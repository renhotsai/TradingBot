import type { MeanReversionParams } from "@/config";
import type { Candle, Direction, StrategyDecision } from "./types";

export function sma(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function stdDev(values: number[]): number {
  const mean = sma(values);
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Mean reversion on 15-minute candles (SPY z=1.5, QQQ z=1.8).
 * Long when price sits more than `zThreshold` standard deviations below the
 * 20-period SMA, short when above; exit once price returns to the SMA.
 */
export function meanReversionSignal(
  candles: Candle[],
  position: Direction | null,
  params: MeanReversionParams,
): StrategyDecision {
  if (candles.length < params.period) return "none";

  const closes = candles.slice(-params.period).map((c) => c.close);
  const mean = sma(closes);
  const sd = stdDev(closes);
  const close = closes[closes.length - 1];

  if (position === "long") {
    return close >= mean ? "exit" : "none";
  }
  if (position === "short") {
    return close <= mean ? "exit" : "none";
  }

  if (sd === 0) return "none";
  const z = (close - mean) / sd;
  if (z <= -params.zThreshold) return "long";
  if (z >= params.zThreshold) return "short";
  return "none";
}
