import { describe, expect, it } from "vitest";
import { claimedTicker, deriveNoticedSignals, deriveVerdictArgument } from "./reportInsights";

describe("deriveNoticedSignals", () => {
  it("lifts unlocked liquidity and holder concentration out of the stat grid", () => {
    const signals = deriveNoticedSignals({
      lpLockedPct: 0,
      largestHolderPct: 30,
      top10HolderPct: 92,
      marketCapUsd: 557_000_000,
      anchors: { market: "#investigation-visuals" },
    });

    expect(signals.map((signal) => signal.id)).toEqual(["lp-unlocked", "holder-concentration"]);
    expect(signals[0]).toMatchObject({
      severity: "alert",
      headline: "None of the trading liquidity is locked",
      anchor: "#investigation-visuals",
    });
    expect(signals[1].headline).toBe("One wallet holds 30% of the supply");
    expect(signals[1].detail).toContain("top 10 wallets hold 92%");
  });

  it("prices the next unlock in days of typical trading", () => {
    const [signal] = deriveNoticedSignals({
      nextUnlock: { amountUsd: 48_000_000, date: "2026-08-14", pctSupply: 6 },
      volume24hUsd: 4_000_000,
    });

    expect(signal).toMatchObject({ id: "unlock-pressure", severity: "alert" });
    expect(signal.headline).toBe("The next unlock equals 12 days of trading");
    expect(signal.detail).toContain("$48.0M");
    expect(signal.detail).toContain("6% of supply");
    expect(signal.detail).toContain("2026-08-14");
  });

  it("flags fees and locked value moving in opposite directions", () => {
    const [signal] = deriveNoticedSignals({
      tvlChange30dPct: 18,
      feesChange30dPct: -24,
    });

    expect(signal.id).toBe("usage-capital-divergence");
    expect(signal.detail).toBe("Fees fell 24% while locked value rose 18% over 30 days.");
  });

  it("stays quiet when the stats are unremarkable or absent", () => {
    expect(deriveNoticedSignals({})).toEqual([]);
    expect(deriveNoticedSignals({
      lpLockedPct: 95,
      largestHolderPct: 4,
      top10HolderPct: 22,
      circulatingPct: 88,
      tvlChange30dPct: 12,
      feesChange30dPct: 9,
      daysSinceLastPost: 3,
      verifiedTeamCount: 3,
      marketCapUsd: 400_000_000,
      athDrawdownPct: -35,
    })).toEqual([]);
  });

  it("treats long official-account silence as a leading flag even with no token bound", () => {
    const [signal] = deriveNoticedSignals({ daysSinceLastPost: 294 });
    expect(signal).toMatchObject({ id: "account-quiet", severity: "alert" });
    expect(signal.headline).toBe("The official account has been silent for 294 days");
    expect(signal.detail).toContain("warning on its own");

    expect(deriveNoticedSignals({ daysSinceLastPost: 45 })).toEqual([]);
    expect(deriveNoticedSignals({ daysSinceLastPost: 45, volume24hUsd: 200_000 })[0]).toMatchObject({
      id: "account-quiet",
      severity: "watch",
    });
  });

  it("ranks alerts ahead of watches and notes", () => {
    const signals = deriveNoticedSignals({
      athDrawdownPct: -94,
      circulatingPct: 40,
      fdvUsd: 800_000_000,
      marketCapUsd: 320_000_000,
      accountSuspended: true,
    });

    expect(signals.map((signal) => signal.severity)).toEqual(["alert", "watch", "note"]);
    expect(signals[0].id).toBe("account-suspended");
  });

  it("calls out an unverified team only when real money is at stake", () => {
    expect(deriveNoticedSignals({
      verifiedTeamCount: 0,
      namedTeamCount: 2,
      marketCapUsd: 25_000_000,
    })[0]).toMatchObject({
      id: "team-unverified",
      headline: "No verified team behind a $25.0M token",
      detail: "2 named people, none independently verified.",
    });
    expect(deriveNoticedSignals({
      verifiedTeamCount: 0,
      marketCapUsd: 2_000_000,
    })).toEqual([]);
  });
});

describe("claimedTicker", () => {
  it("finds a self-claimed ticker and skips currency and acronym noise", () => {
    expect(claimedTicker("Burn-rate-based fundraising. Powered by $ORBIT")).toBe("ORBIT");
    expect(claimedTicker("We raised $100M in USDC")).toBeNull();
    expect(claimedTicker("$BTC and $ETH maxi")).toBeNull();
    expect(claimedTicker(null)).toBeNull();
  });
});

describe("deriveVerdictArgument", () => {
  it("argues with the strongest support, the cap, and the next checks", () => {
    expect(deriveVerdictArgument({
      verdict: "FAIL",
      supports: ["", "Canonical token verified through the official account"],
      concerns: ["Minor formatting gap"],
      capReason: "Critical protocol loss with no recorded full recovery",
      nextChecks: ["Finish the sanctions screen", "Verify the second auditor"],
    })).toEqual({
      forLine: "Canonical token verified through the official account.",
      againstLine: "Critical protocol loss with no recorded full recovery.",
      moveLine: "Finish the sanctions screen; Verify the second auditor.",
    });
  });

  it("is honest when an adverse verdict rests on coverage rather than findings", () => {
    const argument = deriveVerdictArgument({ verdict: "CAUTION", supports: [], concerns: [] });
    expect(argument.forLine).toBeNull();
    expect(argument.againstLine).toBe("The concern here is coverage: too little verified evidence, not adverse findings.");
    expect(argument.moveLine).toBe("No checks remain open; a rescan would test whether this result still holds.");
  });

  it("does not invent a concern for a clean pass", () => {
    const argument = deriveVerdictArgument({
      verdict: "PASS",
      supports: ["Two independent auditors attested the deployed contracts"],
      concerns: [],
      nextChecks: [],
    });
    expect(argument.againstLine).toBeNull();
    expect(argument.moveLine).toContain("rescan");
  });
});
