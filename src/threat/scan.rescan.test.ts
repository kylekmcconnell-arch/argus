import { describe, expect, it } from "vitest";

import { buildChecks, judge, splitVenueCodeFlags } from "./scan";
import type { CodeReview, LaunchProvenance, SellStructure } from "./types";

// Three mis-reads from the first production rescan of $HADES (2026-09-25):
// venue code judged as the token's, concentration called a bundle with no
// launch-block proof, and market contracts counted as holders.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 2.7, top10Pct: 18, holderCount: 916, lpHolderCount: 1,
  lpLockedPct: 100, creatorPct: 2, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};
const dossier = (over: Record<string, unknown> = {}) => ({
  address: "0x923d915ddf0fe60c04addac68e13f0d5af03164f", chain: "robinhood", symbol: "HADES", name: "Hades",
  mcap: 1_690_000, fdv: 1_690_000, liquidityUsd: 157_000, vol24: 619_000, ageDays: 3,
  safety: { ...SAFETY }, cg: null, socials: [], findings: [],
  bundleRisk: "high", bundleCount: 25, insiderPct: 52,
  ...over,
}) as never;
const DEP = { address: "0x5ded38b5b4cbb97a44323609156c3e182e5202ad", serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [{ address: "0xpool", label: "pool", pct: 4.2 }], cexHeld: [], rewardPools: [],
  lp: { status: "launchpad-locked", burnedPct: 0, lockedPct: 100, unlockedTopPct: 0, lockers: ["Pons"], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 2.7, note: "",
} as never;
const flag = (file: string, severity: "critical" | "high" | "medium") => ({ id: "x", severity, title: "t", detail: "The renounce function does not hand ownership to the zero address", file, line: 1, excerpt: "" });
const CODE: CodeReview = {
  checked: true, verified: true, origin: "blockscout", contractName: "PonsV2LauncherToken", compiler: null,
  stats: { functions: 486, gatedFunctions: 3, dangerHits: 0, isProxy: false, loc: 4000 },
  flags: [flag("src/PonsV2MemeHook.sol", "critical"), flag("src/PonsV2LaunchFactory.sol", "critical"), flag("src/PonsV2LaunchLocker.sol", "high"), flag("src/PonsV2LauncherToken.sol", "medium")],
  tokenomics: null, ai: null,
};
const PONS: LaunchProvenance = { kind: "launchpad", venue: "pons", onCurve: false, graduated: null, curveProgressPct: null, quote: "ETH", quoteNote: null, lpDisposition: "locked", lpNote: "", creatorFees: null, snipe: null, notes: [] };
const run = (code: CodeReview, launch: LaunchProvenance | null, d = dossier(), sellers: SellStructure | null = null) =>
  judge(d, code, DEP, null, null, null, [], TK, null, null, launch, null, sellers, null);

describe("venue code is the venue's, not the token's", () => {
  it("splits flags by the token's own contract file when the venue is known", () => {
    const sp = splitVenueCodeFlags(CODE, PONS);
    expect(sp.own.map((f) => f.file)).toEqual(["src/PonsV2LauncherToken.sol"]);
    expect(sp.venue).toHaveLength(3);
  });

  it("keeps every flag on the token when the venue is unknown or the source is one unnamed file", () => {
    expect(splitVenueCodeFlags(CODE, null).own).toHaveLength(4);
    const flat: CodeReview = { ...CODE, flags: [flag("Contract.sol", "critical")] };
    expect(splitVenueCodeFlags(flat, PONS).own).toHaveLength(1);
  });

  it("does not charge the token for the venue's critical flags, and says where they sit", () => {
    const withVenue = run(CODE, PONS);
    const without = run(CODE, null);
    expect(withVenue.risk).toBeLessThan(without.risk);
    expect(withVenue.flags.join(" ")).not.toMatch(/PonsV2MemeHook/);
    expect(withVenue.warnings.join(" ")).toMatch(/3 code flags sit in pons's shared launch contracts \(PonsV2MemeHook\.sol, PonsV2LaunchFactory\.sol, PonsV2LaunchLocker\.sol\)/);
    const row = buildChecks(dossier(), CODE, DEP, null, null, null, TK, PONS, null, null, null).find((c) => c.key === "code");
    expect(row?.status).toBe("pass");
    expect(row?.detail).toMatch(/1 flag on the token \(3 in pons's shared contracts\)/);
  });
});

describe("a bundle needs launch-block proof on EVM", () => {
  const clean: CodeReview = { ...CODE, flags: [] };
  it("high concentration alone is a warning, not the +25 bundle flag", () => {
    const call = run(clean, PONS);
    expect(call.flags.join(" ")).not.toMatch(/bundled launch/);
    expect(call.warnings.join(" ")).toMatch(/no launch-block coordination is on record/);
    expect(call.warnings.join(" ")).toMatch(/Robinhood Chain the largest holders are routinely the app's own smart accounts/);
  });

  it("same-block buyers taking a material share prove it", () => {
    const launch = { ...PONS, snipe: { sameBlockBuyers: 9, pctOfSupply: 14, window: "first block" } } as never;
    const call = run(clean, launch);
    expect(call.flags.join(" ")).toMatch(/52% of supply sits in 25 launch-block wallets/);
  });

  it("launch-block snipers in the sell tape prove it", () => {
    const sellers = { available: true, devSold: false, sellerCount: 10, badSellerCount: 2, topSellers: [
      { wallet: "0xa", soldPct: 3, boughtPct: 3, realizedExitPct: 100, sameBlockSniper: true, isDeployer: false, deployerSeeded: false, flags: ["launch-block sniper"] },
      { wallet: "0xb", soldPct: 3, boughtPct: 3, realizedExitPct: 100, sameBlockSniper: true, isDeployer: false, deployerSeeded: false, flags: ["launch-block sniper"] },
    ], note: "" } as never;
    const call = run(clean, PONS, dossier(), sellers);
    expect(call.flags.join(" ")).toMatch(/bundled launch or coordinated snipe/);
  });
});
