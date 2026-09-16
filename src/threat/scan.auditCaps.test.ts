import { describe, expect, it } from "vitest";

import { buildChecks, judge } from "./scan";
import type { LaunchProvenance } from "./types";

// 2026-09-14 deep-dive review, token lane findings 1, 3, 4 and 12.
//
// The threat judge used to re-derive risk from raw safety flags plus a
// whitelist of exactly one audit cap (honeypot_confirmed). Every other hard
// conclusion the mechanical audit reached - an OFAC SDN hit forcing AVOID/5, a
// documented scanner-concealment cap, a later-minted ticker collision, a severe
// Arkham funding path - was dropped on the floor, so a sanctioned deployer
// scanned SAFE, was receipted SAFE to the shared ledger and cached SAFE for an
// hour. These tests pin the parity rule: an audit cap at the AVOID line is a
// trap here, and a cap below PASS is at least a flag.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, ownerAssessed: true, hiddenOwner: false, takeBack: false, blacklist: false,
  proxy: false, selfdestruct: false, externalCall: false, topHolderPct: 0, holderCount: 500,
  lpLockedPct: 0, lpBurnedPct: 0, lpTopUnlockedEoaPct: 0, creatorPercent: 0, tradingCooldown: false,
  slippageModifiable: false, ownerChangeBalance: false, balanceMutable: false, transferHook: false,
  transferFee: false, serialScammerCreator: false, honeypotOnchain: false, nonTransferable: false,
  openSource: true, metadataMutable: false, lpLocked: true, contractPropertiesAssessed: true,
};

function dossier(over: Record<string, unknown> = {}) {
  return {
    address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", chain: "ethereum",
    symbol: "CLEAN", name: "Clean Token", mcap: 500_000, fdv: 500_000,
    liquidityUsd: 120_000, vol24: 5_000, ageDays: 30,
    verdict: "PASS", score: 82, capApplied: null,
    safety: { ...SAFETY }, cg: null, socials: [], findings: [], topHolders: [],
    bundleRisk: "low", insiderPct: 0, bundleCount: 0,
    deployer: "0xdddddddddddddddddddddddddddddddddddddddd",
    ...over,
  } as never;
}

