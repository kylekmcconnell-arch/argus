import { describe, it, expect } from "vitest";
import { assessFounderRepeatBacking } from "./orchestrate";
import {
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  type AnalystAxis,
} from "./agent";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass, VentureOutcome, getProfile } from "../src/engine";
import type { CollectedEvidence } from "./adapters/types";

// A founder resolved richly on every axis except repeat backing, with NO verified
// venture row (the empirically-confirmed abstention case). Mirrors the real packet
// sections a person scan produces.
function richFounderNoVentures(): Record<string, unknown> {
  return {
    profile: { handle: "@rich", display_name: "Rich Founder", profile_collection_state: "resolved", identity_confidence: "Confirmed", bio: "Founder." },
    basicFacts: [
      { predicate: "official_identity", value: "Rich Founder", status: "verified", artifact_verified: true, sources: [{ url: "https://x.example/id", excerpt: "Rich Founder is a verified identity.", provider: "public-web", artifactVerified: true }] },
      { predicate: "founder", value: "BigCo", status: "verified", artifact_verified: true, sources: [{ url: "https://bigco.example/about", excerpt: "Rich Founder founded BigCo.", provider: "public-web", artifactVerified: true }] },
      { predicate: "product", value: "BigApp", status: "verified", artifact_verified: true, sources: [{ url: "https://bigco.example/app", excerpt: "BigApp is live and shipping.", provider: "public-web", artifactVerified: true }] },
    ],
    checkOutcomes: [
      { checkId: "identity-resolution", status: "confirmed", note: "resolved", provider: "peopledatalabs" },
      { checkId: "affiliations-associates", status: "confirmed", note: "4 of 6 relationships observed", provider: "twitterapi.io" },
      { checkId: "code-footprint-github", status: "confirmed", note: "org repos found", provider: "github" },
    ],
    recentActivity: [{ text: "Shipping updates and roadmap for BigApp this quarter.", value: "post", provider: "twitterapi" }],
    notableFollowers: [{ handle: "@vitalik", display_name: "Vitalik", followers: 5_000_000, provider: "twitterapi" }],
    ventures: [],
  };
}

const founderAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.FOUNDER).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.FOUNDER }));

function preflightState(sections: Record<string, unknown>) {
  const packet = buildScoringEvidencePacket(sections, founderAxes);
  const pf = inspectAnalystScoringPreflight(founderAxes, packet);
  const catalog = extractScoringEvidenceCatalog(packet, founderAxes);
  return { pf, catalog };
}

describe("founder abstention fix: F3 repeat-backing assessment", () => {
  it("REGRESSION: a rich founder with no ventures abstains solely on F3 when no repeat-backing check is present", () => {
    const { pf } = preflightState(richFounderNoVentures());
    expect(pf.state).toBe("insufficient_evidence");
    expect(pf.missingSubstantiveAxes).toEqual(["F3_repeat_backing"]);
  });

  it("FIX: adding a substantive founder-repeat-backing checkOutcome covers F3 and preflight goes ready", () => {
    const sections = richFounderNoVentures();
    (sections.checkOutcomes as unknown[]).push({
      checkId: "founder-repeat-backing",
      status: "finding",
      note: "Assessed repeat backing across 1 known venture; no source-backed repeat financing appears in the collected record.",
      provider: "argus-analysis",
    });
    const { pf, catalog } = preflightState(sections);
    expect(pf.state).toBe("ready");
    expect(pf.missingSubstantiveAxes).toEqual([]);
    // The assessment artifact is substantive and eligible for F3 only.
    const artifact = catalog.find((a) => a.operation === "checkOutcomes:founder-repeat-backing");
    expect(artifact?.eligibleAxes).toEqual(["F3_repeat_backing"]);
    expect(["checked_empty", "unavailable"]).not.toContain(artifact?.verification);
  });
});

function founderEvidence(patch: Partial<CollectedEvidence>): CollectedEvidence {
  const ev = emptyEvidence("@founder");
  ev.roles = [SubjectClass.FOUNDER];
  return { ...ev, ...patch };
}

describe("assessFounderRepeatBacking", () => {
  it("returns null for a non-founder subject (never runs off-role)", () => {
    const ev = emptyEvidence("@proj");
    ev.roles = [SubjectClass.PROJECT];
    expect(assessFounderRepeatBacking(ev)).toBeNull();
  });

  it("returns null when there is no known venture or company to assess (stays a gap → honest abstention)", () => {
    expect(assessFounderRepeatBacking(founderEvidence({ ventures: [], basicFacts: [] }))).toBeNull();
  });

  it("records an affirmative-null 'finding' when a known company exists but no repeat backing is on record", () => {
    const ev = founderEvidence({
      ventures: [],
      basicFacts: [{
        factId: "f1", subjectKey: "@founder", predicate: "founder", value: "BigCo", normalizedValue: "bigco",
        status: "verified", critical: true, artifact_verified: true, evidence_origin: "deterministic", provider: "public-web",
        sources: [{ url: "https://bigco.example", sourceClass: "official_subject", relation: "supports", excerpt: "founded BigCo", contentHash: "a".repeat(64), capturedAt: "2026-07-15T00:00:00.000Z", provider: "public-web", artifactVerified: true }],
      }] as unknown as CollectedEvidence["basicFacts"],
    });
    const obs = assessFounderRepeatBacking(ev);
    expect(obs?.id).toBe("founder-repeat-backing");
    expect(obs?.status).toBe("finding");
    expect(obs?.note).toContain("no source-backed repeat");
  });

  it("records a 'confirmed' outcome when a backer re-backs across ventures (reuses the engine's repeatBackingSignal)", () => {
    const ev = founderEvidence({
      ventures: [
        { project_name: "ExitCo", role: "founder", period: "2015-2018", outcome: VentureOutcome.ACQUISITION, investors: ["Sequoia"], acquirer: "BigCorp", evidence_origin: "deterministic", artifact_verified: true } as unknown as CollectedEvidence["ventures"][number],
        { project_name: "NewCo", role: "founder", period: "2020-2024", outcome: VentureOutcome.ACTIVE, current_backers: ["Sequoia"], evidence_origin: "deterministic", artifact_verified: true } as unknown as CollectedEvidence["ventures"][number],
      ],
    });
    const obs = assessFounderRepeatBacking(ev);
    expect(obs?.status).toBe("confirmed");
    expect(obs?.note).toMatch(/sequoia/i);
  });
});
