import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence } from "../src/data/evidence";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";

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
      ["traction", "$18M 24h trading volume"],
      ["repository", "github.com/jup-ag"],
    ]);
    expect(evidence.basicFacts?.every((fact) =>
      fact.evidence_origin === "deterministic"
      && fact.artifact_verified === true
      && fact.sources.every((candidate) => candidate.artifactVerified === true),
    )).toBe(true);
    expect(evidence.basicFacts?.some((fact) => fact.value === "Unverified Person")).toBe(false);
  });

  it("does nothing for a non-project subject", () => {
    const evidence = emptyEvidence("@person");
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    projectProviderBackedBasicFacts(evidence);
    expect(evidence.basicFacts).toEqual([]);
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
