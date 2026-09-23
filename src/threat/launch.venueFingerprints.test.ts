import { describe, expect, it } from "vitest";

import { creatorFeeAssetNote, matchVenue } from "./launch";

// Venue fingerprints established by the launchpad study (docs/launchpads/,
// read 2026-09-23): LONG mines every token address to end in ...1e18, and
// Doppler-era Bankr tokens end in ...ba3, on Robinhood Chain and Base.

describe("Robinhood Chain venue fingerprints", () => {
  it("detects LONG by the ...1e18 suffix on Robinhood Chain (AI, MEME, TAIWAN)", () => {
    expect(matchVenue("robinhood", "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18", "uniswap", "NVDA")?.name).toBe("long");
    expect(matchVenue("robinhood", "0x385f4f8ae47651ce5f58f5265395a669f8281e18", "uniswap", "USDG")?.name).toBe("long");
    expect(matchVenue("robinhood", "0xaa0b48defde440b8445ba45db88cb076cf261e18", "uniswap", "TSM")?.name).toBe("long");
  });

  it("does not call a 1e18-suffixed token on another chain LONG", () => {
    expect(matchVenue("base", "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18", "uniswap", "WETH")?.name).not.toBe("long");
    expect(matchVenue("ethereum", "0x2E8c31162b855A2ffa90F6F8634643Ad6F111e18", "uniswap", "WETH")).toBeNull();
  });

  it("detects Doppler-era Bankr by the ...ba3 suffix on both chains (musebook, Agrippa)", () => {
    expect(matchVenue("robinhood", "0x91a2dae9699f0b82540b5886b0d8759c22820ba3", "uniswap", "META")?.name).toBe("bankr");
    expect(matchVenue("robinhood", "0x83a49b808f8d5e02cb2931cd2352988f498e5ba3", "uniswap", "musebook")?.name).toBe("bankr");
    expect(matchVenue("base", "0x3722264ab15a1dfce5a5af89e6547f7949a8aba3", "uniswap", "WETH")?.name).toBe("bankr");
  });

  it("still tells Clanker-era Bankr (...b07) apart from Doppler-era (...ba3)", () => {
    expect(matchVenue("base", "0xb695559b26bb2c9703ef1935c37aeae9526bab07", "uniswap", "WETH")?.name).toBe("clanker");
  });

  it("reports the fee asset the venue pays creators in", () => {
    expect(matchVenue("robinhood", "0x385f4f8ae47651ce5f58f5265395a669f8281e18", "uniswap", "USDG")?.creatorFeeAsset).toBe("mixed");
    expect(matchVenue("robinhood", "0x91a2dae9699f0b82540b5886b0d8759c22820ba3", "uniswap", "META")?.creatorFeeAsset).toBe("mixed");
    expect(matchVenue("solana", "6dEgs8x4WabZFeNq7BQKzTdgYaLXGeTGyJavGkiSpump", "", null)?.creatorFeeAsset).toBe("quote");
  });
});

describe("creatorFeeAssetNote is a disclosure, not a finding", () => {
  it("says nothing for a venue that pays in the quote asset", () => {
    expect(creatorFeeAssetNote("pump.fun", "quote", "SOL")).toBeNull();
    expect(creatorFeeAssetNote("four.meme", "none", "BNB")).toBeNull();
    expect(creatorFeeAssetNote("flap.sh", "unknown", "BNB")).toBeNull();
  });

  it("states the mechanism and names the quote for a mixed-asset venue", () => {
    const n = creatorFeeAssetNote("long", "mixed", "NVDA")!;
    expect(n).toMatch(/mix of the token and NVDA/);
    expect(n).toMatch(/not a finding/);
  });
});
