import { afterEach, describe, expect, it, vi } from "vitest";
import { goplusMeta, honeypotDeep, rugcheckReport } from "./deepsources";

describe("deep-source provider normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes RugCheck records without trusting nested response shapes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      score_normalised: "42",
      token: { supply: "100" },
      insiderNetworks: [{ wallets: [{}, {}], tokenAmount: "10" }],
      lockers: { streamflow: { type: "Streamflow", usdcLocked: "50" } },
      totalMarketLiquidity: "100",
      risks: [{ name: "Insider network", level: "high", description: "Linked wallets", score: "7" }],
      rugged: 1,
    }), { status: 200 })));

    await expect(rugcheckReport("mint-address")).resolves.toMatchObject({
      score: 42,
      insidersDetected: 2,
      insiderPct: 10,
      lockerPct: 50,
      lockerNames: ["Streamflow"],
      rugged: true,
      risks: [{ name: "Insider network", score: 7 }],
    });
  });

  it("normalizes GoPlus holder rows and ignores malformed entries", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      result: {
        [address]: {
          fake_token: { value: "1", true_token_address: "0xreal" },
          is_in_cex: { listed: true },
          holders: [null, { address: "0xholder", percent: "0.25", is_contract: "1" }],
          lp_holders: [{ account: "0xlocker", percent: "0.5", is_locked: 1 }],
          total_supply: "1000",
        },
      },
    }), { status: 200 })));

    await expect(goplusMeta("ethereum", address)).resolves.toMatchObject({
      fakeToken: true,
      fakeTokenOf: "0xreal",
      inCex: true,
      holders: [{ address: "0xholder", percent: 25, isContract: true }],
      lpHolders: [{ address: "0xlocker", percent: 50, isLocked: true }],
      totalSupply: 1000,
    });
  });
});

describe("Honeypot.is deep normalization", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses supported summary flags and never treats absolute token limits as percentages", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      summary: {
        flags: [{ flag: "low_sell_limit", description: "The sell limit is unusually low.", severity: "high" }],
      },
      simulationSuccess: true,
      honeypotResult: { isHoneypot: false },
      simulationResult: {
        maxBuy: { token: 500_000, tokenWei: "500000000000000" },
        maxSell: { token: 250_000, tokenWei: "250000000000000" },
      },
      holderAnalysis: { holders: "2", failed: "0", siphoned: "0", highTaxWallets: "0", averageTax: 0 },
    }), { status: 200 })));

    const result = await honeypotDeep("ethereum", "0x0000000000000000000000000000000000000001");

    expect(result?.flags).toContainEqual({
      code: "low_sell_limit",
      text: "The sell limit is unusually low.",
      severity: "high",
    });
    expect(result).not.toHaveProperty("maxBuyPct");
    expect(result).not.toHaveProperty("maxSellPct");
  });
});
