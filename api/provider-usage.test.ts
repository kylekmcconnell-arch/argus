import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string) => ({ apikey: key })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import handler from "./provider-usage";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_ID = "00000000-0000-4000-8000-000000000201";
const CASE_ID = "00000000-0000-4000-8000-000000000101";

function response() {
  const captured: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  return { res, captured };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("provider usage feed", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "service-secret" });
    serviceHeaders.mockClear();
    vi.unstubAllGlobals();
  });

  it("returns tenant-scoped events with exact report and analyst context", async () => {
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/provider_usage_events?")) return Promise.resolve(json([{
        id: "00000000-0000-4000-8000-000000000301",
        report_version_id: VERSION_ID,
        provider: "grok",
        operation: "live-search",
        calls: 2,
        usd: 0.125,
        status: "partial",
        meta: "http_400 · retry_ok",
        initiated_by: USER_ID,
        created_at: "2026-07-11T11:00:00.000Z",
      }]));
      if (url.includes("/rpc/get_provider_usage_summary")) return Promise.resolve(json([{
        event_count: "9",
        calls: "17",
        usd: 0.12500075,
      }]));
      if (url.includes("/report_versions?")) return Promise.resolve(json([{ id: VERSION_ID, case_id: CASE_ID, version: 4 }]));
      if (url.includes("/argus_members?")) return Promise.resolve(json([{ user_id: USER_ID, display_name: "Kyle" }]));
      if (url.includes("/cases?")) return Promise.resolve(json([{ id: CASE_ID, kind: "token", canonical_ref: "eip155:1:0xabc", display_query: "$ARG" }]));
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET", query: { limit: "20" } } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.headers["cache-control"]).toBe("no-store");
    expect(captured.body).toMatchObject({
      available: true,
      window: { limit: 20, eventCount: 1 },
      totals: { eventCount: 9, calls: 17, usd: 0.12500075 },
      events: [{
        reportVersionId: VERSION_ID,
        provider: "grok",
        operation: "live-search",
        status: "partial",
        actor: "Kyle",
        report: { kind: "token", ref: "eip155:1:0xabc", label: "$ARG", version: 4 },
      }],
    });
    const eventUrl = String(fetchMock.mock.calls[0][0]);
    expect(eventUrl).toContain(`organization_id=eq.${ORGANIZATION_ID}`);
    expect(eventUrl).toContain("limit=20");
    const summaryCall = fetchMock.mock.calls.find(([input]) => String(input).includes("/rpc/get_provider_usage_summary"));
    expect(summaryCall?.[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(summaryCall?.[1]?.body))).toEqual({
      p_organization_id: ORGANIZATION_ID,
      p_report_version_id: null,
    });
  });

  it("rejects a malformed report version before storage access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET", query: { reportVersionId: "not-a-version" } } as never, res as never);

    expect(captured.status).toBe(400);
    expect(captured.body).toEqual({ error: "invalid_report_version" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops when authentication fails", async () => {
    requireArgusAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res } = response();

    await handler({ method: "GET", query: {} } as never, res as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
