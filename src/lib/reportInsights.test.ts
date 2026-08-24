import { describe, expect, it } from "vitest";
import { claimedTicker, deriveDecisionDiscovery, deriveNoticedSignals, deriveVerdictArgument, isConcentratedLiquidityPool, top10ShareFromRows } from "./reportInsights";

describe("deriveNoticedSignals", () => {
  it("lifts unlocked liquidity and holder concentration out of the stat grid", () => {
    const signals = deriveNoticedSignals({
      lpLockedPct: 0,
      largestHolderPct: 30,
      top10HolderPct: 92,
      assessedWalletCount: 10,
      top10HolderPctIsFloor: false,
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

  it("does not flag a concentrated-liquidity (v3/v4) pool as unlocked: there is no LP token to lock", () => {
    const signals = deriveNoticedSignals({
      lpLockedPct: 0,
      isConcentratedLiquidityPool: true,
      largestHolderPct: 30,
      marketCapUsd: 557_000_000,
      anchors: { market: "#investigation-visuals" },
    });

    expect(signals.map((signal) => signal.id)).not.toContain("lp-unlocked");
  });

  it("still flags a standard-AMM pool with no lock as unlocked", () => {
    const signals = deriveNoticedSignals({
      lpLockedPct: 0,
      isConcentratedLiquidityPool: false,
      marketCapUsd: 557_000_000,
    });

    expect(signals.map((signal) => signal.id)).toContain("lp-unlocked");
  });

  it("describes a short holder register as a floor across the assessed wallets", () => {
    const [signal] = deriveNoticedSignals({
      top10HolderPct: 70,
      assessedWalletCount: 4,
      top10HolderPctIsFloor: true,
    });

    expect(signal).toMatchObject({
      id: "holder-concentration",
      headline: "At least 70% sits across 4 assessed wallets",
    });
    expect(signal.headline).not.toMatch(/top 10/i);
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
      headline: "No independently corroborated team behind a $25.0M token",
      detail: "2 named people, none independently corroborated.",
    });
    expect(deriveNoticedSignals({
      verifiedTeamCount: 0,
      marketCapUsd: 2_000_000,
    })).toEqual([]);
  });

  it("states a project-published founder role without promoting identity or control", () => {
    expect(deriveNoticedSignals({
      verifiedTeamCount: 0,
      namedTeamCount: 1,
      projectAttributedTeam: [{ name: "@0xSimpleFarmer", role: "Founder" }],
      marketCapUsd: 32_600_000,
    })[0]).toMatchObject({
      id: "team-unverified",
      headline: "Project-attributed founder behind a $32.6M token",
      detail: "The project identifies @0xSimpleFarmer as Founder. That establishes its published role attribution, not independent proof of the person's identity, ownership, or control.",
    });
  });
});

describe("deriveDecisionDiscovery", () => {
  it("surfaces a cross-fact finding with proof and a reversal condition", () => {
    const discovery = deriveDecisionDiscovery(deriveNoticedSignals({
      nextUnlock: { amountUsd: 48_000_000, date: "2026-08-14", pctSupply: 6 },
      volume24hUsd: 4_000_000,
      anchors: { market: "#token-market" },
    }));

    expect(discovery).toMatchObject({
      id: "unlock-pressure",
      headline: "The next unlock equals 12 days of trading",
      evidenceHref: "#token-market",
    });
    expect(discovery?.reversalCondition).toContain("unlock schedule");
  });

  it("does not promote a single scanner metric into a discovery", () => {
    const discovery = deriveDecisionDiscovery(deriveNoticedSignals({
      lpLockedPct: 0,
      anchors: { market: "#token-market" },
    }));

    expect(discovery).toBeNull();
  });

  it("withholds a discovery when there is no receipt target", () => {
    const discovery = deriveDecisionDiscovery(deriveNoticedSignals({
      tvlChange30dPct: 18,
      feesChange30dPct: -24,
    }));

    expect(discovery).toBeNull();
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
    expect(argument.moveLine).toBe("No checks remain open. A new scan would show whether this result still holds.");
  });

  it("does not invent a concern for a clean pass", () => {
    const argument = deriveVerdictArgument({
      verdict: "PASS",
      supports: ["Two independent auditors attested the deployed contracts"],
      concerns: [],
      nextChecks: [],
    });
    expect(argument.againstLine).toBeNull();
    expect(argument.moveLine).toContain("new scan");
  });

  it("does not call an empty 0-of-0 register complete", () => {
    const argument = deriveVerdictArgument({
      verdict: "CAUTION",
      supports: [],
      concerns: [],
      nextChecks: [],
      applicableChecks: 0,
    });
    expect(argument.moveLine).toBe("No check results were saved with this report. Run a new scan before relying on it.");
  });
});

// A register the token lane refused to trust must not be summed and handed to
// the "top 10 wallets hold X%" rail as if it were measured, and ten rows is the
// only row count that can answer a question about ten wallets.
describe("top10ShareFromRows", () => {
  const rows = Array.from({ length: 10 }, () => ({ percent: 2 }));

  it("sums a full, trusted register", () => {
    expect(top10ShareFromRows(rows, true)).toBe(20);
  });

  it("returns null when the token lane judged its register self-inconsistent", () => {
    expect(top10ShareFromRows(rows, false)).toBeNull();
  });

  it("returns null rather than passing a short register off as a top ten", () => {
    expect(top10ShareFromRows(rows.slice(0, 4), true)).toBeNull();
  });

  it("returns null when the summed rows exceed supply", () => {
    expect(top10ShareFromRows(Array.from({ length: 10 }, () => ({ percent: 40 })), true)).toBeNull();
  });

  it("returns null when a row carries no measured share", () => {
    expect(top10ShareFromRows([...rows.slice(0, 9), { percent: null }], true)).toBeNull();
  });
});

describe("isConcentratedLiquidityPool", () => {
  it("detects a Uniswap V3 pool by dex label", () => {
    expect(isConcentratedLiquidityPool("uniswap", ["v3"])).toBe(true);
  });

  it("detects by dexId when no labels are present (e.g. Raydium CLMM)", () => {
    expect(isConcentratedLiquidityPool("raydium clmm", [])).toBe(true);
  });

  it("is false for a standard V2-style AMM", () => {
    expect(isConcentratedLiquidityPool("uniswap", ["v2"])).toBe(false);
  });

  it("handles missing dexId/labels", () => {
    expect(isConcentratedLiquidityPool(undefined, undefined)).toBe(false);
  });
});
