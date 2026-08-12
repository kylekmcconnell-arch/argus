import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheGet, cacheSet } from "./cache";
import { getCost, withCostLedger } from "./cost";

const originalEnv = {
  url: process.env.SUPABASE_URL,
  secret: process.env.SUPABASE_SECRET_KEY,
  role: process.env.SUPABASE_SERVICE_ROLE_KEY,
  legacy: process.env.SUPABASE_SERVICE_KEY,
};

function restore(name: string, value: string | undefined): void {
  if (value == null) delete process.env[name];
  else process.env[name] = value;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restore("SUPABASE_URL", originalEnv.url);
  restore("SUPABASE_SECRET_KEY", originalEnv.secret);
  restore("SUPABASE_SERVICE_ROLE_KEY", originalEnv.role);
  restore("SUPABASE_SERVICE_KEY", originalEnv.legacy);
});

describe("orchestrator provider cache", () => {
  it("reads an unexpired text entry and records a zero-cost hit", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{
      payload: { text: "public provider result" },
      expires_at: "2099-01-01T00:00:00.000Z",
    }]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await withCostLedger(async () => ({
      value: await cacheGet("x:alice"),
      cost: getCost(),
    }));

    expect(result.value).toBe("public provider result");
    expect(result.cost.calls).toContainEqual(expect.objectContaining({
      provider: "cache",
      op: "grok-hit",
      calls: 1,
      cached: 1,
      status: "cached",
      usd: 0,
    }));
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/provider_cache?select=payload,expires_at");
    expect(options?.headers).not.toHaveProperty("authorization");
  });

  it("writes text entries with an exact 24-hour expiry", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await cacheSet("x:alice", "public provider result");

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://database.example/rest/v1/provider_cache?on_conflict=cache_key");
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      payload: { text: "public provider result" },
      expires_at: "2026-07-11T12:00:00.000Z",
      updated_at: "2026-07-10T12:00:00.000Z",
    });
    expect(body.cache_key).toMatch(/^gt:[0-9a-f]{40}$/);
  });

  it("ignores expired entries", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([{
      payload: { text: "stale" },
      expires_at: "2000-01-01T00:00:00.000Z",
    }])));

    await expect(cacheGet("x:alice")).resolves.toBeNull();
  });
});
