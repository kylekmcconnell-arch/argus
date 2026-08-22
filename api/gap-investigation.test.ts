import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  consumeInvestigationQuota,
  loadExactVersionReport,
  persistGapInvestigationProposalBundle,
  recordProviderUsageBatch,
  requireArgusAuth,
  runAudit,
} = vi.hoisted(() => ({
  consumeInvestigationQuota: vi.fn(),
  loadExactVersionReport: vi.fn(),
  persistGapInvestigationProposalBundle: vi.fn(),
  recordProviderUsageBatch: vi.fn(),
  requireArgusAuth: vi.fn(),
  runAudit: vi.fn(),
}));

vi.mock("./_auth.js", () => ({
  consumeInvestigationQuota,
  requireArgusAuth,
  serviceCredentials: () => ({ url: "https://database.example", key: "sb_secret_test" }),
  serviceHeaders: () => ({ apikey: "sb_secret_test", "content-type": "application/json" }),
}));
vi.mock("./report.js", () => ({ loadExactVersionReport }));
vi.mock("./_collector.js", () => ({ runAudit }));
vi.mock("./_provenance.js", () => ({ persistGapInvestigationProposalBundle }));
vi.mock("./_cache.js", () => ({ recordProviderUsageBatch }));

import handler from "./gap-investigation";

const SOURCE_ID = "00000000-0000-4000-8000-000000000105";
const AUTHORIZATION_ID = "00000000-0000-4000-8000-000000000205";
const PROPOSAL_ID = "00000000-0000-4000-8000-000000000305";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000011";

const researchPlan = {
  schemaVersion: 1,
  intent: "investment_due_diligence",
  subject: "Alice",
  roles: ["FOUNDER"],
  createdAt: "2026-08-22T10:00:00.000Z",
  tasks: [
    {
      id: "identity",
      capability: "identity_resolution",
      question: "Who is Alice?",
      why: "Identity gate",
      priority: "critical",
      delegates: ["x-profile", "official-domain", "basic-facts"],
      checkIds: ["identity-resolution"],
      triggeredBy: [],
      rank: 1,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Required",
      stopWhen: "Bound",
      blockedBy: [],
      state: "completed",
    },
    {
      id: "portfolio",
      capability: "portfolio_and_outcomes",
      question: "What outcomes are attributable?",
      why: "Decision gap",
      priority: "high",
      delegates: ["portfolio-web", "entity-store"],
      checkIds: ["founder-track-record"],
      triggeredBy: ["gap.track-record"],
      rank: 2,
      decisionImpact: 5,
      costClass: "high",
      dispatchReason: "Gap",
      stopWhen: "Corroborated",
      blockedBy: [],
      state: "unavailable",
    },
    {
      id: "synthesis",
      capability: "analyst_synthesis",
      question: "What follows?",
      why: "Proposal",
      priority: "critical",
      delegates: ["evidence-preflight", "axis-scorer"],
      checkIds: [],
      triggeredBy: [],
      rank: 3,
      decisionImpact: 5,
      costClass: "low",
      dispatchReason: "Required",
      stopWhen: "Frozen",
      blockedBy: [],
      state: "partial",
    },
  ],
  nextActions: [],
};

const payload = {
  handle: "alice",
  researchPlan,
  intelligence: {
    questions: [{
      id: "gap.track-record",
      prompt: "What is the verified track record?",
      state: "unresolved",
      materiality: "critical",
    }],
  },
};

function request(method: "POST" | "PATCH", body: Record<string, unknown>) {
  return { method, body, headers: {}, query: {} };
}

function response() {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    status(code: number) { captured.status = code; return res; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return res; },
    json(body: unknown) { captured.body = body; return res; },
  };
  return { res, captured };
}

describe("gap investigation API", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    requireArgusAuth.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORGANIZATION_ID,
      role: "analyst",
      email: "analyst@example.com",
      displayName: "Analyst",
    });
    consumeInvestigationQuota.mockResolvedValue({ allowed: true, used: 1, remaining: 2 });
    loadExactVersionReport.mockResolvedValue({
      caseStatus: "open",
      report: { kind: "person", ref: "alice", query: "@alice", payload },
    });
    runAudit.mockResolvedValue({
      ...payload,
      live: true,
      display_name: "Alice Example",
      evidence: { profile: { handle: "alice" } },
      graph: { nodes: [{ key: "alice", subject: true }], edges: [] },
      report: {
        audit_id: "audit-gap-1",
        composite_verdict: "INCOMPLETE",
        governing_score: null,
        roles: [],
        role_reports: [],
      },
      checkRuns: [{ label: "Identity", status: "confirmed", checkId: "identity-resolution" }],
      completeness_state: "partial",
      cost: { schemaVersion: 1, usd: 1.2, calls: [] },
      providerSnapshot: {},
    });
    persistGapInvestigationProposalBundle.mockResolvedValue(PROPOSAL_ID);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(AUTHORIZATION_ID), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
  });

  it("executes only the server-derived saved scope and persists an inactive proposal", async () => {
    const { res, captured } = response();
    await handler(request("POST", {
      sourceReportVersionId: SOURCE_ID,
      gapId: "gap.track-record",
      taskIds: ["portfolio"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 3.5,
    }) as never, res as never);

    expect(captured.status).toBe(201);
    expect(captured.body).toMatchObject({
      authorizationId: AUTHORIZATION_ID,
      proposedReportVersionId: PROPOSAL_ID,
      active: false,
      status: "partial",
      observedCostUsd: 1.2,
    });
    expect(runAudit).toHaveBeenCalledWith("alice", expect.any(Function), expect.objectContaining({
      authorizedResearchScope: {
        taskIds: ["portfolio", "identity", "synthesis"],
        capabilities: ["portfolio_and_outcomes", "identity_resolution", "analyst_synthesis"],
        delegates: [
          "portfolio-web",
          "entity-store",
          "x-profile",
          "official-domain",
          "basic-facts",
          "evidence-preflight",
          "axis-scorer",
        ],
      },
    }));
    expect(persistGapInvestigationProposalBundle).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        authorizationId: AUTHORIZATION_ID,
        completenessState: "partial",
        payload: expect.objectContaining({
          gapInvestigation: expect.objectContaining({
            publicationState: "proposed",
            sourceReportVersionId: SOURCE_ID,
            gapId: "gap.track-record",
          }),
        }),
      }),
    );
  });

  it("rejects invented task ids before quota or provider work", async () => {
    const { res, captured } = response();
    await handler(request("POST", {
      sourceReportVersionId: SOURCE_ID,
      gapId: "gap.track-record",
      taskIds: ["invented"],
      timeBudgetSeconds: 300,
      acceptedCostCeilingUsd: 10,
    }) as never, res as never);
    expect(captured.status).toBe(409);
    expect(captured.body).toMatchObject({ error: "research_task_not_allowed" });
    expect(consumeInvestigationQuota).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it("requires a second explicit request to promote a proposal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify(PROPOSAL_ID), { status: 200 }),
    ));
    const { res, captured } = response();
    await handler(request("PATCH", {
      authorizationId: AUTHORIZATION_ID,
      action: "promote",
    }) as never, res as never);
    expect(captured.status).toBe(200);
    expect(captured.body).toEqual({
      authorizationId: AUTHORIZATION_ID,
      status: "promoted",
      reportVersionId: PROPOSAL_ID,
    });
    const fetchMock = vi.mocked(fetch);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rpc/promote_gap_investigation_proposal");
  });
});
