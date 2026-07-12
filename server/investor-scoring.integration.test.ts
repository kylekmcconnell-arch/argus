import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence, type PortfolioLead } from "../src/data/evidence";
import { getProfile, SubjectClass } from "../src/engine";
import {
  analyzeSubject,
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  type AnalystAxis,
} from "./agent";
import { collectFundScale, type FundScaleLead } from "./adapters/fundScale";
import { collectPortfolioRelationships } from "./adapters/portfolio";
import type { CollectContext } from "./adapters/types";
import type { PublicTextDocument } from "./publicWeb";

const NOW = "2026-07-11T12:00:00.000Z";

const page = (url: string, text: string, hash: string): PublicTextDocument => ({
  status: "ok",
  url,
  host: new URL(url).hostname,
  contentType: "text/html",
  text,
  contentHash: hash.repeat(64),
  capturedAt: NOW,
});

const investorAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.INVESTOR).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.INVESTOR }));

async function collectedInvestorPacket(includeFundScale = true): Promise<string> {
  const evidence = emptyEvidence("@paradigm");
  evidence.profile = {
    ...evidence.profile,
    handle: "@paradigm",
    display_name: "Paradigm",
    website: "https://paradigm.xyz",
    bio: "Crypto investment firm",
    profile_collection_state: "resolved",
    profile_provider: "twitterapi",
    profile_captured_at: NOW,
  };
  evidence.roles = [SubjectClass.INVESTOR];
  const ctx: CollectContext = { handle: "@paradigm", evidence, emit: vi.fn() };
  const portfolioLead: PortfolioLead = {
    projectName: "Acme Protocol",
    investorEntityName: "Paradigm",
    attribution: "direct_subject",
    relationship: "invested_in",
    sources: [{ url: "https://paradigm.xyz/portfolio/acme" }],
    evidence_origin: "model_lead",
    artifact_verified: false,
    provider: "grok",
  };
  await collectPortfolioRelationships(ctx, {
    discover: async () => [portfolioLead],
    fetchSource: async () => page(
      "https://paradigm.xyz/portfolio/acme",
      "<h1>Our portfolio</h1><article>Acme Protocol</article>",
      "a",
    ),
    resolveProjectDomain: async () => undefined,
  });

  if (includeFundScale) {
    const scaleLead: FundScaleLead = {
      fundName: "Paradigm",
      attribution: "direct_subject",
      sources: [{ url: "https://paradigm.xyz/fund" }],
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    };
    await collectFundScale(ctx, {
      discover: async () => [scaleLead],
      fetchSource: async () => page(
        "https://paradigm.xyz/fund",
        "<p>We announced a new $850 million venture fund.</p>",
        "b",
      ),
      now: () => new Date(NOW),
    });
  }

  return buildScoringEvidencePacket({
    profile: evidence.profile,
    sourceArtifacts: evidence.sourceArtifacts,
    testimonials: [{
      claimed_endorser_handle: "@verified_founder",
      claimed_relationship: "public founder acknowledgment",
      provider: "twitterapi",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }],
    recentActivity: [{
      provider: "twitterapi",
      text: "Current public investment activity and no observed direct-subject reputation finding.",
      capturedAt: NOW,
    }],
  }, investorAxes);
}

describe("investor scoring integration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("carries real collector output through I2, I3, and a complete investor verdict", async () => {
    const packet = await collectedInvestorPacket();
    const catalog = extractScoringEvidenceCatalog(packet);
    const scale = catalog.find((artifact) => artifact.operation === "sourceArtifacts:fund_scale");
    const portfolio = catalog.find((artifact) => artifact.operation === "sourceArtifacts:portfolio_relationship");
    expect(portfolio).toMatchObject({ verification: "verified", eligibleAxes: ["I2_portfolio_quality"] });
    expect(scale).toMatchObject({ verification: "verified", eligibleAxes: ["I3_fund_scale_tier"] });
    expect(JSON.parse(packet).axisGaps).toEqual([]);

    const aliasFor = (axis: string) => {
      const index = catalog.findIndex((artifact) =>
        artifact.eligibleAxes.includes(axis)
        && artifact.verification !== "unavailable"
        && artifact.verification !== "checked_empty");
      expect(index).toBeGreaterThanOrEqual(0);
      return `e${String(index + 1).padStart(3, "0")}`;
    };
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{
        type: "tool_use",
        name: "record_verdict",
        input: {
          axes: investorAxes.map((spec) => ({
            axis: spec.axis,
            score: Math.max(0, spec.weight - 2),
            rationale: `Verified support for ${spec.axis}`,
            primaryEvidenceRef: aliasFor(spec.axis),
            additionalEvidenceRefs: [],
            counterEvidenceRefs: [],
            coverageRefs: [],
            gaps: [],
          })),
          headline: "Verified investor evidence covers every required axis.",
          identity_note: "Provider-backed identity resolved to Paradigm.",
        },
      }],
      stop_reason: "tool_use",
      usage: { input_tokens: 100, output_tokens: 50 },
    }), { status: 200 })));

    const verdict = await analyzeSubject("@paradigm", [SubjectClass.INVESTOR], investorAxes, packet);
    expect(verdict?.axes).toHaveLength(5);
    const i3 = verdict?.axes.find((axis) => axis.axis === "I3_fund_scale_tier");
    expect(i3?.evidenceRefs).toContain(scale?.artifactId);
  });

  it("fails closed before the analyst call when the real collector produces no scale artifact", async () => {
    const packet = await collectedInvestorPacket(false);
    expect(JSON.parse(packet).axisGaps).toContainEqual(expect.objectContaining({ axis: "I3_fund_scale_tier" }));
    const fetchMock = vi.fn();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubGlobal("fetch", fetchMock);
    await expect(analyzeSubject("@paradigm", [SubjectClass.INVESTOR], investorAxes, packet)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
