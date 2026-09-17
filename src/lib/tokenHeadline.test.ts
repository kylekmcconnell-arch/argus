import { describe, expect, it } from "vitest";
import { tokenPassHeadline } from "./tokenHeadline";

describe("tokenPassHeadline", () => {
  it("does not call an EVM owner-held token owned, or treat an X handle as the team", () => {
    expect(tokenPassHeadline({
      chain: "ethereum",
      ownerRenounced: false,
      lpLocked: false,
      projectX: "@Uniswap",
    })).toBe("Most forensic checks passed. The owner still has control. Liquidity lock or burn was not confirmed. Depth figures are from the selected pool, not the whole market. A public X account on the market record is @Uniswap. That is not independent confirmation of the team.");
  });

  it("does not say a renounced EVM token can still pause trading", () => {
    expect(tokenPassHeadline({
      chain: "ethereum",
      ownerRenounced: true,
      pausable: false,
      lpLocked: false,
      projectX: "@pepecoineth",
    })).toContain("Ownership has been renounced.");
    expect(tokenPassHeadline({
      chain: "ethereum",
      ownerRenounced: true,
      pausable: false,
      lpLocked: false,
    })).not.toMatch(/can still be paused|authorities revoked|Clears the forensic bar|Team:/i);
  });

  it("says LP was burned when that is what was measured", () => {
    expect(tokenPassHeadline({
      chain: "ethereum",
      ownerRenounced: true,
      lpBurned: true,
      lpLocked: true,
    })).toContain("Liquidity-provider tokens were burned");
  });

  it("keeps Solana mint/freeze wording on Solana only", () => {
    expect(tokenPassHeadline({ chain: "solana", ownerRenounced: true, lpLocked: true }))
      .toContain("Mint and freeze authorities have been revoked");
  });
});
