import { describe, expect, it } from "vitest";
import { SubjectClass, VentureOutcome, type Venture } from "../src/engine";
import { emptyEvidence, type BasicFact, type BasicFactPredicate } from "../src/data/evidence";
import type { CheckObservation, CollectContext } from "./adapters/types";
import {
  axisCatalog,
  coalesceTeamMembersByHandle,
  collectProjectCoreEvidenceOutcomes,
  mergeDiscoveredAffiliations,
  projectVerifiedBasicFacts,
  providerBackedRoles,
} from "./orchestrate";

const basicFact = (predicate: BasicFactPredicate, value: string, qualifier?: string): BasicFact => ({
  factId: `fact-${predicate}-${value}`,
  subjectKey: "@JupiterExchange",
  predicate,
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: predicate === "founder" || predicate === "product",
  sources: [{
    url: `https://jup.ag/${predicate}`,
    sourceClass: "official_subject",
    relation: "supports",
    excerpt: `Jupiter confirms ${value} for ${predicate}.`,
    contentHash: predicate.padEnd(64, "0").slice(0, 64),
    capturedAt: "2026-07-12T18:00:00.000Z",
    provider: "public-web",
    artifactVerified: true,
  }],
  ...(qualifier ? { qualifier } : {}),
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
  discoveryProvider: "claude-web-search",
});

function resolvedProjectProfile(bio: string, website: string | null | undefined = "https://world.xyz/") {
  const evidence = emptyEvidence("@world_xyz");
  evidence.profile.bio = bio;
  evidence.profile.website = website ?? undefined;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = "2026-07-12T14:00:00.000Z";
  return evidence;
}

