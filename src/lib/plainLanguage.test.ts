import { describe, expect, it } from "vitest";
import {
  formatRoleLabel,
  plainLanguageSummary,
  publicConcernTitle,
  publicCheckLabel,
  publicCheckNote,
  publicEntityLabel,
  publicRelationshipLabel,
} from "./plainLanguage";

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

  it("replaces internal axis ids with their labels", () => {
    expect(plainLanguageSummary(
      "Investigation incomplete: substantive evidence is missing for I2_portfolio_quality.",
    )).toBe(
      "Investigation incomplete: meaningful evidence is missing for portfolio quality.",
    );
  });

  it("keeps URLs, amounts, tickers, and names unchanged", () => {
    const text = "$VVV has $567M market cap. Source: https://venice.ai.";
    expect(plainLanguageSummary(text)).toBe(text);
  });
});

describe("public report labels", () => {
  it("keeps promotional source copy out of public concern titles", () => {
    expect(publicConcernTitle({
      axis: "P2_product_substance",
      axisLabel: "Product and execution",
      gap: "One of our biggest releases. SuperDeepseek-V4-Flash is now live 💪",
    })).toBe("A live product could not be independently verified.");

    expect(publicConcernTitle({
      axis: "P2_product_substance",
      axisLabel: "Product and execution",
      gap: "The official site still presents an early-access page",
    })).toBe("The official site still presents an early-access page.");
  });

  it("turns check IDs into stable reader labels", () => {
    expect(publicCheckLabel("deployer-trail-evm")).toBe("Who created the token");
    expect(publicCheckLabel("trust-graph-reconciliation")).toBe("Known connections");
    expect(publicCheckLabel("OFAC sanctions screen")).toBe("Sanctions screening");
    expect(publicCheckNote("deployer unresolved; trace completion outcome not recorded"))
      .toBe("ARGUS could not identify the token creator, so the funding check did not finish.");
    expect(publicCheckNote("earnonhood.com denied the automated request (HTTP 403); no adverse website conclusion was drawn"))
      .toBe("The official site (earnonhood.com) blocked the automated request, so ARGUS could not read the page. No adverse site-activity conclusion was drawn from that block alone.");
    expect(publicCheckNote("the site rate-limited the automated liveness request (HTTP 429)"))
      .toContain("rate-limited");
    expect(publicCheckNote("the site rate-limited the automated liveness request (HTTP 429)"))
      .not.toContain("could not read the page");
    expect(publicCheckNote("supergemma.ai serves a verified coming-soon page"))
      .toBe("The project website is not live yet. It still shows a coming-soon or early-access page.");
    expect(publicCheckNote("SiteNotLive")).toContain("not live yet");
  });

  it("keeps graph IDs typed while presenting readable nodes and relationships", () => {
    expect(publicEntityLabel("wallet:base:0xdef")).toBe("Wallet 0xdef");
    expect(publicEntityLabel("token:ethereum:0xabc", "Token", "$ARGUS")).toBe("$ARGUS");
    expect(publicRelationshipLabel("DEPLOYED_BY")).toBe("was created by");
    expect(publicRelationshipLabel("held_by")).toBe("is held by");
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
