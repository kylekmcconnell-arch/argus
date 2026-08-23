import { describe, expect, it } from "vitest";
import { honeypotSellLimitWarning } from "./scan";
import type { HoneypotDeep } from "./deepsources";

const deep = (flags: HoneypotDeep["flags"]): HoneypotDeep => ({
  isHoneypot: false,
  reason: null,
  holdersAnalyzed: 0,
  holdersFailed: 0,
  siphoned: 0,
  highTaxWallets: 0,
  averageTax: 0,
  flags,
});

describe("Honeypot.is sell-limit warning", () => {
  it("uses the provider's supported summary flag without inventing a percentage", () => {
    expect(honeypotSellLimitWarning(deep([{
      code: "low_sell_limit",
      text: "The sell limit for the token is low.",
      severity: "critical",
    }]))).toBe("The sell limit for the token is low. (Honeypot.is)");
  });

  it("does not create a warning from unrelated flags", () => {
    expect(honeypotSellLimitWarning(deep([{
      code: "closed_source",
      text: "Source is closed.",
      severity: "high",
    }]))).toBeNull();
  });
});
