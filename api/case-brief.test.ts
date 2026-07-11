import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    displayName: "Kyle",
  })),
  serviceCredentials: vi.fn(() => ({ url: "https://database.example", key: "test-service-key" })),
  serviceHeaders: vi.fn(() => ({ "content-type": "application/json" })),
}));

import { requireArgusAuth } from "./_auth.js";
import handler from "./case-brief";

const CASE_ID = "00000000-0000-4000-8000-000000000101";
const VERSION_ID = "00000000-0000-4000-8000-000000000201";
const OLD_VERSION_ID = "00000000-0000-4000-8000-000000000202";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const NOTE_ID = "00000000-0000-4000-8000-000000000301";
const CLIENT_ID = "00000000-0000-4000-8000-000000000302";

const content = {
  summary: "Monitor until the recovery signer is confirmed.",
  strongestEvidence: ["Treasury flows match the disclosure."],
  highestRisks: ["Recovery signer is unresolved."],
  unresolvedQuestions: ["Who controls recovery?"],
  changeConditions: ["Verified signer disclosure."],
  nextActions: ["Verify the signer."],
};

const reportCase = {
  id: CASE_ID,
  kind: "token",
  canonical_ref: "0x00000000000000000000000000000000000000aa",
  display_query: "$ARGUS",
  status: "open",
  updated_at: "2026-07-11T02:00:00.000Z",
};

const version = {
  id: VERSION_ID,
  version: 4,
  verdict: "CAUTION",
  score: 62,
  completeness_state: "partial",
  attestation_state: "server_collected",
  methodology_version: "v4",
  contributor_label: "Kyle",
  created_at: "2026-07-11T01:50:00.000Z",
};

const briefHead = {
  case_id: CASE_ID,
  anchor_report_version_id: OLD_VERSION_ID,
  revision: 2,
  recommendation: "monitor",
  assignee_user_id: USER_ID,
  assignee_label: "Kyle at assignment time",
  due_at: null,
  content,
  created_by: USER_ID,
  created_by_label: "Kyle at decision time",
  created_at: "2026-07-11T01:00:00.000Z",
  updated_by: USER_ID,
  updated_by_label: "Kyle at decision time",
  updated_at: "2026-07-11T01:30:00.000Z",
};

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
  ended: boolean;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {}, ended: false };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    end() { captured.ended = true; return this; },
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(
  method: string,
  options: { query?: Record<string, string>; body?: unknown; origin?: string } = {},
): VercelRequest {
  return {
    method,
    query: options.query ?? {},
    body: options.body,
    headers: options.origin ? { origin: options.origin } : {},
  } as unknown as VercelRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

function viewerFetch(options: {
  status?: "open" | "archived";
  projectionId?: string | null;
  publishedVersionId?: string | null;
} = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/v1/cases?")) {
      return jsonResponse([{ ...reportCase, status: options.status ?? reportCase.status }]);
    }
    if (url.endsWith("/rest/v1/rpc/get_case_brief_snapshot")) {
      expect(JSON.parse(String(init?.body))).toEqual({
        p_organization_id: "00000000-0000-4000-8000-000000000001",
        p_actor_user_id: USER_ID,
        p_case_id: CASE_ID,
      });
      const status = options.status ?? reportCase.status;
      const currentId = status === "open"
        ? options.projectionId === undefined ? VERSION_ID : options.projectionId
        : options.publishedVersionId === undefined ? VERSION_ID : options.publishedVersionId;
      return jsonResponse({
        case: {
          ...reportCase,
          status,
          current_report_version_id: currentId,
        },
        viewer: { user_id: USER_ID, role: "owner", can_edit: status === "open" },
        current_version: currentId ? { ...version, id: currentId } : null,
        anchor_versions: [
          ...(currentId ? [{ ...version, id: currentId }] : []),
          {
            ...version,
            id: OLD_VERSION_ID,
            version: 2,
            verdict: "PASS",
            score: 78,
            created_at: "2026-07-10T21:00:00.000Z",
          },
        ],
        brief: briefHead,
        revisions: [{ id: NOTE_ID, ...briefHead, created_at: briefHead.updated_at }],
        has_older_revisions: false,
        notes: [{
          id: NOTE_ID,
          case_id: CASE_ID,
          client_id: CLIENT_ID,
          body: "Signer outreach started.",
          created_by: USER_ID,
          created_by_label: "Kyle at note time",
          created_at: "2026-07-11T01:45:00.000Z",
        }],
        has_older_notes: false,
        assignees: [{ user_id: USER_ID, display_name: "Kyle", role: "owner" }],
      });
    }
    if (url.includes("/rest/v1/report_versions?select=id&")) {
      return jsonResponse([{ id: OLD_VERSION_ID }]);
    }
    throw new Error(`Unexpected fetch ${url}`);
  });
}

