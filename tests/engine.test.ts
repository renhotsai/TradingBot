import { beforeEach, describe, expect, it } from "vitest";
import { TradingEngine, completedCandles, tradingDate } from "@/bot/engine";
import { computeAtr } from "@/bot/riskManager";
import type { Position } from "@/bot/store";
import { FakeBroker, MemoryStore, makeCandles } from "./helpers";

const now = new Date("2026-07-20T18:00:00Z");

function meanRevCloses(finalClose: number): number[] {
  return [
    ...Array.from({ length: 19 }, (_, i) => (i % 2 === 0 ? 101 : 99)),
    finalClose,
  ];
}

function breakoutCandles(finalClose: number, finalVolume: number) {
  const closes = [
    ...Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 90.5 : 109.5)),
    finalClose,
  ];
  const volumes = [...Array.from({ length: 20 }, () => 1000), finalVolume];
  return makeCandles({ closes, timeframeMinutes: 60, now, volumes });
}

function openPosition(overrides: Partial<Position>): Position {
  return {
    symbol: "SPY",
    strategy: "mean_reversion",
    direction: "long",
    qty: 100,
    entryPrice: 97.4,
    entryTime: "2026-07-20T15:00:00Z",
    atrAtEntry: 2,
    hardStop: 95.4,
    watermark: 97.4,
    trailStop: null,
    trailAtrMult: null,
    lastPrice: null,
    ...overrides,
  };
}

/** Seeds a position into both the DB and the broker's own ledger, so the
 * engine's broker-vs-DB reconciliation checks see them as already in sync. */
async function seed(store: MemoryStore, broker: FakeBroker, position: Position): Promise<void> {
  await store.upsertPosition(position);
  broker.brokerPositions.set(position.symbol, {
    symbol: position.symbol,
    side: position.direction,
    qty: position.qty,
    avgEntryPrice: position.entryPrice,
  });
}

