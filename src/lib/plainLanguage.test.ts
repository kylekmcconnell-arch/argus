import { describe, expect, it } from "vitest";
import {
  formatRoleLabel,
  plainLanguageSummary,
  publicCheckLabel,
  publicCheckNote,
  publicCheckStatus,
  publicEntityLabel,
  publicOfficialSiteSentence,
  publicPhaseLabel,
  publicRelationshipLabel,
  savedSiteSubstanceStatus,
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

  it("translates the exact Bandos analyst shorthand into plain English", () => {
    expect(plainLanguageSummary(
      "Emerging Solana cash-out service with verified live token and product but null backing and limited operator transparency.",
    )).toBe(
      "Emerging Solana cash-out service with verified live token and product but no verified financial backing and limited operator transparency.",
    );
    expect(plainLanguageSummary("Project and token continuity.")).toBe("Earlier names and token history.");
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
    expect(publicCheckNote("1 graph connection could not be qualified because the linked immutable report is not the active case projection, or is stale, partial, or incompletely attested."))
      .toBe("1 saved relationship is excluded from this comparison because the linked case is older, incomplete, or no longer the active version. It has not been treated as evidence about this subject and does not affect the score or verdict.");
    expect(publicOfficialSiteSentence({ website: "https://earnonhood.com", status: "live" }))
      .toBe("The official site is live.");
    expect(publicOfficialSiteSentence({ website: "https://earnonhood.com", status: "access_blocked" }))
      .toBe("The official site (earnonhood.com) blocked the automated request, so ARGUS could not read the page. No adverse site-activity conclusion was drawn from that block alone.");
    expect(publicOfficialSiteSentence({ website: "https://parked.example", status: "coming_soon", checkNote: "parked page" }))
      .toBe("The official site is a parked page.");
    expect(publicOfficialSiteSentence({ website: "https://earnonhood.com" }))
      .toBe("An official site is on file. ARGUS could not classify it.");
    expect(publicOfficialSiteSentence({ website: "https://earnonhood.com", status: "access_blocked" }))
      .not.toContain("is live");
    expect(publicOfficialSiteSentence({})).toBe("ARGUS did not find an official site.");
    expect(savedSiteSubstanceStatus({
      website: "https://earnonhood.com",
      intelligence: { measurements: [{ id: "official_site_response_state", value: "live" }] },
    })).toBe("live");
    expect(savedSiteSubstanceStatus({
      website: "https://earnonhood.com",
      checkRuns: [{ note: "HTTP 403" }],
    })).toBeNull();
    expect(publicCheckNote("assessed token identity: nothing bound. A null result on this axis, not adverse conduct evidence."))
      .toContain("no result was recorded in this area");
    expect(publicCheckNote("assessed token identity: nothing bound. A null result on this axis, not adverse conduct evidence."))
      .not.toMatch(/null result on this axis/i);
    expect(publicCheckStatus("checked-empty")).toBe("nothing found");
    expect(publicPhaseLabel("P0 · Intake")).toBe("Starting the scan");
    expect(plainLanguageSummary("Largest accounts mentioned the bound identifiers after P0 · Intake."))
      .toBe("Largest accounts mentioned the official X handle and ticker after Starting the scan.");
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
