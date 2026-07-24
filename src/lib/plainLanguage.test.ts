import { describe, expect, it } from "vitest";
import { plainLanguageSummary } from "./plainLanguage";

describe("plainLanguageSummary", () => {
  it("translates internal research shorthand without changing facts", () => {
    expect(plainLanguageSummary(
      "The canonical project token has first-party support and on-chain liveness. Identity resolution is complete.",
    )).toBe(
      "The official token has official support and blockchain activity. Identity check is complete.",
    );
  });

  it("makes scoring and graph language readable", () => {
    expect(plainLanguageSummary(
      "The governing score uses evidence-backed findings after trust-graph reconciliation.",
    )).toBe(
      "The final score uses source-supported findings after connection cross-check.",
    );
  });

  it("keeps URLs, amounts, tickers, and names unchanged", () => {
    const text = "$VVV has $567M market cap. Source: https://venice.ai.";
    expect(plainLanguageSummary(text)).toBe(text);
  });
});
