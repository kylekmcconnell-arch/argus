import { describe, expect, it } from "vitest";
import { analyzeMarketStructure } from "./marketstructure";
import type { Candle } from "../lib/priceHistory";

const DAY = 86400;
let t0 = 1_700_000_000;
const mk = (o: number, h: number, l: number, c: number, v: number): Candle => ({ t: (t0 += DAY), o, h, l, c, v });

// Accumulation base -> markup -> distribution top: the classic cycle the
// classifier must recover from raw candles.
function cycle(): Candle[] {
  const ks: Candle[] = [];
  // base near $1: heavy volume, closes pinned to the highs (buyers absorbing)
  for (let i = 0; i < 30; i++) ks.push(mk(0.96, 1.05, 0.95, 1.04, 100));
  // markup to $2 on thin volume
  for (let i = 0; i < 10; i++) {
    const p = 1.05 + (i + 1) * 0.09;
    ks.push(mk(p - 0.04, p + 0.01, p - 0.05, p, 20));
  }
  // top near $2: heavier volume still, closes pinned to the lows (sellers unloading)
  for (let i = 0; i < 30; i++) ks.push(mk(2.04, 2.05, 1.95, 1.96, 150));
  return ks;
}

describe("analyzeMarketStructure", () => {
  it("returns null on thin, flat, or volumeless data", () => {
    expect(analyzeMarketStructure([])).toBeNull();
    expect(analyzeMarketStructure(Array.from({ length: 8 }, () => mk(1, 1.1, 0.9, 1, 50)))).toBeNull();
    // flat price: no span to bin
    expect(analyzeMarketStructure(Array.from({ length: 20 }, () => mk(1, 1, 1, 1, 50)))).toBeNull();
    // no volume anywhere
    expect(analyzeMarketStructure(Array.from({ length: 20 }, (_, i) => mk(1 + i * 0.01, 1.02 + i * 0.01, 0.99 + i * 0.01, 1.01 + i * 0.01, 0)))).toBeNull();
  });

  it("finds the accumulation base and the distribution top", () => {
    const ms = analyzeMarketStructure(cycle())!;
    expect(ms).not.toBeNull();
    expect(ms.ranges.length).toBeGreaterThanOrEqual(2);

    const base = ms.ranges[0];
    const top = ms.ranges[ms.ranges.length - 1];
    // the base band sits around $1 and reads as accumulation
    expect(base.low).toBeLessThan(1.05);
    expect(base.kind).toBe("accumulation");
    expect(base.flowRatio).toBeGreaterThan(0.5);
    // the top band sits around $2 and reads as distribution
    expect(top.high).toBeGreaterThan(1.9);
    expect(top.kind).toBe("distribution");
    expect(top.flowRatio).toBeLessThan(-0.5);
    // price finished in the top band
    expect(top.active).toBe(true);
    expect(base.active).toBe(false);
    // both bands carry a real share of volume and time
    expect(base.volumeShare).toBeGreaterThan(0.2);
    expect(top.volumeShare).toBeGreaterThan(0.2);
    expect(base.timeShare).toBeGreaterThan(0.3);
  });

  it("profile conserves volume and concentration lands where trade happened", () => {
    const ks = cycle();
    const ms = analyzeMarketStructure(ks)!;
    const total = ks.reduce((s, k) => s + k.v, 0);
    const binned = ms.bins.reduce((s, b) => s + b.volume, 0);
    expect(binned).toBeCloseTo(total, 3);
    // heaviest volume was at the top range
    expect(ms.pocPrice).toBeGreaterThan(1.9);
    expect(ms.pocPrice).toBeLessThan(2.06);
    expect(ms.valueArea.low).toBeLessThan(ms.valueArea.high);
    // support below the last close, resistance above it
    expect(ms.support).not.toBeNull();
    expect(ms.support!).toBeLessThan(ms.lastClose);
    expect(ms.resistance).not.toBeNull();
    expect(ms.resistance!).toBeGreaterThan(ms.lastClose);
  });

  it("fib levels follow the swing direction", () => {
    const up = analyzeMarketStructure(cycle())!;
    expect(up.fib.direction).toBe("up");
    expect(up.fib.swingLow).toBeCloseTo(0.95, 6);
    expect(up.fib.swingHigh).toBeCloseTo(2.05, 6);
    const half = up.fib.levels.find((l) => l.ratio === 0.5)!;
    expect(half.price).toBeCloseTo(2.05 - (2.05 - 0.95) * 0.5, 6);

    // mirror: high first, then the low -> down-leg retracement measured off the low
    const down = analyzeMarketStructure(cycle().reverse().map((k, i) => ({ ...k, t: 1_700_000_000 + i * DAY })))!;
    expect(down.fib.direction).toBe("down");
    const half2 = down.fib.levels.find((l) => l.ratio === 0.5)!;
    expect(half2.price).toBeCloseTo(0.95 + (2.05 - 0.95) * 0.5, 6);
  });

  it("volume trend: rising when the tail outpaces the prior window, with up/down split", () => {
    const ms = analyzeMarketStructure(cycle())!;
    // tail = distribution candles at v=150 vs mixed 100/20 before
    expect(ms.volume.direction).toBe("rising");
    expect(ms.volume.changePct).toBeGreaterThan(25);
    // every recent candle closed below its open: all recent volume on down bars
    expect(ms.volume.recentUpShare).toBe(0);

    // dying tape: same shape but the tail volume collapses
    const dying = cycle().map((k, i, arr) => (i >= arr.length - 14 ? { ...k, v: 5 } : k));
    const ms2 = analyzeMarketStructure(dying)!;
    expect(ms2.volume.direction).toBe("falling");
    expect(ms2.volume.changePct).toBeLessThan(-25);
  });

  it("mid-range closes with balanced flow read as consolidation", () => {
    const ks: Candle[] = [];
    for (let i = 0; i < 40; i++) ks.push(mk(1.0, 1.1, 0.9, 1.0, 100)); // closes dead-center
    for (let i = 0; i < 5; i++) ks.push(mk(1.0, 1.3, 1.0, 1.25, 10)); // small spike widens the window
    const ms = analyzeMarketStructure(ks)!;
    const band = ms.ranges.find((r) => r.low <= 1.0 && r.high >= 1.0)!;
    expect(band).toBeDefined();
    expect(band.kind).toBe("consolidation");
    expect(Math.abs(band.flowRatio)).toBeLessThan(0.12);
  });

  it("flags fib confluence when a level lands inside a range", () => {
    // one heavy band positioned right at the 0.5 retracement of the window
    const ks: Candle[] = [];
    ks.push(mk(1.0, 1.0, 0.0, 0.5, 1)); // pins swing low 0, part of window
    ks.push(mk(1.0, 2.0, 1.0, 1.9, 1)); // pins swing high 2
    for (let i = 0; i < 30; i++) ks.push(mk(0.98, 1.05, 0.95, 1.02, 100)); // band at ~1.0 = 0.5 fib of 0..2
    const ms = analyzeMarketStructure(ks)!;
    const band = ms.ranges.find((r) => r.low <= 1.0 && r.high >= 1.0)!;
    expect(band).toBeDefined();
    expect(band.fibHits).toContain(0.5);
  });
});
