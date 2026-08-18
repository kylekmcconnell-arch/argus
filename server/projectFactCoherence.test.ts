import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact, type BasicFactPredicate } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import { enforceProjectFactCoherence } from "./projectFactCoherence";

const fact = (
  factId: string,
  predicate: BasicFactPredicate,
  value: string,
  sources: Array<{ url: string; title: string; excerpt: string }>,
): BasicFact => ({
  factId,
  subjectKey: "@ClutchMarkets",
  predicate,
  value,
  normalizedValue: value.toLowerCase(),
  status: sources.length > 1 ? "corroborated" : "lead",
  critical: true,
  sources: sources.map((source, index) => ({
    ...source,
    capturedAt: "2026-08-07T12:00:00.000Z",
    provider: "public-web",
    sourceClass: "independent_press",
    relation: "supports",
    contentHash: String(index + 1).repeat(64),
    artifactVerified: true,
  })),
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
  discoveryProvider: "claude-web-search",
});

describe("project fact coherence firewall", () => {
  it("removes namesake facts while preserving independently bound founder evidence", () => {
    const evidence = emptyEvidence("@ClutchMarkets");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.display_name = "Clutch Markets";
    evidence.profile.website = "https://stonkbrokers.io/";
    evidence.basicFacts = [
      fact("wrong-funding", "funding", "$50 million Series D", [{
        url: "https://www.torys.com/work/clutch-series-d-financing",
        title: "Clutch Series D financing",
        excerpt: "Canadian online used-car retailer Clutch raised $50 million in Series D financing.",
      }]),
      fact("wrong-product", "product", "Clutch Marketing Platform", [{
        url: "https://www.utcretail.com/clutch-marketing-platform",
        title: "Clutch Marketing Platform",
        excerpt: "Clutch Marketing Platform is a retail behavior optimization product.",
      }]),
      fact("correct-founder", "founder", "OxSimpleFarmer", [
        {
          url: "https://podcasts.apple.com/example/clutch-markets-founder",
          title: "Clutch Markets founder breaks down DeFi markets",
          excerpt: "OxSimpleFarmer, founder of Clutch Markets, discusses DeFi markets on Arbitrum.",
        },
        {
          url: "https://example-crypto-news.com/clutch-markets-founder",
          title: "Clutch Markets launches onchain markets",
          excerpt: "Clutch Markets founder OxSimpleFarmer built the crypto trading protocol.",
        },
      ]),
    ];
    evidence.basicFactQuestionLedger = [
      {
        questionId: "project.funding",
        audience: "project",
        batch: "track_record",
        predicate: "funding",
        question: "What funding has the project raised?",
        critical: false,
        status: "answered",
        answerRefs: ["wrong-funding"],
        providerRuns: [],
      },
      {
        questionId: "project.founder",
        audience: "project",
        batch: "identity",
        predicate: "founder",
        question: "Who founded the project?",
        critical: true,
        status: "answered",
        answerRefs: ["correct-founder"],
        providerRuns: [],
      },
    ];

    const result = enforceProjectFactCoherence(evidence);

    expect(result.checked).toBe(3);
    expect(result.rejected.map((entry) => entry.factId)).toEqual(["wrong-funding", "wrong-product"]);
    expect(evidence.basicFacts?.map((entry) => entry.factId)).toEqual(["correct-founder"]);
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "project.funding"))
      .toMatchObject({ status: "unanswered", answerRefs: [] });
    expect(evidence.basicFactQuestionLedger?.find((entry) => entry.questionId === "project.founder"))
      .toMatchObject({ status: "answered", answerRefs: ["correct-founder"] });
  });

  it("rejects a corroborated fact when removing a namesake source destroys corroboration", () => {
    const evidence = emptyEvidence("@ClutchMarkets");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.display_name = "Clutch Markets";
    evidence.profile.website = "https://stonkbrokers.io/";
    evidence.basicFacts = [fact("mixed-founder", "founder", "OxSimpleFarmer", [
      {
        url: "https://podcasts.apple.com/example/clutch-markets-founder",
        title: "Clutch Markets founder discusses DeFi",
        excerpt: "OxSimpleFarmer, founder of Clutch Markets, discusses its crypto protocol.",
      },
      {
        url: "https://generic-business.example/clutch-founder",
        title: "Clutch founder",
        excerpt: "OxSimpleFarmer is the founder of Clutch, a Canadian automotive retailer.",
      },
    ])];

    const result = enforceProjectFactCoherence(evidence);

    expect(result.rejected).toEqual([expect.objectContaining({
      factId: "mixed-founder",
      reason: "corroboration_collapsed",
    })]);
    expect(evidence.basicFacts).toEqual([]);
  });

  it("does not re-judge facts produced by exact deterministic provider joins", () => {
    const evidence = emptyEvidence("@ClutchMarkets");
    evidence.roles = [SubjectClass.PROJECT];
    const providerFact = fact("canonical-token", "product", "STONKBROKER", [{
      url: "https://dexscreener.com/robinhood/token",
      title: "Canonical token record",
      excerpt: "STONKBROKER matched the exact canonical contract.",
    }]);
    delete providerFact.discoveryProvider;
    providerFact.status = "verified";
    evidence.basicFacts = [providerFact];

    expect(enforceProjectFactCoherence(evidence)).toEqual({ checked: 0, rejected: [] });
    expect(evidence.basicFacts).toEqual([providerFact]);
  });
});

