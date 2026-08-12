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

import handler from "./alerts";

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

describe("alerts API tenant isolation", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset();
    serviceCredentials.mockReset();
    serviceHeaders.mockClear();
    serviceCredentials.mockReturnValue({ url: "https://database.example", key: "service-key" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects unsupported methods before authentication or storage work", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "POST" } as never, res as never);

    expect(captured).toMatchObject({
      status: 405,
      allow: "GET, DELETE",
      body: { error: "method_not_allowed" },
    });
    expect(requireArgusAuth).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not touch storage when viewer authentication fails", async () => {
    requireArgusAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "viewer");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("scopes alert reads to the authenticated organization", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-a" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([{
      ref: "al:one",
      ts: "2026-07-11T00:00:00.000Z",
      payload: { subject: "subject-a", detail: "changed" },
    }]), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("organization_id=eq.org-a");
    expect(String(url)).toContain("kind=eq.alert");
    expect(captured).toMatchObject({
      status: 200,
      cacheControl: "private, no-store",
      body: {
        available: true,
        alerts: [{
          ref: "al:one",
          ts: "2026-07-11T00:00:00.000Z",
          subject: "subject-a",
          detail: "changed",
        }],
      },
    });
  });

  it("scopes destructive dismissal to an authenticated analyst organization", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-b" });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "DELETE", query: { ref: "al:shared ref" } } as never, res as never);

    expect(requireArgusAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), "analyst");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("organization_id=eq.org-b");
    expect(String(url)).toContain("ref=eq.al%3Ashared%20ref");
    expect(init).toMatchObject({ method: "DELETE" });
    expect(captured).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("does not pretend a failed upstream delete succeeded", async () => {
    requireArgusAuth.mockResolvedValue({ organizationId: "org-b" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { res, captured } = response();

    await handler({ method: "DELETE", query: { ref: "al:one" } } as never, res as never);

    expect(captured).toMatchObject({
      status: 502,
      body: { ok: false, error: "alert_delete_failed" },
    });
  });
});
