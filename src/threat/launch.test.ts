// Launch-provenance detection: the pure venue matcher and the quote-asset
// ramification notes. Fingerprints verified live 2026-08-10 (see RESEARCH.md):
// DexScreener labels are AMM-type only, so venues are identified by mint
// suffix (pump/bonk/Clanker's b07), venue-exclusive dexIds (fourmeme, flapsh),
// or quote-token identity (VIRTUAL, flETH). Pons has NO client fingerprint -
// it is resolved server-side from the token's creator contract.
import { describe, expect, it } from "vitest";
import { matchVenue, genericQuoteNote } from "./launch";

describe("matchVenue", () => {
  it("detects pump.fun by mint vanity suffix regardless of dexId", () => {
    const v = matchVenue("solana", "6dEgs8x4WabZFeNq7BQKzTdgYaLXGeTGyJavGkiSpump", "", null);
    expect(v?.name).toBe("pump.fun");
  });

  it("detects a graduated pump.fun token by the pumpswap dexId", () => {
    const v = matchVenue("solana", "SomeMintWithoutTheSuffix1111111111111111111", "pumpswap", "SOL");
    expect(v?.name).toBe("pump.fun");
  });

  it("detects bonk.fun by suffix even after graduating to plain Raydium", () => {
    const v = matchVenue("solana", "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890bonk", "raydium", "SOL");
    expect(v?.name).toBe("bonk.fun");
  });

  it("does not call an EVM token pump.fun (chain-scoped)", () => {
    expect(matchVenue("base", "0x000000000000000000000000000000000000pump", "uniswap", "WETH")).toBeNull();
  });

  it("returns null for a plain DEX listing (fair launch)", () => {
    expect(matchVenue("ethereum", "0x6982508145454ce325ddbe47a25d4ec3d2311933", "uniswap", "WETH")).toBeNull();
    expect(matchVenue("solana", "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", "raydium", "SOL")).toBeNull();
  });

  it("detects graduated Virtuals by the VIRTUAL quote on Base and Robinhood", () => {
    expect(matchVenue("base", "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", "uniswap", "VIRTUAL")?.name).toBe("virtuals");
    expect(matchVenue("robinhood", "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", "uniswap", "VIRTUAL")?.name).toBe("virtuals");
    // VIRTUAL quote on an unrelated chain is not a Virtuals launch
    expect(matchVenue("ethereum", "0x4F9Fd6Be4a90f2620860d680c0d4d5Fb53d1A825", "uniswap", "VIRTUAL")).toBeNull();
  });

  it("detects Flaunch by the flETH quote", () => {
    expect(matchVenue("base", "0x1234567890123456789012345678901234567890", "uniswap", "flETH")?.name).toBe("flaunch");
  });

  it("detects Clanker (and thus Bankr deploys) by the ...b07 vanity suffix", () => {
    expect(matchVenue("base", "0xA3b9D38210c56B59aC1c1A41F4698fC73cC02B07", "uniswap", "WETH")?.name).toBe("clanker");
  });

  it("splits the LaunchLab family: bonk suffix vs generic launchlab dexId", () => {
    // bonk suffix wins (brand attribution) even on the shared curve dexId
    expect(matchVenue("solana", "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890bonk", "launchlab", "SOL")?.name).toBe("bonk.fun");
    // no suffix on the shared curve -> the family bucket (LetsBonk/Bankr/Raydium-native)
    expect(matchVenue("solana", "3Q2p7KNoPqrstUvWxYz12345678901234567birb", "launchlab", "SOL")?.name).toBe("raydium-launchlab");
  });

  it("detects Bags and Moonit by their venue dexIds and Bags by suffix", () => {
    expect(matchVenue("solana", "SomeMint111111111111111111111111111111BAGS", "meteora", "SOL")?.name).toBe("bags");
    expect(matchVenue("solana", "PlainMint11111111111111111111111111111111", "bags", "SOL")?.name).toBe("bags");
    expect(matchVenue("solana", "PlainMint11111111111111111111111111111111", "moonit", "SOL")?.name).toBe("moonit");
  });

  it("detects four.meme and flap.sh by their venue dexIds", () => {
    expect(matchVenue("bsc", "0x1111111111111111111111111111111111111111", "fourmeme", "WBNB")?.name).toBe("four.meme");
    expect(matchVenue("robinhood", "0x2222222222222222222222222222222222222222", "flapsh", "WETH")?.name).toBe("flap.sh");
  });

  it("has no client fingerprint for Pons (server creator-check territory)", () => {
    // A Pons launch looks exactly like a fair launch from the client's view.
    expect(matchVenue("robinhood", "0xBac573CB56b02D7F1fD285DA5FdC8302C6f27a47", "uniswap", "WETH")).toBeNull();
  });
});

describe("genericQuoteNote", () => {
  it("says nothing for the default gas-token quote", () => {
    expect(genericQuoteNote("SOL", true)).toBeNull();
    expect(genericQuoteNote("WETH", false)).toBeNull();
  });

  it("notes the dollar floor for stable quotes", () => {
    expect(genericQuoteNote("USDC", true)).toMatch(/stable quote/);
    expect(genericQuoteNote("USDG", false)).toMatch(/dollar-denominated/);
  });

  it("warns when the quote is another volatile token", () => {
    expect(genericQuoteNote("BONK", true)).toMatch(/volatile token/);
  });
});
