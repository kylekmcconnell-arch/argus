import { afterEach, describe, expect, it, vi } from "vitest";
import { blockscoutHolders, coingeckoToken, pickPair, GOPLUS_CHAIN, GOPLUS_UNSORTED_HOLDER_CHAINS, type DexPair } from "./sources";

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

describe("blockscoutHolders", () => {
  const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  const holderBody = (rows: Array<[string, string]>) => ({
    items: rows.map(([hash, value]) => ({ value, address: { hash, is_contract: false } })),
  });

  it("returns real percentages ordered by balance, from the chain's own explorer", async () => {
    // The observed $MUMU shape: GoPlus put every row near 0.36%, the explorer
    // shows the true leader at 4.17%.
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/holders")) {
        return json(holderBody([
          ["0x5d25149b5710f4df0a485F075668e1649c4bb2f9", "41674763862759845422483882"],
          ["0x9Ba5eD49FD86EE032dE2C3e7229b4E0836767C92", "23689988172362018879509934"],
        ]));
      }
      return json({ total_supply: "1000000000000000000000000000" });
    }));

    const holders = await blockscoutHolders("robinhood", "0x8eC17C059f250A5c19566C3fC56EE13A343dD283");
    expect(holders).toHaveLength(2);
    expect(holders?.[0].address).toBe("0x5d25149b5710f4df0a485F075668e1649c4bb2f9");
    expect(holders?.[0].percent).toBeCloseTo(4.17, 2);
    expect(holders?.[1].percent).toBeCloseTo(2.37, 2);
  });

  it("returns null for a chain with no configured explorer, and on a failed lookup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ total_supply: "0" })));
    expect(await blockscoutHolders("ethereum", "0xabc")).toBeNull();
    expect(await blockscoutHolders("robinhood", "0xabc")).toBeNull();
  });

  it("marks Robinhood Chain holder ordering as untrusted from GoPlus", () => {
    expect(GOPLUS_UNSORTED_HOLDER_CHAINS.has("robinhood")).toBe(true);
    expect(GOPLUS_UNSORTED_HOLDER_CHAINS.has("ethereum")).toBe(false);
    // The chain is configured for GoPlus safety data even so.
    expect(GOPLUS_CHAIN.robinhood).toBe("4663");
  });
});
