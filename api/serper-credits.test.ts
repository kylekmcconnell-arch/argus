import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireArgusAuth, serviceCredentials, serviceHeaders } = vi.hoisted(() => ({
  requireArgusAuth: vi.fn(),
  serviceCredentials: vi.fn(),
  serviceHeaders: vi.fn((key: string) => ({ apikey: key })),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth, serviceCredentials, serviceHeaders }));

import handler, { parseSerperRemaining } from "./serper-credits";

const ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const USER_ID = "00000000-0000-4000-8000-000000000010";

function response() {
  const captured: { status?: number; body?: Record<string, unknown>; headers: Record<string, string> } = { headers: {} };
  const res = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return this; },
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return this; },
  };
  return { res, captured };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function assertNeverSearch(fetchMock: ReturnType<typeof vi.fn>) {
  for (const [input] of fetchMock.mock.calls) {
    expect(String(input)).not.toContain("/search");
  }
}

describe("parseSerperRemaining", () => {
  it("reads remaining, creditsLeft, balance, or credits and ignores unknown shapes", () => {
    expect(parseSerperRemaining({ remaining: 49123 })).toBe(49123);
    expect(parseSerperRemaining({ creditsLeft: "12" })).toBe(12);
    expect(parseSerperRemaining({ account: { balance: 9 } })).toBe(9);
    expect(parseSerperRemaining({ credits: 50000 })).toBe(50000);
    expect(parseSerperRemaining({ message: "Unauthorized" })).toBeNull();
    expect(parseSerperRemaining({ organic: [] })).toBeNull();
    expect(parseSerperRemaining(null)).toBeNull();
  });
});

describe("GET /api/serper-credits", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset().mockResolvedValue({ organizationId: ORGANIZATION_ID, userId: USER_ID });
    serviceCredentials.mockReset().mockReturnValue({ url: "https://database.example", key: "service-secret" });
    serviceHeaders.mockClear();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("parses live remaining from Serper JSON and never calls /search", async () => {
    vi.stubEnv("SERPER_API_KEY", "test-serper-key");
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://google.serper.dev/credits") {
        return Promise.resolve(json({ remaining: 49123 }));
      }
      if (url.includes("/provider_usage_events?")) return Promise.resolve(json([]));
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.headers["cache-control"]).toBe("no-store");
    expect(captured.body).toMatchObject({
      configured: true,
      remaining: 49123,
      remainingSource: "serper",
      remainingEstimate: 50000,
      usedSinceLatestPurchase: 0,
      dashboardUrl: "https://serper.dev/dashboard",
    });
    const purchases = captured.body?.purchases as Array<Record<string, unknown>>;
    expect(purchases[0]).toMatchObject({
      usd: 50,
      credits: 50000,
      pack: "Starter",
      active: true,
    });
    expect(String(purchases[0]?.purchasedAt)).toContain("2026-08-19");
    const probe = fetchMock.mock.calls.find(([input]) => String(input) === "https://google.serper.dev/credits");
    expect(probe?.[1]).toMatchObject({ method: "GET", headers: { "X-API-KEY": "test-serper-key" } });
    assertNeverSearch(fetchMock);
  });

  it("falls back to an estimate when Serper returns 403 or unknown JSON", async () => {
    vi.stubEnv("SERPER_API_KEY", "test-serper-key");
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://google.serper.dev/")) {
        if (url.endsWith("/credits")) return Promise.resolve(new Response("Unauthorized", { status: 403 }));
        if (url.endsWith("/account")) return Promise.resolve(json({ message: "Unauthorized" }));
        return Promise.resolve(json({ organic: [] }));
      }
      if (url.includes("/provider_usage_events?")) {
        return Promise.resolve(json([{
          calls: 12,
          created_at: "2026-08-19T17:00:00.000Z",
          status: "succeeded",
          provider: "serper",
        }]));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      configured: true,
      remaining: null,
      remainingSource: "estimated",
      remainingEstimate: 49988,
      usedSinceLatestPurchase: 12,
    });
    expect(captured.body?.error).toEqual(expect.any(String));
    expect(String(captured.body?.error)).not.toContain("test-serper-key");
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("https://google.serper.dev/"))).toBe(true);
    assertNeverSearch(fetchMock);
  });

  it("omits the estimate when usage storage is unavailable", async () => {
    vi.stubEnv("SERPER_API_KEY", "test-serper-key");
    serviceCredentials.mockReturnValue(null);
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://google.serper.dev/")) {
        return Promise.resolve(new Response("Unauthorized", { status: 403 }));
      }
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(captured.body).toMatchObject({
      remaining: null,
      remainingSource: "unavailable",
      remainingEstimate: null,
      usedSinceLatestPurchase: null,
    });
    assertNeverSearch(fetchMock);
  });

  it("returns purchases when the key is missing and does not probe Serper", async () => {
    vi.stubEnv("SERPER_API_KEY", "");
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/provider_usage_events?")) return Promise.resolve(json([]));
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { res, captured } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(captured.status).toBe(200);
    expect(captured.body).toMatchObject({
      configured: false,
      remaining: null,
      dashboardUrl: "https://serper.dev/dashboard",
    });
    const purchases = captured.body?.purchases as Array<Record<string, unknown>>;
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ pack: "Starter", credits: 50000, usd: 50 });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("serper.dev"))).toBe(false);
    assertNeverSearch(fetchMock);
  });

  it("stops when authentication fails", async () => {
    requireArgusAuth.mockResolvedValue(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { res } = response();

    await handler({ method: "GET" } as never, res as never);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
