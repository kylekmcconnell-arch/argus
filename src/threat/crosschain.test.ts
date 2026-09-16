import { afterEach, describe, expect, it, vi } from "vitest";

// 2026-09-14 deep-dive review, token lane finding 2. LayerZero OFTs are
// routinely deployed at the SAME address on every chain, and dexByToken answers
// with pairs from all of them. Without a chain filter every peer leg resolved to
// the single deepest pool in the mesh: a $500K Ethereum pool was counted once
// per peer and a $10K Base token asserted a $1.01M mesh, which suppressed every
// thin-liquidity read on the pool the analyst actually scanned.

const { dexByToken } = vi.hoisted(() => ({ dexByToken: vi.fn() }));
vi.mock("../token/sources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../token/sources")>();
  return { ...actual, dexByToken };
});
vi.mock("./net", () => ({
  apiFetch: vi.fn(async () => new Response(JSON.stringify({
    isOft: true, isAdapter: false, endpoint: "0xlz",
    peers: [
      { eid: 30101, chain: "ethereum", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      { eid: 30110, chain: "arbitrum", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
      { eid: 30111, chain: "optimism", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" },
    ],
  }), { status: 200 })),
}));

import { crossChain } from "./crosschain";

const ADDRESS = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
const pair = (chainId: string, usd: number) => ({ chainId, dexId: "uniswap", pairAddress: `0xpool-${chainId}`, baseToken: { address: ADDRESS, name: "OFT", symbol: "OFT" }, liquidity: { usd } });

afterEach(() => vi.clearAllMocks());

describe("OFT mesh liquidity is summed per chain", () => {
  it("each peer leg reads its OWN chain's pool; a peer with no pool on its chain stays unresolved", async () => {
    // Same address everywhere: Ethereum $500K, Base $10K (the scanned leg),
    // Arbitrum $5K, and no Optimism pool at all.
    dexByToken.mockResolvedValue([pair("ethereum", 500_000), pair("base", 10_000), pair("arbitrum", 5_000)]);

    const mesh = await crossChain("base", ADDRESS, 10_000);

    expect(mesh?.legs).toEqual([
      { chain: "base", address: ADDRESS, liquidityUsd: 10_000, self: true },
      { chain: "ethereum", address: ADDRESS, liquidityUsd: 500_000, self: false },
      { chain: "arbitrum", address: ADDRESS, liquidityUsd: 5_000, self: false },
      { chain: "optimism", address: ADDRESS, liquidityUsd: null, self: false },
    ]);
    // Truth is $515K, not $1,010,000 (the deepest pool once per peer).
    expect(mesh?.totalLiquidityUsd).toBe(515_000);
    expect(mesh?.resolvedLegs).toBe(3);
  });
});
