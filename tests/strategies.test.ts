import { describe, expect, it } from "vitest";
import { meanReversionSignal, sma, stdDev } from "@/bot/strategies/meanReversion";
import { momentumBreakoutSignal } from "@/bot/strategies/momentumBreakout";
import { emaSeries, trendFollowingSignal } from "@/bot/strategies/trendFollowing";
import { makeCandles } from "./helpers";

const now = new Date("2026-07-20T18:00:00Z");
const SPY_PARAMS = { period: 20, zThreshold: 1.5 };
const QQQ_PARAMS = { period: 20, zThreshold: 1.8 };
const BREAKOUT_PARAMS = { period: 20, volumeMult: 1.5, trailAtrMult: 2 };
const TREND_PARAMS = { emaFast: 50, emaSlow: 200, trailAtrMult: 3 };

/** 19 alternating closes around 100 plus a final close of choice. */
function meanRevCandles(finalClose: number) {
  const closes = [
    ...Array.from({ length: 19 }, (_, i) => (i % 2 === 0 ? 101 : 99)),
    finalClose,
  ];
  return { closes, candles: makeCandles({ closes, timeframeMinutes: 15, now }) };
}

function zScore(closes: number[]): number {
  const window = closes.slice(-20);
  return (window[window.length - 1] - sma(window)) / stdDev(window);
}

describe("mean reversion", () => {
  it("goes long when z-score is below -1.5 (SPY)", () => {
    const { closes, candles } = meanRevCandles(97.5);
    expect(zScore(closes)).toBeLessThan(-1.8);
    expect(meanReversionSignal(candles, null, SPY_PARAMS)).toBe("long");
    expect(meanReversionSignal(candles, null, QQQ_PARAMS)).toBe("long");
  });

  it("uses the wider 1.8 threshold for QQQ", () => {
    const { closes, candles } = meanRevCandles(98.15);
    const z = zScore(closes);
    expect(z).toBeLessThan(-1.5);
    expect(z).toBeGreaterThan(-1.8);
    expect(meanReversionSignal(candles, null, SPY_PARAMS)).toBe("long");
    expect(meanReversionSignal(candles, null, QQQ_PARAMS)).toBe("none");
  });

  it("goes short when z-score is above the threshold", () => {
    const { closes, candles } = meanRevCandles(102.5);
    expect(zScore(closes)).toBeGreaterThan(1.5);
    expect(meanReversionSignal(candles, null, SPY_PARAMS)).toBe("short");
  });

  it("stays flat inside the band", () => {
    const { candles } = meanRevCandles(100.4);
    expect(meanReversionSignal(candles, null, SPY_PARAMS)).toBe("none");
    expect(meanReversionSignal(candles, null, QQQ_PARAMS)).toBe("none");
  });

  it("exits a long when price returns to the moving average", () => {
    const { candles } = meanRevCandles(100.5);
    expect(meanReversionSignal(candles, "long", SPY_PARAMS)).toBe("exit");
  });

  it("holds a long while price is still below the moving average", () => {
    const { candles } = meanRevCandles(99.0);
    expect(meanReversionSignal(candles, "long", SPY_PARAMS)).toBe("none");
  });

  it("exits a short when price falls back to the moving average", () => {
    const { candles } = meanRevCandles(99.5);
    expect(meanReversionSignal(candles, "short", SPY_PARAMS)).toBe("exit");
  });

  it("returns none with insufficient data", () => {
    const candles = makeCandles({ closes: [100, 101], timeframeMinutes: 15, now });
    expect(meanReversionSignal(candles, null, SPY_PARAMS)).toBe("none");
  });
});

