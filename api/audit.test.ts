import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const {
  issuePanelCostToken,
  recordProviderUsageBatch,
  activateReportVersionWithAuthoritativeGraph,
  persistReportVersionBundle,
} = vi.hoisted(() => ({
  issuePanelCostToken: vi.fn(),
  recordProviderUsageBatch: vi.fn(),
  activateReportVersionWithAuthoritativeGraph: vi.fn(),
  persistReportVersionBundle: vi.fn(),
}));

vi.mock("./_cache.js", () => ({ issuePanelCostToken, recordProviderUsageBatch }));

vi.mock("./_collector.js", async () => {
  const { resolveInput } = await import("../src/lib/resolveInput");
  return {
    resolveInput: vi.fn(resolveInput),
    runAudit: vi.fn(),
  };
});

vi.mock("./_auth.js", () => ({
  consumeInvestigationQuota: vi.fn(),
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "analyst@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "analyst",
    displayName: "Analyst",
  })),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn(),
}));

vi.mock("./_provenance.js", () => ({
  activateReportVersion: vi.fn(),
  persistReportVersionBundle,
}));

vi.mock("./_graph.js", () => ({ activateReportVersionWithAuthoritativeGraph }));

import { consumeInvestigationQuota, requireArgusAuth, serviceCredentials } from "./_auth.js";
import { activateReportVersion } from "./_provenance.js";
import { resolveInput, runAudit } from "./_collector.js";
import handler, { config } from "./audit";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  AUDIT_SSE_HEARTBEAT_MS,
  COLLECTION_ANALYST_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
  TRUST_GRAPH_SCREEN_RESERVE_MS,
} from "../src/lib/investigationRuntime";

