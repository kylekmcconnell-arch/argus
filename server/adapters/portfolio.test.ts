import { describe, expect, it, vi } from "vitest";
import { SubjectClass, VentureOutcome, type Venture } from "../../src/engine";
import { assembleDossier } from "../../src/data/dossier";
import { emptyEvidence, type PortfolioLead } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import type { CheckObservation, CollectContext } from "./types";
import {
  collectPortfolioRelationships,
  domainFromWebsite,
  parsePortfolioCandidates,
  portfolioEntityForLead,
  supportsPortfolioRelationship,
} from "./portfolio";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";

const NOW = new Date("2026-07-11T12:00:00.000Z");

const lead = (overrides: Partial<PortfolioLead> = {}): PortfolioLead => ({
  projectName: "Acme Protocol",
  relationship: "invested_in",
  sources: [{ url: "https://paradigm.xyz/portfolio/acme" }],
  evidence_origin: "model_lead",
  artifact_verified: false,
  provider: "grok",
  ...overrides,
});

const document = (overrides: Partial<PublicTextDocument> = {}): PublicTextDocument => ({
  status: "ok",
  url: "https://paradigm.xyz/portfolio/acme",
  host: "paradigm.xyz",
  contentType: "text/html",
  text: "<html><body><h1>Our portfolio</h1><article>Acme Protocol</article></body></html>",
  contentHash: "a".repeat(64),
  capturedAt: "2026-07-11T12:00:00.000Z",
  ...overrides,
});

function context(handle = "@paradigm", displayName = "Paradigm") {
  const evidence = emptyEvidence(handle);
  evidence.profile.display_name = displayName;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = NOW.toISOString();
  if (handle === "@paradigm") evidence.profile.website = "https://paradigm.xyz";
  evidence.roles = [SubjectClass.INVESTOR];
  const checks: CheckObservation[] = [];
  const ctx: CollectContext = {
    handle,
    evidence,
    emit: vi.fn(),
    recordCheck: (check) => checks.push(check),
  };
  return { ctx, evidence, checks };
}

describe("portfolio candidate parsing", () => {
  it.each([
    "https://fund.medium.com/about",
    "https://paradigm.substack.com",
    "https://paradigm.github.io",
    "https://paradigm.vercel.app",
    "https://linktr.ee/paradigm",
    "https://bio.link/paradigm",
    "https://github.com/paradigmxyz",
    "https://linkedin.com/company/paradigm",
    "https://youtube.com/@paradigm",
    "https://mirror.xyz/paradigm.eth",
    "https://ipfs.io/ipfs/bafy-profile",
    "https://co.uk",
    "https://x.com/paradigm",
    "http://127.0.0.1/site",
  ])("does not promote shared or local hosting to an official domain: %s", (website) => {
    expect(domainFromWebsite(website)).toBeUndefined();
  });

  it("normalizes a dedicated official domain", () => {
    expect(domainFromWebsite("https://WWW.Paradigm.xyz/about")).toBe("paradigm.xyz");
  });

  it("keeps source-linked model leads but drops unsafe source URLs", () => {
    const parsed = parsePortfolioCandidates(JSON.stringify({
      investments: [{
        project: "Acme Protocol",
        project_x_handle: "@acme",
        sources: [
          { url: "https://example.com/acme", title: "Round announcement" },
          { url: "http://127.0.0.1/private" },
          { url: "https://user:secret@example.com/private" },
          { url: "https://example.com/private?X-Amz-Credential=secret" },
        ],
      }],
    }));
    expect(parsed).toEqual([expect.objectContaining({
      projectName: "Acme Protocol",
      projectHandle: "@acme",
      evidence_origin: "model_lead",
      artifact_verified: false,
      sources: [{ url: "https://example.com/acme", title: "Round announcement" }],
    })]);
  });

  it("keeps distinct investor attributions for the same project", () => {
    const parsed = parsePortfolioCandidates(JSON.stringify({
      investments: [{
        project: "Acme Protocol",
        investor_entity: "Alice Example",
        attribution: "direct_subject",
        source_url: "https://alice.example/investments/acme",
      }, {
        project: "Acme Protocol",
        investor_entity: "Example Fund",
        attribution: "affiliated_fund",
        source_url: "https://fund.example/portfolio/acme",
      }],
    }));
    expect(parsed).toHaveLength(2);
  });
});

