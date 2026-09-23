import { describe, expect, it } from "vitest";

import { washSignatureFor } from "./audit";
import { plainScoreRationale } from "../lib/verdictNarrative";

// The volume-to-liquidity guard, calibrated on the Robinhood Chain ring of
// 2026-09-22 (docs/launchpads/README.md §2.3) and on the healthy tokens the
// same sweep produced. Numbers are the sweep's, read 2026-09-23.

describe("washSignatureFor", () => {
  it("catches volume on no liquidity, which the old ratio read as clean", () => {
    // Fake BTC: $4.08M volume, $0 liquidity, price moved.
    const r = washSignatureFor({ vol24: 4_081_072, liquidityUsd: 0, pc24: 312, buys: 1_200, sells: 900 });
    expect(r.wash).toBe(true);
    expect(r.ratio).toBe(Number.POSITIVE_INFINITY);
    expect(r.claim).toMatch(/fabricated or the pool was drained/);
  });

  it("catches a pool cycled a hundred times its depth even when the price moved", () => {
    // PGREM: $23.17M on $170,098, 136x, price up.
    const r = washSignatureFor({ vol24: 23_171_191, liquidityUsd: 170_098, pc24: 180, buys: 4_000, sells: 3_900 });
    expect(r.wash).toBe(true);
    expect(Math.round(r.ratio)).toBe(136);
    expect(r.rationale).toMatch(/cycled-volume signature/);
    // musebook clone: 5,407x on $2,806.
    expect(washSignatureFor({ vol24: 15_173_998, liquidityUsd: 2_806, pc24: -40, buys: 900, sells: 950 }).wash).toBe(true);
  });

  it("keeps the flat-price signature for moderate churn", () => {
    const r = washSignatureFor({ vol24: 300_000, liquidityUsd: 15_000, pc24: 2.1, buys: 80, sells: 75 });
    expect(r.wash).toBe(true);
    expect(r.rationale).toMatch(/price flat/);
  });

  it("does not flag a thin meme token with real turnover and a moving price", () => {
    // A 20x day with the price actually moving is normal for a thin launch.
    const r = washSignatureFor({ vol24: 300_000, liquidityUsd: 15_000, pc24: 85, buys: 80, sells: 75 });
    expect(r.wash).toBe(false);
    expect(r.ratio).toBeCloseTo(20, 1);
  });

  it("does not flag the healthy tokens from the same sweep", () => {
    // PONS main pool: $71.9M on $8.8M (8.2x). MEME: $3.9M on $2.2M (1.8x).
    expect(washSignatureFor({ vol24: 71_937_405, liquidityUsd: 8_811_081, pc24: 10.3, buys: 58_585, sells: 53_563 }).wash).toBe(false);
    expect(washSignatureFor({ vol24: 3_921_995, liquidityUsd: 2_220_000, pc24: -3.3, buys: 7_109, sells: 5_325 }).wash).toBe(false);
    // SPIKE on Base: $4.88M on $242K (20x) with the price up 40,978%: violent, but not a cycled pool.
    expect(washSignatureFor({ vol24: 4_879_059, liquidityUsd: 242_463, pc24: 40_978, buys: 8_728, sells: 6_733 }).wash).toBe(false);
  });

  it("does not flag a dead pool with no volume, and never divides to a fake zero", () => {
    expect(washSignatureFor({ vol24: 0, liquidityUsd: 0, pc24: null, buys: 0, sells: 0 })).toMatchObject({ wash: false, ratio: 0 });
    expect(washSignatureFor({ vol24: 2_500, liquidityUsd: 0, pc24: null, buys: 3, sells: 2 }).wash).toBe(false);
  });

  it("needs a few transactions before calling a ratio manufactured", () => {
    expect(washSignatureFor({ vol24: 1_000_000, liquidityUsd: 5_000, pc24: 50, buys: 3, sells: 2 }).wash).toBe(false);
  });
});

describe("the narrative explains each signature in plain words", () => {
  it("cycled volume", () => {
    const r = washSignatureFor({ vol24: 23_171_191, liquidityUsd: 170_098, pc24: 180, buys: 4_000, sells: 3_900 });
    expect(plainScoreRationale(r.rationale)).toMatch(/136 times the pool size in a day.*traded against itself/);
  });
  it("volume without a pool", () => {
    const r = washSignatureFor({ vol24: 4_081_072, liquidityUsd: 0, pc24: 312, buys: 1_200, sells: 900 });
    expect(plainScoreRationale(r.rationale)).toMatch(/No pool that shallow can host that trading/);
  });
});
