import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { VentureOutcome } from "../src/engine";
import {
  emptyEvidence,
  type BasicFact,
  type BasicFactQuestionLedgerEntry,
  type BasicFactPredicate,
  type CollectedEvidence,
} from "../src/data/evidence";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { hydrateProjectTeamFromVerifiedFacts, projectProviderBackedBasicFacts } from "./basicFactsProjection";
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

function bindCanonicalProjectToken(
  evidence: CollectedEvidence,
  geckoId: string,
  name: string,
  symbol: string,
): void {
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    name,
    symbol,
    coingeckoId: geckoId,
    rank: null,
    address: "0x0000000000000000000000000000000000000001",
    chain: "ethereum",
    sourceUrl: `https://www.coingecko.com/en/coins/${geckoId}`,
    capturedAt: "2026-07-22T00:00:00.000Z",
    providers: ["coingecko"],
  };
}

describe("projectProviderBackedBasicFacts", () => {
  it("mints a ceiling-only product fact from a live official site when nothing else can", () => {
    // The @orbitgroup_ai case: bio parses to no product name, token unbound,
    // discovery verification starved, yet ARGUS itself fetched a live site
    // bound to the account. That fetch completes product substance.
    const evidence = emptyEvidence("@orbitgroup_ai");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Orbit",
      website: "https://orbitgroup.ai/",
      site_substance_status: "live",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-26T10:00:00.000Z",
    };
    projectProviderBackedBasicFacts(evidence);
    const product = (evidence.basicFacts ?? []).find((fact) =>
      fact.predicate === "product" && fact.value === "orbitgroup.ai");
    expect(product).toBeDefined();
    expect(product?.floorEligible).toBe(false);
    expect(product?.sources[0]).toEqual(expect.objectContaining({
      url: "https://orbitgroup.ai/",
      sourceClass: "official_subject",
      provider: "sitecheck",
    }));
  });

  it("does not mint the site product fact without a live fetch or a project route", () => {
    const notLive = emptyEvidence("@orbitgroup_ai");
    notLive.roles = [SubjectClass.PROJECT];
    notLive.profile = {
      ...notLive.profile,
      website: "https://orbitgroup.ai/",
      site_substance_status: "coming_soon",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-26T10:00:00.000Z",
    };
    projectProviderBackedBasicFacts(notLive);
    expect((notLive.basicFacts ?? []).some((fact) => fact.predicate === "product")).toBe(false);

    const person = emptyEvidence("@someone");
    person.roles = [SubjectClass.FOUNDER];
    person.profile = {
      ...person.profile,
      website: "https://someone.com/",
      site_substance_status: "live",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-26T10:00:00.000Z",
    };
    projectProviderBackedBasicFacts(person);
    expect((person.basicFacts ?? []).some((fact) => fact.predicate === "product" && fact.provider === "public-web")).toBe(false);
  });

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
      ["repository", "github.com/jup-ag"],
    ]);
    expect(evidence.basicFacts?.every((fact) =>
      fact.evidence_origin === "deterministic"
      && fact.artifact_verified === true
      && fact.sources.every((candidate) => candidate.artifactVerified === true),
    )).toBe(true);
    expect(evidence.basicFacts?.some((fact) => fact.value === "Unverified Person")).toBe(false);
  });

  it("projects an identity-bound DEX-native token without manufacturing a CoinGecko source", () => {
    const evidence = emptyEvidence("@ponsdotfamily");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Pons",
      symbol: "PONS",
      rank: null,
      address: "0x39dBED3a2bd333467115dE45665cC57F813C4571",
      chain: "robinhood",
      sourceUrl: "https://dexscreener.com/robinhood/0x10cc6bd38112cac182db90b6a71d8bb5939526ba",
      capturedAt: "2026-07-24T12:19:07.351Z",
      providers: ["dexscreener", "geckoterminal"],
      marketCapUsd: 32_135_961,
      liquidityUsd: 1_543_733,
      volume24hUsd: 5_762_104,
    };

    projectProviderBackedBasicFacts(evidence);

    const tokenFact = evidence.basicFacts?.find((fact) => fact.predicate === "official_token");
    expect(tokenFact).toMatchObject({ value: "$PONS", status: "verified" });
    expect(tokenFact?.sources[0]).toMatchObject({
      title: "DexScreener token record",
      provider: "dexscreener + geckoterminal",
    });
    expect(tokenFact?.sources[0].title).not.toContain("CoinGecko");
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "traction")).toBe(false);
    expect(evidence.basicFacts?.some((fact) => fact.predicate === "product")).toBe(false);
  });

  it("uses the resolved project profile for identity and product without retaining namesake citations", () => {
    const evidence = emptyEvidence("@ponsdotfamily");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Pons",
      bio: "Launch coins on Robinhood via https://t.co/example",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-23T23:11:00.000Z",
    };
    evidence.basicFacts = [{
      factId: "namesake-identity",
      subjectKey: "@ponsdotfamily",
      predicate: "official_identity",
      value: "Pons",
      normalizedValue: "pons",
      status: "corroborated",
      critical: true,
      sources: [{
        url: "https://ponstherapy.com/",
        title: "PoNS portable neuromodulation stimulator",
        sourceClass: "independent_press",
        relation: "supports",
        excerpt: "PoNS is a portable neuromodulation stimulator.",
        contentHash: "a".repeat(64),
        capturedAt: "2026-07-23T23:10:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }, {
        url: "https://pons1945.com/",
        title: "Pons olive oil",
        sourceClass: "independent_press",
        relation: "supports",
        excerpt: "Pons produces olive oil.",
        contentHash: "b".repeat(64),
        capturedAt: "2026-07-23T23:10:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    }];

    projectProviderBackedBasicFacts(evidence);

    const identity = evidence.basicFacts.find((fact) => fact.predicate === "official_identity");
    expect(identity?.sources.map((candidate) => candidate.url)).toEqual(["https://x.com/ponsdotfamily"]);
    const product = evidence.basicFacts.find((fact) => fact.predicate === "product");
    expect(product).toMatchObject({
      value: "Launch coins on Robinhood",
      status: "verified",
      floorEligible: false,
      providerProjection: true,
    });
    expect(product?.sources.map((candidate) => candidate.url)).toEqual(["https://x.com/ponsdotfamily"]);
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
      identity_binding: "independent_exact_handle",
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
      identity_binding: "independent_exact_handle",
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
      identity_binding: "independent_exact_handle",
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

  it("projects an investor's exact current firm role from the frozen licensed identity record", () => {
    const evidence = emptyEvidence("@1scottrupp");
    evidence.roles = [SubjectClass.INVESTOR, SubjectClass.FOUNDER, SubjectClass.ADVISOR];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Scott Rupp",
      resolved_name: "Scott Rupp",
      identity_binding: "licensed_exact_social",
      bio: "Founding General Partner, BITKRAFT Ventures.",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-08-06T21:58:00.000Z",
      identity_note: "Resolved to Scott Rupp, Founding General Partner @ BITKRAFT Ventures. 11 roles on record (https://www.linkedin.com/in/scott-rupp/).",
    };
    evidence.ventures = [{
      project_name: "BITKRAFT Ventures",
      role: "Founding General Partner",
      period: "2020-08",
      outcome: VentureOutcome.UNKNOWN,
      evidence_url: "https://www.bitkraft.vc/people/scott-rupp",
      notes: "People Data Labs employment record",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];
    evidence.basicFactQuestionLedger = [
      ledgerEntry("official_identity", "unanswered"),
      ledgerEntry("current_role", "unanswered"),
    ];

    projectProviderBackedBasicFacts(evidence);

    const identity = evidence.basicFacts?.find((fact) => fact.predicate === "official_identity");
    const role = evidence.basicFacts?.find((fact) => fact.predicate === "current_role");
    expect(identity).toMatchObject({ value: "Scott Rupp", status: "verified" });
    expect(role).toMatchObject({
      value: "Founding General Partner at BITKRAFT Ventures",
      status: "verified",
    });
    expect(role?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: "https://www.linkedin.com/in/scott-rupp/",
        provider: "peopledatalabs",
      }),
      expect.objectContaining({ url: "https://x.com/1scottrupp", provider: "twitterapi" }),
    ]));
    expect(evidence.basicFactQuestionLedger).toEqual(expect.arrayContaining([
      expect.objectContaining({ predicate: "official_identity", status: "answered" }),
      expect.objectContaining({ predicate: "current_role", status: "answered" }),
    ]));
  });

  it("does not project a legacy person record without an exact handle binding", () => {
    const evidence = emptyEvidence("@unrelated_handle");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.profile = {
      ...evidence.profile,
      display_name: "Scott Rupp",
      resolved_name: "Scott Rupp",
      bio: "Founding General Partner, BITKRAFT Ventures.",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-08-06T21:58:00.000Z",
      identity_note: "Resolved to Scott Rupp, Founding General Partner @ BITKRAFT Ventures. 11 roles on record (https://www.linkedin.com/in/scott-rupp/).",
    };
    evidence.ventures = [{
      project_name: "BITKRAFT Ventures",
      role: "Founding General Partner",
      period: "2020-08",
      outcome: VentureOutcome.UNKNOWN,
      evidence_url: "https://www.bitkraft.vc/people/scott-rupp",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }];

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toEqual([]);
  });

  it("publishes a fund account's official brand identity without treating self-description as verified legitimacy", () => {
    const evidence = emptyEvidence("@theformsvc");
    evidence.roles = [SubjectClass.INVESTOR];
    evidence.profile = {
      ...evidence.profile,
      display_name: "TheForms - Your Partner",
      bio: "Capital follows understanding. We back founders building infrastructure for what comes next.",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: "2026-08-06T22:10:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts).toEqual([
      expect.objectContaining({
        predicate: "official_identity",
        value: "TheForms - Your Partner",
        status: "verified",
        floorEligible: false,
        providerProjection: true,
        sources: [expect.objectContaining({
          url: "https://x.com/theformsvc",
          provider: "twitterapi",
          sourceClass: "official_subject",
        })],
      }),
    ]);
    expect(evidence.profile.resolved_name).toBeUndefined();
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

    // The exact official-token fact merges and network remains. Token market
    // footprint does not manufacture product or usage facts.
    expect(evidence.basicFacts).toHaveLength(2);
    const tokenFacts = evidence.basicFacts?.filter((fact) => fact.predicate === "official_token") ?? [];
    expect(tokenFacts).toHaveLength(1);
    expect(tokenFacts[0]).toMatchObject({ value: "JUP", normalizedValue: "jup", status: "verified" });
    expect(tokenFacts[0].sources).toHaveLength(2);
  });

  it("does not manufacture product or traction from an established token market footprint", () => {
    const evidence = emptyEvidence("@aave");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_domain",
      name: "Aave",
      symbol: "AAVE",
      coingeckoId: "aave",
      rank: 52,
      address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
      chain: "Ethereum",
      sourceUrl: "https://www.coingecko.com/en/coins/aave",
      capturedAt: "2026-07-13T20:00:00.000Z",
      providers: ["coingecko", "dexscreener", "geckoterminal"],
      marketCapUsd: 1_452_871_023,
      liquidityUsd: 13_159_336,
      // no volume24hUsd, mirroring a partial market snapshot
    };

    projectProviderBackedBasicFacts(evidence);

    const byPredicate = new Map((evidence.basicFacts ?? []).map((fact) => [fact.predicate, fact]));
    expect(byPredicate.get("traction")).toBeUndefined();
    expect(byPredicate.get("product")).toBeUndefined();
    expect(byPredicate.get("official_token")?.value).toBe("$AAVE");
  });

  it("states supply overhang and the fully-diluted multiple the way a buyer asks it", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Uniswap",
      symbol: "UNI",
      coingeckoId: "uniswap",
      rank: 39,
      address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
      chain: "Ethereum",
      sourceUrl: "https://www.coingecko.com/en/coins/uniswap",
      capturedAt: "2026-07-22T00:00:00.000Z",
      providers: ["coingecko"],
      marketCapUsd: 2_300_000_000,
      circulatingSupply: 630_000_000,
      maxSupply: 1_000_000_000,
    };

    projectProviderBackedBasicFacts(evidence);

    const tokenomics = evidence.basicFacts?.find((fact) => fact.predicate === "tokenomics");
    expect(tokenomics?.value).toBe(
      "630.0M of 1000.0M supply circulating (63%) · 37% of supply not yet circulating · fully-diluted value 1.6x market cap",
    );
    expect(tokenomics?.sources[0]).toMatchObject({
      title: "CoinGecko supply snapshot",
      excerpt: expect.stringContaining("630.0M circulating supply and 1000.0M maximum supply"),
    });
  });

  it("cites DeFiLlama, not token identity, for the multi-chain protocol footprint", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Uniswap",
      symbol: "UNI",
      coingeckoId: "uniswap",
      rank: 39,
      address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
      chain: "Ethereum",
      deployedChains: ["Ethereum", "Base", "Arbitrum"],
      sourceUrl: "https://www.coingecko.com/en/coins/uniswap",
      capturedAt: "2026-08-02T00:00:00.000Z",
      providers: ["coingecko"],
    };
    evidence.protocolTvl = {
      slug: "uniswap",
      name: "Uniswap",
      symbol: "UNI",
      tvlUsd: 1,
      chains: ["Ethereum", "Base", "Arbitrum"],
      chainBreakdown: [],
      geckoId: "uniswap",
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-08-02T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const network = evidence.basicFacts?.find((fact) => fact.predicate === "network");
    expect(network?.value).toBe("3 chains incl. Ethereum, Base, Arbitrum");
    expect(network?.sources).toEqual([expect.objectContaining({
      url: "https://defillama.com/protocol/uniswap",
      provider: "defillama",
      excerpt: expect.stringContaining("listed across 3 chains"),
    })]);
  });

  it("reports an effectively fully diluted token instead of a meaningless overhang", () => {
    const evidence = emptyEvidence("@mature");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_domain",
      name: "Mature",
      symbol: "MAT",
      coingeckoId: "mature",
      rank: 120,
      address: "0x0000000000000000000000000000000000000001",
      chain: "Ethereum",
      sourceUrl: "https://www.coingecko.com/en/coins/mature",
      capturedAt: "2026-07-22T00:00:00.000Z",
      providers: ["coingecko"],
      marketCapUsd: 500_000_000,
      circulatingSupply: 995_000_000,
      totalSupply: 1_000_000_000,
    };

    projectProviderBackedBasicFacts(evidence);

    const tokenomics = evidence.basicFacts?.find((fact) => fact.predicate === "tokenomics");
    expect(tokenomics?.value).toContain("effectively fully diluted");
    expect(tokenomics?.value).not.toContain("not yet circulating");
  });

  it("withholds a supply ratio when circulating supply exceeds its denominator", () => {
    const evidence = emptyEvidence("@inconsistent");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "inconsistent", "Inconsistent", "BAD");
    evidence.projectToken!.circulatingSupply = 120;
    evidence.projectToken!.totalSupply = 100;

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.find((fact) => fact.predicate === "tokenomics")).toBeUndefined();
  });

  it("discloses float control: holder concentration and locked liquidity, neutrally phrased", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.holderProfile = {
      binding: {
        canonicalAddress: evidence.projectToken!.address,
        chain: evidence.projectToken!.chain,
        method: "canonical_token_address_chain",
      },
      topHolderPct: 5.6,
      top10Pct: 31.2,
      assessedWalletCount: 10,
      top10PctIsFloor: false,
      holderCount: 370_041,
      lpLockedOrBurnedPct: 85,
      sourceUrl: "https://gopluslabs.io/token-security/1/0x1f98",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    // "wallet", not "holder": pools, contracts and locked addresses are
    // excluded from concentration, so the largest ROW on the register is not
    // what this number reports.
    const control = evidence.basicFacts?.find((fact) => String(fact.value).includes("largest single wallet"));
    expect(control?.predicate).toBe("tokenomics");
    expect(control?.value).toBe(
      "largest single wallet ~5.6% of supply · top 10 wallets hold ~31% · 370,041 holders · 85% of DEX liquidity locked or burned",
    );
    // Neutral framing: concentration is a fact to verify, not an accusation.
    expect(control?.sources[0].excerpt).toContain("exchanges, custodians, or protocol contracts");
  });

  it("discloses the next unlock and the 90-day unlock load as a vesting fact", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.projectToken!.address = "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984";
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-08-01",
      allocationName: "Team",
      percentOfSupply: 1.2,
      unlockValueUsd: 27_000_000,
      percentOfMcap: 1.8,
      cumulativeUnlockedPercent: 63,
      next90dPercentOfSupply: 2,
      canonicalAddress: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
      chain: "ethereum",
      currencyId: 11,
      contractSourceUrl: "https://api.cryptorank.io/v3/currencies/11/contracts",
      eventsSourceUrl: "https://api.cryptorank.io/v3/currencies/11/vesting/events?filter=upcoming&sortBy=time&sortOrder=asc",
      sourceUrl: "https://cryptorank.io/price/uniswap/vesting",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const vesting = evidence.basicFacts?.find((fact) => fact.predicate === "vesting");
    expect(vesting?.value).toBe(
      "next unlock 2026-08-01 · Team · ~1.2% of supply · ~$27.0M · 1.8% of market cap · ~2% of supply unlocking within 90 days · 63% already unlocked",
    );
    expect(vesting?.sources[0].provider).toBe("cryptorank");
    expect(vesting?.sources).toHaveLength(2);
    expect(vesting?.sources[0].url).toBe("https://api.cryptorank.io/v3/currencies/11/contracts");
    expect(vesting?.sources[0].excerpt).toContain("exact canonical ethereum contract 0x1f9840a85d5af5bf1d1762f925bdaddc4201f984");
    expect(vesting?.sources[1].url).toContain("/currencies/11/vesting/events?");
  });

  it("does not project a legacy or wrong-contract unlock schedule", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-08-01",
      allocationName: "Team",
      percentOfSupply: 1.2,
      unlockValueUsd: 27_000_000,
      percentOfMcap: 1.8,
      cumulativeUnlockedPercent: 63,
      next90dPercentOfSupply: 2,
      canonicalAddress: "0x0000000000000000000000000000000000000002",
      chain: "ethereum",
      currencyId: 11,
      contractSourceUrl: "https://api.cryptorank.io/v3/currencies/11/contracts",
      eventsSourceUrl: "https://api.cryptorank.io/v3/currencies/11/vesting/events",
      sourceUrl: "https://cryptorank.io/price/uniswap/vesting",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.find((fact) => fact.predicate === "vesting")).toBeUndefined();
  });

  it("appends the TVL trend so capital commitment reads as growth or bleed", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.protocolTvl = {
      slug: "uniswap",
      name: "Uniswap",
      symbol: "UNI",
      tvlUsd: 3_180_000_000,
      chains: ["Ethereum", "Base", "Arbitrum"],
      chainBreakdown: [{ chain: "Ethereum", tvlUsd: 2_000_000_000 }],
      geckoId: "uniswap",
      change30dPct: 6,
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const tvl = evidence.basicFacts?.find((fact) => String(fact.value).includes("total value locked"));
    expect(tvl?.value).toBe("$3.18B total value locked (Ethereum, Base, Arbitrum) · up 6% vs 30 days ago");
    expect(tvl?.sources[0].excerpt).toContain("up 6% vs 30 days ago");
  });

  it("projects protocol hacks as standalone critical facts instead of burying them in TVL prose", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "drift-protocol", "Drift", "DRIFT");
    evidence.protocolTvl = {
      slug: "drift",
      name: "Drift",
      symbol: "DRIFT",
      tvlUsd: 100_000_000,
      chains: ["Solana"],
      chainBreakdown: [{ chain: "Solana", tvlUsd: 100_000_000 }],
      geckoId: "drift-protocol",
      hacks: [{
        date: "2026-04-01",
        amountUsd: 295_000_000,
        returnedFunds: false,
        returnedAmountUsd: null,
        classification: "Infrastructure",
        technique: "Compromised Admin + Fake Token Price Manipulation",
      }],
      sourceUrl: "https://defillama.com/protocol/drift",
      capturedAt: "2026-07-24T12:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const incident = evidence.basicFacts?.find((fact) => fact.predicate === "security_incident");
    const tvl = evidence.basicFacts?.find((fact) => fact.predicate === "traction");
    expect(incident).toEqual(expect.objectContaining({
      status: "verified",
      critical: true,
      floorEligible: false,
    }));
    expect(incident?.value).toContain("2026-04-01 · $295M security incident");
    expect(incident?.value).toContain("Compromised Admin");
    expect(tvl?.sources[0].excerpt).not.toContain("security incident");
  });

  it("mints a citable, floor-ineligible fact from multi-firm audit attestation", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.securityAudits = {
      securityPageUrl: "https://www.certora.com/reports/uniswap-v4.pdf",
      selfAttested: ["Certora", "ABDK", "OpenZeppelin"],
      attestations: [{
        auditor: "Certora",
        origin: "curated_audit_link",
        sourceUrl: "https://www.certora.com/reports/uniswap-v4.pdf",
      }, {
        auditor: "ABDK",
        origin: "curated_audit_link",
        sourceUrl: "https://abdk.consulting/reports/uniswap-v4.pdf",
      }, {
        auditor: "OpenZeppelin",
        origin: "subject_page",
        sourceUrl: "https://uniswap.org/security",
      }],
      corroborated: [],
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const attested = evidence.basicFacts?.find((fact) => fact.predicate === "audit");
    expect(attested?.value).toBe("Security engagements attested: Certora, ABDK, OpenZeppelin");
    expect(attested?.status).toBe("corroborated");
    // Citable for the analyst, but can never mint a score floor (H2) and never
    // counts as a strictly verified auditFact for band floors.
    expect(attested?.floorEligible).toBe(false);
    expect(attested?.sources).toHaveLength(3);
    expect(attested?.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        url: "https://www.certora.com/reports/uniswap-v4.pdf",
        title: "Curated audit link naming Certora",
        sourceClass: "other_public",
      }),
      expect.objectContaining({
        url: "https://abdk.consulting/reports/uniswap-v4.pdf",
        title: "Curated audit link naming ABDK",
        sourceClass: "other_public",
      }),
      expect.objectContaining({
        url: "https://uniswap.org/security",
        title: "Subject disclosure naming OpenZeppelin",
        sourceClass: "official_subject",
      }),
    ]));
    expect(attested?.sources.some((candidate) =>
      String(candidate.title ?? "").toLowerCase().includes("project security page"))).toBe(false);
  });

  it("keeps a legacy no-anchor auditor row as a lead instead of a verified engagement", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.securityAudits = {
      securityPageUrl: "https://www.certora.com/reports/uniswap-v4",
      selfAttested: ["Certora"],
      attestations: [{
        auditor: "Certora",
        origin: "curated_audit_link",
        sourceUrl: "https://www.certora.com/reports/uniswap-v4",
      }],
      corroborated: [{
        auditor: "Certora",
        auditorUrl: "https://www.certora.com/reports/uniswap-v4",
        excerpt: "Certora formal verification report for the Uniswap v4 core contracts.",
      }],
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.find((fact) => fact.predicate === "audit")).toBeUndefined();
    expect(evidence.basicFactLeads).toContainEqual(expect.objectContaining({
      predicate: "audit",
      value: "Audit discovery source names Certora",
      artifact_verified: false,
    }));
  });

  it("projects an auditor engagement only when its frozen anchor matches the canonical subject", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.website = "https://uniswap.org/";
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.securityAudits = {
      securityPageUrl: "https://uniswap.org/security",
      selfAttested: ["Certora"],
      attestations: [{ auditor: "Certora", origin: "subject_page", sourceUrl: "https://uniswap.org/security" }],
      corroborated: [{
        auditor: "Certora",
        auditorUrl: "https://www.certora.com/reports/uniswap-v4",
        excerpt: "Certora audited the contracts published at uniswap.org.",
        matchedIdentityAnchor: { type: "official_domain", value: "uniswap.org" },
      }],
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    expect(evidence.basicFacts?.find((fact) => fact.predicate === "audit"))
      .toMatchObject({ value: "Security engagement with Certora", status: "verified" });
  });

  it("appends the fee trend so a reader sees growth or bleed, not just a total", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    bindCanonicalProjectToken(evidence, "uniswap", "Uniswap", "UNI");
    evidence.protocolTvl = {
      slug: "uniswap",
      name: "Uniswap",
      symbol: "UNI",
      tvlUsd: 1,
      chains: ["Ethereum"],
      chainBreakdown: [{ chain: "Ethereum", tvlUsd: 1 }],
      geckoId: "uniswap",
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };
    evidence.protocolFees = {
      slug: "uniswap",
      total24hUsd: 3_840_000,
      total30dUsd: 80_400_000,
      change30dOver30dPct: -12.3,
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-07-22T00:00:00.000Z",
      binding: {
        canonicalGeckoId: "uniswap",
        protocolSlug: "uniswap",
        method: "matched_protocol_gecko_id",
      },
    };

    projectProviderBackedBasicFacts(evidence);

    const fees = evidence.basicFacts?.find((fact) => String(fact.value).includes("protocol fees"));
    expect(fees?.value).toBe("$80.4M protocol fees in 30 days · down 12.3% vs the prior 30 days");
    expect(fees?.sources[0].excerpt).toContain("down 12.3% vs the prior 30 days");
  });

  it("does not grant product substance to a thin, unranked, low-cap token", () => {
    const evidence = emptyEvidence("@thinproject");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Thin Project",
      symbol: "THIN",
      coingeckoId: "thin-project",
      rank: null,
      address: "0xthin",
      chain: "Ethereum",
      sourceUrl: "https://www.coingecko.com/en/coins/thin-project",
      capturedAt: "2026-07-13T20:00:00.000Z",
      providers: ["dexscreener"],
      liquidityUsd: 8_000,
    };

    projectProviderBackedBasicFacts(evidence);

    const predicates = new Set((evidence.basicFacts ?? []).map((fact) => fact.predicate));
    // Market data remains market context. It cannot manufacture either
    // product substance or traction for a project subject.
    expect(predicates.has("traction")).toBe(false);
    expect(predicates.has("product")).toBe(false);
  });

  it("hydrates a verified project founder into the shared team evidence", () => {
    const evidence = emptyEvidence("@ClutchMarkets");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.basicFacts = [{
      factId: "clutch-founder",
      subjectKey: "@ClutchMarkets",
      predicate: "founder",
      value: "OxSimpleFarmer",
      normalizedValue: "oxsimplefarmer",
      qualifier: "Founder",
      status: "corroborated",
      critical: true,
      sources: [{
        url: "https://podcasts.apple.com/example/clutch-markets-founder",
        title: "Clutch Markets founder interview",
        excerpt: "OxSimpleFarmer, founder of Clutch Markets, discusses DeFi markets.",
        capturedAt: "2026-08-07T12:00:00.000Z",
        provider: "public-web",
        sourceClass: "independent_press",
        relation: "supports",
        contentHash: "c".repeat(64),
        artifactVerified: true,
      }],
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
    }];

    hydrateProjectTeamFromVerifiedFacts(evidence);
    hydrateProjectTeamFromVerifiedFacts(evidence);

    expect(evidence.webTeam).toEqual([expect.objectContaining({
      name: "OxSimpleFarmer",
      role: "Founder",
      provider: "basic-facts",
      artifact_verified: true,
      evidence_origin: "deterministic",
    })]);
  });
});

