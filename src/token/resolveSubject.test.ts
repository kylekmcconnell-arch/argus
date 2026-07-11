import { afterEach, describe, expect, it, vi } from "vitest";
import type { TokenInput } from "../lib/resolveInput";
import { resolveTokenSubject } from "./resolveSubject";

const SOLANA = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
const OTHER_SOLANA = "9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump";

function response(body: unknown, ok = true): Response {
  return { ok, json: async () => body } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});
describe("resolveTokenSubject", () => {
  it("recovers the canonical case of a historical lower-cased Solana mint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      pairs: [{
        chainId: "solana",
        dexId: "raydium",
        pairAddress: "pair-one",
        liquidity: { usd: 12_000 },
        baseToken: { address: SOLANA, symbol: "PEPEBULL", name: "Pepe Bull" },
      }],
    })));

    const input: TokenInput = { kind: "token", ref: SOLANA.toLowerCase(), via: "address-candidate" };
    await expect(resolveTokenSubject(input)).resolves.toMatchObject({
      state: "resolved",
      candidate: {
        canonicalRef: SOLANA,
        input: { kind: "token", ref: SOLANA, via: "solana" },
      },
    });
  });

  it("keeps only exact ticker matches, dedupes pairs, and never silently chooses a contract", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({
      pairs: [
        {
          chainId: "solana", dexId: "raydium", pairAddress: "pair-low", liquidity: { usd: 100 },
          baseToken: { address: SOLANA, symbol: "PEPEBULL", name: "Pepe Bull" },
        },
        {
          chainId: "solana", dexId: "orca", pairAddress: "pair-high", liquidity: { usd: 500 },
          baseToken: { address: SOLANA, symbol: "pepebull", name: "Pepe Bull" },
        },
        {
          chainId: "solana", dexId: "raydium", pairAddress: "pair-two", liquidity: { usd: 300 },
          baseToken: { address: OTHER_SOLANA, symbol: "PEPEBULL", name: "Other Pepe Bull" },
        },
        {
          chainId: "solana", dexId: "raydium", pairAddress: "fuzzy", liquidity: { usd: 999_999 },
          baseToken: { address: "4Nd1mYdK9BvQ6ZpH3xJtG7wRc2sLf8Ua5eKoPiNmAbCd", symbol: "PEPEBULL2", name: "Fuzzy" },
        },
      ],
    })));

    const result = await resolveTokenSubject({ kind: "token", ref: "$PEPEBULL", via: "ticker" });
    expect(result.state).toBe("ambiguous");
    if (result.state !== "ambiguous") return;
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map((candidate) => candidate.canonicalRef)).toEqual([SOLANA, OTHER_SOLANA]);
    expect(result.candidates[0].pairAddress).toBe("pair-high");
  });

  it("preserves provider failure instead of falling through to a person audit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response({}, false)));
    await expect(resolveTokenSubject({ kind: "token", ref: "$NOPE", via: "ticker" }))
      .resolves.toEqual({ state: "unavailable" });
  });

  it("canonicalizes an EVM address to lowercase", async () => {
    const checksum = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
    vi.stubGlobal("fetch", vi.fn(async () => response({
      pairs: [{
        chainId: "ethereum",
        dexId: "uniswap",
        pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        liquidity: { usd: 10_000 },
        baseToken: { address: checksum, symbol: "UNI", name: "Uniswap" },
      }],
    })));

    await expect(resolveTokenSubject({ kind: "token", ref: checksum, via: "evm" }))
      .resolves.toMatchObject({
        state: "resolved",
        candidate: {
          canonicalRef: checksum.toLowerCase(),
          input: { ref: checksum.toLowerCase(), via: "evm" },
        },
      });
  });
});
