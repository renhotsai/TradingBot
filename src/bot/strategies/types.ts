export interface Candle {
  /** Bar start time, ISO-8601 UTC. */
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Direction = "long" | "short";

/**
 * What the strategy wants given the latest completed bar.
 * "long" / "short" are desired exposure; the engine reconciles them against the
 * current position (reversing, flattening, or ignoring shorts on instruments
 * that cannot be shorted). "exit" flattens whatever is open.
 */
export type StrategyDecision = "long" | "short" | "exit" | "none";
