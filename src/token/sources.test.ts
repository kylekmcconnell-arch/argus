import { describe, expect, it } from "vitest";
import { pickPair, type DexPair } from "./sources";

const SOLANA_A = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
const SOLANA_B = "52hNeKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";

const pair = (address: string, liquidity: number): DexPair => ({
  chainId: "solana",
  dexId: "raydium",
  pairAddress: `pair-${liquidity}`,
  liquidity: { usd: liquidity },
  baseToken: { address, name: "Same", symbol: "SAME" },
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
});
