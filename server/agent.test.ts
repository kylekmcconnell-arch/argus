import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  analyzeSubject,
  buildAnalystEvidencePacket,
  buildScoringEvidencePacket,
  scanContradictions,
  structured,
  validateAnalystVerdict,
  type AnalystAxis,
} from "./agent";
import { getCost, withCostLedger } from "./cost";

const catalog: AnalystAxis[] = [
  { axis: "F1_identity_verifiability", weight: 12, role: "FOUNDER" },
  { axis: "F2_track_record", weight: 28, role: "FOUNDER" },
];

describe("analyst verdict integrity", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("accepts exactly one finite, in-range score per requested axis", () => {
    const result = validateAnalystVerdict({
      axes: [
        { axis: "F2_track_record", score: 20, rationale: "documented history" },
        { axis: "F1_identity_verifiability", score: 10, rationale: "named identity" },
      ],
      headline: "Complete result",
      identity_note: "Identity resolved",
    }, catalog);

    expect(result?.axes.map((axis) => axis.axis)).toEqual(catalog.map((axis) => axis.axis));
    expect(result?.axes.map((axis) => axis.score)).toEqual([10, 20]);
  });

  it.each([
    {
      label: "missing axis",
      axes: [{ axis: "F1_identity_verifiability", score: 10, rationale: "ok" }],
    },
    {
      label: "duplicate axis",
      axes: [
        { axis: "F1_identity_verifiability", score: 10, rationale: "first" },
        { axis: "F1_identity_verifiability", score: 11, rationale: "duplicate" },
      ],
    },
    {
      label: "unknown axis",
      axes: [
        { axis: "F1_identity_verifiability", score: 10, rationale: "ok" },
        { axis: "MADE_UP", score: 1, rationale: "not requested" },
      ],
    },
    {
      label: "non-finite score",
      axes: [
        { axis: "F1_identity_verifiability", score: Number.NaN, rationale: "bad" },
        { axis: "F2_track_record", score: 20, rationale: "ok" },
      ],
    },
    {
      label: "out-of-range score",
      axes: [
        { axis: "F1_identity_verifiability", score: 13, rationale: "over max" },
        { axis: "F2_track_record", score: 20, rationale: "ok" },
      ],
    },
  ])("rejects a $label response", ({ axes }) => {
    expect(validateAnalystVerdict({ axes, headline: "bad", identity_note: "bad" }, catalog)).toBeNull();
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
      finding_type: "DeterministicFinding",
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
      finding_type: "DeterministicFinding",
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
      profile: { handle: "@subject", name: "Subject Person", bio: "Public builder" },
      team: [{ name: "Named Teammate", role: "CTO", linkedin: "https://linkedin.com/in/teammate" }],
      wallets: [{ chain: "ethereum", address: "0x123", attribution: "self-disclosed" }],
      ventures: [{ project_name: "FIXTURE_VENTURE_MUST_NOT_REACH_SCORER", evidence_origin: "model_lead", artifact_verified: false }],
      testimonials: [{ claimed_endorser_handle: "@fixture_endorser", evidence_origin: "model_lead", artifact_verified: false }],
      promotions: [{ ticker: "FIXTURE_PROMO", evidence_origin: "model_lead", artifact_verified: false }],
      checkOutcomes: [{ checkId: "identity-resolution", status: "confirmed", provider: "github" }],
      findings: [modelLead, relatedLead, direct],
      investigative_leads: [{ claim: "SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER" }],
    });
    const parsed = JSON.parse(packet);

    expect(parsed).not.toHaveProperty("investigative_leads");
    expect(parsed.coverage).not.toHaveProperty("investigative_leads");
    expect(parsed.finding_scope_policy).not.toHaveProperty("investigative_leads");
    expect(parsed.findings).toEqual([
      expect.objectContaining({ claim: "DIRECT_SUBJECT_FINDING_RETAINED" }),
    ]);
    expect(parsed.profile).toMatchObject({ handle: "@subject", name: "Subject Person" });
    expect(parsed.team[0]).toMatchObject({ name: "Named Teammate", role: "CTO" });
    expect(parsed.wallets[0]).toMatchObject({ chain: "ethereum", address: "0x123" });
    expect(parsed.checkOutcomes[0]).toMatchObject({
      checkId: "identity-resolution",
      status: "confirmed",
    });
    expect(packet).not.toContain("MODEL_LEAD_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("RELATED_ENTITY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("SEPARATE_LEAD_ARRAY_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("FIXTURE_VENTURE_MUST_NOT_REACH_SCORER");
    expect(packet).not.toContain("fixture_endorser");
    expect(packet).not.toContain("FIXTURE_PROMO");
    expect(packet).not.toContain("model_lead");
    expect(packet).not.toContain("@associate");
  });

  it("tells decision prompts that leads are excluded without discarding non-finding evidence", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "anthropic-test-key");
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { tool_choice: { name: string } };
      const input = request.tool_choice.name === "record_contradictions"
        ? { contradictions: [] }
        : {
            axes: [
              { axis: "F1_identity_verifiability", score: 10, rationale: "Named team" },
              { axis: "F2_track_record", score: 20, rationale: "Verified work" },
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
    await analyzeSubject("@subject", ["FOUNDER"], catalog, "{\"profile\":{\"handle\":\"@subject\"}}");

    const requests = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      system: string;
      messages: { content: string }[];
      tool_choice: { name: string };
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
