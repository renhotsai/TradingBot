export interface PositionView {
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  qty: number;
  entryPrice: number;
  entryTime: string;
  atrAtEntry: number;
  hardStop: number;
  watermark: number;
  trailStop: number | null;
  trailAtrMult: number | null;
  lastPrice: number | null;
}

export interface TradeView {
  closedAt: string;
  entryTime: string;
  symbol: string;
  strategy: string;
  direction: "long" | "short";
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnl: number;
  exitReason: string;
}

export interface DailyPnlView {
  date: string;
  startEquity: number;
  endEquity: number;
  pnl: number;
}

export interface EquityPoint {
  time: string;
  equity: number;
}

export interface StatusView {
  botOnline: boolean;
  lastHeartbeat: string | null;
  lastError: string | null;
  equity: number | null;
}

export interface DashboardData {
  /** True when serving built-in sample data (no DATABASE_URL configured). */
  sample: boolean;
  status: StatusView;
  positions: PositionView[];
  trades: TradeView[];
  dailyPnl: DailyPnlView[];
  equityHistory: EquityPoint[];
}
