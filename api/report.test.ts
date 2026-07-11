import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "owner@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "owner",
    displayName: "Owner",
  })),
  serviceCredentials: vi.fn(() => ({ url: "https://database.example", key: "test-service-key" })),
  serviceHeaders: vi.fn(() => ({ "content-type": "application/json" })),
}));

vi.mock("./_provenance.js", () => ({
  persistProvenance: vi.fn(async () => undefined),
  activateReportVersion: vi.fn(async () => undefined),
}));

import { requireArgusAuth } from "./_auth.js";
import { activateReportVersion } from "./_provenance.js";
import handler from "./report";

interface CapturedResponse {
  statusCode: number;
  body: unknown;
  headers: Record<string, string>;
}

function response(): { res: VercelResponse; captured: CapturedResponse } {
  const captured: CapturedResponse = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code: number) { captured.statusCode = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
    setHeader(name: string, value: string) { captured.headers[name] = value; return this; },
  } as unknown as VercelResponse;
  return { res, captured };
}

function request(
  method: string,
  options: { query?: Record<string, string>; body?: unknown } = {},
): VercelRequest {
  return {
    method,
    query: options.query ?? {},
    body: options.body,
    headers: {},
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

describe("report case lifecycle API", () => {
  beforeEach(() => {
    vi.mocked(requireArgusAuth).mockClear();
    vi.mocked(activateReportVersion).mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires owner access and submits one normalized, deduplicated PATCH batch", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      { subject_kind: "person", subject_ref: "alice", case_status: "archived" },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        action: "archive",
        subjects: [
          { kind: "person", ref: "@Alice" },
          { kind: "person", ref: "alice" },
        ],
      },
    }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "owner");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/manage_case_lifecycle");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_action: "archive",
      p_subjects: [{ kind: "person", ref: "alice" }],
    });
    expect(captured.statusCode).toBe(200);
    expect(captured.body).toMatchObject({ ok: true, action: "archive" });
  });

  it("rejects invalid or oversized subject batches before touching storage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("PATCH", {
      body: {
        action: "archive",
        subjects: Array.from({ length: 51 }, (_, index) => ({ kind: "person", ref: `person-${index}` })),
      },
    }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({ error: "valid_action_and_subjects_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps watch deletion separate and analyst-authorized", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("DELETE", { query: { ref: "watch-1", kind: "watch" } }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "analyst");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/reports?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("kind=eq.watch");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
    expect(captured.body).toEqual({ ok: true, deleted: "watch" });
  });

  it("turns case DELETE into an archive RPC instead of deleting its projection", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("DELETE", { query: { ref: "@Alice", kind: "person" } }), res);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), res, "owner");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/manage_case_lifecycle");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
      p_action: "archive",
      p_subjects: [{ kind: "person", ref: "alice" }],
    });
    expect(captured.body).toMatchObject({ ok: true, action: "archive" });
  });

  it("relies on atomic immutable persistence without a second projection write", async () => {
    const address = "0x00000000000000000000000000000000000000aa";
    const versionId = "00000000-0000-4000-8000-000000000301";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{ report_version_id: versionId }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("POST", {
      body: { kind: "token", ref: address, query: "$TEST", payload: { address } },
    }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/persist_report_version");
    expect(activateReportVersion).toHaveBeenCalledWith(
      { url: "https://database.example", key: "test-service-key" },
      "00000000-0000-4000-8000-000000000001",
      versionId,
    );
    expect(captured.body).toEqual({ ok: true, reportVersionId: versionId });
  });

  it("maps archived cases from their latest immutable version", async () => {
    const caseId = "00000000-0000-4000-8000-000000000101";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        id: caseId,
        kind: "token",
        canonical_ref: "0xabc",
        display_query: "$ABC",
        updated_at: "2026-07-11T01:00:00.000Z",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        id: versionId,
        case_id: caseId,
        version: 2,
        verdict: "CAUTION",
        score: 54,
        completeness_state: "partial",
        attestation_state: "analyst_submitted",
        methodology_version: "v2",
        created_at: "2026-07-10T23:00:00.000Z",
        cost: { usd: 0.25 },
        contributor_label: "Kyle",
      }]))
      .mockResolvedValueOnce(jsonResponse([{
        report_version_id: versionId,
        provider: "grok",
        operation: "panel:namesake",
        calls: 1,
        usd: 0.1,
        meta: "cached search",
      }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { list: "1", status: "archived" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({
      available: true,
      reports: [{
        ref: "0xabc",
        kind: "token",
        query: "$ABC",
        contributor: "Kyle",
        verdict: "CAUTION",
        score: 54,
        ts: "2026-07-10T23:00:00.000Z",
        cost: {
          usd: 0.35,
          calls: [{ provider: "grok", op: "panel:namesake", calls: 1, usd: 0.1, meta: "cached search" }],
        },
        status: "archived",
        archivedAt: "2026-07-11T01:00:00.000Z",
        reportVersionId: versionId,
        completenessState: "partial",
        attestationState: "analyst_submitted",
        methodologyVersion: "v2",
        createdAt: "2026-07-10T23:00:00.000Z",
      }],
    });
  });

  it("returns an archived case state instead of treating a missing projection as a new subject", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{
        case_id: "00000000-0000-4000-8000-000000000101",
        subject_kind: "person",
        subject_ref: "alice",
        display_query: "@Alice",
        case_status: "archived",
      }]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([{ status: "archived" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { ref: "@Alice", kind: "person" } }), res);

    expect(captured.statusCode).toBe(200);
    expect(captured.body).toEqual({ available: true, report: null, caseStatus: "archived" });
  });

  it("resolves labels and legacy case-folded refs from durable cases", async () => {
    const canonical = "52hneKeDvX3QMpysYXERquicq3QXxfVChqsEtYaLpump";
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([{
      case_id: "00000000-0000-4000-8000-000000000101",
      subject_kind: "token",
      subject_ref: canonical,
      display_query: "$PEPEBULL",
      case_status: "archived",
      updated_at: "2026-07-11T01:00:00.000Z",
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { resolve: "$pepebull" } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/resolve_case_subject");
    expect(captured.body).toEqual({
      available: true,
      subjects: [{
        caseId: "00000000-0000-4000-8000-000000000101",
        kind: "token",
        ref: canonical,
        query: "$PEPEBULL",
        status: "archived",
        updatedAt: "2026-07-11T01:00:00.000Z",
      }],
    });
  });

  it("rejects a direct read when one label resolves to multiple contracts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([
      {
        case_id: "00000000-0000-4000-8000-000000000201",
        subject_kind: "token",
        subject_ref: "0x1111111111111111111111111111111111111111",
        display_query: "$SAME",
        case_status: "open",
      },
      {
        case_id: "00000000-0000-4000-8000-000000000202",
        subject_kind: "token",
        subject_ref: "0x2222222222222222222222222222222222222222",
        display_query: "$SAME",
        case_status: "open",
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request("GET", { query: { ref: "$SAME", kind: "token" } }), res);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(captured.statusCode).toBe(409);
    expect(captured.body).toMatchObject({ error: "case_subject_ambiguous" });
  });
});
