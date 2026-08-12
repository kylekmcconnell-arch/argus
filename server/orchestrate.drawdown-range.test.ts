// The drawdown finding gates on the CLOSE-based figure, which is precisely
// blind to the shape it exists to catch: a token that ran inside a single
// candle and gave it all back closes flat, so a 97% collapse from the reported
// intraday high scores a 0% drawdown and no finding is recorded at all.
//
// The claim must also say WHICH peak it measured. "Peak-to-latest" over a
// captured 90-candle window is not an all-time high, and the high-based figure
// is the highest price one source reported inside one period.
import { describe, expect, it } from "vitest";
import { emptyEvidence, type CollectedEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import { recordProjectTokenDrawdownFinding } from "./orchestrate";

const SOURCE = "https://api.geckoterminal.com/api/v2/networks/eth/pools/p/ohlcv/day?aggregate=1&limit=90&currency=usd";

function evidenceWith(history: Record<string, unknown>): CollectedEvidence {
  const evidence = emptyEvidence("@project");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    name: "Pump",
    symbol: "PUMP",
    address: "0xabc",
    chain: "ethereum",
    sourceUrl: "https://dexscreener.com/ethereum/0xabc",
    capturedAt: "2026-08-01T00:00:00.000Z",
    providers: ["dexscreener"],
    history: { timeframe: "day", poolAddress: "p", sourceUrl: SOURCE, ...history },
  } as CollectedEvidence["projectToken"];
  return evidence;
}

describe("the drawdown finding reads the reported candle range", () => {
  it("catches a one-day pump and dump that closed flat", () => {
    const evidence = evidenceWith({
      points: [1, 1, 1],
      first: 1,
      last: 1,
      peak: 1,
      changePct: 0,
      drawdownPct: 0,
      range: { high: 40, low: 0.9, drawdownFromHighPct: -97.5, measuredPoints: 3 },
    });

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(true);
    expect(evidence.findings[0].claim).toContain("97.5%");
    // Never "peak": the figure is one source's reading inside one candle.
    expect(evidence.findings[0].claim).toContain("highest price");
    expect(evidence.findings[0].claim).not.toContain("all-time");
  });

  it("takes the more severe of the two readings and names which one it measured", () => {
    const evidence = evidenceWith({
      points: [10, 1],
      first: 10,
      last: 1,
      peak: 10,
      changePct: -90,
      drawdownPct: -90,
      range: { high: 11, low: 0.9, drawdownFromHighPct: -90.9, measuredPoints: 2 },
    });

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(true);
    expect(evidence.findings[0].claim).toContain("90.9%");
  });

  it("still fires on closes alone when the source reported no range", () => {
    const evidence = evidenceWith({
      points: [1, 0.2],
      first: 1,
      last: 0.2,
      peak: 1,
      changePct: -80,
      drawdownPct: -80,
    });

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(true);
    expect(evidence.findings[0].claim).toContain("highest close");
  });

  it("qualifies a claim made over a window with holes in it", () => {
    const evidence = evidenceWith({
      points: [1, 0.2],
      first: 1,
      last: 0.2,
      peak: 1,
      changePct: -80,
      drawdownPct: -80,
      spanPeriods: 30,
      windowIsPartial: true,
    });

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(true);
    expect(evidence.findings[0].claim).toContain("2 of 30");
  });

  it("does not fire when neither reading is severe", () => {
    const evidence = evidenceWith({
      points: [1, 0.8],
      first: 1,
      last: 0.8,
      peak: 1,
      changePct: -20,
      drawdownPct: -20,
      range: { high: 1.2, low: 0.7, drawdownFromHighPct: -33.3, measuredPoints: 2 },
    });

    expect(recordProjectTokenDrawdownFinding(evidence)).toBe(false);
    expect(evidence.findings).toHaveLength(0);
  });
});
