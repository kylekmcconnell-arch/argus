import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string, extra?: Record<string, string>) => ({ apikey: key, ...extra })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import handler from "./augment";

function response() {
  const captured: { status?: number; body?: unknown; allow?: string; cacheControl?: string } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    setHeader(name: string, value: string) {
      if (name.toLowerCase() === "allow") captured.allow = value;
      if (name.toLowerCase() === "cache-control") captured.cacheControl = value;
      return this;
    },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("augmentation API tenant isolation", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset();
    serviceCredentials.mockReset();
    serviceHeaders.mockClear();
    serviceCredentials.mockReturnValue({ url: "https://database.example", key: "service-key" });
    vi.stubEnv("ARGUS_ADMIN_SECRET", "admin-secret");
    vi.stubEnv("ARGUS_EDIT_WEBHOOK", "");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("ARGUS_ADMIN_EMAIL", "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects unsupported methods before authentication", async () => {
    const { res, captured } = response();
    await handler({ method: "POST", query: {} } as never, res as never);

    expect(captured).toMatchObject({ status: 405, allow: "GET", body: { error: "method_not_allowed" } });
    expect(requireArgusAuth).not.toHaveBeenCalled();
  });

  it("scopes viewer reads to the authenticated organization", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-a", displayName: "Viewer A" });
    const fetchMock = vi.fn().mockResolvedValue(json([{
      payload: { items: [{ id: "one", type: "website", value: "a.example", label: "a.example", by: "Analyst", at: 1 }] },
    }]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET", query: { subject: "Alice" } } as never, res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "viewer");
    expect(String(fetchMock.mock.calls[0][0])).toContain("organization_id=eq.org-a");
    expect(String(fetchMock.mock.calls[0][0])).toContain("ref=eq.aug%3Aalice");
    expect(captured).toMatchObject({ status: 200, cacheControl: "private, no-store" });
  });

  it("scopes owner pending review to one organization", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-b", displayName: "Owner B" });
    const fetchMock = vi.fn().mockResolvedValue(json([]));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET", query: { action: "pending-all", secret: "admin-secret" } } as never, res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "owner");
    expect(String(fetchMock.mock.calls[0][0])).toContain("organization_id=eq.org-b");
    expect(captured).toMatchObject({ status: 200, body: { ok: true, pending: [] } });
  });

  it("stores a verified submission in the analyst organization with server-owned attribution", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-a", displayName: "Real Analyst" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockResolvedValueOnce(json([]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({
      method: "GET",
      query: { subject: "Alice", type: "x", value: "@Alice", by: "Spoofed Name" },
    } as never, res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "analyst");
    expect(String(fetchMock.mock.calls[1][0])).toContain("organization_id=eq.org-a");
    expect(String(fetchMock.mock.calls[2][0])).toContain("on_conflict=organization_id,ref,kind");
    const saved = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(saved.organization_id).toBe("org-a");
    expect(saved.payload.items[0]).toMatchObject({ by: "Real Analyst", status: "pending" });
    expect(captured.status).toBe(200);
  });

  it("does not touch storage when authentication fails", async () => {
    requireArgusAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res } = response();

    await handler({ method: "GET", query: { subject: "Alice" } } as never, res as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