describe("H2: recall (floorEligible:false) facts are coverage-only, never floors", () => {
  it("excludes a floorEligible:false fact from project score floors while a strict fact floors", async () => {
    const { deriveProjectStrengthBands } = await import("./agent");
    const axes = [{ axis: "P1_team_and_identity", weight: 16, role: SubjectClass.PROJECT }];
    const baseFact = {
      factId: "founder:Acme", subjectKey: "@acme", predicate: "founder", value: "Acme",
      normalizedValue: "acme", critical: true,
      sources: [{ url: "https://coindesk.com/a", title: "t", excerpt: "Acme founder", capturedAt: "2026-07-13T00:00:00.000Z", provider: "public-web", sourceClass: "independent_press", relation: "supports", contentHash: "a".repeat(64), artifactVerified: true }],
      evidence_origin: "deterministic", artifact_verified: true, provider: "public-web",
    };
    const packet = (fact: Record<string, unknown>) => JSON.stringify({ profile: { handle: "@acme", display_name: "Acme" }, basicFacts: [fact], team: [] });

    const strict = deriveProjectStrengthBands(packet({ ...baseFact, status: "corroborated" }), axes);
    const recall = deriveProjectStrengthBands(packet({ ...baseFact, status: "corroborated", floorEligible: false }), axes);
    // The strict corroborated founder fact contributes a P1 leader floor; the
    // recall (floorEligible:false) fact must not raise the floor above it.
    expect(recall.P1_team_and_identity.minScore).toBeLessThanOrEqual(strict.P1_team_and_identity.minScore);
    expect(recall.P1_team_and_identity.minScore).toBe(0);
  });
});
