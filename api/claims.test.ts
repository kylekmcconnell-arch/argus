import { describe, expect, it } from "vitest";

import { extractClaims } from "./claims";

describe("claim extraction", () => {
  it("types the claims a team makes and names who they lean on", () => {
    const text = "Hades is a smart router across Railgun, 0xbow and Houdini - not a Houdini wrapper. Fees from the web product and Robinhood trading are distributed to token holders or via buybacks. Dev wallet locked for several years; no KOLs or snipers at launch. Non-custodial: Hades is an aggregator, not a mixer. Each mixer runs its own OFAC checks. Peer.xyz integration in progress. Built by true cypherpunks.";
    const claims = extractClaims(text, "telegram", "https://t.me/x");
    const kinds = claims.map((c) => c.kind);
    for (const k of ["router", "fees-to-holders", "dev-locked", "no-snipers", "no-custody", "compliance", "partnership", "original"]) expect(kinds).toContain(k);
    const router = claims.find((c) => c.kind === "router")!;
    expect(router.names).toEqual(expect.arrayContaining(["Railgun", "Privacy Pools", "Houdini Swap"]));
    expect(claims.find((c) => c.kind === "partnership")?.names).toContain("Peer.xyz");
    expect(claims.every((c) => c.source === "telegram" && c.url === "https://t.me/x")).toBe(true);
  });

  it("ignores plain product copy that makes no claim", () => {
    expect(extractClaims("Securely move assets across different chains and addresses. Enter an amount for a quote.", "website", null)).toEqual([]);
  });
});
