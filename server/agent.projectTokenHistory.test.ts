// The frozen candle window now carries the reported intra-period range, a
// volume trend, and whether the window has holes. The analyst packet's history
// allowlist predates all three, so the analyst sees only closes: it cannot tell
// a token that ran 40x inside a day and gave it back from one that never moved,
// and it cannot see a market that stopped trading.
//
// The volume trend has to arrive WITH its window widths. A percentage change
// with no named span is exactly the assertion this work exists to prevent, so
// the test pins the widths, not just the percentage.
import { describe, expect, it } from "vitest";
import { buildAnalystEvidencePacket } from "./agent";

const projectToken = {
  symbol: "ARG",
  chain: "ethereum",
  address: "0xabc",
  history: {
    points: [1, 2, 3, 4],
    first: 1,
    last: 4,
    peak: 4,
    changePct: 300,
    drawdownPct: 0,
    range: {
      high: 90,
      low: 0.5,
      drawdownFromHighPct: -95.6,
      measuredPoints: 4,
      highs: [2, 4, 90, 9],
      lows: [0.5, 1, 2, 3],
    },
    volume: {
      recent: { usd: 1_000, candles: 7, measured: 7 },
      prior: { usd: 40_000, candles: 7, measured: 5 },
      changePct: -97.5,
      isFloor: true,
    },
    spanPeriods: 6,
    windowIsPartial: true,
    timeframe: "day",
    poolAddress: "0xpool",
  },
};

describe("the analyst packet carries the whole candle window", () => {
  const packet = () => JSON.parse(buildAnalystEvidencePacket({ projectToken }));
  const history = () => packet().projectToken.history as Record<string, unknown>;

  it("passes the reported range scalars", () => {
    const range = history().range as Record<string, unknown>;
    expect(range.high).toBe(90);
    expect(range.low).toBe(0.5);
    expect(range.drawdownFromHighPct).toBe(-95.6);
    expect(range.measuredPoints).toBe(4);
  });

  it("drops the per-candle arrays, which belong in the UI and not the prompt", () => {
    const range = history().range as Record<string, unknown>;
    expect(range.highs).toBeUndefined();
    expect(range.lows).toBeUndefined();
  });

  it("passes the volume trend WITH both window widths", () => {
    const volume = history().volume as Record<string, Record<string, unknown>>;
    expect(volume.changePct).toBe(-97.5);
    expect(volume.isFloor).toBe(true);
    expect(volume.recent.candles).toBe(7);
    expect(volume.prior.candles).toBe(7);
    // A window that under-reported volume is a floor, and the analyst has to
    // be able to see which side under-reported it.
    expect(volume.prior.measured).toBe(5);
  });

  it("passes the window coverage, so a gapped series cannot read as a full one", () => {
    expect(history().spanPeriods).toBe(6);
    expect(history().windowIsPartial).toBe(true);
  });
});
