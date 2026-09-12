import { describe, expect, it } from "vitest";
import {
  finiteUsd,
  looksLikeAddress,
  marketVenueName,
  poolIdentityTag,
  poolTapeUsable,
  resolveMarketValuation,
} from "./marketIntegrity";

describe("finiteUsd", () => {
  it("rejects the UNI-style DexScreener overflow and non-numbers", () => {
    expect(finiteUsd(5_495_026_099_675_436)).toBe(false);
    expect(finiteUsd(Number.NaN)).toBe(false);
    expect(finiteUsd(0)).toBe(false);
    expect(finiteUsd(0, true)).toBe(true);
    expect(finiteUsd(3_976_000_000)).toBe(true);
  });
});

describe("marketVenueName", () => {
  it("does not publish a contract address as the venue", () => {
    expect(looksLikeAddress("0xF028F723ED1D0fE01cC59973C49298AA95c57472")).toBe(true);
    expect(marketVenueName("0xF028F723ED1D0fE01cC59973C49298AA95c57472")).toBe("this pool");
    expect(marketVenueName("uniswap")).toBe("Uniswap");
  });
});

describe("resolveMarketValuation", () => {
  it("prefers CoinGecko circulating cap when DexScreener marketCap is unusable", () => {
    expect(resolveMarketValuation({
      pairMarketCap: 5_495_026_099_675_436,
      pairFdv: 5_495_026_099_675_436,
      geckoMcap: 3_976_000_000,
      geckoFdv: 5_650_000_000,
    })).toMatchObject({
      marketCap: 3_976_000_000,
      fdv: 5_650_000_000,
      marketCapSource: "coingecko",
      fdvSource: "coingecko",
      discardedPairMarketCap: true,
      discardedPairFdv: true,
    });
  });

  it("leaves circulating cap unmeasured when every source is unusable", () => {
    expect(resolveMarketValuation({ pairMarketCap: 1e18, pairFdv: 1e18, geckoMcap: null })).toMatchObject({
      marketCap: undefined,
      fdv: undefined,
      discardedPairMarketCap: true,
      discardedPairFdv: true,
    });
  });

  it("keeps a DexScreener cap when CoinGecko is absent and the figure is plausible", () => {
    expect(resolveMarketValuation({ pairMarketCap: 14_976, pairFdv: 14_976, geckoMcap: null })).toMatchObject({
      marketCap: 14_976,
      fdv: 14_976,
      marketCapSource: "dexscreener",
    });
  });
});

describe("poolTapeUsable", () => {
  it("rejects millions of volume with a handful of swaps", () => {
    expect(poolTapeUsable({ volumeUsd: 27_695_047, buys: 1, sells: 2, liquidityUsd: 162_220_055 })).toBe(false);
    expect(poolTapeUsable({ volumeUsd: 1_614_234, buys: 2_322, sells: 1_577, liquidityUsd: 215_863 })).toBe(true);
  });
});

describe("poolIdentityTag", () => {
  it("names the pair without calling an address a venue", () => {
    expect(poolIdentityTag("UNI", "WETH", "this pool")).toBe(" (UNI/WETH pool)");
    expect(poolIdentityTag("UNI", "USDC", "Uniswap")).toBe(" (UNI/USDC on Uniswap)");
  });
});