describe("TradingEngine.runTick", () => {
  let broker: FakeBroker;
  let store: MemoryStore;
  let engine: TradingEngine;

  beforeEach(() => {
    broker = new FakeBroker();
    store = new MemoryStore();
    engine = new TradingEngine(broker, store);
  });

  it("opens an ATR-sized long on a mean-reversion signal and doesn't re-fire on the same bar", async () => {
    const candles = makeCandles({ closes: meanRevCloses(97.5), timeframeMinutes: 15, now });
    broker.bars.set("SPY", candles);
    broker.prices.set("SPY", 97.4);

    const report = await engine.runTick(now);
    expect(report.errors).toEqual([]);

    const pos = store.positions.get("SPY");
    expect(pos).toBeDefined();
    expect(pos!.direction).toBe("long");

    const atr = computeAtr(candles, 14)!;
    const expectedQty = Math.floor((100_000 * 0.01) / atr);
    expect(pos!.qty).toBe(expectedQty);
    expect(pos!.entryPrice).toBe(97.4);
    expect(pos!.hardStop).toBeCloseTo(97.4 - atr, 10);
    expect(pos!.trailStop).toBeNull(); // mean reversion has no trailing stop
    expect(broker.orders).toEqual([{ symbol: "SPY", side: "buy", qty: expectedQty }]);

    // Same bar again: the engine must not act twice.
    await engine.runTick(now);
    expect(broker.orders).toHaveLength(1);
    expect(store.trades).toHaveLength(0);
  });

  it("closes a position when the hard stop is breached and logs the trade", async () => {
    const pos = openPosition({ hardStop: 95.4, qty: 100 });
    await seed(store, broker, pos);
    broker.prices.set("SPY", 95.0); // below the hard stop
    broker.bars.set("SPY", []);

    await engine.runTick(now);

    expect(store.positions.has("SPY")).toBe(false);
    expect(broker.orders).toEqual([{ symbol: "SPY", side: "sell", qty: 100 }]);
    expect(store.trades).toHaveLength(1);
    const trade = store.trades[0];
    expect(trade.exitReason).toBe("hard_stop");
    expect(trade.pnl).toBeCloseTo((95.0 - 97.4) * 100, 10);
  });

  it("exits a mean-reversion long once price returns to the moving average", async () => {
    await seed(store, broker, openPosition({ qty: 50 }));
    broker.prices.set("SPY", 100.5);
    broker.bars.set(
      "SPY",
      makeCandles({ closes: meanRevCloses(100.5), timeframeMinutes: 15, now }),
    );

    await engine.runTick(now);

    expect(store.positions.has("SPY")).toBe(false);
    expect(store.trades).toHaveLength(1);
    expect(store.trades[0].exitReason).toBe("signal");
  });

  it("blocks a BTC long when SPY and QQQ are both long (correlation filter)", async () => {
    await store.upsertPosition(openPosition({ symbol: "SPY" }));
    await store.upsertPosition(openPosition({ symbol: "QQQ", entryPrice: 500, hardStop: 490, watermark: 500 }));
    broker.prices.set("SPY", 100);
    broker.prices.set("QQQ", 505);
    broker.bars.set("BTC/USD", breakoutCandles(111, 2000));

    const report = await engine.runTick(now);

    expect(broker.orders).toHaveLength(0);
    expect(store.positions.has("BTC/USD")).toBe(false);
    expect(report.actions.join(" ")).toContain("correlation filter");
  });

  it("flattens instead of shorting BTC on a confirmed breakdown", async () => {
    await seed(
      store,
      broker,
      openPosition({
        symbol: "BTC/USD",
        strategy: "momentum_breakout",
        qty: 0.01,
        entryPrice: 100,
        hardStop: 85,
        trailStop: 86,
        trailAtrMult: 2,
        watermark: 100,
      }),
    );
    broker.prices.set("BTC/USD", 89.5); // above stored stops, below the range low
    broker.bars.set("BTC/USD", breakoutCandles(89, 2000));

    await engine.runTick(now);

    expect(store.positions.has("BTC/USD")).toBe(false);
    expect(broker.orders).toEqual([{ symbol: "BTC/USD", side: "sell", qty: 0.01 }]);
    // Long-only instrument: the short signal must not open a short.
    expect(store.trades).toHaveLength(1);
  });

  it("skips equities when the market is closed but still trades crypto", async () => {
    broker.marketOpen = false;
    broker.bars.set("SPY", makeCandles({ closes: meanRevCloses(97.5), timeframeMinutes: 15, now }));
    broker.bars.set("BTC/USD", breakoutCandles(111, 2000));
    broker.prices.set("BTC/USD", 111);

    await engine.runTick(now);

    expect(broker.orders).toHaveLength(1);
    expect(broker.orders[0].symbol).toBe("BTC/USD");
    expect(broker.orders[0].side).toBe("buy");
    expect(store.positions.has("SPY")).toBe(false);
    const btc = store.positions.get("BTC/USD");
    expect(btc).toBeDefined();
    expect(Number.isInteger(btc!.qty)).toBe(false); // fractional crypto sizing
    expect(btc!.trailAtrMult).toBe(2);
    expect(btc!.trailStop).not.toBeNull();
  });

  it("holds a pending order instead of writing the position until the fill is confirmed", async () => {
    const candles = makeCandles({ closes: meanRevCloses(97.5), timeframeMinutes: 15, now });
    broker.bars.set("SPY", candles);
    broker.noImmediateFill.add("SPY"); // order accepted but not yet confirmed filled

    const report = await engine.runTick(now);
    expect(report.errors).toEqual([]);
    expect(store.positions.has("SPY")).toBe(false); // not written yet
    expect(store.pendingOrders.size).toBe(1);
    const pending = [...store.pendingOrders.values()][0];
    expect(pending.symbol).toBe("SPY");
    expect(pending.purpose).toBe("open");
    expect(pending.brokerOrderId).not.toBeNull();
    expect(broker.orders).toHaveLength(1);

    // Same bar, order still unresolved: must not submit a second order.
    await engine.runTick(now);
    expect(broker.orders).toHaveLength(1);
    expect(store.pendingOrders.size).toBe(1);

    // Broker confirms the fill on a later tick.
    await broker.resolveOrder(pending.brokerOrderId!, 97.6, pending.qty);
    broker.prices.set("SPY", 97.6); // needed for this tick's own stop-check on the newly opened position
    const report2 = await engine.runTick(now);
    expect(report2.errors).toEqual([]);
    expect(store.pendingOrders.size).toBe(0);
    const pos = store.positions.get("SPY");
    expect(pos).toBeDefined();
    expect(pos!.entryPrice).toBe(97.6);
    expect(pos!.qty).toBe(pending.qty);
  });

  it("does not resubmit a close order while one is pending, and finalizes the trade once confirmed", async () => {
    await seed(store, broker, openPosition({ hardStop: 95.4, qty: 100 }));
    broker.prices.set("SPY", 95.0); // below the hard stop
    broker.bars.set("SPY", []);
    broker.noImmediateFill.add("SPY");

    const report = await engine.runTick(now);
    expect(report.errors).toEqual([]);
    expect(store.positions.has("SPY")).toBe(true); // close not confirmed yet
    expect(store.pendingOrders.size).toBe(1);
    const pending = [...store.pendingOrders.values()][0];
    expect(pending.purpose).toBe("close");
    expect(broker.orders).toHaveLength(1);

    // Stop is still breached, but a close is already in flight: must not resubmit.
    await engine.runTick(now);
    expect(broker.orders).toHaveLength(1);
    expect(store.positions.has("SPY")).toBe(true);

    broker.noImmediateFill.delete("SPY");
    await broker.resolveOrder(pending.brokerOrderId!, 95.0, 100);
    await engine.runTick(now);
    expect(store.positions.has("SPY")).toBe(false);
    expect(store.pendingOrders.size).toBe(0);
    expect(store.trades).toHaveLength(1);
    expect(store.trades[0].exitReason).toBe("hard_stop");
  });

  it("cleans up the pending order record when the broker rejects the order outright", async () => {
    const candles = makeCandles({ closes: meanRevCloses(97.5), timeframeMinutes: 15, now });
    broker.bars.set("SPY", candles);
    broker.prices.set("SPY", 97.4);
    broker.failSymbols.add("SPY");

    const report = await engine.runTick(now);
    expect(report.errors.join(" ")).toContain("insufficient balance");
    expect(store.positions.has("SPY")).toBe(false);
    expect(store.pendingOrders.size).toBe(0);
    expect(broker.orders).toHaveLength(0);
  });

  it("adopts a broker position the DB has no record of, protecting it with a stop the same tick", async () => {
    // Broker already holds a position the DB has never recorded (e.g. a
    // manual trade, or one opened before this reconciliation logic existed).
    // Reported as "BTCUSD" — Alpaca's positions endpoints identify crypto
    // without the slash even though orders/bars use "BTC/USD" — must still
    // match against the configured instrument and adopt under our own
    // canonical symbol.
    broker.brokerPositions.set("BTCUSD", { symbol: "BTCUSD", side: "long", qty: 0.01, avgEntryPrice: 100 });
    broker.bars.set("BTC/USD", breakoutCandles(105, 1000)); // enough bars for ATR; volume too low to also trigger a signal
    broker.prices.set("BTC/USD", 105);

    const report = await engine.runTick(now);

    expect(report.errors.join(" ")).toContain("RECONCILE mismatch");
    expect(report.actions.join(" ")).toContain("adopted untracked");
    const pos = store.positions.get("BTC/USD");
    expect(pos).toBeDefined();
    expect(pos!.direction).toBe("long");
    expect(pos!.qty).toBe(0.01);
    expect(pos!.entryPrice).toBe(100); // the broker's real avg entry price, not the current price
    expect(pos!.hardStop).toBeLessThan(100);
    expect(broker.orders).toHaveLength(0); // adoption itself never places an order
  });

  it("does not re-adopt a position already tracked under its canonical symbol", async () => {
    await store.upsertPosition(
      openPosition({
        symbol: "BTC/USD",
        strategy: "momentum_breakout",
        qty: 0.01,
        entryPrice: 100,
        hardStop: 85,
        trailStop: 86,
        trailAtrMult: 2,
        watermark: 100,
      }),
    );
    // Broker reports it back without the slash, as Alpaca does — must still
    // be recognized as already tracked, not re-adopted every tick (which
    // would reset its entry price and stop each time).
    broker.brokerPositions.set("BTCUSD", { symbol: "BTCUSD", side: "long", qty: 0.01, avgEntryPrice: 100 });
    broker.prices.set("BTC/USD", 100);
    broker.bars.set("BTC/USD", []);

    const report = await engine.runTick(now);

    expect(report.actions.join(" ")).not.toContain("adopted untracked");
    expect(report.errors.join(" ")).not.toContain("RECONCILE mismatch");
    expect(store.positions.get("BTC/USD")!.entryPrice).toBe(100);
  });

  it("closes using the broker's actual quantity when it differs from the DB's recorded quantity", async () => {
    await seed(store, broker, openPosition({ hardStop: 95.4, qty: 100 }));
    // Simulate the kind of rounding drift a real fill can leave behind.
    broker.brokerPositions.set("SPY", { symbol: "SPY", side: "long", qty: 99.5, avgEntryPrice: 97.4 });
    broker.prices.set("SPY", 95.0); // below the hard stop
    broker.bars.set("SPY", []);

    const report = await engine.runTick(now);
    expect(report.actions.join(" ")).toContain("qty mismatch");
    expect(broker.orders).toEqual([{ symbol: "SPY", side: "sell", qty: 99.5 }]);
    expect(store.trades).toHaveLength(1);
    expect(store.trades[0].qty).toBe(99.5);
  });

  it("drops a stale DB position instead of submitting a close when the broker already shows it flat", async () => {
    await store.upsertPosition(openPosition({ hardStop: 95.4, qty: 100 }));
    // Deliberately leave broker.brokerPositions empty for "SPY" — the DB
    // thinks there's a position, but the broker (the source of truth)
    // doesn't; this is the state a desync eventually reaches.
    broker.prices.set("SPY", 95.0); // below the hard stop
    broker.bars.set("SPY", []);

    const report = await engine.runTick(now);
    expect(report.errors.join(" ")).toContain("RECONCILE mismatch");
    expect(broker.orders).toHaveLength(0);
    expect(store.positions.has("SPY")).toBe(false);
    expect(store.trades).toHaveLength(0);
  });

  it("records an equity snapshot and daily P&L every tick", async () => {
    await engine.runTick(now);
    expect(store.equitySnapshots).toHaveLength(1);
    expect(store.equitySnapshots[0].equity).toBe(100_000);
    expect(store.dailyPnl.get(tradingDate(now))).toEqual({ start: 100_000, end: 100_000 });
    expect(store.state.lastHeartbeat).toBe(now.toISOString());
  });
});

describe("completedCandles", () => {
  it("drops the still-forming bar", () => {
    const candles = makeCandles({ closes: [1, 2, 3], timeframeMinutes: 15, now });
    // Shift the last bar to start 5 minutes ago — incomplete.
    candles[2] = { ...candles[2], time: new Date(now.getTime() - 5 * 60_000).toISOString() };
    const completed = completedCandles(candles, 15, now);
    expect(completed).toHaveLength(2);
  });
});

describe("tradingDate", () => {
  it("buckets by the New York calendar day", () => {
    // 01:00 UTC on July 21 is still July 20 in New York (UTC-4).
    expect(tradingDate(new Date("2026-07-21T01:00:00Z"))).toBe("2026-07-20");
    expect(tradingDate(new Date("2026-07-21T12:00:00Z"))).toBe("2026-07-21");
  });
});
