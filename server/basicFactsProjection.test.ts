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
      ["traction", "CoinGecko rank #90 · $17.9M 24h volume"],
      ["product", "Jupiter operates a live on-chain protocol; its canonical token JUP is established and actively traded (CoinGecko rank #90 · $17.9M 24h volume)"],
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

    // official_token (merged) + network + market-backed traction + product: an
    // established top-ranked canonical token contributes liveness facts too.
    expect(evidence.basicFacts).toHaveLength(4);
    const tokenFacts = evidence.basicFacts?.filter((fact) => fact.predicate === "official_token") ?? [];
    expect(tokenFacts).toHaveLength(1);
    expect(tokenFacts[0]).toMatchObject({ value: "JUP", normalizedValue: "jup", status: "verified" });
    expect(tokenFacts[0].sources).toHaveLength(2);
  });

  it("completes product and traction from an established token even when no volume is present (Cloudflare-blocked site)", () => {
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
    // Market/on-chain evidence completes traction-liveness and product-substance
    // without any homepage fetch — the fix for "AAVE can never complete".
    expect(byPredicate.get("traction")?.value).toBe("CoinGecko rank #52 · $1.45B market cap · $13.2M on-chain liquidity");
    expect(byPredicate.get("product")?.value).toContain("Aave operates a live on-chain protocol");
    expect(byPredicate.get("product")?.artifact_verified).toBe(true);
    expect(byPredicate.get("product")?.sources[0].sourceClass).toBe("regulatory_or_onchain");
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

  it("discloses float control: holder concentration and locked liquidity, neutrally phrased", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.holderProfile = {
      topHolderPct: 5.6,
      top10Pct: 31.2,
      holderCount: 370_041,
      lpLockedOrBurnedPct: 85,
      sourceUrl: "https://gopluslabs.io/token-security/1/0x1f98",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const control = evidence.basicFacts?.find((fact) => String(fact.value).includes("largest single holder"));
    expect(control?.predicate).toBe("tokenomics");
    expect(control?.value).toBe(
      "largest single holder ~5.6% of supply · top 10 hold ~31% · 370,041 holders · 85% of DEX liquidity locked or burned",
    );
    // Neutral framing: concentration is a fact to verify, not an accusation.
    expect(control?.sources[0].excerpt).toContain("exchanges, custodians, or protocol contracts");
  });

  it("discloses the next unlock and the 90-day unlock load as a vesting fact", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.tokenUnlocks = {
      nextUnlockDate: "2026-08-01",
      allocationName: "Team",
      percentOfSupply: 1.2,
      unlockValueUsd: 27_000_000,
      percentOfMcap: 1.8,
      cumulativeUnlockedPercent: 63,
      next90dPercentOfSupply: 2,
      sourceUrl: "https://cryptorank.io/price/uniswap/vesting",
      capturedAt: "2026-07-22T00:00:00.000Z",
    };

    projectProviderBackedBasicFacts(evidence);

    const vesting = evidence.basicFacts?.find((fact) => fact.predicate === "vesting");
    expect(vesting?.value).toBe(
      "next unlock 2026-08-01 · Team · ~1.2% of supply · ~$27.0M · 1.8% of market cap · ~2% of supply unlocking within 90 days · 63% already unlocked",
    );
    expect(vesting?.sources[0].provider).toBe("cryptorank");
  });

  it("appends the fee trend so a reader sees growth or bleed, not just a total", () => {
    const evidence = emptyEvidence("@uniswap");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.protocolFees = {
      slug: "uniswap",
      total24hUsd: 3_840_000,
      total30dUsd: 80_400_000,
      change30dOver30dPct: -12.3,
      sourceUrl: "https://defillama.com/protocol/uniswap",
      capturedAt: "2026-07-22T00:00:00.000Z",
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
    // Thin liquidity still shows traction (it does trade), but an unranked,
    // sub-$10M token must NOT inherit product substance for free.
    expect(predicates.has("traction")).toBe(true);
    expect(predicates.has("product")).toBe(false);
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
