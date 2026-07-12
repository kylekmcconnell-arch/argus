import { describe, expect, it, vi } from "vitest";
import { SubjectClass } from "../../src/engine";
import { assembleDossier } from "../../src/data/dossier";
import { emptyEvidence, type PortfolioLead } from "../../src/data/evidence";
import type { CheckObservation, CollectContext } from "./types";
import {
  collectPortfolioRelationships,
  parsePortfolioCandidates,
  supportsPortfolioRelationship,
} from "./portfolio";
import type { PublicTextDocument, PublicTextResult } from "../publicWeb";

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
    evidence.profile.bio = "Research Partner at Paradigm";
    const affiliatedLead = lead({
      investorEntityName: "Paradigm",
      investorEntityHandle: "@paradigm",
      attribution: "affiliated_fund",
    });
    await collectPortfolioRelationships(ctx, {
      discover: async () => [affiliatedLead],
      fetchSource: async () => document(),
      resolveInvestorDomain: async () => "paradigm.xyz",
    });

    expect(evidence.sourceArtifacts).toContainEqual(expect.objectContaining({
      investorEntityName: "Paradigm",
      attribution: "affiliated_fund",
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
    });

    expect(checks.at(-1)).toMatchObject({ status: "checked-empty" });
    expect(evidence.sourceArtifacts).toEqual([]);
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