describe("portfolio relationship matching", () => {
  it("rejects negated investment language", () => {
    expect(supportsPortfolioRelationship({
      document: document({ text: "Paradigm did not invest in Acme Protocol." }),
      sourceClass: "first_party_subject",
      subjectAliases: ["Paradigm"],
      projectName: "Acme Protocol",
    }).supported).toBe(false);
  });

  it("requires the subject, project, and investment predicate on third-party sources", () => {
    expect(supportsPortfolioRelationship({
      document: document({
        url: "https://techcrunch.com/acme-round",
        host: "techcrunch.com",
        text: "Acme Protocol announced a seed financing led by Paradigm.",
      }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm", "paradigm"],
      projectName: "Acme Protocol",
    }).supported).toBe(true);
  });

  it("matches short project names on token boundaries rather than substrings", () => {
    expect(supportsPortfolioRelationship({
      document: document({ text: "Our investment database is available to partners." }),
      sourceClass: "first_party_investor",
      subjectAliases: ["Paradigm"],
      projectName: "Base",
    }).supported).toBe(false);
    expect(supportsPortfolioRelationship({
      document: document({ text: "Paradigm invested in one company during the quarter." }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      projectName: "One",
    }).supported).toBe(false);
  });

  it("does not join unrelated page-level mentions into a relationship", () => {
    expect(supportsPortfolioRelationship({
      document: document({
        url: "https://techcrunch.com/roundup",
        host: "techcrunch.com",
        text: "Paradigm invested in Foo Protocol. Acme Protocol separately announced a product update.",
      }),
      sourceClass: "independent_press",
      subjectAliases: ["Paradigm"],
      projectName: "Acme Protocol",
    }).supported).toBe(false);
  });
});

describe("investor affiliation resolution", () => {
  const affiliatedLead = () => lead({
    investorEntityName: "Paradigm",
    investorEntityHandle: "@paradigm",
    attribution: "affiliated_fund",
  });

  it.each([
    ["unresolved profile", { profile_collection_state: "unavailable" }],
    ["untrusted provider", { profile_provider: "fixture" }],
    ["missing capture", { profile_captured_at: undefined }],
    ["stale capture", { profile_captured_at: new Date(NOW.getTime() - 24 * 60 * 60 * 1_000 - 1).toISOString() }],
    ["future capture", { profile_captured_at: new Date(NOW.getTime() + 5 * 60 * 1_000 + 1).toISOString() }],
  ] as const)("does not ground a bio affiliation from a %s", (_label, profileOverrides) => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = "Research Partner at Paradigm";
    Object.assign(evidence.profile, profileOverrides);
    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toBeNull();
  });

  it.each([
    "Former Research Partner at Paradigm",
    "No longer a Partner at Paradigm",
    "Left my role at Paradigm",
    "Departed from Paradigm after serving as Partner",
    "Retired as Partner at Paradigm",
    "Research Partner at Paradigm (retired 2025)",
    "Research Partner at Paradigm until 2025",
    "Currently independent, formerly Research Partner at Paradigm",
    "Currently independent and formerly Research Partner at Paradigm",
    "Not a partner @paradigm",
    "Never a partner @paradigm",
    "No affiliation with Paradigm",
    "Not affiliated with @paradigm",
    "Former co-founder @paradigm",
    "Not @paradigm partner",
    "Not a @paradigm partner",
    "Never @paradigm employee",
  ])("rejects ended-affiliation language in a current provider bio: %s", (bio) => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = bio;
    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toBeNull();
  });

  it.each(["Paradigm", "at Paradigm", "@Paradigm"])(
    "does not treat a bare fund mention as a current role: %s",
    (bio) => {
      const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
      evidence.profile.bio = bio;
      expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toBeNull();
    },
  );

  it.each([
    "GP @Paradigm",
    "Research @Paradigm",
    "Co-founder @Paradigm",
    "CEO @Paradigm",
    "CIO @Paradigm",
    "Portfolio manager @Paradigm",
  ])(
    "accepts a scoped current role form shared with the scorer: %s",
    (bio) => {
      const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
      evidence.profile.bio = bio;
      expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toMatchObject({
        name: "Paradigm",
        attributionSourceKind: "provider_profile",
      });
    },
  );

  it("permits an explicit current affiliation after a separate former role", () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = "Previously at Sequoia, now Research Partner at Paradigm";
    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toMatchObject({
      name: "Paradigm",
      attribution: "affiliated_fund",
      attributionSourceKind: "provider_profile",
      attributionCapturedAt: NOW.toISOString(),
    });
    evidence.profile.bio = "Previously at Sequoia and now Research Partner at Paradigm";
    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toMatchObject({
      name: "Paradigm",
      attributionSourceKind: "provider_profile",
    });
  });

  it("uses a fully attested current verified venture when the profile bio cannot ground the affiliation", () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = "Independent researcher";
    evidence.ventures.push({
      project_name: "Paradigm",
      x_handle: "@paradigm",
      domain: "https://paradigm.xyz",
      role: "Research Partner",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://example.com/employment/gakonst",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });

    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toMatchObject({
      name: "Paradigm",
      handle: "@paradigm",
      domain: "paradigm.xyz",
      subjectHandle: "@gakonst",
      attribution: "affiliated_fund",
      attributionSourceUrl: "https://example.com/employment/gakonst",
      attributionSourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      attributionCapturedAt: NOW.toISOString(),
      attributionSourceKind: "verified_venture",
    });
  });

  it.each([
    ["former role", { role: "Former Research Partner" }],
    ["ended period", { period: "2020-2023" }],
    ["ended note", { notes: "No longer with Paradigm" }],
    ["missing source", { evidence_url: undefined }],
    ["company-root source without person binding", { evidence_url: "https://paradigm.xyz" }],
    ["missing provider", { provider: undefined }],
  ] as Array<[string, Partial<Venture>]>)('rejects a verified-venture fallback with %s', (_label, overrides) => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = "Independent researcher";
    evidence.ventures.push({
      project_name: "Paradigm",
      x_handle: "@paradigm",
      domain: "paradigm.xyz",
      role: "Research Partner",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://example.com/employment/gakonst",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
      ...overrides,
    });
    expect(portfolioEntityForLead(ctx, affiliatedLead(), NOW)).toBeNull();
  });
});

