export type AssetClass = "equity" | "crypto";
export type StrategyName =
  | "mean_reversion"
  | "momentum_breakout"
  | "trend_following";

export interface MeanReversionParams {
  period: number;
  zThreshold: number;
}

export interface MomentumBreakoutParams {
  period: number;
  volumeMult: number;
  trailAtrMult: number;
}

export interface TrendFollowingParams {
  emaFast: number;
  emaSlow: number;
  trailAtrMult: number;
}

export interface InstrumentConfig {
  symbol: string;
  assetClass: AssetClass;
  strategy: StrategyName;
  timeframeMinutes: number;
  /** How many completed bars to request from the data API. */
  barsToFetch: number;
  /** Alpaca spot crypto cannot be sold short — short signals flatten instead. */
  canShort: boolean;
  meanReversion?: MeanReversionParams;
  momentumBreakout?: MomentumBreakoutParams;
  trendFollowing?: TrendFollowingParams;
}

export const INSTRUMENTS: InstrumentConfig[] = [
  {
    symbol: "SPY",
    assetClass: "equity",
    strategy: "mean_reversion",
    timeframeMinutes: 15,
    barsToFetch: 120,
    canShort: true,
    meanReversion: { period: 20, zThreshold: 1.5 },
  },
  {
    symbol: "QQQ",
    assetClass: "equity",
    strategy: "mean_reversion",
    timeframeMinutes: 15,
    barsToFetch: 120,
    canShort: true,
    meanReversion: { period: 20, zThreshold: 1.8 },
  },
  {
    symbol: "BTC/USD",
    assetClass: "crypto",
    strategy: "momentum_breakout",
    timeframeMinutes: 60,
    barsToFetch: 120,
    canShort: false,
    momentumBreakout: { period: 20, volumeMult: 1.5, trailAtrMult: 2 },
  },
  {
    symbol: "GLD",
    assetClass: "equity",
    strategy: "trend_following",
    timeframeMinutes: 240,
    barsToFetch: 500,
    canShort: true,
    trendFollowing: { emaFast: 50, emaSlow: 200, trailAtrMult: 3 },
  },
  {
    symbol: "USO",
    assetClass: "equity",
    strategy: "trend_following",
    timeframeMinutes: 240,
    barsToFetch: 500,
    canShort: true,
    trendFollowing: { emaFast: 50, emaSlow: 200, trailAtrMult: 3 },
  },
];

export const RISK = {
  atrPeriod: 14,
  /** A 1-ATR adverse move costs exactly this fraction of account equity. */
  riskPerTrade: 0.01,
  /**
   * Equity instruments (SPY/QQQ/GLD/USO) only *open new* positions when the
   * account is at least this large; below it the bot trades crypto only.
   *
   * Rationale: a sub-$25k US margin account is a Pattern Day Trader — capped
   * at 3 day-trades per rolling 5 days — which the mean-reversion strategy's
   * intraday churn would trip almost immediately, restricting the account.
   * Crypto is exempt from PDT, allows fractional sizing, and its larger ATR
   * keeps the 1%-risk sizing from ballooning into buying-power-capped
   * leverage. Existing equity positions are always still stop-managed and
   * closed regardless of this threshold — it only gates new entries.
   */
  equityTradingMinEquity: 25000,
};

export function instrumentBySymbol(symbol: string): InstrumentConfig | undefined {
  return INSTRUMENTS.find((i) => i.symbol === symbol);
}

export function timeframeString(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1Hour" : `${hours}Hour`;
  }
  return `${minutes}Min`;
}
