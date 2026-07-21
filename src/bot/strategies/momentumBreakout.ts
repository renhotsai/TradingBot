import type { MomentumBreakoutParams } from "@/config";
import type { Candle, Direction, StrategyDecision } from "./types";

/**
 * Momentum breakout on 1-hour candles (BTC/USD).
 * Long on a close above the 20-period high with volume >= 1.5x the 20-period
 * average volume; a confirmed close below the 20-period low signals short —
 * on Alpaca spot crypto the engine turns that into "flatten" since shorting
 * is not supported. The lookback window excludes the breakout bar itself.
 * Trailing-stop exits (2x ATR) are handled by the risk manager.
 */
export function momentumBreakoutSignal(
  candles: Candle[],
  _position: Direction | null,
  params: MomentumBreakoutParams,
): StrategyDecision {
  if (candles.length < params.period + 1) return "none";

  const window = candles.slice(-(params.period + 1), -1);
  const current = candles[candles.length - 1];

  const periodHigh = Math.max(...window.map((c) => c.high));
  const periodLow = Math.min(...window.map((c) => c.low));
  const avgVolume =
    window.reduce((acc, c) => acc + c.volume, 0) / window.length;

  const volumeConfirmed =
    avgVolume > 0 && current.volume >= params.volumeMult * avgVolume;
  if (!volumeConfirmed) return "none";

  if (current.close > periodHigh) return "long";
  if (current.close < periodLow) return "short";
  return "none";
}
