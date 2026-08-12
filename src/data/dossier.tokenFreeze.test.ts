// assembleDossier is the freeze. Anything it copies shallowly stays a live
// reference into the collector's evidence, so a later mutation rewrites a
// report that was supposed to be immutable. Two structures grew a nested layer
// in this batch: the candle summary (per-candle highs and lows, two volume
// windows) and the holder profile (the GoPlus contract-control flags).
import { describe, expect, it } from "vitest";
import { assembleDossier } from "./dossier";
import { emptyEvidence, type CollectedEvidence } from "./evidence";

function evidenceWithToken(): CollectedEvidence {
  const ev = emptyEvidence("@project");
  ev.projectToken = {
    verified: true,
    verification: "official_x",
    symbol: "ARG",
    name: "Argus",
    rank: null,
    chain: "ethereum",
    address: "0xabc",
    sourceUrl: "https://dexscreener.com/ethereum/0xabc",
    capturedAt: "2026-08-01T00:00:00.000Z",
    history: {
      points: [1, 2, 3, 4],
      first: 1,
      last: 4,
      peak: 4,
      changePct: 300,
      drawdownPct: 0,
      range: {
        high: 9,
        low: 0.5,
        drawdownFromHighPct: -55,
        measuredPoints: 4,
        highs: [2, 4, 6, 9],
        lows: [0.5, 1, 2, 3],
      },
      volume: {
        recent: { usd: 100, candles: 2, measured: 2 },
        prior: { usd: 400, candles: 2, measured: 2 },
        changePct: -75,
        isFloor: false,
      },
      spanPeriods: 6,
      windowIsPartial: true,
      timeframe: "day",
      poolAddress: "0xpool",
    },
  } as CollectedEvidence["projectToken"];
  ev.holderProfile = {
    topHolderPct: 4,
    top10Pct: 7,
    assessedWalletCount: 2,
    top10PctIsFloor: true,
    holderCount: 100,
    lpLockedOrBurnedPct: 85,
    holdersAssessed: true,
    distributionSource: "goplus",
    distributionNote: null,
    contractFlags: [{ key: "mint_authority_active", claim: "Mint authority is live.", tone: "warn", source: "goplus" }],
    creatorPct: null,
    sourceUrl: "https://gopluslabs.io/token-security/1/0xabc",
    capturedAt: "2026-08-01T00:00:00.000Z",
  };
  return ev;
}

describe("the frozen token snapshot shares nothing with live evidence", () => {
  it("clones the candle range and both volume windows", () => {
    const ev = evidenceWithToken();
    const frozen = assembleDossier(ev, false);
    const history = frozen.projectToken?.history;
    const source = ev.projectToken!.history!;
    if (!history?.range || !history.volume) throw new Error("expected a frozen range and volume");

    expect(history.range).not.toBe(source.range);
    expect(history.range.highs).not.toBe(source.range!.highs);
    expect(history.range.lows).not.toBe(source.range!.lows);
    expect(history.volume).not.toBe(source.volume);
    expect(history.volume.recent).not.toBe(source.volume!.recent);
    expect(history.volume.prior).not.toBe(source.volume!.prior);

    source.range!.highs![0] = 999;
    source.volume!.recent.usd = 999;
    expect(history.range.highs?.[0]).toBe(2);
    expect(history.volume.recent.usd).toBe(100);
  });

  it("clones each GoPlus contract-control flag", () => {
    const ev = evidenceWithToken();
    const frozen = assembleDossier(ev, false);
    const flags = frozen.holderProfile?.contractFlags;
    if (!flags?.length) throw new Error("expected frozen contract flags");

    expect(flags).not.toBe(ev.holderProfile!.contractFlags);
    expect(flags[0]).not.toBe(ev.holderProfile!.contractFlags![0]);
    ev.holderProfile!.contractFlags![0].claim = "rewritten after the freeze";
    expect(flags[0].claim).toBe("Mint authority is live.");
  });

  it("freezes the structural holder-floor basis with the aggregate", () => {
    const frozen = assembleDossier(evidenceWithToken(), false).holderProfile;

    expect(frozen).toMatchObject({
      top10Pct: 7,
      assessedWalletCount: 2,
      top10PctIsFloor: true,
    });
  });
});
