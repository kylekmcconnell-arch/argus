import { describe, expect, it } from "vitest";

import { judge } from "./scan";
import type { LaunchProvenance } from "./types";

// The fee model is a note, never a demerit. The warning is reserved for a
// creator observed claiming and selling the token leg without balancing it.

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 0, top10Pct: 0, holderCount: 4700, lpHolderCount: 1,
  lpLockedPct: 0, creatorPct: 0, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};
const dossier = () => ({
  address: "0x385f4f8ae47651ce5f58f5265395a669f8281e18", chain: "robinhood", symbol: "MEME", name: "A Meme Coin",
  mcap: 25_800_000, fdv: 25_800_000, liquidityUsd: 2_200_000, vol24: 3_900_000, ageDays: 20,
  safety: { ...SAFETY }, cg: null, socials: [], findings: [],
}) as never;
const CODE = { checked: false, verified: false, origin: null, contractName: null, compiler: null, stats: null, flags: [], tokenomics: null, ai: null } as never;
const DEP = { address: null, serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [{ address: "0xpool", label: "pool", pct: 0 }], cexHeld: [], rewardPools: [],
  lp: { status: "launchpad-locked", burnedPct: 0, lockedPct: 100, unlockedTopPct: 0, lockers: ["Doppler"], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 0, note: "",
} as never;

function longLaunch(fees: Partial<NonNullable<LaunchProvenance["creatorFees"]>>): LaunchProvenance {
  return {
    kind: "launchpad", venue: "long", onCurve: false, graduated: null, curveProgressPct: null,
    quote: "USDG", quoteNote: null, lpDisposition: "locked", lpNote: "locked book-entry inside Doppler's initializer",
    creatorFees: { platformPays: true, asset: "mixed", claimCount: null, claimedUsd: null, usage: "unknown", note: "venue note", ...fees },
    snipe: null, notes: [],
  };
}
const run = (launch: LaunchProvenance) => judge(dossier(), CODE, DEP, null, null, null, [], TK, null, null, launch, null, null, null);

describe("creator fee asset is a note, conduct is the warning", () => {
  it("a mixed-asset venue with no observed claims changes nothing", () => {
    const withVenue = run(longLaunch({}));
    const quoteVenue = run({ ...longLaunch({}), creatorFees: { platformPays: true, asset: "quote", claimCount: null, claimedUsd: null, usage: "unknown", note: "venue note" } });
    expect(withVenue.risk).toBe(quoteVenue.risk);
    expect(withVenue.warnings.join(" ")).not.toMatch(/claim/i);
    expect(withVenue.flags.join(" ")).not.toMatch(/fee/i);
  });

  it("a creator observed claiming and selling repeatedly draws the warning, with the cadence", () => {
    const call = run(longLaunch({ claimCount: 28, claimedTokens: 5_010_685, usage: "dump", note: "28 claims of 5,010,685 MEME; 5,000,000 (100%) sold" }));
    const w = call.warnings.join(" ");
    expect(w).toMatch(/keeps claiming long fees across 28 claims and selling them/);
    expect(w).toMatch(/claims arrive in the token/);
    expect(w).toMatch(/no buyback or burn balancing it/);
    expect(call.risk).toBeGreaterThan(run(longLaunch({})).risk);
  });

  it("a creator who burns the claims earns the positive instead", () => {
    const call = run(longLaunch({ claimCount: 5, usage: "buyback-burn", note: "5 claims; 900 burned." }));
    expect(call.positives.join(" ")).toMatch(/buys back and burns/);
    expect(call.warnings.join(" ")).not.toMatch(/keeps claiming/);
  });
});
