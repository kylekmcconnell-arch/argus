import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact, type SourceArtifact } from "../data/evidence";
import { SubjectClass, VentureOutcome } from "../engine";
import { buildEntityPointInTimeIntelligence } from "./buildEntityPointInTimeIntelligence";

const CAPTURED_AT = "2026-08-06T20:00:00.000Z";

function fact(overrides: Partial<BasicFact> = {}): BasicFact {
  return {
    factId: "identity-fact",
    subjectKey: "@unrelated_handle",
    predicate: "official_identity",
    value: "Stani Kulechov",
    normalizedValue: "stani kulechov",
    status: "verified",
    critical: true,
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    sources: [{
      url: "https://aave.example/about",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: "Stani Kulechov is an entrepreneur.",
      contentHash: "a".repeat(64),
      capturedAt: CAPTURED_AT,
      provider: "public-web",
      artifactVerified: true,
    }],
    ...overrides,
  };
}

function fundEvidence() {
  const evidence = emptyEvidence("@paradigmcapital");
  evidence.roles = [SubjectClass.INVESTOR];
  evidence.profile.display_name = "Paradigm Capital";
  evidence.profile.bio = "We invest in technology companies.";
  evidence.profile.website = "https://paradigm.xyz";
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = CAPTURED_AT;
  return evidence;
}

function portfolioArtifact(sourceUrl: string, hash: string): SourceArtifact {
  return {
    kind: "portfolio_relationship",
    provider: "portfolio-web",
    title: "Paradigm Capital to Acme Protocol",
    sourceUrl,
    capturedAt: CAPTURED_AT,
    contentHash: hash,
    sourceContentHash: hash,
    excerpt: "Our portfolio includes Acme Protocol.",
    match: "relationship_confirmed",
    relationship: "invested_in",
    subjectName: "Paradigm Capital",
    subjectHandle: "@paradigmcapital",
    investorEntityName: "Paradigm Capital",
    investorEntityDomain: "paradigm.xyz",
    attribution: "direct_subject",
    projectName: "Acme Protocol",
    projectDomain: "acme.example",
    sourceClass: "first_party_subject",
  };
}

function scaleArtifact(sourceUrl: string, hash: string): SourceArtifact {
  return {
    kind: "fund_scale",
    provider: "fund-scale-web",
    title: "Paradigm Capital Venture Fund III",
    sourceUrl,
    capturedAt: CAPTURED_AT,
    contentHash: hash,
    sourceContentHash: hash,
    excerpt: "We closed Venture Fund III at $850 million.",
    match: "fund_scale_confirmed",
    subjectName: "Paradigm Capital",
    subjectHandle: "@paradigmcapital",
    investorEntityName: "Paradigm Capital",
    investorEntityDomain: "paradigm.xyz",
    attribution: "direct_subject",
    sourceClass: "first_party_subject",
    fundName: "Paradigm Capital",
    fundSizeUsd: 850_000_000,
    fundVehicle: "Venture Fund III",
    fundScaleMetric: "final_close",
    fundAmountQualifier: "exact",
    fundScaleBasis: "manager_reported",
    fundScaleTemporalState: "fixed_historical",
    fundScaleClaimId: "fund-scale-claim-001",
  };
}