const AUTH_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  chunks: string[];
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, chunks: [] };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader() { return this; },
    writeHead(code: number) { captured.statusCode = code; return this; },
    flushHeaders() { return this; },
    write(chunk: unknown) { captured.chunks.push(String(chunk)); return true; },
    end() { return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(handle: string, query: Record<string, string> = {}): VercelRequest {
  return {
    method: "GET",
    query: { handle, ...query },
    headers: {},
  } as unknown as VercelRequest;
}

describe("person audit input guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    issuePanelCostToken.mockReturnValue("signed-panel-token");
    recordProviderUsageBatch.mockResolvedValue(undefined);
    activateReportVersionWithAuthoritativeGraph.mockResolvedValue(false);
    persistReportVersionBundle.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["cashtag", "$PEPEBULL"],
    ["case-folded Solana mint", "52hnekedvx3qmpysyxerquicq3qxxfvchqsetyalpump"],
  ])("rejects a %s before quota or provider work", async (_label, input) => {
    const { res, captured } = response();

    await handler(request(input), res);

    expect(requireArgusAuth).toHaveBeenCalledOnce();
    expect(resolveInput).toHaveBeenCalledWith(input);
    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "valid_handle_required" });
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("passes only the authenticated organization to the collector", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({
      allowed: true,
      remaining: 9,
      used: 1,
    });
    vi.mocked(runAudit).mockResolvedValue(null);
    const { res, captured } = response();

    await handler(request("argus", { organizationId: "attacker-controlled-org" }), res);

    expect(captured.statusCode).toBe(200);
    expect(runAudit).toHaveBeenCalledOnce();
    expect(runAudit).toHaveBeenCalledWith(
      "argus",
      expect.any(Function),
      expect.objectContaining({
        organizationId: AUTH_ORGANIZATION_ID,
        analystDeadlineAt: expect.any(Number),
      }),
    );
  });

  it("hands the collector an absolute analyst deadline of request start plus the ceiling minus the finalization reserve", async () => {
    vi.useFakeTimers();
    const requestStartedAt = new Date("2026-07-18T12:00:00.000Z").getTime();
    vi.setSystemTime(requestStartedAt);
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(runAudit).mockResolvedValue(null);
    const { res } = response();

    await handler(request("argus"), res);

    // Exact epoch value: a sign flip, dropped term, seconds-for-ms slip, or a
    // relative (elapsed) budget here would still be "a number" but would push
    // the analyst past the Fluid Compute ceiling or zero its budget.
    expect(runAudit).toHaveBeenCalledWith(
      "argus",
      expect.any(Function),
      expect.objectContaining({
        analystDeadlineAt: requestStartedAt
          + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000
          - ANALYST_FINALIZATION_RESERVE_MS,
      }),
    );
  });

  it("keeps the SSE connection active while a slow bounded provider is still working", async () => {
    vi.useFakeTimers();
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    let resolveAudit!: (value: null) => void;
    vi.mocked(runAudit).mockReturnValue(new Promise<null>((resolve) => {
      resolveAudit = resolve;
    }) as never);
    const { res, captured } = response();

    const pending = handler(request("argus"), res);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(AUDIT_SSE_HEARTBEAT_MS);

    expect(captured.chunks.join("")).toContain(": argus-heartbeat\n\n");
    resolveAudit(null);
    await pending;
    const heartbeatCount = captured.chunks.filter((chunk) => chunk === ": argus-heartbeat\n\n").length;
    await vi.advanceTimersByTimeAsync(AUDIT_SSE_HEARTBEAT_MS * 2);
    expect(captured.chunks.filter((chunk) => chunk === ": argus-heartbeat\n\n")).toHaveLength(heartbeatCount);
  });

  it("issues a panel-cost capability only after fresh persistence succeeds", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000301";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      axisCitationVersion: 1,
      completeness_state: "complete",
      report: {
        audit_id: "audit-run-1",
        composite_verdict: "PASS",
        governing_score: 81,
      },
      checkRuns: [],
      providerSnapshot: { capturedAt: "2026-07-11T00:00:00.000Z", runs: [] },
      cost: {
        schemaVersion: 1,
        calls: [
          { provider: "grok", op: "live-search", calls: 2, usd: 0.2, status: "partial", meta: "one retry" },
          { provider: "claude", op: "analysis", calls: 1, usd: 0.01, status: "succeeded" },
        ],
      },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completenessState: "partial" }),
    );

    expect(recordProviderUsageBatch).toHaveBeenCalledWith(
      AUTH_ORGANIZATION_ID,
      reportVersionId,
      "00000000-0000-4000-8000-000000000010",
      [
        { provider: "grok", op: "live-search", calls: 2, usd: 0.2, status: "partial", meta: "one retry" },
        { provider: "claude", op: "analysis", calls: 1, usd: 0.01, status: "succeeded" },
      ],
    );
    expect(persistReportVersionBundle.mock.invocationCallOrder[0]).toBeLessThan(
      recordProviderUsageBatch.mock.invocationCallOrder[0],
    );
    expect(recordProviderUsageBatch.mock.invocationCallOrder[0]).toBeLessThan(
      activateReportVersionWithAuthoritativeGraph.mock.invocationCallOrder[0],
    );
    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: AUTH_ORGANIZATION_ID,
        reportVersionId,
        attestationState: "server_collected",
        completeness: "partial",
      }),
    );
    expect(activateReportVersionWithAuthoritativeGraph.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(activateReportVersion).mock.invocationCallOrder[0],
    );
    expect(issuePanelCostToken).toHaveBeenCalledWith(AUTH_ORGANIZATION_ID, reportVersionId);
    const stream = captured.chunks.join("");
    expect(stream).toContain("event: done\n");
    const done = JSON.parse(stream.match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({
      state: "persisted",
      reportVersionId,
      panelCostToken: "signed-panel-token",
    });
  });

  it("does not issue a capability for a private, unpersisted run", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: { audit_id: "private-run", composite_verdict: "PASS", governing_score: 81 },
    } as never);
    const { res, captured } = response();

    await handler(request("argus", { private: "1" }), res);

    expect(recordProviderUsageBatch).not.toHaveBeenCalled();
    expect(activateReportVersionWithAuthoritativeGraph).not.toHaveBeenCalled();
    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const stream = captured.chunks.join("");
    const done = JSON.parse(stream.match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "private", reportVersionId: null });
  });

  it("does not activate or publish a report when core usage attribution fails", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: { audit_id: "audit-run-accounting-failure", composite_verdict: "PASS", governing_score: 81 },
      cost: { schemaVersion: 1, calls: [{ provider: "grok", op: "live-search", calls: 1, usd: 0.1 }] },
    } as never);
    recordProviderUsageBatch.mockRejectedValueOnce(new Error("provider usage batch attribution failed (503)"));
    persistReportVersionBundle.mockResolvedValue("00000000-0000-4000-8000-000000000302");
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(recordProviderUsageBatch).toHaveBeenCalledOnce();
    expect(persistReportVersionBundle).toHaveBeenCalledOnce();
    expect(activateReportVersionWithAuthoritativeGraph).not.toHaveBeenCalled();
    expect(activateReportVersion).not.toHaveBeenCalled();
    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const stream = captured.chunks.join("");
    expect(stream).toContain("event: persistence\n");
    const done = JSON.parse(stream.match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "failed", reportVersionId: null });
  });

  it("emits no immutable binding when the atomic parent-and-provenance bundle fails", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: { audit_id: "audit-run-lineage-failure", composite_verdict: "PASS", governing_score: 81 },
      cost: { schemaVersion: 1, calls: [{ provider: "grok", op: "live-search", calls: 1, usd: 0.1 }] },
    } as never);
    persistReportVersionBundle.mockRejectedValueOnce(
      new Error("invalid axis evidence lineage: F1_identity_verifiability cites absence evidence without a gap"),
    );
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledOnce();
    expect(recordProviderUsageBatch).not.toHaveBeenCalled();
    expect(activateReportVersionWithAuthoritativeGraph).not.toHaveBeenCalled();
    expect(activateReportVersion).not.toHaveBeenCalled();
    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const done = JSON.parse(captured.chunks.join("").match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "failed", reportVersionId: null });
  });

  it("fails closed when a live audit returns no collector-owned usage ledger", async () => {
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      report: { audit_id: "audit-run-missing-ledger", composite_verdict: "PASS", governing_score: 81 },
      cost: { calls: [] },
    } as never);
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(recordProviderUsageBatch).not.toHaveBeenCalled();
    expect(persistReportVersionBundle).not.toHaveBeenCalled();
    expect(activateReportVersionWithAuthoritativeGraph).not.toHaveBeenCalled();
    expect(activateReportVersion).not.toHaveBeenCalled();
    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const done = JSON.parse(captured.chunks.join("").match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "failed", reportVersionId: null });
  });

  it("allows a collector-observed empty ledger when no provider attempt ran", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000304";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      completeness_state: "complete",
      report: { audit_id: "audit-run-observed-empty", composite_verdict: "INCOMPLETE", governing_score: null },
      cost: { schemaVersion: 1, calls: [] },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completenessState: "partial" }),
    );
    expect(recordProviderUsageBatch).not.toHaveBeenCalled();
    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completeness: "partial" }),
    );
    expect(activateReportVersion).toHaveBeenCalledWith(expect.anything(), AUTH_ORGANIZATION_ID, reportVersionId);
    expect(issuePanelCostToken).toHaveBeenCalledWith(AUTH_ORGANIZATION_ID, reportVersionId);
    const done = JSON.parse(captured.chunks.join("").match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toMatchObject({ state: "persisted", reportVersionId });
  });

  it.each([
    {
      label: "no-role/no-axis routing failure",
      auditId: "audit-run-routing-failed",
      roles: [],
      roleReports: [],
    },
    {
      label: "resolved-role scoring failure",
      auditId: "audit-run-scoring-failed",
      roles: ["PROJECT"],
      roleReports: [{ role: "PROJECT", axes: {} }],
    },
  ])("saves a $label and delegates supersession to the DB activation guard", async ({ auditId, roles, roleReports }) => {
    const reportVersionId = "00000000-0000-4000-8000-000000000307";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@world_xyz",
      completeness_state: "partial",
      report: {
        audit_id: auditId,
        roles,
        role_reports: roleReports,
        composite_verdict: "INCOMPLETE",
        governing_score: null,
      },
      cost: { schemaVersion: 1, calls: [] },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res, captured } = response();

    await handler(request("world_xyz"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledOnce();
    // The API no longer withholds activation for a decisionless-incomplete
    // report: the authoritative-graph write self-skips on partial completeness,
    // and activate_report_version (the DB guard) is what preserves a prior
    // decision report while still activating a brand-new subject's first report.
    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ completeness: "partial" }),
    );
    expect(activateReportVersion).toHaveBeenCalledWith(expect.anything(), AUTH_ORGANIZATION_ID, reportVersionId);
    expect(issuePanelCostToken).toHaveBeenCalledWith(AUTH_ORGANIZATION_ID, reportVersionId);
    const done = JSON.parse(captured.chunks.join("").match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toMatchObject({ state: "persisted", reportVersionId });
  });

  it("still activates an incomplete report that has a resolved role and axes", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000308";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@partial_founder",
      completeness_state: "partial",
      report: {
        audit_id: "audit-run-incomplete-with-methodology",
        roles: ["FOUNDER"],
        role_reports: [{
          role: "FOUNDER",
          axes: { F1_identity_verifiability: { score: null } },
        }],
        composite_verdict: "INCOMPLETE",
        governing_score: null,
      },
      cost: { schemaVersion: 1, calls: [] },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res } = response();

    await handler(request("partial_founder"), res);

    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledOnce();
    expect(activateReportVersion).toHaveBeenCalledWith(expect.anything(), AUTH_ORGANIZATION_ID, reportVersionId);
  });

  it("atomically activates a coverage-qualified live report with its graph", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000305";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    activateReportVersionWithAuthoritativeGraph.mockResolvedValueOnce(true);
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      axisCitationVersion: 1,
      completeness_state: "complete",
      report: { audit_id: "audit-run-graph", composite_verdict: "PASS", governing_score: 82 },
      checkRuns: [{ checkId: "identity-resolution", label: "Identity resolution", status: "confirmed" }],
      graph: {
        nodes: [{ type: "Person", key: "@argus", subject: true }],
        edges: [],
      },
      cost: { schemaVersion: 1, calls: [] },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res } = response();

    await handler(request("argus"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ methodologyVersion: "argus-person-v5-project-strength-bands" }),
    );

    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: AUTH_ORGANIZATION_ID,
        reportVersionId,
        userId: "00000000-0000-4000-8000-000000000010",
        attestationState: "server_collected",
        completeness: "complete",
      }),
    );
    expect(persistReportVersionBundle.mock.invocationCallOrder[0]).toBeLessThan(
      activateReportVersionWithAuthoritativeGraph.mock.invocationCallOrder[0],
    );
    expect(activateReportVersion).not.toHaveBeenCalled();
  });

  it("does not activate a report when its authoritative graph write fails", async () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000306";
    vi.mocked(consumeInvestigationQuota).mockResolvedValue({ allowed: true, remaining: 9, used: 1 });
    vi.mocked(serviceCredentials).mockReturnValue({ url: "https://database.example", key: "service-key" });
    activateReportVersionWithAuthoritativeGraph.mockRejectedValueOnce(new Error("atomic report/graph activation failed (503)"));
    vi.mocked(runAudit).mockResolvedValue({
      live: true,
      handle: "@argus",
      completeness_state: "complete",
      report: { audit_id: "audit-run-graph-failure", composite_verdict: "PASS", governing_score: 82 },
      checkRuns: [{ checkId: "identity-resolution", label: "Identity resolution", status: "confirmed" }],
      graph: { nodes: [{ type: "Person", key: "@argus", subject: true }], edges: [] },
      cost: { schemaVersion: 1, calls: [] },
    } as never);
    persistReportVersionBundle.mockResolvedValue(reportVersionId);
    const { res, captured } = response();

    await handler(request("argus"), res);

    expect(persistReportVersionBundle).toHaveBeenCalledOnce();
    expect(activateReportVersionWithAuthoritativeGraph).toHaveBeenCalledOnce();
    expect(activateReportVersion).not.toHaveBeenCalled();
    expect(issuePanelCostToken).not.toHaveBeenCalled();
    const done = JSON.parse(captured.chunks.join("").match(/event: done\ndata: ([^\n]+)\n\n/)?.[1] ?? "null");
    expect(done.persistence).toEqual({ state: "failed", reportVersionId: null });
  });
});

