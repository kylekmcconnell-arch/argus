import { describe, expect, it } from "vitest";
import { assetIdentity, marketObservation } from "./assetIdentity";
const address = "0x1111111111111111111111111111111111111111";
describe("identity-bound market outcomes", () => {
  it("keeps chain and base58 case while normalizing EVM case", () => {
    expect(assetIdentity("solana", "So111")).not.toBe(assetIdentity("solana", "so111"));
    expect(assetIdentity("base", address)).not.toBe(assetIdentity("ethereum", address));
    expect(assetIdentity("base", `0x${"A".repeat(40)}`)).toBe(assetIdentity("base", `0x${"a".repeat(40)}`));
  });
  it.each([undefined, null, NaN, Infinity, -1, "0"])("does not invent a zero from %s", (usd) => {
    expect(marketObservation({ pairs: [{ chainId: "ethereum", baseToken: { address }, liquidity: { usd } }] }, "ethereum", address)).toEqual({ kind: "malformed" });
  });
  it("keeps measured zero and confirmed empty separate", () => {
    expect(marketObservation({ pairs: [] }, "ethereum", address)).toEqual({ kind: "no_pair", liquidityUsd: 0 });
    expect(marketObservation({ pairs: [{ chainId: "ethereum", baseToken: { address }, liquidity: { usd: 0 } }] }, "ethereum", address)).toEqual({ kind: "measured", liquidityUsd: 0 });
  });
  it("cannot mask an Ethereum collapse with Base liquidity", () => {
    expect(marketObservation({ pairs: [
      { chainId: "ethereum", baseToken: { address }, liquidity: { usd: 0 } },
      { chainId: "base", baseToken: { address }, liquidity: { usd: 50000 } },
    ] }, "ethereum", address)).toEqual({ kind: "measured", liquidityUsd: 0 });
  });
});
