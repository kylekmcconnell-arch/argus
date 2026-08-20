import { describe, expect, it } from "vitest";
import { SubjectClass, VentureOutcome, type Venture } from "../src/engine";
import { emptyEvidence, type BasicFact, type BasicFactPredicate } from "../src/data/evidence";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { basicFactsResearchQuestions } from "./adapters/basicFacts";
import {
  axisCatalog,
  coalesceTeamMembersByHandle,
  collectProjectCoreEvidenceOutcomes,
  mergeDiscoveredAffiliations,
  protocolRecordMatchesCanonicalToken,
  projectVerifiedBasicFacts,
  providerBackedRoles,
  partitionProjectRelationshipsForScoring,
  providerFailureLinesForEvidence,
} from "./orchestrate";
import {
  hydrateOfficialProjectIdentityFromFacts,
  verifiedOfficialProjectIdentity,
} from "./projectIdentity";

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

describe("project relationship scorer routing", () => {
  it("partitions verified operating people from non-core context and excludes candidates", () => {
    const partitioned = partitionProjectRelationshipsForScoring([
      {
        name: "JRA",
        handle: "@jra_xyz",
        role: "COO and cofounder",
        kind: "person",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        relationshipProvenance: "subject_official",
      },
      {
        name: "Superteam DE",
        handle: "@superteamde",
        role: "ecosystem",
        kind: "org",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        relationshipProvenance: "subject_official",
      },
      {
        name: "Strategic Super R",
        handle: "@strategicsuperr",
        role: "VC",
        kind: "person",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
        relationshipProvenance: "claimant_self",
      },
      {
        name: "Lovable",
        handle: "@lovable_dev",
        role: "VC",
        kind: "org",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
    ]);

    expect(partitioned.coreTeam.map((member) => member.name)).toEqual(["JRA"]);
    expect(partitioned.nonCoreRelationships.map((member) => ({
      name: member.name,
      relationship: member.relationship,
    }))).toEqual([
      { name: "Superteam DE", relationship: "ecosystem" },
    ]);
    expect([
      ...partitioned.coreTeam,
      ...partitioned.nonCoreRelationships,
    ].map((member) => member.name)).not.toContain("Strategic Super R");
  });

  it("promotes a claimant-only relationship only after stronger project-side proof binds the same identity", () => {
    const claimant = {
      name: "Strategic Super R",
      handle: "@strategicsuperr",
      role: "VC",
      kind: "person" as const,
      provider: "twitterapi",
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      relationshipProvenance: "claimant_self" as const,
    };
    expect(partitionProjectRelationshipsForScoring([claimant])).toMatchObject({
      coreTeam: [],
      nonCoreRelationships: [],
    });

    const confirmed = partitionProjectRelationshipsForScoring([
      claimant,
      {
        ...claimant,
        provider: "team-page",
        sourceUrl: "https://multihopper.example/backers",
        relationshipProvenance: "subject_official",
      },
    ]);
    expect(confirmed.coreTeam).toEqual([]);
    expect(confirmed.nonCoreRelationships).toEqual([
      expect.objectContaining({
        name: "Strategic Super R",
        relationship: "backer",
        relationshipProvenance: "subject_official",
      }),
    ]);
  });
});

describe("public X probe failure policy", () => {
  const cost = {
    calls: [
      {
        provider: "x-public",
        op: "account-state",
        calls: 1,
        succeeded: 0,
        partial: 0,
        failed: 1,
        cached: 0,
        status: "failed" as const,
        usd: 0,
        meta: "multihopper · temporarily_unavailable_http_404",
      },
      {
        provider: "github",
        op: "users/multihopper",
        calls: 1,
        succeeded: 0,
        partial: 0,
        failed: 1,
        cached: 0,
        status: "failed" as const,
        usd: 0,
        meta: "http_503",
      },
    ],
  };

  it("keeps the retryable probe notice when no other source established identity", () => {
    const evidence = emptyEvidence("@multihopper");
    expect(providerFailureLinesForEvidence(cost, evidence).map((line) => line.provider))
      .toEqual(["x-public", "github"]);
  });

  it("suppresses only the public-X probe after an independent handle binding", () => {
    const evidence = emptyEvidence("@person");
    evidence.profile.identity_binding = "independent_exact_handle";
    expect(providerFailureLinesForEvidence(cost, evidence).map((line) => line.provider))
      .toEqual(["github"]);
  });

  it("suppresses a related-person X probe even when the subject itself is unresolved", () => {
    const evidence = emptyEvidence("@multihopper");
    const relatedCost = {
      calls: cost.calls.map((line) => line.provider === "x-public"
        ? { ...line, meta: "lovable_dev · temporarily_unavailable_http_404" }
        : line),
    };
    expect(providerFailureLinesForEvidence(relatedCost, evidence).map((line) => line.provider))
      .toEqual(["github"]);
  });

  it("suppresses only the public-X probe after a verified official-site identity binding", () => {
    const evidence = emptyEvidence("@multihopper");
    const identity = {
      ...basicFact("official_identity", "MultiHopper routing protocol"),
      subjectKey: "@multihopper",
      questionId: "project.official_identity",
      sources: [{
        ...basicFact("official_identity", "MultiHopper routing protocol").sources[0],
        url: "https://multihopper.com/about",
      }],
    };
    evidence.basicFacts = [identity];

    expect(verifiedOfficialProjectIdentity(evidence)).not.toBeNull();
    expect(providerFailureLinesForEvidence(cost, evidence).map((line) => line.provider))
      .toEqual(["github"]);
  });
});

describe("provider-backed project routing", () => {
  it("classifies an empty-bio account from its own posts instead of refusing to route", () => {
    // The @stonkbrokers case: empty bio, no website, 11 followers. Routing read
    // only the bio, found nothing, and published INCOMPLETE with zero
    // applicable checks even though the account's own posts say what it is.
    const evidence = emptyEvidence("@stonkbrokers");
    evidence.profile.bio = "";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-07-27T13:00:00.000Z";
    expect(providerBackedRoles(evidence)).toEqual([]);

    evidence.profile.self_post_sample = "daily alpha calls for degen traders. entry and exit signals on the best gems.";
    expect(providerBackedRoles(evidence)).toContain(SubjectClass.KOL);
  });

  it("keeps the bio governing when it says something", () => {
    const evidence = emptyEvidence("@somefund");
    evidence.profile.bio = "We back bold entrepreneurs building the next internet.";
    evidence.profile.self_post_sample = "alpha calls degen gems";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-07-27T13:00:00.000Z";
    const roles = providerBackedRoles(evidence);
    expect(roles).toContain(SubjectClass.INVESTOR);
    expect(roles).not.toContain(SubjectClass.KOL);
  });

  it("routes a powered-by-token brand account as PROJECT, not INVESTOR", () => {
    // The @orbitgroup_ai case: a token platform whose bio also says
    // "capital" and "investors". The fund methodology starves such a scan
    // into INCOMPLETE; the project methodology can actually assess it.
    const evidence = resolvedProjectProfile(
      "Burn-rate-based fundraising for serious founders. Connecting capital with execution, transparently. Built for builders. Trusted by investors. Powered by $ORBIT",
      "https://orbitgroup.ai/",
    );
    const roles = providerBackedRoles(evidence);
    expect(roles).toContain(SubjectClass.PROJECT);
    expect(roles).not.toContain(SubjectClass.INVESTOR);
  });

  it("keeps the fund methodology when the investor signal leads or is verified", () => {
    const fund = resolvedProjectProfile(
      "We back bold entrepreneurs building the next internet. Our platform for founders.",
      "https://fund.example/",
    );
    const fundRoles = providerBackedRoles(fund);
    expect(fundRoles).toContain(SubjectClass.INVESTOR);
    expect(fundRoles).not.toContain(SubjectClass.PROJECT);

    const verifiedGp = resolvedProjectProfile(
      "Burn-rate-based fundraising for serious founders. Powered by $ORBIT",
      "https://orbitgroup.ai/",
    );
    verifiedGp.ventures.push({
      name: "Orbit Capital",
      role: "General Partner",
      evidence_origin: "deterministic",
      artifact_verified: true,
    } as unknown as Venture);
    const gpRoles = providerBackedRoles(verifiedGp);
    expect(gpRoles).toContain(SubjectClass.INVESTOR);
    expect(gpRoles).not.toContain(SubjectClass.PROJECT);
  });

  it("requires an exact CoinGecko identity join for protocol fundamentals", () => {
    expect(protocolRecordMatchesCanonicalToken("uniswap", "uniswap")).toBe(true);
    expect(protocolRecordMatchesCanonicalToken("uniswap-v3", "uniswap")).toBe(false);
    expect(protocolRecordMatchesCanonicalToken(null, "uniswap")).toBe(false);
  });

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

  it("does not collapse a name-only provider row without a stable identity bridge", () => {
    expect(coalesceTeamMembersByHandle([
      {
        name: "Erik Voorhees",
        role: "Founder & CEO",
        source: "Monid/Akta management record",
        sourceUrl: "https://venice.ai/",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "monid",
        identity_link_evidence_origin: "deterministic",
      },
      {
        name: "Erik Voorhees",
        handle: "@ErikVoorhees",
        role: "Founder & CEO",
        source: "Official project post",
        sourceUrl: "https://x.com/askvenice/status/1",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "twitterapi",
        identity_link_evidence_origin: "deterministic",
      },
    ])).toHaveLength(2);
  });

  it("carries the first-party handle marker forward through a coalesce, never backward", () => {
    // A team-page row (higher evidence rank, no marker) collides with a
    // post-role-scan row for the same handle (lower rank, but the subject's
    // OWN posts named them). The merged row must still read as first-party —
    // the enrichment gate would otherwise silently lose the two real handles.
    const merged = coalesceTeamMembersByHandle([
      {
        name: "Prophett",
        handle: "@proph3ttt",
        role: "Founder",
        source: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
        identity_link_evidence_origin: "deterministic",
      },
      {
        name: "Prophett",
        handle: "@proph3ttt",
        role: "Founder",
        source: "post role-scan",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "twitterapi",
        identity_link_evidence_origin: "deterministic",
        handleProvenance: "subject_first_party",
      },
    ]);
    expect(merged).toEqual([
      expect.objectContaining({ handle: "@proph3ttt", handleProvenance: "subject_first_party" }),
    ]);
  });

  it("leaves a search-only handle without the first-party marker after a coalesce", () => {
    const merged = coalesceTeamMembersByHandle([
      {
        name: "Grok Lead",
        handle: "@someone",
        role: "Advisor",
        source: "Web identity search",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "grok",
        identity_link_evidence_origin: "model_lead",
      },
    ]);
    expect(merged[0].handleProvenance).toBeUndefined();
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

  it("routes a person with a cryptic bio to FOUNDER on a verified founder fact", () => {
    // The @VitalikButerin shell: a personal, keyword-free bio (no "founder"),
    // no official website, and ventures that arrived only as model leads, so
    // classifier + venture routing both come up empty. A fetched source that
    // names the subject as a company founder must still route the subject.
    const evidence = emptyEvidence("@vitalikbuterin");
    evidence.profile.bio = "I choose balance. First-level balance.";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-07-19T14:00:00.000Z";
    evidence.profile.identity_binding = "independent_exact_handle";
    evidence.basicFacts = [basicFact("founder", "Ethereum")];
    expect(providerBackedRoles(evidence)).toEqual([SubjectClass.FOUNDER]);
  });

  it("routes a suspended brand account from a verified official-site identity binding", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.profile.profile_collection_state = "unavailable";
    evidence.profile.website = "https://www.drift.trade/";
    evidence.basicFacts = [basicFact("official_identity", "Drift Protocol")];

    expect(providerBackedRoles(evidence)).toEqual([SubjectClass.PROJECT]);
  });

  it("restores a reused project identity before routing a suspended account", () => {
    const evidence = emptyEvidence("@driftprotocol");
    evidence.profile.display_name = "driftprotocol";
    evidence.profile.profile_collection_state = "unavailable";
    const identity = {
      ...basicFact("official_identity", "Drift Protocol"),
      questionId: "project.official_identity",
      sources: [{
        ...basicFact("official_identity", "Drift Protocol").sources[0],
        url: "https://www.drift.trade/governance/introducing-the-drift-governance-token",
      }],
    };

    expect(verifiedOfficialProjectIdentity(evidence, [identity])).toEqual(expect.objectContaining({
      fact: expect.objectContaining({ value: "Drift Protocol" }),
      website: expect.objectContaining({ domain: "drift.trade" }),
    }));
    expect(hydrateOfficialProjectIdentityFromFacts(evidence, [identity])).not.toBeNull();
    expect(evidence.profile.website).toBe("https://drift.trade/governance/introducing-the-drift-governance-token");
    expect(evidence.profile.display_name).toBe("Drift Protocol");
    expect(evidence.profile.identity_confidence).toBe("Confirmed");
    expect(evidence.roles).toEqual([SubjectClass.PROJECT]);
    expect(basicFactsResearchQuestions({
      handle: evidence.profile.handle,
      evidence,
      emit: () => undefined,
    }).some((question) => question.predicate === "security_incident")).toBe(true);
    expect(providerBackedRoles({ ...evidence, basicFacts: [identity] })).toEqual([SubjectClass.PROJECT]);
  });

  it("does not route to FOUNDER on a non-founder fact or an unresolved founder fact", () => {
    const evidence = emptyEvidence("@subject");
    evidence.profile.bio = "gm";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-07-19T14:00:00.000Z";
    // A verified education fact is not a role signal; a founder fact that only
    // reached "conflicted" (not verified/corroborated) must not route either.
    evidence.basicFacts = [
      basicFact("education", "MIT"),
      { ...basicFact("founder", "SomeCo"), status: "conflicted" as const },
    ];
    expect(providerBackedRoles(evidence)).toEqual([]);
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

  it("routes a keyword-free brand account to PROJECT from a bound Grok orientation even without a live-site mark", () => {
    // The @multihopper case: slogan bio with no protocol/platform keyword, so
    // classifier + live-site fallback (needs site_substance_status === "live")
    // both miss. Bound Grok orientation is the last-resort unique-id bind.
    const evidence = emptyEvidence("@multihopper");
    evidence.profile.bio = "SWIFT 2.0 for digital assets. Programmable, non-custodial routing…";
    evidence.profile.website = "https://multihopper.com";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-19T12:00:00.000Z";
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "Non-custodial onchain asset routing infrastructure.",
      audience: "teams moving digital assets",
      boundHandle: "@multihopper",
      boundDomain: "multihopper.com",
      sourceUrls: ["https://x.com/multihopper", "https://multihopper.com/"],
      mentionedHandles: [
        { handle: "@alice", roleHint: "co-founder", quote: "Welcome co-founder @alice to the team." },
      ],
    };
    const roles = providerBackedRoles(evidence);
    expect(roles).toContain(SubjectClass.PROJECT);
    expect(roles).not.toContain(SubjectClass.FOUNDER);
  });

  it("does not put FOUNDER on a PROJECT-bound brand with a person-like display name", () => {
    // Brand handle + official domain is the unique-id. Display name may match
    // a person. A product-lab bio ("building"), a verified founder fact, and
    // a venture founder title all describe a person — not this brand account.
    const evidence = emptyEvidence("@brandlab");
    evidence.profile.display_name = "Morgan Chen";
    evidence.profile.bio = "A product lab building onchain markets.";
    evidence.profile.website = "https://brandlab.com";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-19T12:00:00.000Z";
    evidence.profile.identity_binding = "independent_exact_handle";
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "A product lab for onchain markets.",
      audience: "builders",
      boundHandle: "@brandlab",
      boundDomain: "brandlab.com",
      sourceUrls: ["https://x.com/brandlab", "https://brandlab.com/"],
    };
    evidence.basicFacts = [basicFact("founder", "Someone")];
    evidence.ventures.push({
      name: "Brand Lab",
      role: "founder",
      evidence_origin: "deterministic",
      artifact_verified: true,
    } as unknown as Venture);

    const roles = providerBackedRoles(evidence);
    expect(roles).toContain(SubjectClass.PROJECT);
    expect(roles).not.toContain(SubjectClass.FOUNDER);
  });

  it("keeps FOUNDER routing on a personal account with FOUNDER orientation", () => {
    const evidence = emptyEvidence("@alicefounder");
    evidence.profile.display_name = "Alice";
    evidence.profile.bio = "gm";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-19T12:00:00.000Z";
    evidence.subjectOrientation = {
      kind: "FOUNDER",
      what: "Founder of a product lab.",
      audience: "",
      boundHandle: "@alicefounder",
      boundDomain: null,
      sourceUrls: ["https://x.com/alicefounder"],
    };
    expect(providerBackedRoles(evidence)).toEqual([SubjectClass.FOUNDER]);
  });

  it("keeps orientation-PROJECT unroutable when the domain did not bind", () => {
    const evidence = emptyEvidence("@multihopper");
    evidence.profile.bio = "SWIFT 2.0 for digital assets. Programmable, non-custodial routing…";
    evidence.profile.website = "https://multihopper.com";
    evidence.profile.profile_collection_state = "resolved";
    evidence.profile.profile_provider = "twitterapi";
    evidence.profile.profile_captured_at = "2026-08-19T12:00:00.000Z";
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "Non-custodial onchain asset routing infrastructure.",
      audience: "",
      boundHandle: "@multihopper",
      boundDomain: null,
      sourceUrls: ["https://x.com/multihopper"],
    };
    expect(providerBackedRoles(evidence)).toEqual([]);
  });

  it("never lets orientation PROJECT override a bio-classified role", () => {
    const evidence = resolvedProjectProfile("Daily alpha calls", "https://world.xyz/");
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "A trading-signal product.",
      audience: "",
      boundHandle: "@world_xyz",
      boundDomain: "world.xyz",
      sourceUrls: ["https://world.xyz/"],
    };
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
    expect(outcome.detail).toContain("1 strictly verified backing record");
    expect(outcome.detail).toContain("2 strictly verified disclosure records");
  });

  it("never lists the audited subject handle as founder of itself on team", () => {
    const evidence = resolvedProjectProfile("the Solana liquidity protocol", "https://jup.ag");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.profile.display_name = "Jupiter";
    const selfFact = basicFact("founder", "@JupiterExchange", "Founder");
    selfFact.sources[0].excerpt = "Jupiter (@JupiterExchange) is the founder.";
    evidence.basicFacts = [selfFact];
    const ctx: CollectContext = {
      handle: "@JupiterExchange",
      evidence,
      emit: () => undefined,
    };

    projectVerifiedBasicFacts(ctx);

    const roster = evidence.webTeam ?? [];
    expect(roster.some((member) => {
      const handle = (member.handle ?? "").replace(/^@/, "").toLowerCase();
      const name = (member.name ?? "").replace(/^@/, "").toLowerCase();
      return handle === "jupiterexchange" || name === "jupiterexchange";
    })).toBe(false);
  });

  it("counts a verified operating partnership as backing evidence", () => {
    const evidence = resolvedProjectProfile("the Solana liquidity protocol", "https://jup.ag");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.basicFacts = [basicFact("partnership", "Pyth Network")];
    const checks: CheckObservation[] = [];
    const ctx: CollectContext = {
      handle: "@JupiterExchange",
      evidence,
      emit: () => undefined,
      recordCheck: (check) => checks.push(check),
    };

    collectProjectCoreEvidenceOutcomes(ctx);

    expect(checks).toContainEqual(expect.objectContaining({
      id: "project-backing-partners",
      status: "confirmed",
      sourceCount: 1,
      note: expect.stringContaining("operating-partner record was verified"),
    }));
  });

  it("counts distinct publishers under a two-label public suffix as independent identity witnesses", () => {
    const evidence = resolvedProjectProfile("the example protocol", "https://project.example");
    evidence.roles = [SubjectClass.PROJECT];
    const founder = basicFact("founder", "Alice Example", "Founder");
    founder.sources = [
      {
        ...founder.sources[0],
        url: "https://www.bbc.co.uk/news/alice-example",
        sourceClass: "independent_press",
      },
      {
        ...founder.sources[0],
        url: "https://www.telegraph.co.uk/business/alice-example",
        sourceClass: "independent_press",
      },
    ];
    evidence.basicFacts = [founder];
    const ctx: CollectContext = {
      handle: "@project",
      evidence,
      emit: () => undefined,
    };

    projectVerifiedBasicFacts(ctx);

    expect(evidence.profile.identity_confidence).toBe("Confirmed");
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
    "Venture Lead",
    "Investment Director",
    "Portfolio Manager",
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
