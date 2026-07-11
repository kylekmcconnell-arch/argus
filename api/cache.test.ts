import { afterEach, describe, expect, it, vi } from "vitest";
import { attachPanelCost, cacheGetJson, cacheSetJson } from "./_cache.js";

const originalUrl = process.env.SUPABASE_URL;
const originalSecret = process.env.SUPABASE_SECRET_KEY;

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (originalUrl == null) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalUrl;
  if (originalSecret == null) delete process.env.SUPABASE_SECRET_KEY;
  else process.env.SUPABASE_SECRET_KEY = originalSecret;
});

describe("service-only provider cache", () => {
  it("reads an unexpired value from provider_cache", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const value = { subject: "alice", signals: 4 };
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{
      payload: { value },
      expires_at: "2099-01-01T00:00:00.000Z",
    }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(cacheGetJson("identity:alice")).resolves.toEqual(value);

    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/rest/v1/provider_cache?select=payload,expires_at");
    expect(String(url)).toContain("cache_key=eq.gj%3A");
    expect(options?.headers).not.toHaveProperty("authorization");
  });

  it("rejects expired cache entries", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse([{
      payload: { value: { stale: true } },
      expires_at: "2000-01-01T00:00:00.000Z",
    }])));

    await expect(cacheGetJson("identity:alice")).resolves.toBeNull();
  });

  it("upserts values by opaque cache key with a 24-hour expiry", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const now = Date.parse("2026-07-10T12:00:00.000Z");
    vi.spyOn(Date, "now").mockReturnValue(now);
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await cacheSetJson("identity:alice", { verified: true });

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://database.example/rest/v1/provider_cache?on_conflict=cache_key");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toMatchObject({
      apikey: "sb_secret_test",
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    expect(options?.headers).not.toHaveProperty("authorization");
    const body = JSON.parse(String(options?.body));
    expect(body).toMatchObject({
      payload: { value: { verified: true } },
      expires_at: "2026-07-11T12:00:00.000Z",
      updated_at: "2026-07-10T12:00:00.000Z",
    });
    expect(body.cache_key).toMatch(/^gj:[0-9a-f]{40}$/);
  });
});

describe("post-report cost ledger", () => {
  it("attributes a panel line to the exact organization and immutable version", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await attachPanelCost(
      "org-1",
      versionId,
      { provider: "claude", op: "panel:pfp-check", calls: 1, usd: 0.123456, meta: "vision" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/upsert_report_cost_line");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      p_organization_id: "org-1",
      p_report_version_id: versionId,
      p_provider: "claude",
      p_operation: "panel:pfp-check",
      p_calls: 1,
      p_usd: 0.1235,
      p_meta: "vision",
    });
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("authorization");
  });

  it("never guesses a report version from a subject reference", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await attachPanelCost(
      "org-1",
      "0x1111111111111111111111111111111111111111",
      { provider: "grok", op: "panel:namesake", calls: 1, usd: 0.2 },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
