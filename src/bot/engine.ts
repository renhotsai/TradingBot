import { randomUUID } from "crypto";
import {
  INSTRUMENTS,
  RISK,
  type InstrumentConfig,
} from "@/config";
import { directionToCloseSide, type Broker, type OrderResult } from "./broker";
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
import type { PendingOrder, Position, Store, TradeRecord } from "./store";

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

    // ---- Phase 0: finish orders a previous tick submitted but never saw
    // through to a filled/rejected outcome. Symbols with an order still
    // in flight after this are skipped below so we never submit a second
    // order for the same symbol while the first is unresolved. ----
    const blockedSymbols = await this.reconcilePendingOrders(now, report);

    // ---- Phase 1: manage stops on open positions (every tick) ----
    for (const position of await this.store.getPositions()) {
      if (blockedSymbols.has(position.symbol)) continue;
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
      if (blockedSymbols.has(instrument.symbol)) continue;
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

  /**
   * Resolves every pending order left over from a previous tick: fills it in
   * (writing the position/trade row) if the broker confirms a fill, drops it
   * if the broker confirms it never will (canceled/expired/rejected), or
   * leaves it for next time if the broker still shows it working. Returns
   * the set of symbols that still have an order in flight after this pass.
   */
  private async reconcilePendingOrders(now: Date, report: TickReport): Promise<Set<string>> {
    const blocked = new Set<string>();
    const pending = await this.store.getPendingOrders();

    for (const po of pending) {
      try {
        const status = po.brokerOrderId
          ? await this.broker.getOrderStatus(po.brokerOrderId)
          : await this.broker.getOrderByClientOrderId(po.clientOrderId);

        if (!status) {
          // Broker has no record yet (or the initial submit never reached
          // it). Leave it for the next tick to try again.
          blocked.add(po.symbol);
          continue;
        }
        if (!po.brokerOrderId) {
          await this.store.attachBrokerOrderId(po.id, status.orderId);
        }

        if (status.filledAvgPrice !== null) {
          await this.finalizePendingOrder(po, status.filledAvgPrice, status.filledQty ?? po.qty, now, report);
          continue;
        }
        if (["canceled", "expired", "rejected"].includes(status.status)) {
          report.errors.push(`${po.symbol}: pending ${po.purpose} order ${status.status}, dropped`);
          await this.store.deletePendingOrder(po.id);
          continue;
        }
        blocked.add(po.symbol);
      } catch (e) {
        report.errors.push(`reconcile ${po.symbol}: ${message(e)}`);
        blocked.add(po.symbol);
      }
    }
    return blocked;
  }

  /** Writes the positions/trades row for a confirmed fill, then drops the pending record. */
  private async finalizePendingOrder(
    po: PendingOrder,
    fillPrice: number,
    filledQty: number,
    now: Date,
    report: TickReport,
  ): Promise<void> {
    if (po.purpose === "open") {
      const atr = po.atrAtEntry!;
      const position: Position = {
        symbol: po.symbol,
        strategy: po.strategy,
        direction: po.direction,
        qty: filledQty,
        entryPrice: fillPrice,
        entryTime: po.createdAt,
        atrAtEntry: atr,
        hardStop: hardStopPrice(fillPrice, po.direction, atr),
        watermark: fillPrice,
        trailStop:
          po.trailAtrMult !== null
            ? hardStopPrice(fillPrice, po.direction, po.trailAtrMult * atr)
            : null,
        trailAtrMult: po.trailAtrMult,
        lastPrice: fillPrice,
      };
      await this.store.upsertPosition(position);
      report.actions.push(
        `${po.symbol}: opened ${po.direction} ${filledQty} @ ${fillPrice.toFixed(2)} (stop ${position.hardStop.toFixed(2)})`,
      );
    } else {
      const sign = po.direction === "long" ? 1 : -1;
      const pnl = (fillPrice - po.entryPrice!) * filledQty * sign;
      await this.store.insertTrade({
        closedAt: now.toISOString(),
        symbol: po.symbol,
        strategy: po.strategy,
        direction: po.direction,
        qty: filledQty,
        entryPrice: po.entryPrice!,
        exitPrice: fillPrice,
        pnl,
        exitReason: po.exitReason!,
        entryTime: po.entryTime!,
      });
      await this.store.deletePosition(po.symbol);
      report.actions.push(
        `${po.symbol}: closed ${po.direction} ${filledQty} @ ${fillPrice.toFixed(2)} (${po.exitReason}, pnl ${pnl.toFixed(2)})`,
      );
    }
    await this.store.deletePendingOrder(po.id);

    // Confirm the broker's own state agrees with what was just written,
    // rather than trusting the fill response alone.
    try {
      const brokerPosition = await this.broker.getOpenPosition(po.symbol);
      if (po.purpose === "open") {
        if (!brokerPosition || brokerPosition.side !== po.direction || qtyMismatch(brokerPosition.qty, filledQty)) {
          report.errors.push(
            `${po.symbol}: RECONCILE mismatch after open — bot recorded ${po.direction} ${filledQty}, Alpaca shows ` +
              (brokerPosition ? `${brokerPosition.side} ${brokerPosition.qty}` : "no position"),
          );
        }
      } else if (brokerPosition) {
        report.errors.push(
          `${po.symbol}: RECONCILE mismatch after close — bot recorded the position closed, but Alpaca still shows ` +
            `${brokerPosition.side} ${brokerPosition.qty}`,
        );
      }
    } catch (e) {
      report.errors.push(`${po.symbol}: post-fill reconcile check failed: ${message(e)}`);
    }
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

    // Confirm with the broker that this symbol is actually flat before
    // adding exposure — the DB has no record of a position, but that's only
    // trustworthy if it agrees with Alpaca's own account state.
    const existingBrokerPosition = await this.broker.getOpenPosition(instrument.symbol);
    if (existingBrokerPosition) {
      report.errors.push(
        `${instrument.symbol}: RECONCILE mismatch — bot has no record of a position but Alpaca shows ` +
          `${existingBrokerPosition.side} ${existingBrokerPosition.qty}; skipping entry`,
      );
      return;
    }

    const side = direction === "long" ? "buy" : "sell";
    const pending = await this.store.createPendingOrder({
      clientOrderId: randomUUID(),
      brokerOrderId: null,
      symbol: instrument.symbol,
      side,
      purpose: "open",
      qty,
      strategy: instrument.strategy,
      direction,
      atrAtEntry: atr,
      trailAtrMult: trailAtrMult(instrument),
      entryPrice: null,
      entryTime: null,
      exitReason: null,
      createdAt: now.toISOString(),
    });

    let order: OrderResult;
    try {
      order = await this.broker.submitMarketOrder(instrument, side, qty, pending.clientOrderId);
    } catch (e) {
      await this.store.deletePendingOrder(pending.id);
      throw e;
    }

    if (order.filledAvgPrice !== null) {
      await this.finalizePendingOrder(pending, order.filledAvgPrice, order.filledQty ?? qty, now, report);
    } else {
      await this.store.attachBrokerOrderId(pending.id, order.orderId);
      report.actions.push(`${instrument.symbol}: ${side} order submitted, awaiting fill confirmation`);
    }
  }

  private async closePosition(
    instrument: InstrumentConfig,
    position: Position,
    reason: TradeRecord["exitReason"],
    now: Date,
    report: TickReport,
  ): Promise<void> {
    // Confirm with the broker what's actually held before submitting a
    // close — this is what a stale/rounded DB quantity would otherwise
    // trip over (a close sized to the DB's qty can be rejected for
    // insufficient balance if the real fill was fractionally smaller).
    const brokerPosition = await this.broker.getOpenPosition(instrument.symbol);
    if (!brokerPosition) {
      report.errors.push(
        `${instrument.symbol}: RECONCILE mismatch — bot has an open ${position.direction} ${position.qty} ` +
          `but Alpaca shows no position; dropping the stale record`,
      );
      await this.store.deletePosition(instrument.symbol);
      return;
    }
    if (brokerPosition.side !== position.direction) {
      report.errors.push(
        `${instrument.symbol}: RECONCILE mismatch — bot has ${position.direction} but Alpaca shows ` +
          `${brokerPosition.side}; skipping close for manual review`,
      );
      return;
    }
    const closeQty = brokerPosition.qty;
    if (qtyMismatch(brokerPosition.qty, position.qty)) {
      report.actions.push(
        `${instrument.symbol}: qty mismatch — bot recorded ${position.qty}, Alpaca shows ${brokerPosition.qty}; ` +
          `closing the broker's actual quantity`,
      );
    }

    const side = directionToCloseSide(position.direction);
    const pending = await this.store.createPendingOrder({
      clientOrderId: randomUUID(),
      brokerOrderId: null,
      symbol: instrument.symbol,
      side,
      purpose: "close",
      qty: closeQty,
      strategy: position.strategy,
      direction: position.direction,
      atrAtEntry: null,
      trailAtrMult: null,
      entryPrice: position.entryPrice,
      entryTime: position.entryTime,
      exitReason: reason,
      createdAt: now.toISOString(),
    });

    let order: OrderResult;
    try {
      order = await this.broker.submitMarketOrder(instrument, side, closeQty, pending.clientOrderId);
    } catch (e) {
      await this.store.deletePendingOrder(pending.id);
      throw e;
    }

    if (order.filledAvgPrice !== null) {
      await this.finalizePendingOrder(pending, order.filledAvgPrice, order.filledQty ?? closeQty, now, report);
    } else {
      await this.store.attachBrokerOrderId(pending.id, order.orderId);
      report.actions.push(`${instrument.symbol}: ${side} order submitted to close position, awaiting fill confirmation`);
    }
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** True when two quantities differ by more than a small rounding tolerance. */
function qtyMismatch(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(1e-6, Math.abs(a) * 0.001);
}