describe("provider-backed project routing", () => {
  it("coalesces different roster names that enrichment resolves to the same X handle", () => {
    expect(coalesceTeamMembersByHandle([
      {
        name: "Siong",
        handle: "@sssionggg",
        role: "Co-founder",
        source: "Project governance forum",
        sourceUrl: "https://discuss.example/team",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
        identity_link_evidence_origin: "model_lead",
      },
      {
        name: "Siong Ong",
        handle: "@sssionggg",
        role: "Co-founder",
        source: "Web identity search",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "grok",
        identity_link_evidence_origin: "model_lead",
      },
    ])).toEqual([
      expect.objectContaining({
        name: "Siong",
        handle: "@sssionggg",
        role: "Co-founder",
        source: "Project governance forum",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }),
    ]);
  });

  it("routes @world_xyz to the PROJECT methodology and requests every PROJECT axis", () => {
    const evidence = resolvedProjectProfile("the solana prediction market");
    const roles = providerBackedRoles(evidence);

    expect(roles).toEqual([SubjectClass.PROJECT]);
    expect(axisCatalog(roles)).toEqual([
      { axis: "P1_team_and_identity", weight: 16, role: SubjectClass.PROJECT },
      { axis: "P2_product_substance", weight: 24, role: SubjectClass.PROJECT },
      { axis: "P3_token_conduct", weight: 20, role: SubjectClass.PROJECT },
      { axis: "P4_backing_and_partners", weight: 14, role: SubjectClass.PROJECT },
      { axis: "P5_traction_and_liveness", weight: 14, role: SubjectClass.PROJECT },
      { axis: "P6_transparency_integrity", weight: 12, role: SubjectClass.PROJECT },
    ]);
  });

  it.each([
    "the onchain prediction market",
    "a decentralized exchange",
    "the NFT marketplace",
    "a crypto product",
    "the liquidity protocol",
  ])("recognizes a provider-resolved project profile: %s", (bio) => {
    expect(providerBackedRoles(resolvedProjectProfile(bio))).toContain(SubjectClass.PROJECT);
  });

  it("routes a slogan-only account as PROJECT when its canonical token matches the official X account", () => {
    const evidence = resolvedProjectProfile("Just use crypto, Just use Jupiter", null);
    evidence.projectToken = {
      verified: true,
      verification: "official_x",
      name: "Jupiter",
      symbol: "JUP",
      coingeckoId: "jupiter-exchange-solana",
      rank: 89,
      address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
      chain: "solana",
      officialX: "@JupiterExchange",
      sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
      capturedAt: "2026-07-12T17:00:00.000Z",
    };

    const roles = providerBackedRoles(evidence);
    expect(roles).toEqual([SubjectClass.PROJECT]);
    expect(axisCatalog(roles).map(({ axis }) => axis)).toEqual([
      "P1_team_and_identity",
      "P2_product_substance",
      "P3_token_conduct",
      "P4_backing_and_partners",
      "P5_traction_and_liveness",
      "P6_transparency_integrity",
    ]);
  });

  it("routes a verb-phrase product bio to PROJECT once the official site is linked", () => {
    // The @ponsdotfamily prod shell: "Launch coins on Robinhood via <t.co>"
    // carries no protocol/platform noun, so keyword routing alone left the
    // subject unroutable and the report published with no methodology.
    const evidence = resolvedProjectProfile("Launch coins on Robinhood via https://t.co/X4t0HOafyO", "https://ponsfamily.com/");
    expect(providerBackedRoles(evidence)).toContain(SubjectClass.PROJECT);
  });

  it("routes a keyword-free brand account to PROJECT when its own site served a live product", () => {
    const evidence = resolvedProjectProfile("The family way to do it.", "https://ponsfamily.com/");
    evidence.profile.site_substance_status = "live";
    expect(providerBackedRoles(evidence)).toEqual([SubjectClass.PROJECT]);
  });

  it("keeps a keyword-free account unroutable when the site did not serve a live product", () => {
    const shell = resolvedProjectProfile("The family way to do it.", "https://ponsfamily.com/");
    shell.profile.site_substance_status = "client_rendered";
    expect(providerBackedRoles(shell)).toEqual([]);

    const unfetched = resolvedProjectProfile("The family way to do it.", "https://ponsfamily.com/");
    expect(providerBackedRoles(unfetched)).toEqual([]);
  });

  it("never uses the live-site fallback when the bio already classified a role", () => {
    const evidence = resolvedProjectProfile("Daily alpha calls and gems.", "https://ponsfamily.com/");
    evidence.profile.site_substance_status = "live";
    const roles = providerBackedRoles(evidence);
    expect(roles).toContain(SubjectClass.KOL);
    expect(roles).not.toContain(SubjectClass.PROJECT);
  });

  it("does not route a non-verified token candidate by name alone", () => {
    const evidence = resolvedProjectProfile("Just use crypto", null);
    evidence.projectToken = {
      verified: false,
      verification: "official_x",
      name: "Copycat Jupiter",
      symbol: "JUP",
      coingeckoId: "copycat-jupiter",
      rank: null,
      address: "So11111111111111111111111111111111111111112",
      chain: "solana",
      sourceUrl: "https://www.coingecko.com/en/coins/copycat-jupiter",
      capturedAt: "2026-07-12T17:00:00.000Z",
    } as unknown as NonNullable<typeof evidence.projectToken>;

    expect(providerBackedRoles(evidence)).not.toContain(SubjectClass.PROJECT);
  });

  it("does not let a model-only PROJECT candidate select a methodology", () => {
    const evidence = emptyEvidence("@model_project");
    evidence.findings.push({
      finding_type: "RoleCandidate",
      claim: "Model-extracted self-claim suggests PROJECT.",
      source_url: "",
      source_date: "",
      source_author: "claude-intake",
      verification_status: "Rumor",
      independent_source_count: 0,
      polarity: 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });

    const roles = providerBackedRoles(evidence);
    expect(roles).toEqual([]);
    expect(axisCatalog(roles)).toEqual([]);
  });

  it("turns verified basic facts into a cited project roster and completed diligence checks", () => {
    const evidence = resolvedProjectProfile("the Solana liquidity protocol", "https://jup.ag");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.basicFacts = [
      basicFact("founder", "Meow", "Co-founder"),
      basicFact("product", "Jupiter Swap"),
      basicFact("traction", "$1 billion monthly volume"),
      basicFact("investor", "Framework Ventures"),
      basicFact("governance", "Jupiter DAO"),
      basicFact("audit", "OtterSec security review"),
    ];
    const checks: CheckObservation[] = [];
    const ctx: CollectContext = {
      handle: "@JupiterExchange",
      evidence,
      emit: () => undefined,
      recordCheck: (check) => checks.push(check),
    };

    projectVerifiedBasicFacts(ctx);
    const outcome = collectProjectCoreEvidenceOutcomes(ctx);

    expect(evidence.webTeam).toEqual([
      expect.objectContaining({
        name: "Meow",
        role: "Co-founder",
        sourceUrl: "https://jup.ag/founder",
        artifact_verified: true,
        provider: "basic-facts-web",
      }),
    ]);
    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "identity-resolution", status: "confirmed", provider: "basic-facts-web", sourceCount: 1 }),
      expect.objectContaining({ id: "affiliations-associates", status: "confirmed", provider: "basic-facts-web", sourceCount: 1 }),
      expect.objectContaining({ id: "project-team-identity", status: "confirmed" }),
      expect.objectContaining({ id: "project-product-substance", status: "confirmed" }),
      expect.objectContaining({ id: "project-traction-liveness", status: "confirmed" }),
      expect.objectContaining({ id: "project-backing-partners", status: "confirmed" }),
      expect.objectContaining({ id: "project-transparency", status: "confirmed" }),
    ]));
    expect(evidence.profile.identity_confidence).toBe("Probable");
    expect(outcome.detail).toContain("1 verified backing record");
    expect(outcome.detail).toContain("2 verified disclosure records");
  });

  it("merges a verified full-name fact into the roster member with the same cited X handle", () => {
    const evidence = resolvedProjectProfile("the Solana liquidity protocol", "https://jup.ag");
    evidence.roles = [SubjectClass.PROJECT];
    const siong = basicFact("founder", "Siong Ong", "Co-founder");
    siong.sources[0] = {
      ...siong.sources[0],
      url: "https://discuss.jup.ag/t/founders/1",
      excerpt: "Siong Ong (@sssionggg) is a co-founder of Jupiter.",
    };
    evidence.basicFacts = [siong];
    evidence.webTeam = [{
      name: "Siong",
      handle: "@sssionggg",
      role: "Co-founder",
      source: "Jupiter governance forum",
      sourceUrl: "https://discuss.jup.ag/t/founders/1",
      evidence: "Siong is listed as a co-founder.",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "team-page",
      identity_link_evidence_origin: "deterministic",
    }];
    const checks: CheckObservation[] = [];
    const ctx: CollectContext = {
      handle: "@JupiterExchange",
      evidence,
      emit: () => undefined,
      recordCheck: (check) => checks.push(check),
    };

    projectVerifiedBasicFacts(ctx);

    expect(evidence.webTeam).toHaveLength(1);
    expect(evidence.webTeam[0]).toMatchObject({ name: "Siong", handle: "@sssionggg" });
    expect(checks).toContainEqual(expect.objectContaining({
      id: "project-team-identity",
      status: "confirmed",
      provider: "basic-facts-web",
    }));
  });

  it("does not attach another co-founder's handle to a verified founder fact", () => {
    const evidence = resolvedProjectProfile("the Solana protocol", "https://project.example");
    evidence.roles = [SubjectClass.PROJECT];
    const alice = basicFact("founder", "Alice", "Co-founder");
    alice.sources[0] = {
      ...alice.sources[0],
      url: "https://project.example/team",
      excerpt: "Alice and @bob co-founded Project Example.",
    };
    evidence.basicFacts = [alice];
    evidence.webTeam = [{
      name: "Bob",
      handle: "@bob",
      role: "Co-founder",
      source: "Official team page",
      sourceUrl: "https://project.example/team",
      evidence: "Bob is a co-founder.",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "team-page",
      identity_link_evidence_origin: "deterministic",
    }];
    const ctx: CollectContext = {
      handle: "@project",
      evidence,
      emit: () => undefined,
    };

    projectVerifiedBasicFacts(ctx);

    expect(evidence.webTeam).toHaveLength(2);
    expect(evidence.webTeam).toContainEqual(expect.objectContaining({ name: "Bob", handle: "@bob" }));
    const aliceMember = evidence.webTeam.find((member) => member.name === "Alice");
    expect(aliceMember).toBeDefined();
    expect(aliceMember?.handle).toBeUndefined();
  });

  it.each([
    ["no official site", null, "twitterapi", "2026-07-12T14:00:00.000Z"],
    ["untrusted profile provider", "https://world.xyz/", "model", "2026-07-12T14:00:00.000Z"],
    ["unfrozen provider profile", "https://world.xyz/", "twitterapi", undefined],
    ["shared-host profile URL", "https://medium.com/world", "twitterapi", "2026-07-12T14:00:00.000Z"],
  ])("rejects PROJECT routing with %s", (_label, website, provider, capturedAt) => {
    const evidence = resolvedProjectProfile("the solana prediction market", website);
    evidence.profile.profile_provider = provider;
    evidence.profile.profile_captured_at = capturedAt;

    expect(providerBackedRoles(evidence)).not.toContain(SubjectClass.PROJECT);
  });
});

