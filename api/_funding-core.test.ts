import { afterEach, describe, expect, it, vi } from "vitest";

import { currentTokenBalance, seedFundingSource, type ProviderUsage } from "./_funding-core";

const URL = "https://helius.example/rpc";
const WALLET = "RecipientWallet111111111111111111111111111";
const FUNDER = "SeedFunder1111111111111111111111111111";

function rpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function transaction(instructions: unknown[] = []) {
  return {
    transaction: {
      message: {
        instructions,
        accountKeys: [],
      },
    },
    meta: {
      innerInstructions: [],
      preBalances: [],
      postBalances: [],
    },
  };
}

function tokenAccount(uiAmount: unknown, uiAmountString?: unknown) {
  return {
    account: {
      data: {
        parsed: {
          info: {
            tokenAmount: { uiAmount, uiAmountString },
          },
        },
      },
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("seedFundingSource", () => {
  it("leaves the seed funder unresolved when an older transaction is unreadable", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(rpcResponse(transaction([{
        parsed: { type: "transfer", info: { destination: WALLET, source: FUNDER } },
      }])));
    vi.stubGlobal("fetch", fetchMock);
    const usage: ProviderUsage = { calls: 0, succeeded: 0 };

    const result = await seedFundingSource(URL, WALLET, ["oldest", "later-top-up"], usage);

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({ calls: 1, succeeded: 0 });
  });

  it("can continue past a readable non-funding transaction", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(rpcResponse(transaction()))
      .mockResolvedValueOnce(rpcResponse(transaction([{
        parsed: { type: "transfer", info: { destination: WALLET, source: FUNDER } },
      }])));
    vi.stubGlobal("fetch", fetchMock);
    const usage: ProviderUsage = { calls: 0, succeeded: 0 };

    const result = await seedFundingSource(URL, WALLET, ["oldest", "first-funding"], usage);

    expect(result).toBe(FUNDER);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage).toEqual({ calls: 2, succeeded: 2 });
  });
});

describe("currentTokenBalance", () => {
  it("uses uiAmountString when Solana omits the numeric uiAmount", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcResponse({
      value: [tokenAccount(null, "123.5"), tokenAccount(1.5, "1.5")],
    })));
    const usage: ProviderUsage = { calls: 0, succeeded: 0 };

    await expect(currentTokenBalance(URL, WALLET, "Mint111", usage)).resolves.toBe(125);
  });

  it("returns unknown instead of zero for an unreadable nonempty token account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcResponse({
      value: [tokenAccount(null, "not-a-number")],
    })));
    const usage: ProviderUsage = { calls: 0, succeeded: 0 };

    await expect(currentTokenBalance(URL, WALLET, "Mint111", usage)).resolves.toBeNull();
  });

  it("keeps an empty, successfully read account list as a measured zero", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(rpcResponse({ value: [] })));
    const usage: ProviderUsage = { calls: 0, succeeded: 0 };

    await expect(currentTokenBalance(URL, WALLET, "Mint111", usage)).resolves.toBe(0);
  });
});
