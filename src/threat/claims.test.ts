import { describe, expect, it } from "vitest";

import { claimsScore, judgeClaims, type ClaimEvidence } from "./claims";
import type { ProductAuthenticity, ProjectClaim } from "./types";

const claim = (kind: ProjectClaim["kind"], text: string, names: string[] = []): ProjectClaim => ({ kind, text, source: "telegram", url: null, names });
const houdini: ProductAuthenticity = {
  url: "https://hades.exchange/", host: "hades.exchange", privacyProduct: true,
  providers: [{ name: "Houdini Swap", kind: "mixer", evidence: ["HOUDINI_AMOUNT_BELOW_MINIMUM"] }],
  backendHosts: [], paasHosts: ["hades-api-production.up.railway.app"], originalityClaims: [], contractsInApp: 0, bundlesRead: 1, read: "white-label", note: "",
  api: { base: "https://hades-api-production.up.railway.app", service: "bifrost-private-api", endpoints: ["/privacy/quotes/preview"], errorCodes: [], providers: [] },
};
const ev = (over: Partial<ClaimEvidence> = {}): ClaimEvidence => ({ product: houdini, launch: null, sellers: null, tokenomics: null, lockedHolderPct: 0, deployerMixerHop: null, ...over });

describe("claims against evidence", () => {
  it("a router claim naming protocols the client never loads is contradicted, with the shown provider and service named", () => {
    const [v] = judgeClaims([claim("router", "Smart router across Railgun, 0xbow and Houdini", ["Railgun", "Privacy Pools", "Houdini Swap"])], ev());
    expect(v.status).toBe("contradicted");
    expect(v.evidence).toMatch(/expose Houdini Swap only \(service "bifrost-private-api"\); Railgun, Privacy Pools appear nowhere/);
  });

  it("a router claim naming only what the client loads is confirmed; one naming nothing on a single-provider client is contradicted", () => {
    expect(judgeClaims([claim("router", "routes via Houdini", ["Houdini Swap"])], ev())[0].status).toBe("confirmed");
    expect(judgeClaims([claim("router", "picks the fastest route across protocols")], ev())[0].status).toBe("contradicted");
  });

  it("fees-to-holders is unrealised with no claims, contradicted on a dump, confirmed on a buyback", () => {
    const launch = (usage: string, count: number) => ({ kind: "launchpad", venue: "pons", onCurve: false, graduated: null, curveProgressPct: null, quote: "ETH", quoteNote: null, lpDisposition: "locked", lpNote: "", creatorFees: { platformPays: true, asset: "quote", claimCount: count, claimedUsd: null, quoteClaims: { count, eth: 1, tokenPayouts: 0 }, usage, note: "n" }, snipe: null, notes: [] }) as never;
    const c = claim("fees-to-holders", "Fees distributed to token holders or via buybacks");
    expect(judgeClaims([c], ev({ launch: launch("unknown", 0) }))[0].status).toBe("unrealised");
    expect(judgeClaims([c], ev({ launch: launch("dump", 4) }))[0].status).toBe("contradicted");
    expect(judgeClaims([c], ev({ launch: launch("buyback", 2) }))[0].status).toBe("confirmed");
  });

  it("no-snipers is contradicted by same-block buyers or tape snipers, confirmed by a quiet launch window", () => {
    const c = claim("no-snipers", "no KOLs or snipers at launch");
    const launch = (n: number) => ({ kind: "launchpad", venue: "pons", onCurve: false, graduated: null, curveProgressPct: null, quote: "ETH", quoteNote: null, lpDisposition: "locked", lpNote: "", creatorFees: null, snipe: { sameBlockBuyers: n, pctOfSupply: 11, window: "first block" }, notes: [] }) as never;
    expect(judgeClaims([c], ev({ launch: launch(4) }))[0].status).toBe("contradicted");
    expect(judgeClaims([c], ev({ launch: launch(1) }))[0].status).toBe("confirmed");
    const sellers = { available: true, devSold: false, sellerCount: 5, badSellerCount: 2, topSellers: [{ wallet: "a", sameBlockSniper: true }, { wallet: "b", sameBlockSniper: true }], note: "" } as never;
    expect(judgeClaims([c], ev({ sellers }))[0].status).toBe("contradicted");
    expect(judgeClaims([c], ev())[0].status).toBe("unverifiable");
  });

  it("dev-locked is confirmed by a recognised locker in the holder table", () => {
    const c = claim("dev-locked", "Dev wallet locked for several years");
    expect(judgeClaims([c], ev({ lockedHolderPct: 2.07 }))[0]).toMatchObject({ status: "confirmed" });
    expect(judgeClaims([c], ev())[0].status).toBe("unverifiable");
  });

  it("no-custody on a mixer white-label is contradicted; compliance and partnerships stay unverifiable", () => {
    const vs = judgeClaims([claim("no-custody", "aggregator, not a mixer"), claim("compliance", "each mixer runs OFAC checks"), claim("partnership", "Peer.xyz integration in progress", ["Peer.xyz"])], ev());
    expect(vs.map((v) => v.status)).toEqual(["contradicted", "unverifiable", "unverifiable"]);
    expect(vs[1].evidence).toMatch(/Houdini Swap's/);
  });

  it("scores contradictions with a cap and turns each status into the right tier", () => {
    const vs = judgeClaims([
      claim("router", "router across Railgun", ["Railgun"]), claim("no-custody", "non-custodial"), claim("router", "aggregates protocols"), claim("router", "multi-protocol"),
      claim("compliance", "OFAC"),
    ], ev());
    const s = claimsScore(vs);
    expect(s.points).toBe(24);
    expect(s.flags).toHaveLength(4);
    expect(s.flags[0]).toMatch(/^Contradicted router claim \(telegram\): "router across Railgun"/);
    expect(s.warnings).toHaveLength(0);
  });
});
