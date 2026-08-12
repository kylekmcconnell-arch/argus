import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CaseBriefConflictError,
  CaseBriefAnchorConflictError,
  appendCaseBriefNote,
  fetchCaseBrief,
  fetchOlderCaseBriefNotes,
  fetchOlderCaseBriefRevisions,
  saveCaseBrief,
  type CaseBrief,
  type CaseBriefContent,
} from "./caseBrief";

const content: CaseBriefContent = {
  summary: "The evidence supports a monitored advance.",
  strongestEvidence: ["Treasury flows match disclosed wallets."],
  highestRisks: ["One unresolved deployer link."],
  unresolvedQuestions: ["Who controls the recovery signer?"],
  changeConditions: ["A signer disclosure changes this decision."],
  nextActions: ["Verify the recovery signer."],
};

const brief: CaseBrief = {
  caseId: "00000000-0000-4000-8000-000000000101",
  revision: 2,
  anchorReportVersionId: "00000000-0000-4000-8000-000000000201",
  recommendation: "monitor",
  assigneeUserId: null,
  assigneeDisplayName: null,
  dueAt: null,
  content,
  createdByUserId: "00000000-0000-4000-8000-000000000010",
  createdByDisplayName: "Kyle",
  createdAt: "2026-07-11T01:00:00.000Z",
  updatedByUserId: "00000000-0000-4000-8000-000000000010",
  updatedByDisplayName: "Kyle",
  updatedAt: "2026-07-11T02:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("Case Brief client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("prefers an exact case id and disables browser caching", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ case: {}, brief: null }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCaseBrief({ caseId: brief.caseId }, { settleRetries: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/case-brief?caseId=${brief.caseId}`);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("pins fresh report views to their expected immutable version", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ case: {}, brief: null }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCaseBrief({
      caseId: brief.caseId,
      expectedReportVersionId: brief.anchorReportVersionId,
    }, { settleRetries: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe(
      `/api/case-brief?caseId=${brief.caseId}&expectedReportVersionId=${brief.anchorReportVersionId}`,
    );
  });

  it("uses only an exact kind and canonical ref as fallback", async () => {
    const address = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ case: {}, brief: null }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchCaseBrief({ kind: "token", ref: address }, { settleRetries: 0 });

    expect(fetchMock.mock.calls[0][0]).toBe(`/api/case-brief?kind=token&ref=${address}`);
  });

  it("requests older immutable history with stable cursors", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ revisions: [], anchorVersions: [], hasOlderRevisions: false }))
      .mockResolvedValueOnce(jsonResponse({ notes: [], hasOlderNotes: false }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchOlderCaseBriefRevisions(brief.caseId, 11);
    await fetchOlderCaseBriefNotes(brief.caseId, {
      createdAt: "2026-07-10T12:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000301",
    });

    expect(fetchMock.mock.calls[0][0]).toContain(`caseId=${brief.caseId}&history=revisions&beforeRevision=11`);
    expect(fetchMock.mock.calls[1][0]).toContain("history=notes");
    expect(fetchMock.mock.calls[1][0]).toContain("beforeCreatedAt=2026-07-10T12%3A00%3A00.000Z");
  });

  it("retries a bounded persistence-settling miss", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "case_not_found", settling: true }, 404))
      .mockResolvedValueOnce(jsonResponse({ case: { caseId: brief.caseId }, brief }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchCaseBrief(
      { caseId: brief.caseId },
      { settleRetries: 2, retryDelayMs: 0 },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result?.brief).toEqual(brief);
  });

  it("returns null instead of inventing a case after retries settle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: "case_not_found" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCaseBrief(
      { caseId: brief.caseId },
      { settleRetries: 1, retryDelayMs: 0 },
    )).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry a report view that durable storage has superseded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      error: "case_version_changed",
      message: "Reopen the report before editing its Case Brief.",
    }, 409));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCaseBrief({
      caseId: brief.caseId,
      expectedReportVersionId: brief.anchorReportVersionId,
    }, { settleRetries: 3, retryDelayMs: 0 })).rejects.toThrow("Reopen the report");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the server head on an optimistic revision conflict", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "case_brief_revision_conflict",
      message: "The brief changed.",
      currentBrief: brief,
    }, 409)));

    const operation = saveCaseBrief({
      caseId: brief.caseId,
      expectedRevision: 1,
      anchorReportVersionId: brief.anchorReportVersionId,
      recommendation: "monitor",
      assigneeUserId: null,
      dueAt: null,
      content,
    });

    await expect(operation).rejects.toMatchObject({
      name: "CaseBriefConflictError",
      currentBrief: brief,
    } satisfies Partial<CaseBriefConflictError>);
  });

  it("types an active-anchor race so the drawer can recover safely", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      error: "case_brief_anchor_conflict",
      message: "A newer version is active.",
    }, 409)));

    const operation = saveCaseBrief({
      caseId: brief.caseId,
      expectedRevision: brief.revision,
      anchorReportVersionId: brief.anchorReportVersionId,
      reanchor: true,
      recommendation: brief.recommendation,
      assigneeUserId: null,
      dueAt: null,
      content,
    });

    await expect(operation).rejects.toBeInstanceOf(CaseBriefAnchorConflictError);
  });

  it("sends idempotent note client ids", async () => {
    const clientId = "00000000-0000-4000-8000-000000000301";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      note: {
        id: "00000000-0000-4000-8000-000000000302",
        caseId: brief.caseId,
        clientId,
        body: "Signer confirmed.",
        createdByUserId: brief.createdByUserId,
        createdAt: brief.updatedAt,
        authorDisplayName: "Kyle",
      },
    }, 201));
    vi.stubGlobal("fetch", fetchMock);

    await appendCaseBriefNote({ caseId: brief.caseId, clientId, body: "Signer confirmed." });

    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      caseId: brief.caseId,
      clientId,
      body: "Signer confirmed.",
    });
  });
});
