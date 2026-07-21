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
    await store.upsertPosition(pos);
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
    await store.upsertPosition(openPosition({ qty: 50 }));
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