describe("momentum breakout", () => {
  // 20-bar window oscillating between 90 and 110 with avg volume 1000,
  // then a 21st bar that may or may not break out.
  function breakoutCandles(finalClose: number, finalVolume: number) {
    const closes = [
      ...Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? 90.5 : 109.5)),
      finalClose,
    ];
    const volumes = [...Array.from({ length: 20 }, () => 1000), finalVolume];
    return makeCandles({ closes, timeframeMinutes: 60, now, volumes });
  }

  it("goes long on a breakout above the 20-period high with 1.5x volume", () => {
    expect(momentumBreakoutSignal(breakoutCandles(111, 1500), null, BREAKOUT_PARAMS)).toBe("long");
  });

  it("ignores a breakout without volume confirmation", () => {
    expect(momentumBreakoutSignal(breakoutCandles(111, 1499), null, BREAKOUT_PARAMS)).toBe("none");
  });

  it("signals short on a confirmed breakdown below the 20-period low", () => {
    expect(momentumBreakoutSignal(breakoutCandles(89, 2000), null, BREAKOUT_PARAMS)).toBe("short");
  });

  it("does nothing inside the range even on huge volume", () => {
    expect(momentumBreakoutSignal(breakoutCandles(100, 5000), null, BREAKOUT_PARAMS)).toBe("none");
  });

  it("returns none with insufficient data", () => {
    const candles = makeCandles({
      closes: Array.from({ length: 10 }, () => 100),
      timeframeMinutes: 60,
      now,
    });
    expect(momentumBreakoutSignal(candles, null, BREAKOUT_PARAMS)).toBe("none");
  });
});

describe("trend following", () => {
  // Long downtrend followed by a sharp recovery: the 50 EMA starts below the
  // 200 EMA and crosses above it during the recovery.
  function crossingCloses(): number[] {
    const closes: number[] = [];
    for (let i = 0; i < 250; i++) closes.push(300 - i * 0.5);
    for (let i = 0; i < 120; i++) closes.push(175 + i * 1.5);
    return closes;
  }

  function findGoldenCross(closes: number[]): number {
    // First index (in close-space) where the 50 EMA sits above the 200 EMA.
    for (let end = 201; end <= closes.length; end++) {
      const slice = closes.slice(0, end);
      const fast = emaSeries(slice, 50);
      const slow = emaSeries(slice, 200);
      if (fast[fast.length - 1] > slow[slow.length - 1]) return end;
    }
    throw new Error("series never crosses");
  }

  it("goes long exactly on the bar where the 50 EMA crosses above the 200 EMA", () => {
    const closes = crossingCloses();
    const crossEnd = findGoldenCross(closes);

    const atCross = makeCandles({
      closes: closes.slice(0, crossEnd),
      timeframeMinutes: 240,
      now,
    });
    expect(trendFollowingSignal(atCross, null, TREND_PARAMS)).toBe("long");

    const beforeCross = makeCandles({
      closes: closes.slice(0, crossEnd - 1),
      timeframeMinutes: 240,
      now,
    });
    expect(trendFollowingSignal(beforeCross, null, TREND_PARAMS)).toBe("none");
  });

  it("signals short when the 50 EMA crosses below the 200 EMA", () => {
    // Mirror image: uptrend then collapse.
    const closes: number[] = [];
    for (let i = 0; i < 250; i++) closes.push(100 + i * 0.5);
    for (let i = 0; i < 120; i++) closes.push(225 - i * 1.5);

    let crossEnd = -1;
    for (let end = 201; end <= closes.length; end++) {
      const slice = closes.slice(0, end);
      const fast = emaSeries(slice, 50);
      const slow = emaSeries(slice, 200);
      if (fast[fast.length - 1] < slow[slow.length - 1]) {
        crossEnd = end;
        break;
      }
    }
    expect(crossEnd).toBeGreaterThan(0);

    const atCross = makeCandles({
      closes: closes.slice(0, crossEnd),
      timeframeMinutes: 240,
      now,
    });
    expect(trendFollowingSignal(atCross, "long", TREND_PARAMS)).toBe("short");
  });

  it("returns none while the trend persists (no fresh cross)", () => {
    const closes = crossingCloses();
    const candles = makeCandles({ closes, timeframeMinutes: 240, now });
    // Deep into the recovery the cross is long past.
    expect(trendFollowingSignal(candles, "long", TREND_PARAMS)).toBe("none");
  });

  it("returns none with insufficient data", () => {
    const candles = makeCandles({
      closes: Array.from({ length: 150 }, () => 100),
      timeframeMinutes: 240,
      now,
    });
    expect(trendFollowingSignal(candles, null, TREND_PARAMS)).toBe("none");
  });
});
