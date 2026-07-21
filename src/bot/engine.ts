import {
  INSTRUMENTS,
  RISK,
  type InstrumentConfig,
} from "@/config";
import { directionToCloseSide, type Broker } from "./broker";
import {
  checkStops,
  computeAtr,
  correlationBlocked,
  hardStopPrice,
  positionSize,
  updateTrailingStop,
} from "./riskManager";
import { meanReversionSignal } from "./strategies/meanReversion";
import { momentumBreakoutSignal } from "./strategies/momentumBreakout";
import { trendFollowingSignal } from "./strategies/trendFollowing";
import type {
  Candle,
  Direction,
  StrategyDecision,
} from "./strategies/types";
import type { Position, Store, TradeRecord } from "./store";

export interface TickReport {
  time: string;
  equity: number | null;
  marketOpen: boolean | null;
  actions: string[];
  errors: string[];
}

function decide(
  instrument: InstrumentConfig,
  candles: Candle[],
  position: Direction | null,
): StrategyDecision {
  switch (instrument.strategy) {
    case "mean_reversion":
      return meanReversionSignal(candles, position, instrument.meanReversion!);
    case "momentum_breakout":
      return momentumBreakoutSignal(candles, position, instrument.momentumBreakout!);
    case "trend_following":
      return trendFollowingSignal(candles, position, instrument.trendFollowing!);
  }
}

function trailAtrMult(instrument: InstrumentConfig): number | null {
  return (
    instrument.momentumBreakout?.trailAtrMult ??
    instrument.trendFollowing?.trailAtrMult ??
    null
  );
}

/** Keep only bars whose full period has elapsed — drops the still-forming bar. */
export function completedCandles(
  candles: Candle[],
  timeframeMinutes: number,
  now: Date,
): Candle[] {
  const cutoff = now.getTime() - timeframeMinutes * 60_000;
  return candles.filter((c) => new Date(c.time).getTime() <= cutoff);
}