const CODE = { checked: true, verified: true, origin: "sourcify", contractName: "Clean", compiler: null, stats: { functions: 12, gatedFunctions: 1, dangerHits: 0, isProxy: false, loc: 200 }, flags: [], tokenomics: null, ai: null } as never;
const DEP = { address: "0xdddddddddddddddddddddddddddddddddddddddd", serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [], cexHeld: [], rewardPools: [],
  lp: { status: "locked", burnedPct: 0, lockedPct: 100, unlockedTopPct: 0, lockers: ["Team Finance"], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 3, note: "",
} as never;

function run(d: never, over: { clones?: { symbol: string; address: string; verdict: string }[]; launch?: LaunchProvenance | null } = {}) {
  return judge(d, CODE, DEP, null, null, null, over.clones ?? [], TK, null, null, over.launch ?? null, null, null, null);
}

const SANCTIONED = {
  available: true, checked: 11, listSize: 20_000,
  sanctioned: ["0xdddddddddddddddddddddddddddddddddddddddd"], completedAt: "2026-09-14T00:00:00.000Z",
};

describe("finding 1: the judge honours every audit cap", () => {
  it("an OFAC-sanctioned deployer is a RUG trap, never SAFE", () => {
    const d = dossier({
      verdict: "AVOID", score: 5, capApplied: "ofac_sanctioned_address",
      sanctionsScreen: SANCTIONED,
      findings: [{ claim: "OFAC SDN hit: screened address 0xdddddddd… is on the US Treasury sanctions list. Touching this token is a legal-exposure risk.", tone: "bad", source: "ofac" }],
    });
    const call = run(d);
    expect(call.verdict).toBe("RUG");
    expect(call.risk).toBe(100);
    expect(call.flags.join(" ")).toMatch(/OFAC SANCTIONS HIT/);
    expect(call.action).toBe("DON'T TOUCH IT");
  });

  it("the sanctions screen itself is enough even when another cap governs capApplied", () => {
    const d = dossier({ verdict: "AVOID", score: 5, capApplied: "honeypot_confirmed", sanctionsScreen: SANCTIONED, safety: { ...SAFETY, honeypot: true } });
    const call = run(d);
    expect(call.verdict).toBe("RUG");
    expect(call.flags.join(" ")).toMatch(/OFAC SANCTIONS HIT/);
  });

  it("any AVOID the audit reaches is a trap, so a future cap can never be silently dropped", () => {
    const call = run(dossier({ verdict: "AVOID", score: 8, capApplied: "some_new_hard_cap" }));
    expect(call.verdict).toBe("RUG");
    expect(call.flags.join(" ")).toMatch(/mechanical audit returned AVOID \(some new hard cap\)/);
  });

  it("documented scanner concealment is a flag with points, not a silent pass", () => {
    const d = dossier({
      verdict: "CAUTION", score: 55, capApplied: "documented_scanner_concealment",
      findings: [{ claim: "The verified source documents defeating a safety scanner: \"hidden from goplus\".", tone: "bad", source: "contract source" }],
    });
    const call = run(d);
    expect(call.risk).toBeGreaterThanOrEqual(20);
    expect(call.flags.join(" ")).toMatch(/defeating a safety scanner/);
    expect(call.verdict).not.toBe("SAFE");
  });

  it("a later-minted ticker collision is flagged, not ignored", () => {
    const d = dossier({
      cloneCheck: { checked: true, audited: "later", clones: [{ mint: "0x1111111111111111111111111111111111111111", chain: "ethereum" }], note: "An earlier $CLEAN mint predates this one by 40 days" },
    });
    const call = run(d);
    expect(call.flags.join(" ")).toMatch(/TICKER COLLISION/);
    expect(call.risk).toBeGreaterThanOrEqual(25);
  });

  it("a severe Arkham funding path is a flag; a soft one is a warning", () => {
    const severe = run(dossier({ deployerRisk: { available: true, completedAt: "x", paths: [{ seed: "0xhack", seedName: "Lazarus Group", category: "hacker", direction: "backward", score: 90, usd: 40_000, hops: 2 }] } }));
    expect(severe.flags.join(" ")).toMatch(/FUNDED by Lazarus Group, 2 hops away/);
    expect(severe.risk).toBeGreaterThanOrEqual(30);
    const soft = run(dossier({ deployerRisk: { available: true, completedAt: "x", paths: [{ seed: "0xmix", seedName: "Some Exchange", category: "exchange", direction: "backward", score: 20, usd: 400, hops: 3 }] } }));
    expect(soft.flags).toEqual([]);
    expect(soft.warnings.join(" ")).toMatch(/traceable to Some Exchange/);
  });

  it("a clean audit with a completed screen still scans SAFE", () => {
    const call = run(dossier({ sanctionsScreen: { ...SANCTIONED, sanctioned: [] } }));
    expect(call.verdict).toBe("SAFE");
    expect(call.flags).toEqual([]);
  });
});

describe("finding 1: the checklist carries the sanctions row and the cap-driven rows", () => {
  const checks = (d: never) => buildChecks(d, CODE, DEP, null, null, null, TK, null, null, null, null);

  it("shows a failed sanctions row on an SDN hit and a passed one on a clean screen", () => {
    const hit = checks(dossier({ verdict: "AVOID", capApplied: "ofac_sanctioned_address", sanctionsScreen: SANCTIONED })).find((c) => c.key === "sanctions");
    expect(hit).toMatchObject({ status: "fail", category: "deployer" });
    expect(hit?.detail).toMatch(/1 of 11 screened addresses/);
    const clean = checks(dossier({ sanctionsScreen: { ...SANCTIONED, sanctioned: [] } })).find((c) => c.key === "sanctions");
    expect(clean).toMatchObject({ status: "pass" });
    // An unrun or unscreenable screen is never a pass.
    expect(checks(dossier()).find((c) => c.key === "sanctions")).toMatchObject({ status: "na" });
    expect(checks(dossier({ sanctionsScreen: { available: false, checked: 0, sanctioned: [], completedAt: "x", reason: "no_screenable_addresses" } })).find((c) => c.key === "sanctions")).toMatchObject({ status: "na" });
  });

  it("fails the code row on documented concealment and the authenticity row on a later-minted collision", () => {
    const code = checks(dossier({ capApplied: "documented_scanner_concealment", findings: [{ claim: "documents defeating a scanner", tone: "bad", source: "contract source" }] })).find((c) => c.key === "code");
    expect(code?.status).toBe("fail");
    const auth = checks(dossier({ cloneCheck: { checked: true, audited: "later", clones: [{ mint: "0x1", chain: "ethereum" }], note: "An earlier mint predates this one" } })).find((c) => c.key === "authenticity");
    expect(auth?.status).toBe("fail");
  });
});

describe("finding 3: a bytecode fingerprint is a template id, not proof of a redeployed trap", () => {
  const danger = [{ symbol: "PRIOR", address: "0x1111111111111111111111111111111111111111", verdict: "DANGER" }];
  const rug = [{ symbol: "TRAP", address: "0x2222222222222222222222222222222222222222", verdict: "RUG" }];
  const clanker: LaunchProvenance = {
    kind: "launchpad", venue: "clanker", onCurve: false, graduated: true, curveProgressPct: null,
    quote: "WETH", quoteNote: null, lpDisposition: "locked", lpNote: null, creatorFees: null, snipe: null, notes: [],
  };

  it("a prior DANGER earned on market conduct lends no points to a byte-identical sibling", () => {
    const call = run(dossier(), { clones: danger });
    expect(call.verdict).toBe("SAFE");
    expect(call.flags).toEqual([]);
    expect(call.warnings.join(" ")).toMatch(/common template, not a confirmed code trap/);
  });

  it("a launchpad template shares bytecode with every sibling, so even a RUG match is a disclosure", () => {
    const call = run(dossier(), { clones: rug, launch: clanker });
    expect(call.flags).toEqual([]);
    expect(call.warnings.join(" ")).toMatch(/clanker mints every token from one template/);
  });

  it("a confirmed code trap redeployed outside a launchpad is still the same trap (+50)", () => {
    const call = run(dossier(), { clones: rug });
    expect(call.risk).toBeGreaterThanOrEqual(50);
    expect(call.flags.join(" ")).toMatch(/the same trap redeployed under a new name/);
  });
});

describe("finding 4: a hidden owner or a reversible renounce never reads as 'no owner powers remain'", () => {
  it("HIDDEN OWNER cannot sit beside 'Ownership renounced - no owner powers remain'", () => {
    const call = run(dossier({ safety: { ...SAFETY, ownerRenounced: true, hiddenOwner: true } }));
    expect(call.flags.join(" ")).toMatch(/HIDDEN OWNER/);
    expect(call.positives.join(" ")).not.toMatch(/no owner powers remain/);
  });

  it("an unmeasured owner is not a renounced owner", () => {
    const call = run(dossier({ safety: { ...SAFETY, ownerRenounced: false, ownerAssessed: false } }));
    expect(call.positives.join(" ")).not.toMatch(/no owner powers remain/);
    const owner = buildChecks(dossier({ safety: { ...SAFETY, ownerRenounced: false, ownerAssessed: false } }), CODE, DEP, null, null, null, TK, null, null, null, null).find((c) => c.key === "owner");
    expect(owner).toMatchObject({ status: "na" });
    expect(owner?.detail).toMatch(/not identified/);
  });

  it("a high-severity code flag is NOT disarmed by a renounce a hidden owner survives", () => {
    const code = { ...(CODE as object), flags: [{ id: "blacklist", severity: "high", title: "Blacklist", detail: "Owner can block addresses from selling", file: "Token.sol", line: 40, excerpt: "" }] } as never;
    const disarmed = judge(dossier({ safety: { ...SAFETY, ownerRenounced: true } }), code, DEP, null, null, null, [], TK, null, null, null, null, null, null);
    const armed = judge(dossier({ safety: { ...SAFETY, ownerRenounced: true, hiddenOwner: true } }), code, DEP, null, null, null, [], TK, null, null, null, null, null, null);
    expect(disarmed.warnings.join(" ")).toMatch(/the switch has no hand on it/);
    expect(armed.warnings.join(" ")).not.toMatch(/the switch has no hand on it/);
  });
});

describe("finding 12: liquidity risk is monotone in liquidity", () => {
  const under10m = (liq: number) => run(dossier({ mcap: 10_000_000, fdv: 10_000_000, liquidityUsd: liq, safety: { ...SAFETY } })).risk;

  it("a $2,400 pool under a $10M cap can never score less than a $2,600 pool under the same cap", () => {
    expect(under10m(2_400)).toBeGreaterThanOrEqual(under10m(2_600));
    expect(under10m(2_400)).toBe(15);
    expect(under10m(2_600)).toBe(15);
  });

  it("a dust pool under a tiny cap is still a plain dust warning worth 10", () => {
    const call = run(dossier({ mcap: 3_000, fdv: 3_000, liquidityUsd: 1_200 }));
    expect(call.risk).toBe(10);
    expect(call.warnings.join(" ")).toMatch(/dust liquidity/i);
  });
});
