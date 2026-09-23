import { describe, expect, it } from "vitest";

import { buildChecks, judge } from "./scan";
import type { CodeReview } from "./types";

// A Base B20 asset has no per-token bytecode: the address holds a 1-byte 0xef
// marker and the token runs on the chain's precompile ($SPIKE, 2026-09-23).
// "No verified source" is therefore not a finding - there is no source - and
// the review must neither dock it as unverified nor call it an SPL token.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 2.3, top10Pct: 16, holderCount: 2064, lpHolderCount: 1,
  lpLockedPct: 0, creatorPct: 0, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};
const dossier = () => ({
  address: "0xb20000000000000000000070f6c1a66d7c1e4d01", chain: "base", symbol: "SPIKE", name: "SPIKE",
  mcap: 1_600_000, fdv: 1_600_000, liquidityUsd: 206_000, vol24: 5_200_000, ageDays: 42,
  safety: { ...SAFETY }, cg: null, socials: [], findings: [],
}) as never;
const base: CodeReview = { checked: false, verified: false, origin: null, contractName: null, compiler: null, stats: null, flags: [], tokenomics: null, ai: null };
const UNVERIFIED: CodeReview = { ...base, checked: true };
const B20: CodeReview = { ...base, system: "b20" };
const DEP = { address: null, serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [{ address: "0xpool", label: "pool", pct: 7.4 }], cexHeld: [], rewardPools: [],
  lp: { status: "launchpad-locked", burnedPct: 0, lockedPct: 100, unlockedTopPct: 0, lockers: ["o1"], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 2.3, note: "",
} as never;

const run = (code: CodeReview) => judge(dossier(), code, DEP, null, null, null, [], TK, null, null, null, null, null, null);

describe("B20 system assets in the code dimension", () => {
  it("is not docked as an unverified contract", () => {
    const unverified = run(UNVERIFIED);
    const b20 = run(B20);
    expect(unverified.warnings.join(" ")).toMatch(/UNVERIFIED contract/);
    expect(b20.warnings.join(" ")).not.toMatch(/UNVERIFIED/i);
    expect(b20.risk).toBeLessThan(unverified.risk);
  });

  it("says what it is instead: no per-token contract, authority reads are the power surface", () => {
    const b20 = run(B20);
    expect(b20.positives.join(" ")).toMatch(/B20 system asset/);
    expect(b20.positives.join(" ")).toMatch(/no per-token contract/);
  });

  it("the source-code check row reads B20, not SPL and not 'not checked'", () => {
    const row = buildChecks(dossier(), B20, DEP, null, null, null, TK, null, null, null, null).find((c) => c.key === "code");
    expect(row?.status).toBe("na");
    expect(row?.detail).toMatch(/B20 system asset/);
    expect(row?.detail).not.toMatch(/SPL|Not checked/);
  });
});
