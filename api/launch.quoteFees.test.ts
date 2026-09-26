import { describe, expect, it } from "vitest";

import { classifyQuoteFeeUsage } from "./launch";

describe("quote-asset creator fee conduct (Pons v2)", () => {
  const base = { claimCount: 0, claimedEth: 0, claimedTokenTransfers: 0, boughtBackTokens: 0, quoteForwardedEth: 0, firstClaimAt: null };
  it("no claims is unknown and says the promise is unrealised", () => {
    expect(classifyQuoteFeeUsage(base)).toMatchObject({ usage: "unknown" });
    expect(classifyQuoteFeeUsage(base).note).toMatch(/unrealised/);
  });
  it("a buyback after claiming is a buyback; forwarding most of the ETH on is a dump; sitting on it is hold", () => {
    expect(classifyQuoteFeeUsage({ ...base, claimCount: 3, claimedEth: 2, boughtBackTokens: 1_000_000, firstClaimAt: 1 }, "HADES")).toMatchObject({ usage: "buyback" });
    expect(classifyQuoteFeeUsage({ ...base, claimCount: 3, claimedEth: 2, quoteForwardedEth: 1.8, firstClaimAt: 1 })).toMatchObject({ usage: "dump" });
    expect(classifyQuoteFeeUsage({ ...base, claimCount: 3, claimedEth: 2, firstClaimAt: 1 })).toMatchObject({ usage: "hold" });
  });
});