describe("registry-shaped namesake collisions", () => {
  // Regression for the @dynexcoin report (version 7c51822f, captured 2026-08-16),
  // which published `legal_entity: "Dynex Capital, Inc."` as VERIFIED on four SEC
  // EDGAR filings for CIK 826675 — a Virginia mortgage REIT that shares only the
  // word "Dynex" with the audited neuromorphic-computing project. Not one filing
  // mentions DNX, dynexcoin.org, or neuromorphic computing. The report's own
  // identity note conceded the relationship was "not itself independently
  // confirmed ... beyond shared naming" while the fact ledger still said verified.
  const filing = (path: string, excerpt: string) => ({
    url: `https://www.sec.gov/Archives/edgar/data/826675/${path}`,
    title: "Form of Restricted Stock Unit Agreement",
    excerpt,
  });

  it("refuses an unbound legal entity taken from a same-name registry filing", () => {
    const evidence = emptyEvidence("@dynexcoin");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.display_name = "Dynex";
    evidence.profile.website = "https://dynexcoin.org/";
    evidence.basicFacts = [
      fact("dynex-capital", "legal_entity", "Dynex Capital, Inc.", [
        filing("000082667525000118/exhibit10419formofrsuagree.htm",
          "This Restricted Stock Unit Award Agreement is made by Dynex Capital, Inc., a Virginia corporation, to a Non-Employee Director of the Company."),
        filing("000082667522000006/exhibit10415.htm",
          "This Restricted Stock Unit Award Agreement is made by Dynex Capital, Inc., a Virginia corporation, to a Key Employee of the Company."),
      ]),
    ];

    const result = enforceProjectFactCoherence(evidence);

    expect(result.rejected.map((entry) => entry.factId)).toContain("dynex-capital");
    expect(result.rejected[0]?.reason).toBe("no_identity_bound_support");
    expect(evidence.basicFacts).toHaveLength(0);
  });

  it("keeps a legal entity whose filing names the project's own domain", () => {
    const evidence = emptyEvidence("@dynexcoin");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.display_name = "Dynex";
    evidence.profile.website = "https://dynexcoin.org/";
    evidence.basicFacts = [
      fact("bound-entity", "legal_entity", "Dynex Developments Ltd", [{
        url: "https://dynexcoin.org/legal/imprint",
        title: "Imprint",
        excerpt: "Dynex Developments Ltd operates dynexcoin.org and issues the DNX token.",
      }]),
    ];

    const result = enforceProjectFactCoherence(evidence);

    expect(result.rejected).toHaveLength(0);
    expect(evidence.basicFacts.map((entry) => entry.factId)).toEqual(["bound-entity"]);
  });
});
