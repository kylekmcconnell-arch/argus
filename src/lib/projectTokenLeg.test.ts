import { describe, expect, it } from "vitest";
import { tokenFromBio, tokenFromPromotions } from "./projectTokenLeg";

const EVM = "0x6982508145454Ce325dDbE47a25d4ec3d2311933"; // $PEPE
const SOL = "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263"; // $BONK

describe("tokenFromBio", () => {
  it("finds an EVM contract stated in the bio", () => {
    const c = tokenFromBio(`The people's frog. CA: ${EVM} - no tax, no games.`);
    expect(c).toMatchObject({ address: EVM, via: "evm" });
  });

  it("finds a Solana mint as a standalone word", () => {
    const c = tokenFromBio(`$BONK - the dog coin of Solana\n${SOL}`);
    expect(c).toMatchObject({ address: SOL, via: "solana" });
  });

  it("prefers the EVM contract when both appear", () => {
    expect(tokenFromBio(`${SOL} ${EVM}`)?.via).toBe("evm");
  });

  it("does not false-positive on prose, handles, or URLs", () => {
    expect(tokenFromBio("Building the future of onchain finance | DeFi maxi | jup.ag")).toBeNull();
    expect(tokenFromBio("")).toBeNull();
    // 31 base58 chars - one short of a plausible mint.
    expect(tokenFromBio("a".repeat(31))).toBeNull();
    // base58 run embedded in a longer non-base58 token (0/O/l break it apart
    // but the fragments stay under 32 chars).
    expect(tokenFromBio("x".repeat(20) + "0" + "x".repeat(20))).toBeNull();
  });
});

describe("tokenFromPromotions", () => {
  it("takes the first promotion carrying a plausible contract", () => {
    const c = tokenFromPromotions([
      { ticker: "$VAPOR" }, // ticker-only claim: nothing to scan
      { ticker: "PEPE", contract_address: EVM, chain: "ethereum" },
    ]);
    expect(c).toMatchObject({ address: EVM, via: "evm" });
    expect(c?.source).toContain("$PEPE");
  });

  it("maps the chain field to the scan route and infers it from format when absent", () => {
    expect(tokenFromPromotions([{ contract_address: SOL, chain: "solana" }])?.via).toBe("solana");
    expect(tokenFromPromotions([{ contract_address: SOL }])?.via).toBe("solana");
    expect(tokenFromPromotions([{ contract_address: EVM }])?.via).toBe("evm");
  });

  it("rejects malformed addresses instead of scanning garbage", () => {
    expect(tokenFromPromotions([{ contract_address: "0x1234", chain: "ethereum" }])).toBeNull();
    expect(tokenFromPromotions([{ contract_address: "not-an-address", chain: "solana" }])).toBeNull();
    expect(tokenFromPromotions([])).toBeNull();
    expect(tokenFromPromotions(undefined)).toBeNull();
  });
});
