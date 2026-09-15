import { describe, expect, it } from "vitest";
import { judge } from "./scan";
import type { TokenClassification } from "./classify";
import type { ShippingSummary } from "./shipping";

// The frozen shipping summary reaches the verdict through class-aware rules:
// a token that claims utility is judged on whether anyone is still building
// it; a meme never made the claim, so only cross-class contradictions score.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 0, top10Pct: 0, holderCount: 500, lpHolderCount: 1,
  lpLockedPct: 0, creatorPct: 0, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};

function summary(over: Partial<ShippingSummary> = {}): ShippingSummary {
  return {
    version: 1, target: "acme", capturedAt: "2026-09-15T00:00:00Z", windowDays: 90,
    grade: "shipping-team", headline: "Shipping as a team: 45 commits in 90 days from 3 people.",
    cadenceStatus: "shipping", totalCommits: 45, activeWeeks: 13, distinctHuman: 3, concentration: "team",
    authorship: "hand-authored", origin: "original", stars: "organic", market: "mixed",
    claimsSupported: 0, claimsUnsupported: 0, live: "unknown", adoption: "unknown", health: "sound",
    leadDeparted: false, reposRead: 3, commitsRead: 45, releasesInWindow: 1,
    ...over,
  };
}

function dossier(over: Record<string, unknown> = {}) {
  return {
    address: "0x1000000000000000000000000000000000000001", chain: "base",
    symbol: "ACME", name: "Acme Protocol", mcap: 2_000_000, fdv: 2_000_000,
    liquidityUsd: 150_000, vol24: 40_000, ageDays: 120,
    safety: { ...SAFETY }, cg: null, socials: [], findings: [],
    ...over,
  } as never;
}

const CODE = { checked: false, verified: false, origin: null, contractName: null, compiler: null, stats: null, flags: [], tokenomics: null, ai: null } as never;
const DEP = { address: null, serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [], cexHeld: [], rewardPools: [],
  lp: { status: "unknown", burnedPct: 0, lockedPct: 0, unlockedTopPct: 0, lockers: [], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 0, note: "",
} as never;
const UTILITY: TokenClassification = { kind: "utility", confidence: "high", label: "UTILITY", signals: ["claims a product"], lens: "" };
const MEME: TokenClassification = { kind: "meme", confidence: "high", label: "MEME COIN", signals: ["dog"], lens: "" };

const run = (d: never, cls: TokenClassification) => judge(d, CODE, DEP, null, null, null, [], TK, null, null, null, null, null, null, cls);

describe("judge · development against the claim", () => {
  it("penalises a stalled utility token and names the read", () => {
    const base = run(dossier(), UTILITY);
    const stalled = run(dossier({ shipping: summary({ grade: "stalled", cadenceStatus: "dormant", headline: "Development has stalled: last commit 75 days ago." }) }), UTILITY);
    expect(stalled.risk).toBe(base.risk + 10);
    expect(stalled.warnings.join(" ")).toMatch(/Development has stalled in the linked GitHub/);
  });

  it("does not penalise a meme for thin or stalled development", () => {
    const base = run(dossier(), MEME);
    const stalled = run(dossier({ shipping: summary({ grade: "stalled" }) }), MEME);
    expect(stalled.risk).toBe(base.risk);
    expect(stalled.warnings.join(" ")).not.toMatch(/Development has stalled/);
  });

  it("scores the cross-class contradictions on any class", () => {
    const base = run(dossier(), MEME);
    const contradicted = run(dossier({ shipping: summary({ market: "price-without-shipping", leadDeparted: true, stars: "suspect", claimsSupported: 0, claimsUnsupported: 3 }) }), MEME);
    expect(contradicted.risk).toBe(base.risk + 8 + 6 + 6 + 5);
    const text = contradicted.warnings.join(" ");
    expect(text).toMatch(/Price rose over the quarter while commits fell/);
    expect(text).toMatch(/lead committer of the prior two months has stopped/);
    expect(text).toMatch(/3 shipping claims .* nothing in the repositories/);
    expect(text).toMatch(/purchased stars/);
  });

  it("relaxes the development penalties on an established token", () => {
    const established = dossier({ cg: { listed: true, cexCount: 6, rank: 40 }, shipping: summary({ grade: "stalled", market: "price-without-shipping" }) });
    const base = run(dossier({ cg: { listed: true, cexCount: 6, rank: 40 } }), UTILITY);
    const out = run(established, UTILITY);
    expect(out.risk).toBe(base.risk);
    expect(out.warnings.join(" ")).toMatch(/Development has stalled/);
  });

  it("credits a shipping team, live code and outside use, and warns on a solo utility builder", () => {
    const team = run(dossier({ shipping: summary({ live: "live", adoption: "used" }) }), UTILITY);
    const p = team.positives.join(" ");
    expect(p).toMatch(/A team is shipping/);
    expect(p).toMatch(/public code is what goes live/);
    expect(p).toMatch(/Outsiders contribute/);
    const solo = run(dossier({ shipping: summary({ grade: "shipping-solo", concentration: "single-author", distinctHuman: 1, headline: "Shipping, but it is one person: 40 commits in 90 days." }) }), UTILITY);
    expect(solo.warnings.join(" ")).toMatch(/Shipping, but one person/);
    expect(solo.risk).toBe(run(dossier(), UTILITY).risk);
  });

  it("never penalises an absent or unread repository", () => {
    const base = run(dossier(), UTILITY);
    expect(run(dossier({ shipping: summary({ grade: "unknown" }) }), UTILITY).risk).toBe(base.risk);
    expect(base.warnings.join(" ")).not.toMatch(/GitHub/);
  });
});
