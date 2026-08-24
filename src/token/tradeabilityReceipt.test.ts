import { describe, expect, it } from "vitest";
import { recordObservedTradeability, type NormalizedSafety } from "./audit";
import { hasCompleteGoplusTradeability } from "./sources";

const safety = {
  tradeabilityAssessed: false,
} as NormalizedSafety;

describe("tradeability receipts", () => {
  it("requires every documented GoPlus trading outcome instead of treating blanks as zero", () => {
    expect(hasCompleteGoplusTradeability({
      is_in_dex: "1",
      buy_tax: "0",
      sell_tax: "0",
      cannot_sell_all: "0",
    })).toBe(true);
    expect(hasCompleteGoplusTradeability({
      is_in_dex: "1",
      buy_tax: "",
      sell_tax: "",
    })).toBe(false);
  });

  it("records two-sided market activity without calling it a simulation", () => {
    const recorded = recordObservedTradeability(safety, {
      buys24h: 2_322,
      sells24h: 1_577,
      liquidityUsd: 215_863,
    });

    expect(recorded).toMatchObject({
      tradeabilityAssessed: true,
      tradeabilityMethod: "observed-market",
      observedBuys24h: 2_322,
      observedSells24h: 1_577,
    });
    expect(recorded.simChecked).not.toBe(true);
  });

  it("keeps one-sided or illiquid activity unresolved", () => {
    expect(recordObservedTradeability(safety, { buys24h: 10, sells24h: 0, liquidityUsd: 100_000 }))
      .toBe(safety);
    expect(recordObservedTradeability(safety, { buys24h: 10, sells24h: 5, liquidityUsd: 0 }))
      .toBe(safety);
  });
});
