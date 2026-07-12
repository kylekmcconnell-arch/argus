import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  analyzeSubject,
  buildAnalystEvidencePacket,
  buildScoringEvidencePacket,
  extractScoringEvidenceCatalog,
  scanContradictions,
  structured,
  validateAnalystVerdict,
  type AnalystAxis,
} from "./agent";
import type { AxisEvidenceRecord } from "../src/data/evidence";
import { ANALYST_SCORING_TIMEOUT_MS } from "../src/lib/investigationRuntime";
import { getCost, withCostLedger } from "./cost";

const catalog: AnalystAxis[] = [
  { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
  { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
];

const F1_REF = `art_v1_${"1".repeat(64)}`;
const F2_REF = `art_v1_${"2".repeat(64)}`;
const F2_COUNTER_REF = `art_v1_${"3".repeat(64)}`;
const F2_UNAVAILABLE_REF = `art_v1_${"4".repeat(64)}`;
const F2_CHECKED_EMPTY_REF = `art_v1_${"5".repeat(64)}`;
const ARTIFACT_ID_FOR_TEST = /^art_v1_[a-f0-9]{64}$/;

const axisArtifact = (
  artifactId: string,
  eligibleAxes: string[],
  verification: AxisEvidenceRecord["verification"] = "verified",
): AxisEvidenceRecord => ({
  artifactId,
  kind: "axis_evidence",
  provider: "test-provider",
  operation: "test-operation",
  section: "test",
  title: "Test evidence",
  contentHash: artifactId.slice("art_v1_".length),
  eligibleAxes,
  verification,
  scope: "direct_subject",
});

const validationCatalog: AxisEvidenceRecord[] = [
  axisArtifact(F1_REF, [catalog[0].axis]),
  axisArtifact(F2_REF, [catalog[1].axis]),
  axisArtifact(F2_COUNTER_REF, [catalog[1].axis], "reported"),
  axisArtifact(F2_UNAVAILABLE_REF, [catalog[1].axis], "unavailable"),
  axisArtifact(F2_CHECKED_EMPTY_REF, [catalog[1].axis], "checked_empty"),
];

const validAxis = (axis: string, score: number, ref: string) => ({
  axis,
  score,
  rationale: "Evidence-backed rationale",
  evidenceRefs: [ref],
  counterEvidenceRefs: [] as string[],
  gaps: [] as string[],
});

describe("analyst verdict integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts exactly one finite, in-range score per requested axis", () => {
    const result = validateAnalystVerdict({
      axes: [
        { ...validAxis("F2_track_record", 20, F2_REF), rationale: "documented history", counterEvidenceRefs: [F2_COUNTER_REF] },
        { ...validAxis("F1_identity_verifiability", 10, F1_REF), rationale: "named identity" },
      ],
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog);

    expect(result?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(result?.axes.map((axis) => axis.score)).toEqual([10, 20]);
  });

  it.each([
    {
      label: "missing axis",
      axes: [validAxis("F1_identity_verifiability", 10, F1_REF)],
    },
    {
      label: "duplicate axis",
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("F1_identity_verifiability", 11, F1_REF),
      ],
    },
    {
      label: "unknown axis",
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("MADE_UP", 1, F2_REF),
      ],
    },
    {
      label: "non-finite score",
      axes: [
        validAxis("F1_identity_verifiability", Number.NaN, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
    },
    {
      label: "out-of-range score",
      axes: [
        validAxis("F1_identity_verifiability", 13, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
    },
  ])("rejects a $label response", ({ axes }) => {
    expect(validateAnalystVerdict({ axes, headline: "bad", identity_note: "bad" }, catalog, validationCatalog)).toBeNull();
  });

  it.each([
    { label: "missing support refs", patch: { evidenceRefs: undefined } },
    { label: "empty support refs", patch: { evidenceRefs: [] } },
    { label: "missing counter refs", patch: { counterEvidenceRefs: undefined } },
    { label: "missing gaps", patch: { gaps: undefined } },
    { label: "unknown ref", patch: { evidenceRefs: [`art_v1_${"9".repeat(64)}`] } },
    { label: "duplicate ref", patch: { evidenceRefs: [F1_REF, F1_REF] } },
    { label: "axis-ineligible ref", patch: { evidenceRefs: [F2_REF] } },
    { label: "support/counter overlap", patch: { evidenceRefs: [F1_REF], counterEvidenceRefs: [F1_REF] } },
    { label: "blank rationale", patch: { rationale: "   " } },
  ])("rejects $label on a scored axis", ({ patch }) => {
    const axes = [
      { ...validAxis("F1_identity_verifiability", 10, F1_REF), ...patch },
      validAxis("F2_track_record", 20, F2_REF),
    ];
    expect(validateAnalystVerdict({
      axes,
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog)).toBeNull();
  });

  it.each([F2_UNAVAILABLE_REF, F2_CHECKED_EMPTY_REF])(
    "rejects coverage-only evidence as substantive support even when a gap is supplied (%s)",
    (coverageRef) => {
      const axes = [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        {
          ...validAxis("F2_track_record", 8, coverageRef),
          gaps: ["No eligible track-record artifact was available."],
        },
      ];
      expect(validateAnalystVerdict({
        axes,
        headline: "Incomplete evidence",
        identity_note: "Identity resolved",
      }, catalog, validationCatalog)).toBeNull();
    },
  );

  it.each([F2_UNAVAILABLE_REF, F2_CHECKED_EMPTY_REF])(
    "preserves a coverage-gap ref only alongside substantive support and an explicit gap (%s)",
    (coverageRef) => {
      const result = validateAnalystVerdict({
        axes: [
          validAxis("F1_identity_verifiability", 10, F1_REF),
          {
            ...validAxis("F2_track_record", 8, F2_REF),
            evidenceRefs: [F2_REF, coverageRef],
            gaps: ["One track-record provider did not return a result."],
          },
        ],
        headline: "Substantive evidence with a disclosed coverage gap",
        identity_note: "Identity resolved",
      }, catalog, validationCatalog);

      expect(result?.axes[1]).toMatchObject({
        evidenceRefs: [F2_REF, coverageRef],
        gaps: ["One track-record provider did not return a result."],
      });
    },
  );

  it("rejects coverage-only artifacts as counter-evidence", () => {
    const axes = [
      validAxis("F1_identity_verifiability", 10, F1_REF),
      { ...validAxis("F2_track_record", 8, F2_REF), counterEvidenceRefs: [F2_CHECKED_EMPTY_REF] },
    ];
    expect(validateAnalystVerdict({
      axes,
      headline: "Invalid counter evidence",
      identity_note: "Identity resolved",
    }, catalog, validationCatalog)).toBeNull();
  });

  it.each([
    { headline: "", identity_note: "Identity resolved" },
    { headline: "Complete result", identity_note: "   " },
  ])("rejects blank headline or identity note", ({ headline, identity_note }) => {
    expect(validateAnalystVerdict({
      axes: [
        validAxis("F1_identity_verifiability", 10, F1_REF),
        validAxis("F2_track_record", 20, F2_REF),
      ],
      headline,
      identity_note,
    }, catalog, validationCatalog)).toBeNull();
  });

  it("builds bounded valid JSON without allowing long context to cut off findings", () => {
    const packet = buildAnalystEvidencePacket({
      profile: { handle: "@subject", bio: "b".repeat(20_000) },
      recentActivity: Array.from({ length: 100 }, (_, i) => `post ${i} ${"x".repeat(4_000)}`),
      ventures: Array.from({ length: 100 }, (_, i) => ({ project_name: `project-${i}`, notes: "v".repeat(4_000) })),
      testimonials: Array.from({ length: 100 }, (_, i) => ({ claimed_endorser_name: `person-${i}`, notes: "t".repeat(4_000) })),
      findings: [{
        finding_type: "DeterministicFinding",
        claim: "material finding survives",
        source_url: "https://example.com/artifact",
        verification_status: "Verified",
        independent_source_count: 1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Material source",
        sourceUrl: "https://example.com/source",
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: "a".repeat(64),
        match: "exact_name",
      }],
      profileAuthenticity: {
        provider: "claude-vision",
        capturedAt: "2026-07-11T12:00:00.000Z",
        imageData: "base64-secret-image-bytes",
        mediaType: "image/jpeg",
        imageContentHash: "b".repeat(64),
        classification: "real_candid",
        confidence: 0.9,
        flag: false,
        tells: ["natural lighting"],
        note: "Visual triage only.",
      },
      trustGraphScreen: {
        provider: "argus-graph",
        capturedAt: "2026-07-11T12:00:00.000Z",
        status: "risk",
        contributionCount: 2,
        qualifiedContributionCount: 2,
        sourceContentHash: "c".repeat(64),
        severity: "avoid",
        line: "One exact adverse connection.",
        connections: [{
          other: "@failed",
          otherReportVersionId: "00000000-0000-4000-8000-000000000033",
          otherAttestation: "server_collected",
          otherCompleteness: "complete",
          otherVerdict: "FAIL",
          qualified: true,
          direct: false,
          ties: [{
            key: "wallet:evm:0xabc",
            label: "shared deployer",
            type: "Identity",
            strength: "hard",
            subjectEdgeTypes: ["DEPLOYED"],
            otherEdgeTypes: ["DEPLOYED"],
          }],
        }],
      },
      checkOutcomes: [{ checkId: "news-press", status: "confirmed", provider: "google-news" }],
      providerRuns: [{ id: "offchain-diligence", state: "partial", detail: "CourtListener failed" }],
    });

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    expect(parsed.findings[0].claim).toBe("material finding survives");
    expect(parsed.findings[0].source_url).toBe("https://example.com/artifact");
    expect(parsed.coverage.recentActivity.available).toBe(100);
    expect(parsed.coverage.recentActivity.included).toBeLessThanOrEqual(12);
    expect(parsed.sourceArtifacts[0]).toMatchObject({ contentHash: "a".repeat(64) });
    expect(parsed.profileAuthenticity).toMatchObject({ imageContentHash: "b".repeat(64), classification: "real_candid" });
    expect(parsed.profileAuthenticity).not.toHaveProperty("imageData");
    expect(packet).not.toContain("base64-secret-image-bytes");
    expect(parsed.trustGraphScreen.connections[0]).toMatchObject({ qualified: true, otherVerdict: "FAIL" });
    expect(parsed.trustGraphScreen.connections[0].ties[0]).toMatchObject({ key: "wallet:evm:0xabc", strength: "hard" });
    expect(parsed.checkOutcomes[0]).toMatchObject({ checkId: "news-press", status: "confirmed" });
    expect(parsed.providerRuns[0]).toMatchObject({ id: "offchain-diligence", state: "partial" });
  });

  it("prioritizes frozen graph predicates ahead of descriptive finding overflow", () => {
    const descriptive = Array.from({ length: 30 }, (_, index) => ({
      finding_type: "ContextLead",
      claim: `descriptive lead ${index}`,
      source_url: `https://example.com/${index}`,
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: 0,
    }));
    const graph = {
      finding_type: "TrustGraphConnection",
      claim: "Exact graph predicate must survive the evidence budget.",
      source_url: "",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      content_hash: "d".repeat(64),
      trust_graph: {
        tie_key: "email:dev@example.com",
        tie_type: "Identity",
        tie_strength: "hard",
        subject_edge_types: ["IDENTITY_EMAIL"],
        other_edge_types: ["COMMIT_EMAIL"],
        other_report_version_id: "00000000-0000-4000-8000-000000000044",
        other_attestation: "server_collected",
        other_completeness: "complete",
        other_verdict: "FAIL",
      },
    };

    const parsed = JSON.parse(buildAnalystEvidencePacket({ findings: [...descriptive, graph] }));

    expect(parsed.coverage.findings).toEqual({ available: 31, included: 24 });
    expect(parsed.findings[0]).toMatchObject({
      finding_type: "TrustGraphConnection",
      content_hash: "d".repeat(64),
      trust_graph: expect.objectContaining({ tie_type: "Identity", other_verdict: "FAIL" }),
    });
  });

  it("separates associate and model leads from subject-scoring findings with explicit scope", () => {
    const direct = {
      finding_type: "LegalCaseNameLead",
      claim: "Evidence about the audited subject.",
      source_url: "https://example.com/subject",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@subject",
        target_entity_type: "person",
        relationship_to_subject: "self",
        relationship_label: "audited subject",
      },
    };
    const associateLead = {
      finding_type: "AdverseLead",
      claim: "A complaint page was surfaced about @associate.",
      source_url: "https://example.com/associate-candidate",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate",
        target_entity_type: "person",
        relationship_to_subject: "associate",
        relationship_label: "recorded collaborator",
      },
    };
    const mismatchedDirectTarget = {
      ...direct,
      claim: "A forged direct scope actually names another account.",
      finding_scope: {
        ...direct.finding_scope,
        target_entity_key: "@somebody_else",
      },
    };

    const parsed = JSON.parse(buildAnalystEvidencePacket({
      profile: { handle: "@subject" },
      findings: [associateLead, mismatchedDirectTarget, direct],
    }));

    expect(parsed.schema_version).toBe(3);
    expect(parsed.coverage.findings).toEqual({ available: 1, included: 1 });
    expect(parsed.coverage.investigative_leads).toEqual({ available: 2, included: 2 });
    expect(parsed.findings).toEqual([expect.objectContaining({ claim: direct.claim })]);
    expect(parsed.investigative_leads).toEqual([
      expect.objectContaining({
        claim: associateLead.claim,
        finding_scope: expect.objectContaining({
          scope: "related_entity",
          target_entity_key: "@associate",
          relationship_to_subject: "associate",
        }),
      }),
      expect.objectContaining({
        claim: mismatchedDirectTarget.claim,
        finding_scope: expect.objectContaining({ target_entity_key: "@somebody_else" }),
      }),
    ]);
    expect(parsed.finding_scope_policy.investigative_leads).toContain("Never attribute");
  });

  it("completely removes investigative leads from the scorer packet while retaining legitimate evidence", () => {
    const direct = {
      finding_type: "LegalCaseNameLead",
      claim: "DIRECT_SUBJECT_FINDING_RETAINED",
      source_url: "https://example.com/direct",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@subject",
        target_entity_type: "person",
        relationship_to_subject: "self",
      },
    };
    const modelLead = {
      ...direct,
      claim: "MODEL_LEAD_MUST_NOT_REACH_SCORER",
      source_url: "https://example.com/model-lead",
      evidence_origin: "model_lead",
      artifact_verified: false,
    };
    const relatedLead = {
      ...direct,
      claim: "RELATED_ENTITY_MUST_NOT_REACH_SCORER",
      source_url: "https://example.com/related",
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate",
        target_entity_type: "person",
        relationship_to_subject: "associate",
      },
    };

    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        name: "Subject Person",
        bio: "Public builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      team: [{
        name: "Named Teammate",
        role: "CTO",
        linkedin: "https://linkedin.com/in/teammate",
        source: "team page",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      wallets: [{ chain: "ethereum", address: "0x123", attribution: "self-disclosed" }],
      ventures: [{ project_name: "FIXTURE_VENTURE_MUST_NOT_REACH_SCORER", evidence_origin: "model_lead", artifact_verified: false }],
      testimonials: [{ claimed_endorser_handle: "@fixture_endorser", evidence_origin: "model_lead", artifact_verified: false }],
      promotions: [{ ticker: "FIXTURE_PROMO", evidence_origin: "model_lead", artifact_verified: false }],
      checkOutcomes: [{ checkId: "identity-resolution", status: "confirmed", provider: "github" }],
      providerRuns: [{ id: "github", state: "executed", detail: "operational telemetry only" }],
      findings: [modelLead, relatedLead, direct],
      investigative_leads: [{ claim: "SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER" }],
    }, catalog);
    const parsed = JSON.parse(packet);
    const frozenCatalog = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("investigative_leads");
    expect(parsed).not.toHaveProperty("coverage");
    expect(parsed.finding_scope_policy).not.toHaveProperty("investigative_leads");
    expect(parsed.findings).toEqual([
      expect.objectContaining({ claim: "DIRECT_SUBJECT_FINDING_RETAINED" }),
    ]);
    expect(parsed.profile).toMatchObject({ handle: "@subject", name: "Subject Person" });
    expect(parsed.team[0]).toMatchObject({ name: "Named Teammate", role: "CTO" });
    expect(parsed.wallets).toEqual([]);
    expect(parsed.checkOutcomes[0]).toMatchObject({
      checkId: "identity-resolution",
      status: "confirmed",
    });
    expect(parsed.profile.artifactId).toMatch(ARTIFACT_ID_FOR_TEST);
    expect(parsed.findings[0].artifactId).toMatch(ARTIFACT_ID_FOR_TEST);
    expect(frozenCatalog.length).toBeGreaterThan(0);
    expect(frozenCatalog.every((artifact) => artifact.artifactId === `art_v1_${artifact.contentHash}`)).toBe(true);
    expect(frozenCatalog.some((artifact) => artifact.section === "findings" && artifact.scope === "direct_subject")).toBe(true);
    expect(frozenCatalog.find((artifact) => artifact.section === "profile")?.provider).toBe("twitterapi");
    expect(frozenCatalog.find((artifact) => artifact.section === "team")?.provider).toBe("team-page");
    expect(parsed).not.toHaveProperty("providerRuns");
    expect(frozenCatalog.some((artifact) => artifact.section === "providerRuns")).toBe(false);
    expect(packet).not.toContain("MODEL_LEAD_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("RELATED_ENTITY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("FIXTURE_VENTURE_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("fixture_endorser");
    expect(packet).not.toContain("FIXTURE_PROMO");
    expect(packet).not.toContain("model_lead");
    expect(packet).not.toContain("@associate");
  });

  it("uses deterministic content-addressed IDs and synthesizes only missing-axis gap artifacts", () => {
    const first = buildScoringEvidencePacket({
      profile: { handle: "@subject", display_name: "Subject", bio: "Builder", profile_collection_state: "resolved", profile_provider: "twitterapi" },
    }, catalog);
    const second = buildScoringEvidencePacket({
      profile: { bio: "Builder", display_name: "Subject", handle: "@subject", profile_provider: "twitterapi", profile_collection_state: "resolved" },
    }, catalog);
    const firstCatalog = extractScoringEvidenceCatalog(first);
    const secondCatalog = extractScoringEvidenceCatalog(second);
    const firstProfile = firstCatalog.find((artifact) => artifact.section === "profile");
    const secondProfile = secondCatalog.find((artifact) => artifact.section === "profile");

    expect(firstProfile?.artifactId).toBe(secondProfile?.artifactId);
    expect(firstProfile?.eligibleAxes).toContain("F1_identity_verifiability");
    expect(firstProfile?.eligibleAxes).not.toContain("F2_track_record");
    const parsed = JSON.parse(first);
    expect(parsed.axisGaps).toEqual([
      expect.objectContaining({
        axis: "F2_track_record",
        status: "unavailable",
        artifactId: expect.stringMatching(ARTIFACT_ID_FOR_TEST),
      }),
    ]);
    expect(firstCatalog).toContainEqual(expect.objectContaining({
      artifactId: parsed.axisGaps[0].artifactId,
      section: "axisGaps",
      eligibleAxes: ["F2_track_record"],
      verification: "unavailable",
    }));
  });

  it("uses an existing unavailable check as the gap artifact instead of synthesizing a duplicate", () => {
    const trackRecordOnly: AnalystAxis[] = [{ axis: "F2_track_record", weight: 28, role: "FOUNDER" }];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      profileAuthenticity: {
        provider: "claude-vision",
        capturedAt: "2026-07-11T12:00:00.000Z",
        classification: "real_candid",
        flag: false,
        tells: [],
        note: "Review lead only.",
      },
      checkOutcomes: [{
        checkId: "vc-portfolio-track-record",
        status: "unavailable",
        note: "Portfolio provider did not return evidence.",
        provider: "crunchbase",
      }],
    }, trackRecordOnly);
    const parsed = JSON.parse(packet);
    const frozenCatalog = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("profileAuthenticity");
    expect(parsed.axisGaps).toEqual([]);
    expect(frozenCatalog).toContainEqual(expect.objectContaining({
      section: "checkOutcomes",
      verification: "unavailable",
      eligibleAxes: ["F2_track_record"],
    }));
  });

  it("catalogs only corroborated client, associate, team, and venture-team records", () => {
    const expandedCatalog: AnalystAxis[] = [
      { axis: "AG2_client_outcomes", weight: 25, role: "AGENCY" },
      { axis: "F6_network_quality", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
    ];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      clientEngagements: [
        { client_name: "Verified Client", service_type: "growth", artifact_verified: true },
        { client_name: "MODEL_CLIENT_EXCLUDED", evidence_origin: "model_lead", artifact_verified: false },
      ],
      team: [
        { name: "Verified Leader", role: "CEO", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
        { name: "MODEL_TEAM_EXCLUDED", role: "CTO", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
      associates: [
        { associate_handle: "@peer", relation: "co-builder", provider: "github", evidence_origin: "deterministic", artifact_verified: true },
        { associate_handle: "@model_peer", relation: "possible collaborator", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
      ventureTeams: [
        { key: "venture:one", name: "Venture One", people: [{ name: "Named Builder" }], provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
        { key: "venture:model", name: "MODEL_VENTURE_TEAM_EXCLUDED", people: [{ name: "Guessed Builder" }], provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      ],
    }, expandedCatalog);
    const parsed = JSON.parse(packet);
    const artifacts = extractScoringEvidenceCatalog(packet);

    expect(parsed.clientEngagements).toHaveLength(1);
    expect(packet).not.toContain("MODEL_CLIENT_EXCLUDED");
    expect(packet).not.toContain("MODEL_TEAM_EXCLUDED");
    expect(packet).not.toContain("model_peer");
    expect(packet).not.toContain("MODEL_VENTURE_TEAM_EXCLUDED");
    expect(artifacts.find((artifact) => artifact.section === "clientEngagements")?.eligibleAxes).toEqual(["AG2_client_outcomes"]);
    expect(artifacts.find((artifact) => artifact.section === "team")?.provider).toBe("team-page");
    expect(artifacts.find((artifact) => artifact.section === "associates")?.eligibleAxes).toEqual(["F6_network_quality"]);
    expect(artifacts.find((artifact) => artifact.section === "associates")?.provider).toBe("github");
    expect(artifacts.find((artifact) => artifact.section === "ventureTeams")?.eligibleAxes).toEqual(["F6_network_quality", "F2_track_record"]);
  });

  it("routes frozen source artifacts by kind instead of making every source eligible for every axis", () => {
    const axes: AnalystAxis[] = [
      { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
      { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
      { axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" },
      { axis: "K4_onchain_conduct", weight: 20, role: "KOL" },
      { axis: "AG3_service_integrity", weight: 25, role: "AGENCY" },
    ];
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      sourceArtifacts: [
        { kind: "press", provider: "google-news", title: "Press history", sourceUrl: "https://example.com/press", match: "observed" },
        { kind: "profile_photo", provider: "claude-vision", title: "Photo screen", contentHash: "a".repeat(64), match: "observed" },
        { kind: "legal_case", provider: "courtlistener", title: "Legal screen", sourceUrl: "https://example.com/legal", match: "observed" },
        { kind: "trust_graph", provider: "argus-graph", title: "Graph tie", contentHash: "b".repeat(64), match: "risk_signal" },
        { kind: "unknown", provider: "unknown", title: "Unclassified source", sourceUrl: "https://example.com/unknown" },
      ],
    }, axes);
    const parsed = JSON.parse(packet);
    const frozen = extractScoringEvidenceCatalog(packet);
    const source = (title: string) => frozen.find((artifact) => artifact.title === title)!;

    expect(source("Press history").eligibleAxes).toEqual(["F2_track_record", "F5_reputation_integrity"]);
    expect(source("Press history").eligibleAxes).not.toEqual(expect.arrayContaining(["K4_onchain_conduct", "AG3_service_integrity"]));
    expect(frozen.find((artifact) => artifact.title === "Photo screen")).toBeUndefined();
    expect(parsed).not.toHaveProperty("profileAuthenticity");
    expect(parsed.sourceArtifacts).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ title: "Photo screen" }),
    ]));
    expect(source("Legal screen").eligibleAxes).toEqual(["F1_identity_verifiability", "F5_reputation_integrity"]);
    expect(source("Graph tie").eligibleAxes).toEqual(["F5_reputation_integrity", "K4_onchain_conduct", "AG3_service_integrity"]);
    expect(frozen.find((artifact) => artifact.title === "Unclassified source")).toBeUndefined();
  });

  it("treats incomplete and empty-clear trust graph records as coverage only", () => {
    const axes: AnalystAxis[] = [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }];
    const incomplete = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "incomplete",
        sourceContentHash: "a".repeat(64),
        connections: [{ qualified: false, ties: [{ key: "email:x@example.com" }] }],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Incomplete graph",
        contentHash: "a".repeat(64),
        sourceContentHash: "a".repeat(64),
        match: "observed",
        coverageState: "unavailable",
      }],
    }, axes));
    const clear = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "clear",
        sourceContentHash: "b".repeat(64),
        qualifiedContributionCount: 0,
        connections: [],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Clear graph",
        contentHash: "b".repeat(64),
        sourceContentHash: "b".repeat(64),
        match: "screened_clear",
      }],
    }, axes));

    expect(incomplete.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "unavailable")).toBe(true);
    expect(clear.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "checked_empty")).toBe(true);
  });

  it("admits only exact qualified trust graph risk predicates as substantive", () => {
    const axes: AnalystAxis[] = [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }];
    const frozen = extractScoringEvidenceCatalog(buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        status: "risk",
        sourceContentHash: "c".repeat(64),
        connections: [{ qualified: true, ties: [{ key: "email:x@example.com", strength: "hard" }] }],
      },
      sourceArtifacts: [{
        kind: "trust_graph",
        provider: "argus-graph",
        title: "Qualified graph risk",
        contentHash: "c".repeat(64),
        sourceContentHash: "c".repeat(64),
        match: "risk_signal",
      }],
    }, axes));

    expect(frozen.filter((artifact) => artifact.section === "trustGraphScreen" || artifact.section === "sourceArtifacts")
      .every((artifact) => artifact.verification === "verified")).toBe(true);
  });

  it("requires positive trusted provenance for every scorer finding", () => {
    const axes: AnalystAxis[] = [{ axis: "P3_token_conduct", weight: 17, role: "PROJECT" }];
    const finding = (claim: string, provenance: Record<string, unknown>) => ({
      finding_type: "TokenCollapse",
      claim,
      source_url: `https://example.com/${claim}`,
      source_author: "dexscreener",
      verification_status: "Verified",
      independent_source_count: 1,
      polarity: -1,
      ...provenance,
    });
    const packet = buildScoringEvidencePacket({
      findings: [
        finding("model", { evidence_origin: "model_lead", artifact_verified: true }),
        finding("explicit-false", { evidence_origin: "deterministic", artifact_verified: false }),
        finding("legacy-unstamped", {}),
        finding("trusted", { evidence_origin: "deterministic", artifact_verified: true }),
      ],
    }, axes);
    const parsed = JSON.parse(packet);

    expect(parsed.findings).toEqual([expect.objectContaining({ claim: "trusted" })]);
    expect(packet).not.toContain("explicit-false");
    expect(packet).not.toContain("legacy-unstamped");
    expect(packet).not.toContain("model");
  });

  it("routes findings by exact type and rejects cross-domain identity citations", () => {
    const axes: AnalystAxis[] = [
      { axis: "P1_team_and_identity", weight: 18, role: "PROJECT" },
      { axis: "P3_token_conduct", weight: 17, role: "PROJECT" },
    ];
    const packet = buildScoringEvidencePacket({
      findings: [{
        finding_type: "TokenCollapse",
        claim: "The attributed token collapsed after launch.",
        source_url: "https://dexscreener.com/token/example",
        source_author: "dexscreener",
        verification_status: "Verified",
        independent_source_count: 1,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const frozen = extractScoringEvidenceCatalog(packet);
    const collapse = frozen.find((artifact) => artifact.section === "findings")!;

    expect(collapse.eligibleAxes).toEqual(["P3_token_conduct"]);
    expect(collapse.provider).toBe("dexscreener");
    expect(validateAnalystVerdict({
      axes: [
        validAxis("P1_team_and_identity", 18, collapse.artifactId),
        validAxis("P3_token_conduct", 5, collapse.artifactId),
      ],
      headline: "Invalid cross-domain citation",
      identity_note: "Identity unresolved",
    }, axes, frozen)).toBeNull();
  });

  it("does not turn an unresolved placeholder profile into observed identity evidence", () => {
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@missing",
        display_name: "missing",
        profile_collection_state: "unavailable",
        profile_provider: "twitterapi",
      },
    }, catalog);
    const parsed = JSON.parse(packet);
    const frozen = extractScoringEvidenceCatalog(packet);

    expect(parsed).not.toHaveProperty("profile");
    expect(frozen.some((artifact) => artifact.section === "profile")).toBe(false);
    expect(frozen.filter((artifact) => artifact.section === "axisGaps")).toHaveLength(catalog.length);
  });

  it("omits bare or credential-bearing links from frozen scorer artifacts", () => {
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      team: [{ name: "Named Teammate", role: "CTO", linkedin: "linkedin.com/in/teammate" }],
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Unsafe source URL",
        sourceUrl: "https://user:secret@example.com/private",
        match: "observed",
      }, {
        kind: "press",
        provider: "google-news",
        title: "Sensitive query URL",
        sourceUrl: "https://example.com/article?token=secret&story=42#private",
        match: "observed",
      }],
    }, catalog);
    const frozen = extractScoringEvidenceCatalog(packet);

    expect(packet).not.toContain("user:secret");
    expect(packet).not.toContain("token=secret");
    expect(packet).not.toContain("#private");
    expect(frozen.find((artifact) => artifact.section === "team")).not.toHaveProperty("sourceUrl");
    expect(frozen.find((artifact) => artifact.title === "Unsafe source URL")).not.toHaveProperty("sourceUrl");
    expect(frozen.find((artifact) => artifact.title === "Sensitive query URL")?.sourceUrl).toBe(
      "https://example.com/article?story=42",
    );
  });

  it("keeps the decorated scorer packet and its exact catalog inside the structural budget", () => {
    const packet = buildScoringEvidencePacket({
      profile: { handle: "@subject", bio: "b".repeat(20_000), profile_collection_state: "resolved", profile_provider: "twitterapi" },
      recentActivity: Array.from({ length: 100 }, (_, index) => `post ${index} ${"x".repeat(4_000)}`),
      sourceArtifacts: Array.from({ length: 100 }, (_, index) => ({
        kind: "press",
        provider: "google-news",
        title: `Source ${index}`,
        sourceUrl: `https://example.com/${index}`,
        capturedAt: "2026-07-11T12:00:00.000Z",
        contentHash: String(index).padStart(64, "0"),
        match: "observed",
      })),
    }, catalog);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    const artifacts = extractScoringEvidenceCatalog(packet);
    expect(artifacts).toHaveLength(parsed.evidenceCatalog.length);
    expect(artifacts.length).toBeGreaterThan(0);
  });

  it("structurally prunes an oversized trust graph to the hard scorer budget", () => {
    const long = "x".repeat(400);
    const ties = Array.from({ length: 4 }, (_, index) => ({
      key: `${long}${index}`,
      label: `${long}${index}`,
      type: long,
      strength: "hard",
      subjectEdgeTypes: Array(8).fill(long),
      otherEdgeTypes: Array(8).fill(long),
    }));
    const packet = buildScoringEvidencePacket({
      trustGraphScreen: {
        provider: "argus-graph",
        capturedAt: "2026-07-11T12:00:00.000Z",
        status: "risk",
        contributionCount: 8,
        qualifiedContributionCount: 8,
        sourceContentHash: "a".repeat(64),
        severity: "avoid",
        line: long,
        connections: Array.from({ length: 8 }, (_, index) => ({
          other: `${long}${index}`,
          otherReportVersionId: long,
          otherAttestation: "server_collected",
          otherCompleteness: "complete",
          otherVerdict: "FAIL",
          qualified: true,
          direct: true,
          ties,
        })),
      },
    }, [{ axis: "F5_reputation_integrity", weight: 18, role: "FOUNDER" }]);

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    expect(extractScoringEvidenceCatalog(packet).length).toBeGreaterThan(0);
  });

  it("tells decision prompts that leads are excluded without discarding non-finding evidence", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: { handle: "@subject", display_name: "Subject", bio: "Named builder", profile_collection_state: "resolved", profile_provider: "twitterapi" },
      ventures: [{ project_name: "Verified Venture", role: "founder", outcome: "Active", artifact_verified: true }],
    }, catalog);
    const scorerCatalog = extractScoringEvidenceCatalog(evidenceJson);
    const refFor = (axis: string) => scorerCatalog.find((artifact) =>
      artifact.verification !== "unavailable" && artifact.eligibleAxes.includes(axis))!.artifactId;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { tool_choice: { name: string } };
      const input = request.tool_choice.name === "record_contradictions"
        ? { contradictions: [] }
        : {
            axes: [
              validAxis("F1_identity_verifiability", 10, refFor("F1_identity_verifiability")),
              validAxis("F2_track_record", 20, refFor("F2_track_record")),
            ],
            headline: "Evidence-backed result",
            identity_note: "Identity resolved",
          };
      return new Response(JSON.stringify({
        content: [{ type: "tool_use", name: request.tool_choice.name, input }],
        usage: { input_tokens: 100, output_tokens: 20 },
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await scanContradictions("@subject", "{\"profile\":{\"handle\":\"@subject\"}}");
    const verdict = await analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson);

    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      system: string;
      messages: { content: string }[];
      tool_choice: { name: string };
      max_tokens: number;
      tools: Array<{ input_schema: { properties: { axes: { items: { properties: Record<string, { items?: { enum?: string[] } }>; required: string[] } } } } }>;
    });
    const contradictionPrompt = requests.find((request) => request.tool_choice.name === "record_contradictions")?.system ?? "";
    const scoringPrompt = requests.find((request) => request.tool_choice.name === "record_verdict")?.messages[0]?.content ?? "";

    expect(contradictionPrompt).toContain("investigative leads are excluded from this evidence packet");
    expect(contradictionPrompt).toContain("when comparing or interpreting finding collections");
    expect(contradictionPrompt).toContain("profile, team, wallet, check-outcome");
    expect(scoringPrompt).toContain("investigative leads are excluded from this scoring packet");
    expect(scoringPrompt).toContain("when comparing or interpreting finding collections");
    expect(scoringPrompt).toContain("profile, team, wallet, check-outcome");
    expect(scoringPrompt).not.toContain("only rows in the findings array may influence");
    expect(scoringPrompt).toContain("every axis must return evidenceRefs, counterEvidenceRefs, and gaps");
    const verdictRequest = requests.find((request) => request.tool_choice.name === "record_verdict")!;
    const axisSchema = verdictRequest.tools[0].input_schema.properties.axes.items;
    expect(verdictRequest.max_tokens).toBe(6000);
    expect(axisSchema.required).toEqual(expect.arrayContaining(["evidenceRefs", "counterEvidenceRefs", "gaps"]));
    expect(axisSchema.properties.evidenceRefs.items?.enum).toEqual(scorerCatalog.map((artifact) => artifact.artifactId));
    expect(verdict?.axes.every((axis) => axis.evidenceRefs.length === 1)).toBe(true);
  });

  it("fails before the provider call when the scorer packet has no valid frozen catalog", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(analyzeSubject(
      "@subject",
      ["FOUNDER"],
      catalog,
      "{\"profile\":{\"handle\":\"@subject\"}}",
    )).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before the provider call when an axis has coverage only and no substantive support", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const trackRecordOnly: AnalystAxis[] = [{ axis: "F2_track_record", weight: 28, role: "FOUNDER" }];
    const evidenceJson = buildScoringEvidencePacket({
      checkOutcomes: [{
        checkId: "vc-portfolio-track-record",
        status: "unavailable",
        provider: "crunchbase",
        note: "Provider unavailable.",
      }],
    }, trackRecordOnly);

    await expect(analyzeSubject("@subject", ["FOUNDER"], trackRecordOnly, evidenceJson)).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives the citation-rich flagship scorer a dedicated 120 second window", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const evidenceJson = buildScoringEvidencePacket({
      profile: {
        handle: "@subject",
        display_name: "Subject",
        bio: "Named builder",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
      },
      ventures: [{
        project_name: "Verified Venture",
        role: "founder",
        outcome: "Active",
        artifact_verified: true,
      }],
    }, catalog);
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(analyzeSubject("@subject", ["FOUNDER"], catalog, evidenceJson)).resolves.toBeNull();

    expect(ANALYST_SCORING_TIMEOUT_MS).toBe(120_000);
    expect(timeoutSpy).toHaveBeenCalledWith(ANALYST_SCORING_TIMEOUT_MS);
  });
});