describe("provider-backed employment title routing", () => {
  const withVerifiedRole = (role: string) => {
    const evidence = emptyEvidence("@person");
    evidence.ventures.push({
      project_name: "Example Corp",
      role,
      period: "2024",
      outcome: VentureOutcome.ACTIVE,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "peopledatalabs",
    });
    return evidence;
  };

  it.each([
    "Principal Engineer",
    "Partnerships Lead",
    "Principal Product Manager",
    "Venture Lead",
  ])("routes the verified employment title %s to MEMBER, not the investor fund methodology", (role) => {
    expect(providerBackedRoles(withVerifiedRole(role))).toEqual([SubjectClass.MEMBER]);
  });

  it("does not route Head of Capital Markets to INVESTOR", () => {
    expect(providerBackedRoles(withVerifiedRole("Head of Capital Markets"))).not.toContain(SubjectClass.INVESTOR);
  });

  it.each([
    "Investor",
    "General Partner",
    "Principal",
    "Venture Capitalist",
  ])("keeps the professional capital-allocation title %s on INVESTOR", (role) => {
    expect(providerBackedRoles(withVerifiedRole(role))).toEqual([SubjectClass.INVESTOR]);
  });
});

describe("discovered-affiliation merge", () => {
  it("backfills bridge keys onto a colliding claims-extracted venture and keeps it corroboratable", () => {
    const ventures: Venture[] = [{
      project_name: "Deks",
      role: "founder",
      period: "2023",
      outcome: VentureOutcome.ACTIVE,
      evidence_origin: "model_lead",
      artifact_verified: false,
    }];

    const pending = mergeDiscoveredAffiliations(ventures, [{
      name: "Deks",
      role: "founder",
      year: "2023",
      evidence: "Named as founder in a launch article.",
      x_handle: "@deksxyz",
      domain: "deks.xyz",
    }]);

    expect(ventures).toHaveLength(1);
    expect(ventures[0]).toMatchObject({
      project_name: "Deks",
      x_handle: "@deksxyz",
      domain: "deks.xyz",
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    expect(ventures[0].notes).toContain("Named as founder in a launch article.");
    expect(pending).toHaveLength(1);
    expect(pending[0].rec).toBe(ventures[0]);
  });

  it("merges bridge keys onto a provider-verified venture without touching its provenance or re-queueing it", () => {
    const ventures: Venture[] = [{
      project_name: "Deks",
      role: "Founder",
      period: "2023",
      outcome: VentureOutcome.ACTIVE,
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "peopledatalabs",
    }];

    const pending = mergeDiscoveredAffiliations(ventures, [{
      name: "Deks",
      role: "founder",
      x_handle: "@deksxyz",
    }]);

    expect(pending).toEqual([]);
    expect(ventures[0]).toMatchObject({
      x_handle: "@deksxyz",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "peopledatalabs",
    });
  });

  it("still pushes a fresh discovery as an unverified model lead in the corroboration queue", () => {
    const ventures: Venture[] = [];

    const pending = mergeDiscoveredAffiliations(ventures, [{
      name: "Deks",
      role: "founder",
      x_handle: "@deksxyz",
      domain: "deks.xyz",
    }]);

    expect(ventures).toEqual([expect.objectContaining({
      project_name: "Deks",
      x_handle: "@deksxyz",
      domain: "deks.xyz",
      outcome: VentureOutcome.ACTIVE,
      evidence_origin: "model_lead",
      artifact_verified: false,
      notes: expect.stringContaining("single-source lead, unverified"),
    })]);
    expect(pending).toHaveLength(1);
    expect(pending[0].rec).toBe(ventures[0]);
  });
});
