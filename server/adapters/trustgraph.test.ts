import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import type { GraphContribution } from "../../src/graph/network";
import { getCost, resetCost, withCostLedger } from "../cost";
import type { CheckObservation, CollectContext } from "./types";
import { collectTrustGraph } from "./trustgraph";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const REPORT_VERSION_ID = "11111111-1111-4111-8111-111111111111";
const WALLET_KEY = `wallet:ethereum:0x${"a".repeat(40)}`;
const CHECK_IDS = [
  "identity-resolution",
  "profile-photo-authenticity",
  "code-footprint-github",
  "identity-continuity",
  "affiliations-associates",
  "promoted-token-performance",
  "vc-portfolio-track-record",
  "news-press",
  "us-legal-history",
  "ofac-sanctions-name",
  "trust-graph-connections",
] as const;

const json = (value: unknown, count: string) => new Response(JSON.stringify(value), {
  status: 200,
  headers: {
    "content-type": "application/json",
    "content-range": count,
  },
});

function fixture(options: { active?: boolean; stale?: boolean; missingCheck?: boolean; graphCount?: string; verdict?: string } = {}) {
  const active = options.active ?? true;
  const graphRow = {
    handle: "@failed",
    aliases: [],
    verdict: "PASS", // mutable graph verdict must never be read or trusted
    nodes: [
      { type: "Person", key: "@failed", label: "Failed subject", subject: true },
      { type: "Identity", key: WALLET_KEY, label: "shared deployer" },
    ],
    edges: [{ src: "@failed", dst: WALLET_KEY, type: "CONTROLS_WALLET" }],
    report_version_id: REPORT_VERSION_ID,
    provenance_state: "server_collected",
  };
  return vi.fn().mockImplementation((input: string | URL | Request) => {
    const url = decodeURIComponent(String(input));
    if (url.includes("/graph_contributions?")) {
      return Promise.resolve(json([graphRow], options.graphCount ?? "0-0/1"));
    }
    if (url.includes("/report_versions?")) {
      return Promise.resolve(json([{
        id: REPORT_VERSION_ID,
        verdict: options.verdict ?? "FAIL",
        completeness_state: "complete",
        attestation_state: "server_collected",
      }], "0-0/1"));
    }
    if (url.includes("/check_runs?")) {
      const checkIds = options.missingCheck ? CHECK_IDS.slice(0, -1) : CHECK_IDS;
      const checks = checkIds.map((checkId) => ({
        check_id: checkId,
        report_version_id: REPORT_VERSION_ID,
        state: checkId === "promoted-token-performance" || checkId === "vc-portfolio-track-record" ? "not_run" : "complete",
        stale_at: options.stale && checkId === "identity-resolution" ? "2020-01-01T00:00:00.000Z" : null,
        attestation_state: "server_collected",
        metadata: checkId === "promoted-token-performance" || checkId === "vc-portfolio-track-record"
          ? { status: "not-applicable", notApplicable: true }
          : { status: "confirmed" },
      }));
      return Promise.resolve(json(checks, `0-${checks.length - 1}/${checks.length}`));
    }
    if (url.includes("/reports?")) {
      return Promise.resolve(active
        ? json([{ report_version_id: REPORT_VERSION_ID }], "0-0/1")
        : json([], "*/0"));
    }
    throw new Error(`unexpected URL ${url}`);
  });
}

function context(): { ctx: CollectContext; checks: CheckObservation[]; current: GraphContribution } {
  const evidence = emptyEvidence("@current");
  const checks: CheckObservation[] = [];
  return {
    ctx: {
      handle: evidence.profile.handle,
      organizationId: ORGANIZATION_ID,
      evidence,
      emit: vi.fn(),
      recordCheck: (observation) => checks.push(observation),
    },
    checks,
    current: {
      handle: "@current",
      nodes: [
        { type: "Person", key: "@current", subject: true },
        { type: "Identity", key: WALLET_KEY, label: "shared deployer" },
      ],
      edges: [{ src: "@current", dst: WALLET_KEY, type: "CONTROLS_WALLET" }],
    },
  };
}

async function collectWithLedger(ctx: CollectContext, current: GraphContribution) {
  return withCostLedger(async () => {
    const result = await collectTrustGraph(ctx, current);
    return { result, cost: getCost() };
  });
}