describe("Case Brief API", () => {
  beforeEach(() => {
    vi.mocked(requireArgusAuth).mockClear();
    delete process.env.ARGUS_CORS_ORIGINS;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an organization-scoped viewer by exact case id", async () => {
    const fetchMock = viewerFetch();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { caseId: CASE_ID } }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "viewer");
    expect(captured.statusCode).toBe(200);
    expect(captured.headers["cache-control"]).toBe("private, no-store");
    expect(captured.body).toMatchObject({
      case: { caseId: CASE_ID, currentReportVersionId: VERSION_ID },
      currentVersion: { reportVersionId: VERSION_ID, version: 4 },
      anchorVersions: expect.arrayContaining([
        expect.objectContaining({ reportVersionId: OLD_VERSION_ID, version: 2 }),
      ]),
      brief: { revision: 2, assigneeDisplayName: "Kyle at assignment time", updatedByDisplayName: "Kyle at decision time" },
      hasNewEvidence: true,
      hasOlderRevisions: false,
      revisions: [{ revision: 2, assigneeDisplayName: "Kyle at assignment time", authorDisplayName: "Kyle at decision time" }],
      hasOlderNotes: false,
      notes: [{ body: "Signer outreach started.", authorDisplayName: "Kyle at note time" }],
      assignees: [{ userId: USER_ID, displayName: "Kyle", role: "owner" }],
      canEdit: true,
      currentUserId: USER_ID,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain(`id=eq.${CASE_ID}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain("organization_id=eq.00000000-0000-4000-8000-000000000001");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rpc/get_case_brief_snapshot"))).toBe(true);
    expect(JSON.stringify(captured.body)).not.toContain("email");
    expect(JSON.stringify(captured.body)).not.toContain("organizationId");
  });

  it("returns a settling response when an open case has no active projection", async () => {
    vi.stubGlobal("fetch", viewerFetch({ projectionId: null }));
    const { res, captured } = response();

    await handler(request("GET", { query: { caseId: CASE_ID } }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_version_pending", settling: true });
  });

  it("rejects a stale report view when its durable version was superseded", async () => {
    vi.stubGlobal("fetch", viewerFetch());
    const { res, captured } = response();

    await handler(request("GET", {
      query: { caseId: CASE_ID, expectedReportVersionId: OLD_VERSION_ID },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: "case_version_changed",
      currentVersion: { reportVersionId: VERSION_ID, version: 4 },
    });
  });

  it("uses the last published version rather than a raw latest row for archived cases", async () => {
    const fetchMock = viewerFetch({ status: "archived", projectionId: null });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { caseId: CASE_ID } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      case: { caseId: CASE_ID, status: "archived" },
      currentVersion: { reportVersionId: VERSION_ID },
      canEdit: false,
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/rpc/get_case_brief_snapshot"))).toBe(true);
  });

  it("paginates immutable revisions with their decision-basis metadata", async () => {
    const revisionRows = Array.from({ length: 11 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 400).padStart(12, "0")}`,
      ...briefHead,
      revision: 11 - index,
      created_at: `2026-07-10T${String(20 - index).padStart(2, "0")}:00:00.000Z`,
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.includes("/rest/v1/case_brief_revisions?")) return jsonResponse(revisionRows);
      if (url.includes("/rest/v1/report_versions?")) {
        return jsonResponse([{ ...version, id: OLD_VERSION_ID, version: 2 }]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", {
      query: { caseId: CASE_ID, history: "revisions", beforeRevision: "12" },
    }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({
      hasOlderRevisions: true,
      revisions: expect.arrayContaining([expect.objectContaining({ revision: 11 })]),
      anchorVersions: [expect.objectContaining({ reportVersionId: OLD_VERSION_ID, version: 2 })],
    });
    expect((captured.body as { revisions: unknown[] }).revisions).toHaveLength(10);
    expect(String(fetchMock.mock.calls[1][0])).toContain("revision=lt.12");
    expect(String(fetchMock.mock.calls[1][0])).toContain("limit=11");
  });

  it("uses a stable timestamp-and-id cursor for append-only notes", async () => {
    const noteRows = Array.from({ length: 21 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 500).padStart(12, "0")}`,
      case_id: CASE_ID,
      client_id: `00000000-0000-4000-8000-${String(index + 600).padStart(12, "0")}`,
      body: `Immutable note ${index + 1}`,
      created_by: USER_ID,
      created_by_label: "Kyle",
      created_at: "2026-07-10T12:00:00.000Z",
    }));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.includes("/rest/v1/case_notes?")) return jsonResponse(noteRows);
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", {
      query: {
        caseId: CASE_ID,
        history: "notes",
        beforeCreatedAt: "2026-07-10T12:00:00.000Z",
        beforeId: NOTE_ID,
      },
    }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ hasOlderNotes: true });
    expect((captured.body as { notes: unknown[] }).notes).toHaveLength(20);
    const pageCall = String(fetchMock.mock.calls[1][0]);
    expect(pageCall).toContain("order=created_at.desc,id.desc");
    expect(decodeURIComponent(pageCall)).toContain(`id.lt.${NOTE_ID}`);
  });

  it("rejects ticker/display fallback instead of resolving it", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { kind: "token", ref: "$ARGUS" } }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "exact_case_identity_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes only authenticated org and actor identity into the save RPC", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.includes("/rest/v1/report_versions?select=id&")) return jsonResponse([{ id: VERSION_ID }]);
      if (url.endsWith("/rest/v1/rpc/save_case_brief")) {
        const rpcBody = JSON.parse(String(init?.body));
        expect(rpcBody).toMatchObject({
          p_organization_id: "00000000-0000-4000-8000-000000000001",
          p_actor_user_id: USER_ID,
          p_case_id: CASE_ID,
          p_expected_revision: 2,
          p_anchor_report_version_id: VERSION_ID,
          p_allow_reanchor: true,
        });
        expect(rpcBody).not.toHaveProperty("organizationId");
        expect(rpcBody).not.toHaveProperty("actorUserId");
        return jsonResponse([{ ...briefHead, anchor_report_version_id: VERSION_ID, revision: 3 }]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        caseId: CASE_ID,
        expectedRevision: 2,
        anchorReportVersionId: VERSION_ID,
        reanchor: true,
        recommendation: "monitor",
        assigneeUserId: null,
        dueAt: null,
        content,
      },
    }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "analyst");
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ brief: { revision: 3, anchorReportVersionId: VERSION_ID } });
  });

  it("returns the current brief on optimistic revision conflict", async () => {
    const baseFetch = viewerFetch();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/report_versions?select=id&")) return jsonResponse([{ id: VERSION_ID }]);
      if (url.endsWith("/rest/v1/rpc/save_case_brief")) {
        return jsonResponse({ code: "40001", message: "case brief revision conflict" }, 409);
      }
      return await baseFetch(input, init);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        caseId: CASE_ID,
        expectedRevision: 1,
        anchorReportVersionId: VERSION_ID,
        recommendation: "monitor",
        assigneeUserId: null,
        dueAt: null,
        content,
      },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({
      error: "case_brief_revision_conflict",
      currentBrief: { revision: 2, anchorReportVersionId: OLD_VERSION_ID },
    });
  });

  it("maps a published-anchor race to a stable 409", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.includes("/rest/v1/report_versions?select=id&")) return jsonResponse([{ id: VERSION_ID }]);
      if (url.endsWith("/rest/v1/rpc/save_case_brief")) {
        return jsonResponse({
          code: "22023",
          message: "case brief anchor must be current active report version",
        }, 400);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        caseId: CASE_ID,
        expectedRevision: 2,
        anchorReportVersionId: VERSION_ID,
        recommendation: "monitor",
        assigneeUserId: null,
        dueAt: null,
        content,
      },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_brief_anchor_conflict" });
  });

  it("rejects an inactive assignee before the save RPC", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.includes("/rest/v1/report_versions?select=id&")) return jsonResponse([{ id: VERSION_ID }]);
      if (url.includes("/rest/v1/argus_members?select=user_id&")) return jsonResponse([]);
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        caseId: CASE_ID,
        expectedRevision: 2,
        anchorReportVersionId: VERSION_ID,
        recommendation: "monitor",
        assigneeUserId: USER_ID,
        dueAt: null,
        content,
      },
    }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "invalid_case_assignee" });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rpc/save_case_brief"))).toBe(false);
  });

  it("rejects archived brief edits before the save RPC", async () => {
    const method = "PATCH" as const;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([{ ...reportCase, status: "archived" }]);
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();
    const body = {
      caseId: CASE_ID,
      expectedRevision: 2,
      anchorReportVersionId: VERSION_ID,
      recommendation: "monitor",
      assigneeUserId: null,
      dueAt: null,
      content,
    };

    await handler(request(method, { body }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_archived" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forwards an idempotent note id and returns its snapshot actor label", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([reportCase]);
      if (url.endsWith("/rest/v1/rpc/append_case_note")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          p_organization_id: "00000000-0000-4000-8000-000000000001",
          p_actor_user_id: USER_ID,
          p_case_id: CASE_ID,
          p_client_id: CLIENT_ID,
          p_body: "Signer confirmed.",
        });
        return jsonResponse([{
          id: NOTE_ID,
          case_id: CASE_ID,
          client_id: CLIENT_ID,
          body: "Signer confirmed.",
          created_by: USER_ID,
          created_by_label: "Kyle at note time",
          created_at: "2026-07-11T03:00:00.000Z",
        }]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: { caseId: CASE_ID, clientId: CLIENT_ID, body: "Signer confirmed." },
    }), res);

    expect(captured.statusCode).toBe(201);
    expect(captured.body).toMatchObject({
      note: { clientId: CLIENT_ID, authorDisplayName: "Kyle at note time" },
    });
  });

  it("recovers an exact note retry after the case was archived", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([{ ...reportCase, status: "archived" }]);
      if (url.endsWith("/rest/v1/rpc/append_case_note")) {
        return jsonResponse([{
          id: NOTE_ID,
          case_id: CASE_ID,
          client_id: CLIENT_ID,
          body: "Signer confirmed.",
          created_by: USER_ID,
          created_by_label: "Kyle at note time",
          created_at: "2026-07-11T03:00:00.000Z",
        }]);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: { caseId: CASE_ID, clientId: CLIENT_ID, body: "Signer confirmed." },
    }), res);

    expect(captured.statusCode).toBe(201);
    expect(captured.body).toMatchObject({ note: { id: NOTE_ID, clientId: CLIENT_ID } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a genuinely new note on an archived case", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/rest/v1/cases?")) return jsonResponse([{ ...reportCase, status: "archived" }]);
      if (url.endsWith("/rest/v1/rpc/append_case_note")) {
        return jsonResponse({ code: "55000", message: "archived cases cannot receive case notes" }, 500);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: { caseId: CASE_ID, clientId: CLIENT_ID, body: "New archived note." },
    }), res);

    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_archived" });
  });

  it("rejects notes that exceed the UTF-8 byte ceiling before storage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: { caseId: CASE_ID, clientId: CLIENT_ID, body: "🧪".repeat(3_000) },
    }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "invalid_case_note" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes PATCH CORS only to configured origins", async () => {
    process.env.ARGUS_CORS_ORIGINS = "https://partner.example";
    const { res, captured } = response();

    await handler(request("OPTIONS", { origin: "https://partner.example" }), res);

    expect(captured.statusCode).toBe(204);
    expect(captured.headers["access-control-allow-origin"]).toBe("https://partner.example");
    expect(captured.headers["access-control-allow-methods"]).toContain("PATCH");
    expect(requireArgusAuth).not.toHaveBeenCalled();
  });
});
