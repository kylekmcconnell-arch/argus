import { describe, expect, it } from "vitest";

import { judge } from "./scan";
import type { LaunchProvenance } from "./types";

// Regression tests for two signals-in-isolation bugs Enigma caught on SWIRL/KUPO:
// (1) the nft-position LP warning fired even when launch provenance PROVES the
//     venue locks principal (Bankr/Doppler book-entry, Pons locker custody);
// (2) "Thin liquidity" was an absolute $15K floor - $10.8K depth under a $15.5K
//     mcap is a deep market for its size, while $40K under a $2M mcap (which the
//     old check passed silently) is the actual exit trap.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 0, top10Pct: 0, holderCount: 500, lpHolderCount: 1,
  lpLockedPct: 0, creatorPct: 0, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};

function dossier(over: Record<string, unknown> = {}) {
  return {
    address: "0xff23000000000000000000000000000000000bff3", chain: "robinhood",
    symbol: "SWIRL", name: "Swirl Chat", mcap: 15500, fdv: 15500,
    liquidityUsd: 10800, vol24: 500, ageDays: 3,
    safety: { ...SAFETY }, cg: null, socials: [], findings: [],
    ...over,
  } as never;
}

const CODE = { checked: false, verified: false, origin: null, contractName: null, compiler: null, stats: null, flags: [], tokenomics: null, ai: null } as never;
const DEP = { address: null, serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;

function tokenomics(lpStatus: string, note: string) {
  return {
    pools: [{ address: "0xpool", label: "pool", pct: 0 }], cexHeld: [], rewardPools: [],
    lp: { status: lpStatus, burnedPct: 0, lockedPct: 0, unlockedTopPct: 0, lockers: [], note },
    tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
    burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
    realHolderTopPct: 0, note: "",
  } as never;
}

const NFT_NOTE = "Liquidity is a concentrated / NFT position (v4) - it is a position NFT, not an LP token, so the standard lock/burn check doesn't apply here. It can still be withdrawn by whoever owns the position; judge it by the position owner and depth, not by an LP-token lock.";

function ponsLaunch(): LaunchProvenance {
  return {
    kind: "launchpad", venue: "pons", onCurve: false, graduated: true, curveProgressPct: null,
    quote: "WETH", quoteNote: null, lpDisposition: "locked",
    lpNote: "the Uniswap V3 position NFT is transferred to the PonsLaunchLocker at launch - permanent custody, no unlock path for principal",
    creatorFees: null, snipe: null, notes: [],
  };
}

function run(d: never, tk: never, launch: LaunchProvenance | null) {
  return judge(d, CODE, DEP, null, null, null, [], tk, null, null, launch, null, null, null);
}

describe("nft-position LP warning defers to proven venue custody", () => {
  it("venue-locked (Pons/Bankr): positive with the venue note, NO withdrawable warning", () => {
    const call = run(dossier(), tokenomics("nft-position", NFT_NOTE), ponsLaunch());
    expect(call.warnings.join(" ")).not.toMatch(/withdrawn by whoever owns the position/i);
    expect(call.positives.join(" ")).toMatch(/PonsLaunchLocker|no unlock path/i);
  });

  it("no launch provenance: the generic position-NFT caution still shows", () => {
    const call = run(dossier(), tokenomics("nft-position", NFT_NOTE), null);
    expect(call.warnings.join(" ")).toMatch(/withdrawn by whoever owns the position/i);
  });
});

describe("liquidity judged relative to market cap", () => {
  it("SWIRL-shaped ($10.8K liq / $15.5K mcap): deep for its size, not 'thin'", () => {
    const call = run(dossier(), tokenomics("locked", ""), null);
    expect(call.warnings.join(" ")).not.toMatch(/thin liquidity/i);
    expect(call.positives.join(" ")).toMatch(/% of market cap.*deep for the token's size/i);
  });

  it("the real exit trap the old floor missed: $40K liq under a $2M mcap", () => {
    const call = run(dossier({ mcap: 2_000_000, fdv: 2_000_000, liquidityUsd: 40_000 }), tokenomics("locked", ""), null);
    expect(call.warnings.join(" ")).toMatch(/paper value cannot exit/i);
  });

  it("established CEX-listed token is exempt from the ratio read (depth lives off-DEX)", () => {
    const call = run(
      dossier({ mcap: 4_000_000_000, fdv: 4_000_000_000, liquidityUsd: 10_000_000, cg: { cexCount: 12 } }),
      tokenomics("locked", ""), null,
    );
    expect(call.warnings.join(" ")).not.toMatch(/paper value cannot exit|thin liquidity/i);
  });

  it("genuinely thin: small pool AND small share of mcap still warns", () => {
    const call = run(dossier({ mcap: 200_000, fdv: 200_000, liquidityUsd: 9_000 }), tokenomics("locked", ""), null);
    expect(call.warnings.join(" ")).toMatch(/thin liquidity/i);
  });

  it("dust pool always warns regardless of ratio", () => {
    const call = run(dossier({ mcap: 3_000, fdv: 3_000, liquidityUsd: 1_200 }), tokenomics("locked", ""), null);
    expect(call.warnings.join(" ")).toMatch(/dust liquidity/i);
  });
});