describe("entity point in time intelligence", () => {
  it("does not turn a copied display name and self-published page into strict person identity", () => {
    const evidence = emptyEvidence("@unrelated_handle");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile.display_name = "Stani Kulechov";
    evidence.basicFacts = [fact()];

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    expect(snapshot.subject.entityKind).toBe("person");
    expect(snapshot.measurements.find((row) => row.id === "entity_fact:identity-fact"))
      .toMatchObject({ evidenceState: "reported_context" });
    expect(snapshot.questions.find((row) => row.id === "entity.identity.exact_subject")?.state)
      .not.toBe("resolved");
    expect(snapshot.signals.some((row) => row.id === "entity_strict_identity")).toBe(false);
  });

  it("keeps licensed employment as attributed context, not counterparty verification", () => {
    const evidence = emptyEvidence("@alice");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.profile.display_name = "Alice Example";
    evidence.profile.resolved_name = "Alice Example";
    evidence.profile.identity_binding = "licensed_exact_social";
    evidence.ventures.push({
      project_name: "Acme",
      role: "Investment Director",
      period: "2024-present",
      outcome: VentureOutcome.ACTIVE,
      evidence_url: "https://acme.example",
      provider: "peopledatalabs",
      evidence_origin: "deterministic",
      artifact_verified: true,
    });

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    expect(snapshot.sources.find((row) => row.id === "entity:venture:001"))
      .toMatchObject({ sourceClass: "licensed_enrichment", evidenceState: "reported_context" });
    expect(snapshot.measurements.find((row) => row.id === "entity_venture:001"))
      .toMatchObject({ evidenceState: "reported_context" });
  });

  it("groups multiple receipts into one exact-bound investment relationship", () => {
    const evidence = fundEvidence();
    evidence.sourceArtifacts.push(
      portfolioArtifact("https://paradigm.xyz/portfolio/acme", "b".repeat(64)),
      portfolioArtifact("https://paradigm.xyz/companies/acme", "c".repeat(64)),
    );
    evidence.portfolioLeads = [{
      projectName: "Acme Protocol",
      relationship: "invested_in",
      sources: [{ url: "https://paradigm.xyz/portfolio/acme" }],
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    }];

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    expect(snapshot.measurements.find((row) => row.id === "entity_confirmed_portfolio_relationship_count"))
      .toMatchObject({ value: 1 });
    const relationships = snapshot.measurements.filter((row) => row.id.startsWith("entity_portfolio_relationship:"));
    expect(relationships).toHaveLength(1);
    expect(relationships[0].sourceRefs).toHaveLength(2);
    expect(snapshot.measurements.some((row) => row.id === "entity_unverified_portfolio_candidate_count")).toBe(false);
  });

  it("keeps a name-only portfolio row outside the verified relationship set", () => {
    const evidence = fundEvidence();
    const malformed = portfolioArtifact("https://paradigm.xyz/portfolio/acme", "d".repeat(64));
    malformed.projectDomain = undefined;
    evidence.sourceArtifacts.push(malformed);

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    expect(snapshot.measurements.some((row) => row.id === "entity_confirmed_portfolio_relationship_count")).toBe(false);
    expect(snapshot.signals.some((row) => row.id === "entity_confirmed_portfolio_set")).toBe(false);
  });

  it("does not let an investor artifact self-convert the audited subject into a project", () => {
    const evidence = fundEvidence();
    const malformed = portfolioArtifact("https://mallory.example/deal", "9".repeat(64));
    malformed.title = "Mallory invested in Paradigm Capital";
    malformed.subjectName = "Mallory Ventures";
    malformed.subjectHandle = "@mallory";
    malformed.investorEntityName = "Mallory Ventures";
    malformed.investorEntityDomain = "mallory.example";
    malformed.projectName = "Paradigm Capital";
    malformed.projectHandle = "@paradigmcapital";
    malformed.projectDomain = "paradigm.example";
    evidence.sourceArtifacts.push(malformed);

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    expect(snapshot.measurements.some((row) => row.id === "entity_confirmed_portfolio_relationship_count")).toBe(false);
    expect(snapshot.measurements.some((row) => row.id.startsWith("entity_portfolio_relationship:"))).toBe(false);
    expect(snapshot.signals.some((row) => row.id === "entity_confirmed_portfolio_set")).toBe(false);
  });

  it("groups corroborating fund-size receipts under one claim measurement", () => {
    const evidence = fundEvidence();
    evidence.sourceArtifacts.push(
      scaleArtifact("https://paradigm.xyz/funds/three", "e".repeat(64)),
      scaleArtifact("https://paradigm.xyz/news/fund-three", "f".repeat(64)),
    );

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    const rows = snapshot.measurements.filter((row) => row.id.startsWith("entity_fund_scale:"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: 850_000_000 });
    expect(rows[0].sourceRefs).toHaveLength(2);
  });

  it("does not substitute scan capture time for an unknown fund claim date", () => {
    const evidence = fundEvidence();
    evidence.sourceArtifacts.push(scaleArtifact("https://paradigm.xyz/funds/three", "1".repeat(64)));

    const snapshot = buildEntityPointInTimeIntelligence(evidence)!;
    const row = snapshot.measurements.find((measurement) => measurement.id.startsWith("entity_fund_scale:"));
    expect(row?.window).toEqual({ kind: "historical", asOf: undefined });
  });
});
