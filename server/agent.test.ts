import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANALYST_EVIDENCE_MAX_CHARS,
  buildAnalystEvidencePacket,
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
    });

    expect(packet.length).toBeLessThanOrEqual(ANALYST_EVIDENCE_MAX_CHARS);
    const parsed = JSON.parse(packet);
    expect(parsed.findings[0].claim).toBe("material finding survives");
    expect(parsed.findings[0].source_url).toBe("https://example.com/artifact");
    expect(parsed.coverage.recentActivity.available).toBe(100);
    expect(parsed.coverage.recentActivity.included).toBeLessThanOrEqual(12);
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