describe("frozen trust-graph collector", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    resetCost();
  });

  it("binds an adverse hard tie to the exact active immutable report version", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const fetchMock = fixture();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, checks, current } = context();

    const captured = await collectWithLedger(ctx, current);

    expect(captured.result).toMatchObject({ state: "executed" });
    expect(captured.cost.calls.filter((line) => line.provider === "supabase")).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "trust-graph/graph-contributions", calls: 1, status: "succeeded" }),
      expect.objectContaining({ op: "trust-graph/report-versions", calls: 1, status: "succeeded" }),
      expect.objectContaining({ op: "trust-graph/check-runs", calls: 1, status: "succeeded" }),
      expect.objectContaining({ op: "trust-graph/reports", calls: 1, status: "succeeded" }),
    ]));
    expect(ctx.evidence.trustGraphScreen).toMatchObject({
      status: "risk",
      severity: "avoid",
      contributionCount: 1,
      qualifiedContributionCount: 1,
    });
    expect(ctx.evidence.trustGraphScreen?.connections[0]).toMatchObject({
      other: "@failed",
      otherReportVersionId: REPORT_VERSION_ID,
      otherVerdict: "FAIL",
      otherAttestation: "server_collected",
      otherCompleteness: "complete",
      qualified: true,
    });
    expect(ctx.evidence.findings).toContainEqual(expect.objectContaining({
      finding_type: "TrustGraphConnection",
      source_url: "",
      content_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      trust_graph: expect.objectContaining({
        tie_key: WALLET_KEY,
        tie_type: "Identity",
        tie_strength: "hard",
        other_report_version_id: REPORT_VERSION_ID,
        other_verdict: "FAIL",
      }),
    }));
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "finding" }));
    const artifact = ctx.evidence.sourceArtifacts.find((candidate) => candidate.kind === "trust_graph");
    expect(artifact).toEqual(expect.objectContaining({
      kind: "trust_graph",
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(artifact).not.toHaveProperty("sourceUrl");
    const graphRead = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(graphRead).not.toContain("select=handle,aliases,verdict");
  });

  it("keeps shared portfolio companies navigable but out of adverse trust qualification", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const base = fixture();
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("/graph_contributions?")) {
        return Promise.resolve(json([{
          handle: "@failed",
          aliases: [],
          nodes: [
            { type: "Person", key: "@failed", subject: true },
            { type: "Company", key: "popularco.com", label: "Popular Co" },
          ],
          edges: [{ src: "@failed", dst: "popularco.com", type: "INVESTED_IN" }],
          report_version_id: REPORT_VERSION_ID,
          provenance_state: "server_collected",
        }], "0-0/1"));
      }
      return base(input);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, checks, current } = context();
    current.nodes = [
      { type: "Person", key: "@current", subject: true },
      { type: "Company", key: "popularco.com", label: "Popular Co" },
    ];
    current.edges = [{ src: "@current", dst: "popularco.com", type: "INVESTED_IN" }];

    const { result } = await collectWithLedger(ctx, current);

    expect(result).toMatchObject({ state: "executed" });
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "clear", connections: [] });
    expect(ctx.evidence.findings).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "checked-empty" }));
  });

  it("skips a historical graph row tied to an INCOMPLETE report without poisoning reconciliation", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubGlobal("fetch", fixture({ verdict: "INCOMPLETE" }));
    const { ctx, checks, current } = context();

    const { result } = await collectWithLedger(ctx, current);

    expect(result).toMatchObject({ state: "executed" });
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "clear", contributionCount: 0, connections: [] });
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "checked-empty" }));
  });

  it.each([
    { label: "archived/non-active", fixtureOptions: { active: false } },
    { label: "stale", fixtureOptions: { stale: true } },
    { label: "incomplete historical checklist", fixtureOptions: { missingCheck: true } },
  ])("keeps a $label linked report from completing or capping the check", async ({ fixtureOptions }) => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubGlobal("fetch", fixture(fixtureOptions));
    const { ctx, checks, current } = context();

    const { result } = await collectWithLedger(ctx, current);

    expect(result).toMatchObject({ state: "partial" });
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "incomplete" });
    expect(ctx.evidence.trustGraphScreen?.connections[0]).toMatchObject({ qualified: false });
    expect(ctx.evidence.trustGraphScreen?.connections[0]).not.toHaveProperty("otherVerdict");
    expect(ctx.evidence.findings).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "unavailable" }));
  });

  it("fails closed when the exact-count header proves the graph response was truncated", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubGlobal("fetch", fixture({ graphCount: "0-0/2" }));
    const { ctx, checks, current } = context();

    const captured = await collectWithLedger(ctx, current);

    expect(captured.result).toMatchObject({ state: "failed" });
    expect(captured.cost.calls).toContainEqual(expect.objectContaining({
      provider: "supabase",
      op: "trust-graph/graph-contributions",
      calls: 1,
      failed: 1,
      status: "failed",
    }));
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "incomplete", connections: [] });
    expect(ctx.evidence.findings).toEqual([]);
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "unavailable" }));
  });

  it("awaits every parallel qualification read before failing closed and freezing cost", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const base = fixture();
    let resolveChecks!: (value: Response) => void;
    let resolveActive!: (value: Response) => void;
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = decodeURIComponent(String(input));
      if (url.includes("/graph_contributions?")) return base(input);
      if (url.includes("/report_versions?")) return Promise.reject(new Error("versions offline"));
      if (url.includes("/check_runs?")) {
        return new Promise<Response>((resolve) => { resolveChecks = resolve; });
      }
      if (url.includes("/reports?")) {
        return new Promise<Response>((resolve) => { resolveActive = resolve; });
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, checks, current } = context();
    let finished = false;

    const pending = collectWithLedger(ctx, current).then((value) => {
      finished = true;
      return value;
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await Promise.resolve();
    expect(finished).toBe(false);

    resolveChecks(json([], "*/0"));
    await Promise.resolve();
    expect(finished).toBe(false);
    resolveActive(json([], "*/0"));

    const captured = await pending;
    expect(captured.result).toMatchObject({ state: "failed" });
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: "trust-graph/report-versions", failed: 1, status: "failed" }),
      expect.objectContaining({ op: "trust-graph/check-runs", succeeded: 1, status: "succeeded" }),
      expect.objectContaining({ op: "trust-graph/reports", succeeded: 1, status: "succeeded" }),
    ]));
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "incomplete", connections: [] });
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "unavailable" }));
  });

  it("hashes canonical graph semantics, including the fresh subject contribution", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const first = context();
    vi.stubGlobal("fetch", fixture());
    await collectWithLedger(first.ctx, first.current);
    const firstHash = first.ctx.evidence.trustGraphScreen?.sourceContentHash;

    const reordered = context();
    reordered.current.nodes.reverse();
    vi.stubGlobal("fetch", fixture());
    await collectWithLedger(reordered.ctx, reordered.current);
    const reorderedHash = reordered.ctx.evidence.trustGraphScreen?.sourceContentHash;

    const different = context();
    different.ctx.handle = "@different";
    different.ctx.evidence.profile.handle = "@different";
    different.current.handle = "@different";
    different.current.nodes = different.current.nodes.map((node) => node.subject
      ? { ...node, key: "@different" }
      : node);
    different.current.edges = different.current.edges.map((edge) => ({ ...edge, src: "@different" }));
    vi.stubGlobal("fetch", fixture());
    await collectWithLedger(different.ctx, different.current);
    const differentHash = different.ctx.evidence.trustGraphScreen?.sourceContentHash;

    expect(firstHash).toMatch(/^[a-f0-9]{64}$/);
    expect(reorderedHash).toBe(firstHash);
    expect(differentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(differentHash).not.toBe(firstHash);
  });

  it("rejects a malformed organization identifier before any cross-tenant query", async () => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { ctx, checks, current } = context();
    ctx.organizationId = "org-not-a-uuid";

    const captured = await collectWithLedger(ctx, current);

    expect(captured.result).toMatchObject({ state: "partial" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(captured.cost.calls.filter((line) => line.provider === "supabase")).toEqual([]);
    expect(ctx.evidence.trustGraphScreen).toMatchObject({ status: "incomplete" });
    expect(checks).toContainEqual(expect.objectContaining({ id: "trust-graph-connections", status: "unavailable" }));
  });
});
