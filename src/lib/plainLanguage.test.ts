import { describe, expect, it } from "vitest";
import { formatRoleLabel, plainLanguageSummary } from "./plainLanguage";

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

describe("formatRoleLabel", () => {
  it("renders one casing for role chips regardless of source casing", () => {
    expect(formatRoleLabel("ceo")).toBe("CEO");
    expect(formatRoleLabel("Founder & CEO")).toBe("Founder & CEO");
    expect(formatRoleLabel("co-founder and coo")).toBe("Co-Founder and COO");
    expect(formatRoleLabel("head of engineering")).toBe("Head of Engineering");
    expect(formatRoleLabel(undefined)).toBe("");
  });
});