/** Calendar date in the exchange's timezone, for daily P&L bucketing. */
export function tradingDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export class TradingEngine {
  constructor(
    private readonly broker: Broker,
    private readonly store: Store,
  ) {}

  /**
   * One complete bot cycle. Designed for a serverless runtime: reads all state
   * from the store, acts, writes everything back. Safe to call every minute.
   */
  async runTick(now: Date = new Date()): Promise<TickReport> {
    const report: TickReport = {
      time: now.toISOString(),
      equity: null,
      marketOpen: null,
      actions: [],
      errors: [],
    };

    const state = await this.store.getBotState();

    // Account + clock are prerequisites for everything; failure aborts the tick
    // (the caller records the error and the next scheduled tick retries).
    const account = await this.broker.getAccount();
    const marketOpen = await this.broker.isMarketOpen();
    report.equity = account.equity;
    report.marketOpen = marketOpen;

    // ---- Phase 1: manage stops on open positions (every tick) ----
    for (const position of await this.store.getPositions()) {
      const instrument = INSTRUMENTS.find((i) => i.symbol === position.symbol);
      if (!instrument) continue;
      if (instrument.assetClass === "equity" && !marketOpen) continue;
      try {
        const price = await this.broker.getLatestPrice(instrument);
        const { position: updated } = updateTrailingStop(position, price);
        const breach = checkStops(updated, price);
        if (breach) {
          await this.closePosition(instrument, updated, breach, now, report);
        } else {
          await this.store.upsertPosition({ ...updated, lastPrice: price });
        }
      } catch (e) {
        report.errors.push(`stop-check ${position.symbol}: ${message(e)}`);
      }
    }

    // ---- Phase 2: strategy signals on newly completed bars ----
    for (const instrument of INSTRUMENTS) {
      try {
        if (instrument.assetClass === "equity" && !marketOpen) continue;

        const lastProcessed = state.lastBars[instrument.symbol];
        if (lastProcessed) {
          const elapsed = now.getTime() - new Date(lastProcessed).getTime();
          // No new bar can be complete until a full period after the last one.
          if (elapsed < instrument.timeframeMinutes * 60_000 * 2) continue;
        }

        const candles = completedCandles(
          await this.broker.getBars(instrument),
          instrument.timeframeMinutes,
          now,
        );
        if (candles.length === 0) continue;
        const latest = candles[candles.length - 1];
        if (lastProcessed && latest.time <= lastProcessed) continue;

        const positions = await this.store.getPositions();
        const position = positions.find((p) => p.symbol === instrument.symbol) ?? null;
        const decision = decide(instrument, candles, position?.direction ?? null);

        await this.applyDecision(
          instrument,
          decision,
          candles,
          position,
          positions,
          account,
          now,
          report,
        );
        state.lastBars[instrument.symbol] = latest.time;
      } catch (e) {
        report.errors.push(`signal ${instrument.symbol}: ${message(e)}`);
      }
    }

    // ---- Phase 3: accounting + heartbeat ----
    try {
      await this.store.insertEquitySnapshot(now.toISOString(), account.equity);
      await this.store.upsertDailyPnl(tradingDate(now), account.equity);
    } catch (e) {
      report.errors.push(`accounting: ${message(e)}`);
    }

    state.lastHeartbeat = now.toISOString();
    state.lastError = report.errors.length ? report.errors.join(" | ") : null;
    await this.store.saveBotState(state);
    return report;
  }

  private async applyDecision(
    instrument: InstrumentConfig,
    decision: StrategyDecision,
    candles: Candle[],
    position: Position | null,
    allPositions: Position[],
    account: { equity: number; buyingPower: number },
    now: Date,
    report: TickReport,
  ): Promise<void> {
    if (decision === "none") return;

    if (decision === "exit") {
      if (position) await this.closePosition(instrument, position, "signal", now, report);
      return;
    }

    // decision is desired exposure: "long" | "short"
    if (position && position.direction === decision) return;

    if (position && position.direction !== decision) {
      await this.closePosition(instrument, position, "signal", now, report);
      allPositions = allPositions.filter((p) => p.symbol !== instrument.symbol);
    }

    if (decision === "short" && !instrument.canShort) {
      // Alpaca spot crypto is long-only: the short signal only flattens.
      return;
    }

    if (correlationBlocked(instrument.symbol, decision, allPositions)) {
      report.actions.push(
        `${instrument.symbol}: long blocked by correlation filter (SPY & QQQ already long)`,
      );
      return;
    }

    await this.openPosition(instrument, decision, candles, account, now, report);
  }

  private async openPosition(
    instrument: InstrumentConfig,
    direction: Direction,
    candles: Candle[],
    account: { equity: number; buyingPower: number },
    now: Date,
    report: TickReport,
  ): Promise<void> {
    const atr = computeAtr(candles, RISK.atrPeriod);
    if (atr === null || atr <= 0) {
      report.errors.push(`${instrument.symbol}: not enough data for ATR`);
      return;
    }

    const referencePrice = candles[candles.length - 1].close;
    const qty = positionSize({
      equity: account.equity,
      buyingPower: account.buyingPower,
      atr,
      price: referencePrice,
      isCrypto: instrument.assetClass === "crypto",
    });
    if (qty <= 0) {
      report.actions.push(`${instrument.symbol}: sized to 0, skipping entry`);
      return;
    }

    const side = direction === "long" ? "buy" : "sell";
    const order = await this.broker.submitMarketOrder(instrument, side, qty);
    const entryPrice = order.filledAvgPrice ?? referencePrice;

    const position: Position = {
      symbol: instrument.symbol,
      strategy: instrument.strategy,
      direction,
      qty,
      entryPrice,
      entryTime: now.toISOString(),
      atrAtEntry: atr,
      hardStop: hardStopPrice(entryPrice, direction, atr),
      watermark: entryPrice,
      trailStop:
        trailAtrMult(instrument) !== null
          ? hardStopPrice(entryPrice, direction, trailAtrMult(instrument)! * atr)
          : null,
      trailAtrMult: trailAtrMult(instrument),
      lastPrice: entryPrice,
    };
    await this.store.upsertPosition(position);
    report.actions.push(
      `${instrument.symbol}: opened ${direction} ${qty} @ ${entryPrice.toFixed(2)} (stop ${position.hardStop.toFixed(2)})`,
    );
  }

  private async closePosition(
    instrument: InstrumentConfig,
    position: Position,
    reason: TradeRecord["exitReason"],
    now: Date,
    report: TickReport,
  ): Promise<void> {
    const order = await this.broker.submitMarketOrder(
      instrument,
      directionToCloseSide(position.direction),
      position.qty,
    );
    const exitPrice =
      order.filledAvgPrice ?? (await this.broker.getLatestPrice(instrument));

    const sign = position.direction === "long" ? 1 : -1;
    const pnl = (exitPrice - position.entryPrice) * position.qty * sign;

    await this.store.insertTrade({
      closedAt: now.toISOString(),
      symbol: position.symbol,
      strategy: position.strategy,
      direction: position.direction,
      qty: position.qty,
      entryPrice: position.entryPrice,
      exitPrice,
      pnl,
      exitReason: reason,
      entryTime: position.entryTime,
    });
    await this.store.deletePosition(position.symbol);
    report.actions.push(
      `${position.symbol}: closed ${position.direction} ${position.qty} @ ${exitPrice.toFixed(2)} (${reason}, pnl ${pnl.toFixed(2)})`,
    );
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