describe("source-backed portfolio collection", () => {
  it("confirms a first-party fund portfolio relationship and creates INVESTED_IN, never FOUNDED", async () => {
    const { ctx, evidence, checks } = context();
    const result = await collectPortfolioRelationships(ctx, {
      discover: async () => [lead()],
      fetchSource: async () => document(),
      resolveProjectDomain: async () => undefined,
    });

    expect(result.state).toBe("executed");
    expect(checks).toContainEqual(expect.objectContaining({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      provider: "portfolio-web",
      sourceCount: 1,
    }));
    expect(evidence.portfolioLeads).toEqual([expect.objectContaining({ evidence_origin: "model_lead", artifact_verified: false })]);
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      kind: "portfolio_relationship",
      subjectHandle: "@paradigm",
      projectName: "Acme Protocol",
      match: "relationship_confirmed",
      sourceClass: "first_party_subject",
      sourceContentHash: "a".repeat(64),
    }));

    const graph = assembleDossier(evidence, true).graph;
    expect(graph.edges).toContainEqual(expect.objectContaining({ type: "INVESTED_IN", dst: "acme protocol" }));
    expect(graph.edges).not.toContainEqual(expect.objectContaining({ type: "FOUNDED", dst: "acme protocol" }));
  });

  it("attributes an affiliated fund's investment to the fund rather than the employee", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Research Partner @paradigm";
    const affiliatedLead = lead({
      investorEntityName: "Paradigm",
      investorEntityHandle: "@paradigm",
      attribution: "affiliated_fund",
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [affiliatedLead],
      fetchSource: async () => document(),
      lookupProfile: async () => ({
        handle: "@paradigm",
        name: "Paradigm",
        website: "https://paradigm.xyz",
      }),
      now: () => NOW,
    });

    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      subjectHandle: "@gakonst",
      investorEntityName: "Paradigm",
      attribution: "affiliated_fund",
      attributionSourceUrl: "https://x.com/gakonst",
      attributionSourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      attributionCapturedAt: NOW.toISOString(),
      attributionSourceKind: "provider_profile",
      investorEntityDomain: "paradigm.xyz",
      investorDomainSourceUrl: "https://x.com/paradigm",
      investorDomainSourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      investorDomainCapturedAt: NOW.toISOString(),
      investorDomainSourceKind: "provider_profile",
      investorDomainProfileName: "Paradigm",
      investorDomainProfileWebsite: "https://paradigm.xyz/",
      match: "relationship_confirmed",
    }));
    const graph = assembleDossier(evidence, true).graph;
    expect(graph.edges).toContainEqual(expect.objectContaining({
      src: "@gakonst",
      dst: "@paradigm",
      type: "AFFILIATED_WITH",
      source_url: "https://x.com/gakonst",
    }));
    expect(graph.edges).toContainEqual(expect.objectContaining({ src: "@paradigm", dst: "acme protocol", type: "INVESTED_IN" }));
    expect(graph.edges).not.toContainEqual(expect.objectContaining({ src: "@gakonst", dst: "acme protocol", type: "INVESTED_IN" }));
  });

  it("does not treat an individual's employer website as a personal portfolio", async () => {
    const { ctx, evidence, checks } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.website = "https://paradigm.xyz";
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ investorEntityName: "Georgios Konstantopoulos", attribution: "direct_subject" })],
      fetchSource: async () => document(),
      resolveProjectDomain: async () => undefined,
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).not.toContainEqual(expect.objectContaining({ match: "relationship_confirmed" }));
  });

  it("does not accept a former employer as a current affiliated fund", async () => {
    const { ctx, evidence, checks } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Partner at Paradigm; formerly Sequoia Capital";
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        investorEntityName: "Sequoia Capital",
        investorEntityHandle: "@sequoia",
        attribution: "affiliated_fund",
      })],
      fetchSource: async () => document(),
      now: () => NOW,
    });

    expect(checks.at(-1)).toMatchObject({ status: "unavailable" });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it("does not let a model-supplied wrong investor handle establish an official domain", async () => {
    const { ctx, evidence, checks } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Research Partner at Paradigm";
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        investorEntityName: "Paradigm",
        investorEntityHandle: "@a16z",
        attribution: "affiliated_fund",
        sources: [{ url: "https://a16z.com/portfolio/acme" }],
      })],
      lookupProfile: async () => ({
        handle: "@a16z",
        name: "a16z",
        website: "https://a16z.com",
      }),
      fetchSource: async () => document({
        url: "https://a16z.com/portfolio/acme",
        host: "a16z.com",
        text: "a16z invested in Acme Protocol during its seed round.",
      }),
      now: () => NOW,
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it("does not trust a wrong fund handle merely because its fetched display name matches", async () => {
    const { ctx, evidence, checks } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.resolved_name = "Georgios Konstantopoulos";
    evidence.profile.bio = "Research Partner at Paradigm";
    const lookupProfile = vi.fn().mockResolvedValue({
      handle: "@paradigm_updates",
      name: "Paradigm",
      website: "https://attacker.example",
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        investorEntityName: "Paradigm",
        investorEntityHandle: "@paradigm_updates",
        attribution: "affiliated_fund",
        sources: [{ url: "https://attacker.example/portfolio/acme" }],
      })],
      lookupProfile,
      fetchSource: async () => document({
        url: "https://attacker.example/portfolio/acme",
        host: "attacker.example",
        text: "Paradigm invested in Acme Protocol.",
      }),
      now: () => NOW,
    });

    expect(lookupProfile).not.toHaveBeenCalled();
    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "other_public",
      match: "candidate",
    }));
    expect(evidence.sourceArtifacts).not.toContainEqual(expect.objectContaining({
      sourceClass: "first_party_investor",
      match: "relationship_confirmed",
    }));
  });

  it("keeps a model-supplied project handle and self-labeled project domain non-authoritative", async () => {
    const { ctx, evidence, checks } = context();
    const lookupProfile = vi.fn().mockResolvedValue({
      handle: "@fakeacme",
      name: "Acme Protocol",
      website: "https://attacker.example",
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        projectHandle: "@fakeacme",
        sources: [{ url: "https://attacker.example/fake-round" }],
      })],
      lookupProfile,
      fetchSource: async () => document({
        url: "https://attacker.example/fake-round",
        host: "attacker.example",
        text: "Acme Protocol announced a seed financing led by Paradigm.",
      }),
    });

    expect(lookupProfile).toHaveBeenCalledWith("@fakeacme");
    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      sourceClass: "first_party_project",
      match: "candidate",
      projectDomain: "attacker.example",
    }));
    expect(evidence.sourceArtifacts).not.toContainEqual(expect.objectContaining({
      match: "relationship_confirmed",
    }));
  });

  it("does not promote a shared hosting parent to a first-party investor source", async () => {
    const { ctx, evidence, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://medium.com/acme" }] })],
      fetchSource: async () => document({
        url: "https://medium.com/acme",
        host: "medium.com",
        text: "Our portfolio includes Acme Protocol.",
      }),
      resolveInvestorDomain: async () => "fund.medium.com",
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it("does not promote an account path on a multi-tenant host to a first-party investor source", async () => {
    const { ctx, evidence, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://github.com/attacker/fake" }] })],
      fetchSource: async () => document({
        url: "https://github.com/attacker/fake",
        host: "github.com",
        text: "Our portfolio includes Acme Protocol.",
      }),
      resolveInvestorDomain: async () => "github.com",
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it("memoizes official-domain resolution for repeated leads from the same investor", async () => {
    const { ctx } = context();
    const resolveInvestorDomain = vi.fn().mockResolvedValue("paradigm.xyz");
    const fetchSource = vi.fn().mockResolvedValue(document({
      text: "Our portfolio includes Acme Protocol and Beta Protocol.",
    }));
    const cost = await withCostLedger(async () => {
      await collectPortfolioRelationships(ctx, {
        discover: async () => [
          lead(),
          lead({ projectName: "Beta Protocol" }),
        ],
        fetchSource,
        resolveInvestorDomain,
      });
      return getCost();
    });

    expect(resolveInvestorDomain).toHaveBeenCalledTimes(1);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(cost.calls).toContainEqual(expect.objectContaining({
      provider: "portfolio-web",
      op: "source-fetch",
      calls: 1,
    }));
  });

  it("does not treat a shared-host profile URL as an official investor domain", async () => {
    const { ctx, evidence, checks } = context();
    evidence.profile.website = "https://fund.medium.com";
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://fund.medium.com/portfolio/acme" }] })],
      fetchSource: async () => document({
        url: "https://fund.medium.com/portfolio/acme",
        host: "fund.medium.com",
        text: "Our portfolio includes Acme Protocol.",
      }),
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toEqual([]);
  });

  it.each([
    ["project page", ["http://project.example/round"]],
    ["primary source", ["http://sec.gov/Archives/edgar/data/123/filing.html"]],
    ["press corroboration", ["http://reuters.com/acme", "http://techcrunch.com/acme"]],
  ])("never confirms portfolio evidence over plaintext HTTP from a %s", async (_label, urls) => {
    const { ctx, evidence, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        projectDomain: "project.example",
        sources: urls.map((url) => ({ url })),
      })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: "Paradigm invested in Acme Protocol during its seed financing.",
      }),
      resolveProjectDomain: async () => "project.example",
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).not.toContainEqual(expect.objectContaining({
      match: "relationship_confirmed",
    }));
    expect(evidence.sourceArtifacts.every((artifact) => artifact.sourceClass === "other_public")).toBe(true);
  });

  it("emits the verified-venture affiliation attestation with the relationship", async () => {
    const { ctx, evidence } = context("@gakonst", "Georgios Konstantopoulos");
    evidence.profile.bio = "Independent researcher";
    evidence.ventures.push({
      project_name: "Paradigm",
      x_handle: "@paradigm",
      domain: "paradigm.xyz",
      role: "Research Partner",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://example.com/employment/gakonst",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({
        investorEntityName: "Paradigm",
        investorEntityHandle: "@paradigm",
        attribution: "affiliated_fund",
      })],
      fetchSource: async () => document(),
      now: () => NOW,
    });

    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      subjectHandle: "@gakonst",
      investorEntityName: "Paradigm",
      attribution: "affiliated_fund",
      attributionSourceUrl: "https://example.com/employment/gakonst",
      attributionSourceContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      attributionCapturedAt: NOW.toISOString(),
      attributionSourceKind: "verified_venture",
      match: "relationship_confirmed",
    }));
  });

  it("keeps one independent press source reported-only and completes the bounded check empty", async () => {
    const { ctx, evidence, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources: [{ url: "https://techcrunch.com/acme-round" }] })],
      fetchSource: async () => document({
        url: "https://techcrunch.com/acme-round",
        host: "techcrunch.com",
        text: "Acme Protocol announced a seed financing led by Paradigm.",
      }),
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(checks.at(-1)).not.toHaveProperty("sourceCount");
    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      projectName: "Acme Protocol",
      match: "candidate",
      sourceClass: "independent_press",
    }));
  });

  it("confirms two independent press sources for the same relationship", async () => {
    const { ctx, checks } = context();
    const sources = [
      { url: "https://techcrunch.com/acme-round" },
      { url: "https://reuters.com/technology/acme-round" },
    ];
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: url.includes("reuters")
          ? "Acme Protocol closed a seed financing round with investment from Paradigm."
          : "Paradigm invested in Acme Protocol during its seed financing.",
      }),
    });
    expect(checks.at(-1)).toMatchObject({ status: "confirmed", sourceCount: 1 });
  });

  it("does not count syndicated press-release wires as independent corroboration", async () => {
    const { ctx, evidence, checks } = context();
    const sources = [
      { url: "https://prnewswire.com/acme-round" },
      { url: "https://globenewswire.com/acme-round" },
    ];
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        text: "Paradigm invested in Acme Protocol during its seed financing.",
      }),
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toHaveLength(2);
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
  });

  it("keeps two editorial domains reported-only when their relationship excerpts are identical", async () => {
    const { ctx, evidence, checks } = context();
    const sources = [
      { url: "https://techcrunch.com/acme-round" },
      { url: "https://reuters.com/technology/acme-round" },
    ];
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead({ sources })],
      fetchSource: async (url) => document({
        url,
        host: new URL(url).hostname,
        contentHash: url.includes("reuters") ? "b".repeat(64) : "a".repeat(64),
        text: "Paradigm invested in Acme Protocol during its seed financing.",
      }),
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts.every((artifact) => artifact.match === "candidate")).toBe(true);
  });

  it("reports unavailable when cited sources cannot be fetched", async () => {
    const { ctx, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [lead()],
      fetchSource: async (): Promise<PublicTextResult> => ({ status: "failed", reason: "http_403" }),
    });
    expect(checks.at(-1)).toMatchObject({ status: "unavailable", provider: "portfolio-web" });
  });

  it("keeps the check unavailable when one candidate verifies but another source fails", async () => {
    const { ctx, checks } = context();
    await collectPortfolioRelationships(ctx, {
      discover: async () => [
        lead(),
        lead({ projectName: "Broken Labs", sources: [{ url: "https://paradigm.xyz/portfolio/broken" }] }),
      ],
      fetchSource: async (url): Promise<PublicTextResult> => url.includes("broken")
        ? { status: "failed", reason: "http_403" }
        : document(),
    });
    expect(checks.at(-1)).toMatchObject({ status: "unavailable", sourceCount: 1 });
  });

  it("does not treat empty model discovery as an exhaustive checked-empty screen", async () => {
    const { ctx, checks } = context();
    await collectPortfolioRelationships(ctx, { discover: async () => [] });
    expect(checks.at(-1)).toMatchObject({ status: "unavailable", provider: "portfolio-web" });
  });
});
