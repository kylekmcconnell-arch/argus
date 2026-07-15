import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { VentureOutcome } from "../src/engine";
import {
  emptyEvidence,
  type BasicFact,
  type BasicFactQuestionLedgerEntry,
  type BasicFactPredicate,
} from "../src/data/evidence";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";
import { collectFounderDecisionQuestionOutcomes } from "./orchestrate";

const ledgerEntry = (
  predicate: BasicFactPredicate,
  status: BasicFactQuestionLedgerEntry["status"],
  answerRefs: string[] = [],
): BasicFactQuestionLedgerEntry => ({
  questionId: `person.${predicate}`,
  audience: "person",
  batch: ["official_identity", "current_role", "founder"].includes(predicate) ? "identity" : "track_record",
  predicate,
  question: `Verify ${predicate}`,
  critical: true,
  status,
  answerRefs,
  providerRuns: [{ phase: "primary", provider: "claude-web-search", state: "succeeded" }],
});

const acceptedFact = (predicate: BasicFactPredicate, value: string, excerpt: string): BasicFact => ({
  factId: `accepted-${predicate}`,
  subjectKey: "@brian_armstrong",
  predicate,
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: true,
  sources: [{
    url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
    title: "Coinbase board of directors",
    sourceClass: "official_subject",
    relation: "supports",
    excerpt,
    contentHash: "f".repeat(64),
    capturedAt: "2026-07-13T18:10:42.000Z",
    provider: "public-web",
    artifactVerified: true,
  }],
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
});

