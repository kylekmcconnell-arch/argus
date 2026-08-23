import { afterEach, describe, expect, it, vi } from "vitest";
import { honeypotDeep } from "./deepsources";

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
