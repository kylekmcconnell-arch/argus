import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest, VercelResponse } from "@vercel/node";

vi.mock("./_auth.js", () => ({
  requireArgusAuth: vi.fn(async () => ({
    userId: "00000000-0000-4000-8000-000000000010",
    email: "analyst@example.com",
    organizationId: "00000000-0000-4000-8000-000000000001",
    role: "analyst",
    displayName: "Analyst",
  })),
  serviceCredentials: vi.fn(() => ({ url: "https://database.example", key: "test-service-key" })),
  serviceHeaders: vi.fn(() => ({ "content-type": "application/json" })),
}));

import handler from "./share";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const CASE_ID = "00000000-0000-4000-8000-000000000101";
const HISTORICAL_VERSION_ID = "00000000-0000-4000-8000-000000000201";

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

function request(body: unknown): VercelRequest {
  return { method: "POST", body, headers: {} } as unknown as VercelRequest;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("exact immutable report sharing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("rejects a malformed requested version before querying storage", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request({ kind: "person", ref: "@Alice", reportVersionId: "latest" }), res);

    expect(captured.statusCode).toBe(400);
    expect(captured.body).toEqual({
      error: "invalid_report_version",
      message: "A valid immutable report version is required.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shares the requested historical version after exact tenant and subject validation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ id: HISTORICAL_VERSION_ID, case_id: CASE_ID }]))
      .mockResolvedValueOnce(jsonResponse([{ kind: "person", canonical_ref: "alice" }]))
      .mockResolvedValueOnce(jsonResponse(null, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request({
      kind: "person",
      ref: "@Alice",
      reportVersionId: HISTORICAL_VERSION_ID,
    }), res);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/report_versions?");
    expect(String(fetchMock.mock.calls[0][0])).toContain(`id=eq.${HISTORICAL_VERSION_ID}`);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`/rest/v1/cases?select=kind,canonical_ref&id=eq.${CASE_ID}`);
    expect(String(fetchMock.mock.calls[1][0])).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("/rest/v1/reports?");

    const inserted = JSON.parse(String(fetchMock.mock.calls[2][1]?.body)) as Record<string, unknown>;
    expect(inserted).toMatchObject({
      organization_id: ORGANIZATION_ID,
      report_version_id: HISTORICAL_VERSION_ID,
      created_by: USER_ID,
      expires_at: "2026-08-10T12:00:00.000Z",
    });
    expect(inserted.token_hash).toEqual(expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(captured.statusCode).toBe(201);
    expect(captured.body).toMatchObject({
      url: expect.stringMatching(/^\/api\/card\?share=/),
      expiresAt: "2026-08-10T12:00:00.000Z",
    });
  });

  it("does not create a link when the version belongs to a different subject", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ id: HISTORICAL_VERSION_ID, case_id: CASE_ID }]))
      .mockResolvedValueOnce(jsonResponse([{ kind: "token", canonical_ref: "0x00000000000000000000000000000000000000aa" }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request({
      kind: "person",
      ref: "alice",
      reportVersionId: HISTORICAL_VERSION_ID,
    }), res);

    expect(captured.statusCode).toBe(404);
    expect(captured.body).toMatchObject({ error: "shareable_report_not_found" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps resolving the current projection when no version is requested", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ report_version_id: HISTORICAL_VERSION_ID }]))
      .mockResolvedValueOnce(jsonResponse([{ id: HISTORICAL_VERSION_ID, case_id: CASE_ID }]))
      .mockResolvedValueOnce(jsonResponse([{ kind: "person", canonical_ref: "alice" }]))
      .mockResolvedValueOnce(jsonResponse(null, 201));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler(request({ kind: "person", ref: "@Alice" }), res);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/v1/reports?");
    expect(String(fetchMock.mock.calls[0][0])).toContain("kind=eq.person");
    expect(String(fetchMock.mock.calls[0][0])).toContain("ref=eq.alice");
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toMatchObject({
      report_version_id: HISTORICAL_VERSION_ID,
    });
    expect(captured.statusCode).toBe(201);
  });
});
