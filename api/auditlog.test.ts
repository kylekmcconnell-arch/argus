import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string, extra?: Record<string, string>) => ({
    apikey: key,
    ...extra,
  })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import handler from "./auditlog";

function response() {
  const captured: { status?: number; body?: unknown } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    setHeader() { return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

describe("audit log reconciliation", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({
      organizationId: "00000000-0000-4000-8000-000000000001",
      userId: "owner-user",
      displayName: "Kyle",
      role: "owner",
    });
    serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "service-key" });
    serviceHeaders.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("patches a foreign analyst row without falling through to a contributor-less insert", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({
      method: "POST",
      body: {
        mode: "update",
        client_id: "other-user:report-1",
        id: "report-1",
        kind: "person",
        query: "@strategicsuperr",
        verdict: "INCOMPLETE",
        score: null,
      },
    } as never, res as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("organization_id=eq.00000000-0000-4000-8000-000000000001");
    expect(String(url)).toContain("client_id=eq.other-user%3Areport-1");
    expect(init).toMatchObject({ method: "PATCH" });
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty("organization_id");
    expect(body).not.toHaveProperty("client_id");
    expect(body).not.toHaveProperty("contributor");
    expect(body).not.toHaveProperty("contributor_user_id");
    expect(body).toMatchObject({ kind: "person", query: "@strategicsuperr", verdict: "INCOMPLETE", score: null });
    expect(captured).toEqual({
      status: 200,
      body: { ok: true, clientId: "other-user:report-1" },
    });
  });
});