describe("projectProviderBackedBasicFacts", () => {
  it("reuses frozen profile, token, market, and GitHub records without promoting model leads", () => {
    const evidence = emptyEvidence("@jupiterexchange");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Jupiter",
      website: "https://jup.ag/",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-12T20:00:00.000Z",
      identity_note: "GitHub github.com/jup-ag links back to this X handle.",
    };
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Jupiter",
      symbol: "JUP",
      coingeckoId: "jupiter-exchange-solana",
      rank: 90,
      address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      chain: "Solana",
      sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
      capturedAt: "2026-07-12T20:01:00.000Z",
      providers: ["coingecko", "dexscreener"],
      volume24hUsd: 17_900_000,
    };
    evidence.basicFactLeads = [{
      subject: "Jupiter",
      predicate: "founder",
      value: "Unverified Person",
      excerpt: "A model suggested this person.",
      sourceUrl: "https://example.com/lead",
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    }];
    evidence.webTeam = [
      {
        name: "Meow",
        handle: "@weremeow",
        role: "Co-founder",
        source: "Official tokenomics",
        sourceUrl: "https://docs.jup.ag/user-docs/more/jup-token/tokenomics.md",
        evidence: "Meow co-founded Jupiter.",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
      },
      {
        name: "Meow Jupiter",
        handle: "@weremeow",
        role: "Founder",
        source: "Duplicate team record",
        sourceUrl: "https://docs.jup.ag/team",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
      },
      {
        name: "Unverified Executive",
        role: "CEO",
        source: "Model search",
        sourceUrl: "https://example.com/team",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "grok",
      },
    ];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.map((fact) => [fact.predicate, fact.value])).toEqual([
      ["official_identity", "Jupiter"],
      ["founder", "Meow"],
      ["official_token", "$JUP"],
      ["network", "Solana"],
      ["traction", "$17.9M 24h trading volume"],
      ["repository", "github.com/jup-ag"],
    ]);
    expect(evidence.basicFacts?.every((fact) =>
      fact.evidence_origin === "deterministic"
      && fact.artifact_verified === true
      && fact.sources.every((candidate) => candidate.artifactVerified === true),
    )).toBe(true);
    expect(evidence.basicFacts?.some((fact) => fact.value === "Unverified Person")).toBe(false);
  });

  it("does not treat a self-authored person profile as verified identity by itself", () => {
    const evidence = emptyEvidence("@person");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile.display_name = "Person Name";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts).toEqual([]);
  });

  it("does not publish person facts while the resolved account is flagged as suspected impersonation", () => {
    const evidence = emptyEvidence("@brian_armstrong");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Brian Armstrong",
      resolved_name: "Brian Armstrong",
      bio: "Co-founder & CEO at Coinbase",
      identity_confidence: "SuspectedImpersonation",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-13T18:09:00.000Z",
    };
    evidence.ventures = [{
      project_name: "Coinbase",
      role: "Co-founder and CEO",
      period: "2012 - present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://coinbase.com",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];
    evidence.basicFacts = [acceptedFact(
      "prior_role",
      "Software engineer at Airbnb",
      "Brian Armstrong is our co-founder and Chief Executive Officer. Before our founding he was a software engineer at Airbnb.",
    )];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toHaveLength(1);
    expect(evidence.basicFacts[0].predicate).toBe("prior_role");
  });

  it("does not confuse a short venture name with a substring of another company's host", () => {
    const evidence = emptyEvidence("@brian_armstrong");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Brian Armstrong",
      resolved_name: "Brian Armstrong",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-13T18:09:00.000Z",
    };
    evidence.ventures = [{
      project_name: "Base",
      role: "Founder",
      period: "2023 - present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://coinbase.com",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];
    evidence.basicFacts = [acceptedFact(
      "prior_role",
      "Software engineer at Airbnb",
      "Brian Armstrong is our co-founder and Chief Executive Officer. Before our founding he was a software engineer at Airbnb.",
    )];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts.some((fact) => fact.predicate === "founder" && fact.value === "Base")).toBe(false);
  });

  it("does not transfer another person's founder role across sentences", () => {
    const evidence = emptyEvidence("@brian_armstrong");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Brian Armstrong",
      resolved_name: "Brian Armstrong",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-13T18:09:00.000Z",
    };
    evidence.ventures = [{
      project_name: "ResearchHub",
      role: "Founder",
      period: "2020 - present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://researchhub.com",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];
    evidence.basicFacts = [acceptedFact(
      "prior_role",
      "Software engineer at Airbnb",
      "Brian Armstrong is CEO of Coinbase. Patrick Smith is founder of ResearchHub.",
    )];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts.some((fact) => fact.predicate === "founder" && fact.value === "ResearchHub")).toBe(false);
  });

  it("does not inflate a founder-only passage into an unsupported CEO title", () => {
    const evidence = emptyEvidence("@brian_armstrong");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Brian Armstrong",
      resolved_name: "Brian Armstrong",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-13T18:09:00.000Z",
    };
    evidence.ventures = [{
      project_name: "Coinbase",
      role: "Founder and CEO",
      period: "2012 - present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://coinbase.com",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];
    evidence.basicFacts = [acceptedFact(
      "prior_role",
      "Software engineer at Airbnb",
      "Brian Armstrong is the founder of Coinbase, whose CEO is Jane Doe. Before founding it he was a software engineer at Airbnb.",
    )];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "founder", value: "Coinbase" }),
    ]));
    expect(evidence.basicFacts.some((fact) => fact.predicate === "current_role")).toBe(false);
  });

  it("publishes identity and company roles only from an exact frozen source passage", () => {
    const evidence = emptyEvidence("@brian_armstrong");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Brian Armstrong",
      resolved_name: "Brian Armstrong",
      bio: "Co-founder & CEO at @Coinbase. Co-founder @researchhub @newlimit",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-13T18:09:00.000Z",
      identity_note: "GitHub github.com/barmstrong links back to this X handle.",
    };
    evidence.ventures = [
      {
        project_name: "Coinbase",
        role: "Co-founder and CEO",
        period: "2012 - present",
        outcome: VentureOutcome.UNKNOWN,
        evidence_url: "https://coinbase.com",
        notes: "corroborated: PDL employment record (chief executive officer & co-founder, 2012-06)",
        provider: "peopledatalabs",
        evidence_origin: "deterministic",
        artifact_verified: true,
      },
      {
        project_name: "NewLimit",
        role: "Co-founder",
        period: "~2022 - present",
        outcome: VentureOutcome.UNKNOWN,
        evidence_url: "https://newlimit.com",
        notes: "People Data Labs employment record",
        provider: "peopledatalabs",
        evidence_origin: "deterministic",
        artifact_verified: true,
      },
      {
        project_name: "universitytutor.com",
        role: "chief executive officer & founder",
        period: "2003-08–2012-05",
        outcome: VentureOutcome.UNKNOWN,
        evidence_url: "https://linkedin.com/company/universitytutor-com",
        notes: "People Data Labs employment record",
        provider: "peopledatalabs",
        evidence_origin: "deterministic",
        artifact_verified: true,
      },
      {
        project_name: "Invented Labs",
        role: "Founder and CEO",
        period: "2025 - present",
        outcome: VentureOutcome.ACTIVE,
        evidence_url: "https://invented.example",
        notes: "model suggestion",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
    ];
    const coinbaseExcerpt = "Brian Armstrong is our co-founder and has served as our Chief Executive Officer and a member of our Board of Directors since our inception in May 2012 and as Chairman. Before our founding he was a software engineer at Airbnb.";
    evidence.basicFacts = [acceptedFact("prior_role", "Software engineer at Airbnb", coinbaseExcerpt)];
    evidence.basicFactQuestionLedger = [
      ledgerEntry("official_identity", "answered", ["profile:twitterapi:@brian_armstrong"]),
      ledgerEntry("current_role", "unanswered"),
      ledgerEntry("founder", "answered", ["venture:coinbase:founder"]),
    ];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "official_identity", value: "Brian Armstrong", status: "verified" }),
      expect.objectContaining({ predicate: "current_role", value: "Co-founder and CEO at Coinbase" }),
      expect.objectContaining({ predicate: "founder", value: "Coinbase" }),
    ]));
    expect(evidence.basicFacts.some((fact) => fact.value.includes("Invented"))).toBe(false);
    expect(evidence.basicFacts.some((fact) => fact.value.includes("NewLimit"))).toBe(false);
    expect(evidence.basicFacts.some((fact) => fact.value.includes("universitytutor"))).toBe(false);
    expect(evidence.basicFacts.find((fact) => fact.predicate === "current_role" && fact.value.includes("universitytutor"))).toBeUndefined();

    const coinbaseRole = evidence.basicFacts.find((fact) =>
      fact.predicate === "current_role" && fact.value === "Co-founder and CEO at Coinbase");
    expect(coinbaseRole?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: "https://investor.coinbase.com/governance/board-of-directors/default.aspx",
        contentHash: "f".repeat(64),
        provider: "public-web",
      }),
      expect.objectContaining({ url: "https://x.com/brian_armstrong", provider: "twitterapi" }),
    ]));
    expect(evidence.basicFactQuestionLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({
        predicate: "current_role",
        status: "answered",
        answerRefs: expect.arrayContaining([coinbaseRole!.factId]),
      }),
      expect.objectContaining({
        predicate: "official_identity",
        answerRefs: expect.arrayContaining(["profile:twitterapi:@brian_armstrong"]),
      }),
    ]));

    const factCount = evidence.basicFacts.length;
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts).toHaveLength(factCount);
    expect(evidence.basicFacts.every((fact) =>
      new Set(fact.sources.map((source) => source.url)).size === fact.sources.length)).toBe(true);

    const observations: CheckObservation[] = [];
    const ctx: CollectContext = {
      handle: "@brian_armstrong",
      evidence,
      emit: () => undefined,
      recordCheck: (observation) => observations.push(observation),
    };
    collectFounderDecisionQuestionOutcomes(ctx);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "founder-identity-authority", status: "confirmed" }),
      expect.objectContaining({ id: "founder-company-relationships", status: "confirmed" }),
    ]));
  });

  it("merges the provider source into an existing identical fact", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Project",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-12T20:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts).toHaveLength(1);
    expect(evidence.basicFacts?.[0].sources).toHaveLength(1);
  });

  it("does not overwrite a frozen conflict when adding provider support", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Project",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-12T20:00:00.000Z",
    };
    evidence.basicFacts = [{
      ...acceptedFact("official_identity", "Project", "Project is the official project identity."),
      subjectKey: "@project",
      normalizedValue: "project",
      status: "conflicted",
    }];
    evidence.basicFactQuestionLedger = [ledgerEntry("official_identity", "unanswered")];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts[0].status).toBe("conflicted");
    expect(evidence.basicFactQuestionLedger[0]).toEqual(expect.objectContaining({
      status: "unanswered",
      answerRefs: [],
    }));
  });

  it("merges provider $TICKER notation into an existing plain token symbol", () => {
    const evidence = emptyEvidence("@project");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Project Token",
      symbol: "JUP",
      coingeckoId: "project-token",
      rank: 100,
      address: "JUPTokenAddress",
      chain: "Solana",
      sourceUrl: "https://www.coingecko.com/en/coins/project-token",
      capturedAt: "2026-07-12T20:01:00.000Z",
      providers: ["coingecko"],
    };
    evidence.basicFacts = [{
      factId: "fact-token",
      subjectKey: "@project",
      predicate: "official_token",
      value: "JUP",
      normalizedValue: "jup",
      status: "verified",
      critical: true,
      sources: [{
        url: "https://project.example/token",
        sourceClass: "official_subject",
        relation: "supports",
        excerpt: "The official token is JUP.",
        contentHash: "a".repeat(64),
        capturedAt: "2026-07-12T20:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    }];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toHaveLength(2);
    const tokenFacts = evidence.basicFacts?.filter((fact) => fact.predicate === "official_token") ?? [];
    expect(tokenFacts).toHaveLength(1);
    expect(tokenFacts[0]).toMatchObject({ value: "JUP", normalizedValue: "jup", status: "verified" });
    expect(tokenFacts[0].sources).toHaveLength(2);
  });
});
