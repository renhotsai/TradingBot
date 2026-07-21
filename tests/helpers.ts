import type { InstrumentConfig } from "@/config";
import type { AccountInfo, Broker, OrderResult } from "@/bot/broker";
import type { Candle } from "@/bot/strategies/types";
import type { BotState, Position, Store, TradeRecord } from "@/bot/store";

/**
 * Build `count` candles of `timeframeMinutes` bars ending with a bar that has
 * just completed relative to `now`. `closes[i]` drives OHLC; volume defaults
 * to 1000 unless overridden per index.
 */
export function makeCandles(args: {
  closes: number[];
  timeframeMinutes: number;
  now: Date;
  volumes?: number[];
  spread?: number;
}): Candle[] {
  const { closes, timeframeMinutes, now, volumes, spread = 0.5 } = args;
  const ms = timeframeMinutes * 60_000;
  return closes.map((close, i) => ({
    time: new Date(now.getTime() - (closes.length - i) * ms).toISOString(),
    open: close,
    high: close + spread,
    low: close - spread,
    close,
    volume: volumes?.[i] ?? 1000,
  }));
}

export class FakeBroker implements Broker {
  account: AccountInfo = { equity: 100_000, buyingPower: 200_000 };
  marketOpen = true;
  bars = new Map<string, Candle[]>();
  prices = new Map<string, number>();
  orders: { symbol: string; side: "buy" | "sell"; qty: number }[] = [];

  async getAccount(): Promise<AccountInfo> {
    return this.account;
  }

  async isMarketOpen(): Promise<boolean> {
    return this.marketOpen;
  }

  async getBars(instrument: InstrumentConfig): Promise<Candle[]> {
    return this.bars.get(instrument.symbol) ?? [];
  }

  async getLatestPrice(instrument: InstrumentConfig): Promise<number> {
    const p = this.prices.get(instrument.symbol);
    if (p === undefined) throw new Error(`no price for ${instrument.symbol}`);
    return p;
  }

  async submitMarketOrder(
    instrument: InstrumentConfig,
    side: "buy" | "sell",
    qty: number,
  ): Promise<OrderResult> {
    this.orders.push({ symbol: instrument.symbol, side, qty });
    return {
      orderId: `fake-${this.orders.length}`,
      filledAvgPrice: this.prices.get(instrument.symbol) ?? null,
    };
  }
}

export class MemoryStore implements Store {
  state: BotState = { lastBars: {}, lastHeartbeat: null, lastError: null };
  positions = new Map<string, Position>();
  trades: TradeRecord[] = [];
  equitySnapshots: { time: string; equity: number }[] = [];
  dailyPnl = new Map<string, { start: number; end: number }>();
  locked = false;

  async getBotState(): Promise<BotState> {
    return {
      ...this.state,
      lastBars: { ...this.state.lastBars },
    };
  }

  async saveBotState(state: BotState): Promise<void> {
    this.state = { ...state, lastBars: { ...state.lastBars } };
  }

  async acquireLock(): Promise<boolean> {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  async releaseLock(): Promise<void> {
    this.locked = false;
  }

  async getPositions(): Promise<Position[]> {
    return [...this.positions.values()].map((p) => ({ ...p }));
  }

  async upsertPosition(position: Position): Promise<void> {
    this.positions.set(position.symbol, { ...position });
  }

  async deletePosition(symbol: string): Promise<void> {
    this.positions.delete(symbol);
  }

  async insertTrade(trade: TradeRecord): Promise<void> {
    this.trades.push({ ...trade });
  }

  async insertEquitySnapshot(time: string, equity: number): Promise<void> {
    this.equitySnapshots.push({ time, equity });
  }

  async upsertDailyPnl(date: string, equity: number): Promise<void> {
    const existing = this.dailyPnl.get(date);
    if (existing) existing.end = equity;
    else this.dailyPnl.set(date, { start: equity, end: equity });
  }
}
