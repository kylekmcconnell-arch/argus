import { describe, expect, it } from "vitest";

import { buildChecks, judge } from "./scan";
import type { ProductAuthenticity } from "./types";
import type { TokenClassification } from "./classify";

const SAFETY = {
  available: true, honeypot: false, cannotSellAll: false, simChecked: false,
  buyTax: 0, sellTax: 0, mintable: false, freezable: false, pausable: false,
  ownerRenounced: true, hiddenOwner: false, takeBack: false, blacklist: false,
  whitelistOnly: false, transferPausable: false, proxy: false, selfDestruct: false,
  externalCall: false, topHolderPct: 2.7, top10Pct: 18, holderCount: 916, lpHolderCount: 1,
  lpLockedPct: 100, creatorPct: 2, antiWhale: false, tradingCooldown: false,
  personalTaxModifiable: false, taxModifiable: false, fakeToken: false, airdropScam: false,
};
const dossier = () => ({
  address: "0x923d915ddf0fe60c04addac68e13f0d5af03164f", chain: "robinhood", symbol: "HADES", name: "Hades",
  mcap: 1_690_000, fdv: 1_690_000, liquidityUsd: 157_000, vol24: 619_000, ageDays: 3,
  safety: { ...SAFETY }, cg: null, socials: [{ label: "Website", url: "https://hades.exchange/" }], findings: [],
}) as never;
const CODE = { checked: true, verified: true, origin: "blockscout", contractName: "PonsV2LauncherToken", compiler: null, stats: { functions: 20, gatedFunctions: 0, dangerHits: 0, isProxy: false, loc: 200 }, flags: [], tokenomics: null, ai: null } as never;
const DEP = { address: "0x5ded38b5b4cbb97a44323609156c3e182e5202ad", serialHoneypoter: false, priorScans: [], priorRugs: 0 } as never;
const TK = {
  pools: [{ address: "0xpool", label: "pool", pct: 4.2 }], cexHeld: [], rewardPools: [],
  lp: { status: "launchpad-locked", burnedPct: 0, lockedPct: 100, unlockedTopPct: 0, lockers: ["Pons"], note: "" },
  tax: { buy: 0, sell: 0, destinations: [], note: "", tone: "neutral" },
  burn: { burnedSupplyPct: 0, hasBurnFunction: false, hasAutoBurn: false, ongoing: false, addresses: [], note: "" },
  realHolderTopPct: 2.7, note: "",
} as never;
const PRIVACY: TokenClassification = { kind: "privacy", confidence: "high", label: "PRIVACY", signals: ["the linked product's own site sells private transfers"], lens: "" };
const MEME: TokenClassification = { kind: "meme", confidence: "low", label: "MEME COIN", signals: [], lens: "" };

const whiteLabel = (claims: string[]): ProductAuthenticity => ({
  url: "https://hades.exchange/", host: "hades.exchange", privacyProduct: true,
  providers: [{ name: "Houdini Swap", kind: "mixer", evidence: ["HOUDINI_AMOUNT_BELOW_MINIMUM", "useXmr"] }],
  backendHosts: ["hades-api-production.up.railway.app"], paasHosts: ["hades-api-production.up.railway.app"],
  originalityClaims: claims, contractsInApp: 0, bundlesRead: 1, read: "white-label", note: "",
});
const run = (cls: TokenClassification, product: ProductAuthenticity | null) =>
  judge(dossier(), CODE, DEP, null, null, null, [], TK, null, null, null, null, null, null, cls, product);

describe("privacy tokens are judged on the product's own code", () => {
  it("a white-label front-end sold as original engineering is a flag with points", () => {
    const honest = run(PRIVACY, whiteLabel([]));
    const claimed = run(PRIVACY, whiteLabel(["true cypherpunks", "built by"]));
    expect(claimed.flags.join(" ")).toMatch(/white-label front-end for Houdini Swap/);
    expect(claimed.flags.join(" ")).toMatch(/"true cypherpunks"/);
    expect(claimed.risk).toBeGreaterThan(honest.risk);
    expect(honest.warnings.join(" ")).toMatch(/front-end for Houdini Swap/);
    expect(honest.flags.join(" ")).not.toMatch(/white-label/);
  });

  it("claims are read from the token's own on-chain description when the site carries none", () => {
    const launch = { kind: "launchpad", venue: "pons", onCurve: false, graduated: null, curveProgressPct: null, quote: "ETH", quoteNote: null, lpDisposition: "locked", lpNote: "", creatorFees: null, snipe: null, notes: [], description: "Built by the OGs growing up on tors and onions. True privacy, built by true cypherpunks." } as never;
    const call = judge(dossier(), CODE, DEP, null, null, null, [], TK, null, null, launch, null, null, null, PRIVACY, whiteLabel([]));
    expect(call.flags.join(" ")).toMatch(/white-label front-end for Houdini Swap/);
    expect(call.flags.join(" ")).toMatch(/"true cypherpunks"|"Built by"|"OGs"/);
    const row = buildChecks(dossier(), CODE, DEP, null, null, null, TK, launch, null, null, null, PRIVACY, null, whiteLabel([])).find((c) => c.key === "product");
    expect(row?.status).toBe("fail");
  });

  it("the sector note is a warning without points, and the mixer-trace bound is stated", () => {
    const none = run(PRIVACY, null);
    const w = none.warnings.join(" ");
    expect(w).toMatch(/mostly mixers and wrappers/);
    expect(w).toMatch(/client could not be read/);
    expect(w).toMatch(/no mixer hop on record, which is a bound on the trace/);
  });

  it("a mixer hop in the deployer's funding trace is a flag", () => {
    const d = { ...(dossier() as object), deployerRisk: { available: true, paths: [{ seed: "0xmixer", seedName: "Tornado Cash", category: "mixer", direction: "backward", score: 90, usd: 5000, hops: 2 }] } } as never;
    const call = judge(d, CODE, DEP, null, null, null, [], TK, null, null, null, null, null, null, PRIVACY, null);
    expect(call.flags.join(" ")).toMatch(/funding trace passes through Tornado Cash/);
  });

  it("a non-privacy token with a white-label product gets a lighter touch", () => {
    const meme = run(MEME, whiteLabel(["proprietary"]));
    const priv = run(PRIVACY, whiteLabel(["proprietary"]));
    expect(meme.flags.join(" ")).toMatch(/white-label/);
    expect(priv.risk).toBeGreaterThan(meme.risk);
    expect(meme.warnings.join(" ")).not.toMatch(/mostly mixers/);
  });

  it("the check row names the read", () => {
    const rows = buildChecks(dossier(), CODE, DEP, null, null, null, TK, null, null, null, null, PRIVACY, null, whiteLabel(["OGs"]));
    const row = rows.find((c) => c.key === "product");
    expect(row?.status).toBe("fail");
    expect(row?.detail).toMatch(/White-label of Houdini Swap sold as original engineering/);
    const none = buildChecks(dossier(), CODE, DEP, null, null, null, TK, null, null, null, null, MEME, null, null).find((c) => c.key === "product");
    expect(none?.status).toBe("na");
  });
});
