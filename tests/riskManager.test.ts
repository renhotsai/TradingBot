import { describe, expect, it } from "vitest";
import {
  checkStops,
  computeAtr,
  correlationBlocked,
  hardStopPrice,
  positionSize,
  updateTrailingStop,
} from "@/bot/riskManager";
import type { Position } from "@/bot/store";
import type { Candle } from "@/bot/strategies/types";

function flatBars(count: number, range: number): Candle[] {
  // Every bar: high - low = range, no gaps between closes → TR = range.
  return Array.from({ length: count }, (_, i) => ({
    time: new Date(2026, 0, 1, i).toISOString(),
    open: 100,
    high: 100 + range / 2,
    low: 100 - range / 2,
    close: 100,
    volume: 1000,
  }));
}

function position(overrides: Partial<Position>): Position {
  return {
    symbol: "SPY",
    strategy: "mean_reversion",
    direction: "long",
    qty: 100,
    entryPrice: 100,
    entryTime: "2026-07-20T14:00:00Z",
    atrAtEntry: 2,
    hardStop: 98,
    watermark: 100,
    trailStop: null,
    trailAtrMult: null,
    lastPrice: null,
    ...overrides,
  };
}

describe("ATR", () => {
  it("computes a constant true range exactly", () => {
    expect(computeAtr(flatBars(20, 4), 14)).toBeCloseTo(4, 10);
  });

  it("returns null with insufficient data", () => {
    expect(computeAtr(flatBars(10, 4), 14)).toBeNull();
  });
});

describe("position sizing", () => {
  const base = { equity: 100_000, buyingPower: 1_000_000, price: 100, isCrypto: false };

  it("sizes so a 1-ATR move equals 1% of equity", () => {
    const qty = positionSize({ ...base, atr: 5 });
    expect(qty).toBe(200); // 1000 risk / 5 ATR
    expect(qty * 5).toBeCloseTo(100_000 * 0.01);
  });

  it("gives a volatile instrument a smaller position than a quiet one", () => {
    const quiet = positionSize({ ...base, atr: 2 });
    const volatile = positionSize({ ...base, atr: 10 });
    expect(quiet).toBe(500);
    expect(volatile).toBe(100);
    expect(quiet).toBeGreaterThan(volatile);
  });

  it("floors equities to whole shares", () => {
    expect(positionSize({ ...base, atr: 3 })).toBe(333);
  });

  it("allows fractional quantities for crypto", () => {
    const qty = positionSize({
      equity: 100_000,
      buyingPower: 1_000_000,
      atr: 1600,
      price: 117_000,
      isCrypto: true,
    });
    expect(qty).toBeCloseTo(0.625, 6);
  });

  it("caps size at available buying power", () => {
    const qty = positionSize({ ...base, buyingPower: 10_000, atr: 5 });
    expect(qty).toBe(100); // 10k BP / $100 price, well below the 200 risk-based qty
  });

  it("returns 0 when the risk-based size rounds below one share", () => {
    expect(positionSize({ equity: 1000, buyingPower: 1000, atr: 20, price: 600, isCrypto: false })).toBe(0);
  });
});

describe("stops", () => {
  it("places the hard stop 1 ATR from entry on both sides", () => {
    expect(hardStopPrice(100, "long", 2)).toBe(98);
    expect(hardStopPrice(100, "short", 2)).toBe(102);
  });

  it("a 1-ATR adverse move loses exactly 1% of equity", () => {
    const equity = 50_000;
    const atr = 4;
    const qty = positionSize({ equity, buyingPower: 10_000_000, atr, price: 200, isCrypto: true });
    const stop = hardStopPrice(200, "long", atr);
    expect((200 - stop) * qty).toBeCloseTo(equity * 0.01, 6);
  });

  it("ratchets the trailing stop with new highs but never widens it", () => {
    const p = position({ trailAtrMult: 2, trailStop: 96, watermark: 100 });
    const up = updateTrailingStop(p, 110);
    expect(up.changed).toBe(true);
    expect(up.position.watermark).toBe(110);
    expect(up.position.trailStop).toBe(110 - 2 * 2);

    const down = updateTrailingStop(up.position, 105);
    expect(down.changed).toBe(false);
    expect(down.position.trailStop).toBe(106);
  });

  it("trails shorts downward", () => {
    const p = position({
      direction: "short",
      trailAtrMult: 3,
      trailStop: 106,
      watermark: 100,
      hardStop: 102,
    });
    const { position: updated } = updateTrailingStop(p, 90);
    expect(updated.watermark).toBe(90);
    expect(updated.trailStop).toBe(90 + 3 * 2);
  });

  it("detects hard and trailing stop breaches for longs", () => {
    const p = position({ hardStop: 98, trailStop: 99 });
    expect(checkStops(p, 97.9)).toBe("hard_stop");
    expect(checkStops(p, 98.5)).toBe("trail_stop");
    expect(checkStops(p, 99.5)).toBeNull();
  });

  it("detects breaches for shorts", () => {
    const p = position({ direction: "short", hardStop: 102, trailStop: 101 });
    expect(checkStops(p, 102.5)).toBe("hard_stop");
    expect(checkStops(p, 101.5)).toBe("trail_stop");
    expect(checkStops(p, 100.5)).toBeNull();
  });
});

describe("correlation filter", () => {
  const spyLong = position({ symbol: "SPY", direction: "long" });
  const qqqLong = position({ symbol: "QQQ", direction: "long" });
  const qqqShort = position({ symbol: "QQQ", direction: "short" });

  it("blocks new BTC longs when SPY and QQQ are both long", () => {
    expect(correlationBlocked("BTC/USD", "long", [spyLong, qqqLong])).toBe(true);
  });

  it("allows BTC longs when only one of SPY/QQQ is long", () => {
    expect(correlationBlocked("BTC/USD", "long", [spyLong])).toBe(false);
    expect(correlationBlocked("BTC/USD", "long", [spyLong, qqqShort])).toBe(false);
  });

  it("never blocks other instruments or directions", () => {
    expect(correlationBlocked("GLD", "long", [spyLong, qqqLong])).toBe(false);
    expect(correlationBlocked("BTC/USD", "short", [spyLong, qqqLong])).toBe(false);
  });
});
