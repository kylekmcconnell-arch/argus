import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence, type BasicFactQuestionLedgerEntry } from "../src/data/evidence";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";

// "Who funded it?" is its own project question. The funding fact answers "how
// much?" and inlines the backers into prose, so before this projection the
// investor question resolved to nothing and an allocator got no named names.
describe("projectProviderBackedBasicFacts: named backers answer the investor question", () => {
  const projectEvidence = (handle: string) => {
    const evidence = emptyEvidence(handle);
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = { ...evidence.profile, display_name: "Uniswap", website: "https://uniswap.org" };
    return evidence;
  };

  const investorLedgerEntry = (): BasicFactQuestionLedgerEntry => ({
    questionId: "project.investor",
    audience: "project",
    batch: "structure_risk",
    predicate: "investor",
    question: "Who funded it?",
    critical: false,
    status: "unanswered",
    answerRefs: [],
    providerRuns: [{ phase: "primary", provider: "claude-web-search", state: "completed_empty" }],
  });

  // The real recorded DeFiLlama payload for Uniswap, after the adapter drops
  // the amount-less, round-less BlackRock relationship row as a non-financing
  // event. a16z and Paradigm sit in otherInvestors here, not leadInvestors.
  const uniswapFunding = () => ({
    slug: "uniswap",
    name: "Uniswap",
    geckoId: "uniswap",
    rounds: [{
      date: "2020-08-07",
      round: "Series A",
      amountUsd: 11_000_000,
      leadInvestors: [] as string[],
      otherInvestors: [
        "A.Capital Ventures",
        "a16z",
        "Paradigm",
        "ParaFi Capital",
        "SV Angel",
        "USV",
        "Variant Fund",
        "Version One Ventures",
      ],
      valuationUsd: null,
    }],
    totalRaisedUsd: 11_000_000,
    leadInvestors: [] as string[],
    sourceUrl: "https://defillama.com/protocol/uniswap",
    capturedAt: "2026-07-30T00:00:00.000Z",
  });

  it("mints one investor fact per named backer on the real Uniswap raises row", () => {
    const evidence = projectEvidence("@uniswap");
    evidence.protocolFunding = uniswapFunding();
    evidence.basicFactQuestionLedger = [investorLedgerEntry()];

    projectProviderBackedBasicFacts(evidence);

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    expect(investors.map((fact) => fact.value).sort()).toEqual([
      "A.Capital Ventures",
      "ParaFi Capital",
      "Paradigm",
      "SV Angel",
      "USV",
      "Variant Fund",
      "Version One Ventures",
      "a16z",
    ]);
    for (const fact of investors) {
      expect(fact.sources[0]?.url).toBe("https://defillama.com/protocol/uniswap");
      expect(fact.sources[0]?.provider).toBe("defillama");
      expect(fact.sources[0]?.excerpt).toContain("Series A");
      expect(fact.sources[0]?.excerpt).toContain("2020-08-07");
      // An aggregator naming a backer is an attribution, not proof of a wire.
      expect(fact.sources[0]?.excerpt).toContain("not a verified investment");
      expect(fact.floorEligible).toBe(false);
    }
  });

  it("never promotes an other-investor to lead", () => {
    const evidence = projectEvidence("@uniswap");
    evidence.protocolFunding = uniswapFunding();

    projectProviderBackedBasicFacts(evidence);

    const a16z = (evidence.basicFacts ?? []).find((fact) => fact.predicate === "investor" && fact.value === "a16z");
    expect(a16z).toBeDefined();
    expect(a16z?.sources[0]?.excerpt ?? "").not.toContain("lead investor");
    // The fact sheet concatenates qualifiers when it merges same-predicate
    // rows, so a per-backer round tag would repeat once per name.
    expect(a16z?.qualifier).toBeUndefined();
  });

  it("answers the investor ledger question that the funding fact left unanswered", () => {
    const evidence = projectEvidence("@uniswap");
    evidence.protocolFunding = uniswapFunding();
    evidence.basicFactQuestionLedger = [investorLedgerEntry()];

    projectProviderBackedBasicFacts(evidence);

    const entry = evidence.basicFactQuestionLedger[0];
    expect(entry.status).toBe("answered");
    expect(entry.answerRefs.length).toBe(8);
  });

  it("publishes a lead at lead strength and reports an unpriced round as unrecorded, never zero", () => {
    const evidence = projectEvidence("@aavetest");
    evidence.protocolFunding = {
      slug: "aave",
      name: "Aave",
      geckoId: null,
      rounds: [
        {
          date: "2020-10-12",
          round: "Strategic",
          amountUsd: 25_000_000,
          leadInvestors: ["Blockchain Capital"],
          otherInvestors: ["Standard Crypto"],
          valuationUsd: null,
        },
        {
          date: null,
          round: "Undisclosed round",
          amountUsd: null,
          leadInvestors: ["Blockchain Capital"],
          otherInvestors: ["Framework Ventures"],
          valuationUsd: 100_000_000,
        },
      ],
      totalRaisedUsd: 25_000_000,
      leadInvestors: ["Blockchain Capital"],
      sourceUrl: "https://defillama.com/protocol/aave",
      capturedAt: "2026-07-30T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    // One fact per distinct backer, even though Blockchain Capital leads twice.
    expect(investors.map((fact) => fact.value).sort()).toEqual([
      "Blockchain Capital",
      "Framework Ventures",
      "Standard Crypto",
    ]);
    const lead = investors.find((fact) => fact.value === "Blockchain Capital");
    expect(lead?.sources[0]?.excerpt).toContain("lead investor");
    const framework = investors.find((fact) => fact.value === "Framework Ventures");
    expect(framework?.sources[0]?.excerpt).toContain("no round amount on record");
    expect(framework?.sources[0]?.excerpt).not.toContain("$0");
    expect(framework?.sources[0]?.excerpt).toContain("no round date on record");
  });

  it("declares the cap when the index names more backers than ARGUS publishes", () => {
    const evidence = projectEvidence("@crowded");
    const many = Array.from({ length: 17 }, (_, index) => `Fund ${index + 1}`);
    evidence.protocolFunding = {
      slug: "crowded",
      name: "Crowded",
      geckoId: null,
      rounds: [{
        date: "2021-01-01",
        round: "Seed",
        amountUsd: 5_000_000,
        leadInvestors: [] as string[],
        otherInvestors: many,
        valuationUsd: null,
      }],
      totalRaisedUsd: 5_000_000,
      leadInvestors: [] as string[],
      sourceUrl: "https://defillama.com/protocol/crowded",
      capturedAt: "2026-07-30T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    expect(investors).toHaveLength(12);
    // Twelve of seventeen names, published without a word about it, reads as the
    // set of backers rather than the floor it is.
    for (const fact of investors) {
      expect(fact.sources[0]?.excerpt).toContain("publishes 12 of the 17 backers");
      expect(fact.sources[0]?.excerpt).toContain("floor");
    }
  });

  it("says nothing about a cap when every named backer was published", () => {
    const evidence = projectEvidence("@uniswap");
    evidence.protocolFunding = uniswapFunding();

    projectProviderBackedBasicFacts(evidence);

    const investors = (evidence.basicFacts ?? []).filter((fact) => fact.predicate === "investor");
    expect(investors).toHaveLength(8);
    for (const fact of investors) {
      expect(fact.sources[0]?.excerpt).not.toContain("backers this index names");
    }
  });

  it("mints no investor fact for a non-project subject", () => {
    const evidence = emptyEvidence("@person");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.protocolFunding = uniswapFunding();

    projectProviderBackedBasicFacts(evidence);

    expect((evidence.basicFacts ?? []).some((fact) => fact.predicate === "investor")).toBe(false);
  });
});
