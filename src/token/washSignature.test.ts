import { describe, expect, it } from "vitest";
import { washSignatureFor } from "./audit";
describe("turnover anomaly evidence boundary", () => {
  it.each([
    { vol24: 10000000, liquidityUsd: 100000, pc24: 80, buys: 15, sells: 15 },
    { vol24: 300000, liquidityUsd: 15000, pc24: 2, buys: 80, sells: 75 },
    { vol24: 4000000, liquidityUsd: 0, pc24: 300, buys: 1200, sells: 900 },
  ])("retains an anomaly without claiming manufactured activity: %j", market => {
    const result = washSignatureFor(market);
    expect(result).toMatchObject({ wash: false, anomaly: true });
    expect(result.claim).toContain("do not establish coordinated trading");
    expect(result.claim).not.toMatch(/fabricated|manufactured|traded against itself/);
  });
  it("distinguishes unavailable liquidity from measured zero", () => {
    const missing = washSignatureFor({ vol24: 20000, liquidityUsd: NaN, pc24: null, buys: 10, sells: 10 });
    expect(missing.claim).toContain("liquidity unavailable");
    const zero = washSignatureFor({ vol24: 20000, liquidityUsd: 0, pc24: null, buys: 10, sells: 10 });
    expect(zero.claim).toContain("$0 current pool liquidity");
    expect(zero.claim).toContain("not measurable");
  });
  it("does not treat an ordinary turnover as anomalous", () => {
    expect(washSignatureFor({ vol24: 10000, liquidityUsd: 10000, pc24: 2, buys: 100, sells: 100 })).toMatchObject({ wash: false, anomaly: false, ratio: 1 });
  });
});