describe("Claude attempt accounting", () => {
  const tool = {
    name: "record_test",
    description: "Record a test result.",
    input_schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("records an HTTP failure as a failed paid attempt", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.claudeCalls).toBe(1);
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      calls: 1,
      failed: 1,
      status: "failed",
      usd: 0,
      meta: expect.stringContaining("http_503"),
    }));
  });

  it("bounds the Anthropic request at 60 seconds by default", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const signal = new AbortController().signal;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal }),
    );
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      failed: 1,
      status: "failed",
      meta: expect.stringContaining("transport_error"),
    }));
  });

  it("records the tool and dedicated timeout when a request expires", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timed out", "TimeoutError")));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool, 2048, 120_000);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      op: "record_test",
      failed: 1,
      meta: expect.stringContaining("timeout_120000ms"),
    }));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("record_test request failed (timeout_120000ms)"),
      expect.objectContaining({ name: "TimeoutError" }),
    );
  });

  it("records billed usage as partial when the required tool result is missing", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: [{ type: "text", text: "not a tool call" }],
      usage: { input_tokens: 1_000, output_tokens: 100 },
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const captured = await withCostLedger(async () => {
      const result = await structured<{ ok: boolean }>("system", "user", tool);
      return { result, cost: getCost() };
    });

    expect(captured.result).toBeNull();
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "claude",
      calls: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      status: "partial",
      meta: expect.stringContaining("missing_tool_use"),
    }));
  });
});