describe("person audit runtime budget", () => {
  it("keeps the deep-investigation route inside the Pro Fluid Compute ceiling", () => {
    expect(config).toEqual({ maxDuration: DEEP_INVESTIGATION_MAX_DURATION_SECONDS });
  });

  it("reserves collection + analyst + finalization time so a slow subject still finishes inside the ceiling", () => {
    const ceilingMs = DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000;
    // Collection stops COLLECTION_ANALYST_RESERVE_MS before the analyst deadline,
    // which is itself ANALYST_FINALIZATION_RESERVE_MS before the ceiling. Both
    // reserves must fit inside the ceiling AND leave the collection phase a
    // positive, meaningful budget, so an over-budget subject degrades to a scored
    // partial report rather than being killed at the ceiling with nothing.
    const analystReserveMs = COLLECTION_ANALYST_RESERVE_MS + ANALYST_FINALIZATION_RESERVE_MS;
    expect(COLLECTION_ANALYST_RESERVE_MS).toBeGreaterThan(0);
    expect(analystReserveMs).toBeLessThan(ceilingMs);
    // Collection still gets the majority of the budget (this is a safety cut-off,
    // not an aggressive cap that would starve normal scans). The trust-graph
    // screen reserve is carved from the analyst reserve but is itself collection
    // work, so it counts toward the collection budget.
    const collectionBudgetMs = ceilingMs - analystReserveMs + TRUST_GRAPH_SCREEN_RESERVE_MS;
    expect(collectionBudgetMs).toBeGreaterThan(ceilingMs / 2);
  });
});
