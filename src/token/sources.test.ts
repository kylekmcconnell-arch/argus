import { afterEach, describe, expect, it, vi } from "vitest";
import { coingeckoToken, pickPair, type DexPair } from "./sources";

const SOLANA_A = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
const SOLANA_B = "52hNeKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";

const pair = (address: string, liquidity: number): DexPair => ({
  chainId: "solana",
  dexId: "raydium",
  pairAddress: `pair-${liquidity}`,
  liquidity: { usd: liquidity },
  baseToken: { address, name: "Same", symbol: "SAME" },
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickPair", () => {
  it("does not case-fold a Solana mint into a different higher-liquidity token", () => {
    expect(pickPair([pair(SOLANA_B, 100), pair(SOLANA_A, 10)], SOLANA_A)?.baseToken?.address)
      .toBe(SOLANA_A);
  });

  it("still treats EVM address casing as equivalent", () => {
    const address = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
    const checksumCase = "0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD";
    const evm = { ...pair(checksumCase, 10), chainId: "ethereum" };
    expect(pickPair([evm], address)?.baseToken?.address).toBe(checksumCase);
  });

  it("freezes CoinGecko lifetime ATH context with the market record", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      tickers: [],
      market_cap_rank: 18,
      links: { homepage: [], twitter_screen_name: "" },
      market_data: {
        market_cap: { usd: 8_000_000_000 },
        ath: { usd: 44.92 },
        ath_date: { usd: "2021-05-03T00:00:00.000Z" },
        ath_change_percentage: { usd: -87.4 },
      },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await expect(coingeckoToken("ethereum", "0x1111111111111111111111111111111111111111"))
      .resolves.toMatchObject({
        listed: true,
        mcapUsd: 8_000_000_000,
        ath: {
          priceUsd: 44.92,
          date: "2021-05-03T00:00:00.000Z",
          drawdownPct: -87.4,
        },
      });
  });
});
