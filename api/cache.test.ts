import { afterEach, describe, expect, it, vi } from "vitest";
import {
  attachPanelCost,
  cacheGetJson,
  cacheSetJson,
  recordProviderUsageBatch,
  recordProviderUsageEvent,
} from "./_cache.js";

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
  it("appends a panel event to the exact organization and immutable version", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await attachPanelCost(
      organizationId,
      versionId,
      { provider: "claude", op: "panel:pfp-check", calls: 1, usd: 0.123456, meta: "vision" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/record_provider_usage_event");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      p_organization_id: organizationId,
      p_report_version_id: versionId,
      p_provider: "claude",
      p_operation: "panel:pfp-check",
      p_calls: 1,
      p_usd: 0.123456,
      p_initiated_by: null,
      p_status: "succeeded",
      p_meta: "vision",
    });
    expect(body.p_idempotency_key).toMatch(/^api:[0-9a-f-]{36}$/);
    expect(fetchMock.mock.calls[0][1]?.headers).not.toHaveProperty("authorization");
  });

  it("generates a distinct idempotency key for each distinct helper invocation", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(null, 204))
      .mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    const line = { provider: "grok", op: "panel:namesake", calls: 1, usd: 0.01 };
    await recordProviderUsageEvent(organizationId, versionId, line);
    await recordProviderUsageEvent(organizationId, versionId, line);

    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const second = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.p_idempotency_key).toMatch(/^api:[0-9a-f-]{36}$/);
    expect(second.p_idempotency_key).toMatch(/^api:[0-9a-f-]{36}$/);
    expect(first.p_idempotency_key).not.toBe(second.p_idempotency_key);
  });

  it("retries a transient accounting failure with the same immutable event key", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse(null, 204));
    vi.stubGlobal("fetch", fetchMock);

    await recordProviderUsageEvent(organizationId, versionId, {
      provider: "twitterapi",
      op: "panel:x-find-profile",
      calls: 1,
      usd: 0.00000075,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const first = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const retry = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(first.p_usd).toBe(0.00000075);
    expect(retry).toEqual(first);
  });

  it("never guesses a report version from a subject reference", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await attachPanelCost(
      "00000000-0000-4000-8000-000000000001",
      "0x1111111111111111111111111111111111111111",
      { provider: "grok", op: "panel:namesake", calls: 1, usd: 0.2 },
    );

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a core audit batch with stable exact-version event keys", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const actorId = "00000000-0000-4000-8000-000000000010";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "temporary" }, 503))
      .mockResolvedValueOnce(jsonResponse([{ event_count: 2 }], 200));
    vi.stubGlobal("fetch", fetchMock);

    await recordProviderUsageBatch(organizationId, versionId, actorId, [
      { provider: "grok", op: "live-search", calls: 2, usd: 0.123456789, status: "partial", meta: "one retry" },
      { provider: "claude", op: "record_claims", calls: 1, usd: 0.01, status: "succeeded" },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://database.example/rest/v1/rpc/record_provider_usage_batch");
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(retryBody).toEqual(firstBody);
    expect(firstBody).toMatchObject({
      p_organization_id: organizationId,
      p_report_version_id: versionId,
      p_initiated_by: actorId,
      p_lines: [
        {
          provider: "grok",
          operation: "live-search",
          calls: 2,
          usd: 0.12345679,
          status: "partial",
          meta: "one retry",
        },
        {
          provider: "claude",
          operation: "record_claims",
          calls: 1,
          usd: 0.01,
          status: "succeeded",
          meta: null,
        },
      ],
    });
    for (const line of firstBody.p_lines) {
      expect(line.idempotency_key).toMatch(new RegExp(`^core:${versionId}:[0-9a-f]{40}$`));
    }
    expect(firstBody.p_lines[0].idempotency_key).not.toBe(firstBody.p_lines[1].idempotency_key);
  });

  it("rejects malformed or duplicate core audit lines before storage", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    const organizationId = "00000000-0000-4000-8000-000000000001";
    const versionId = "00000000-0000-4000-8000-000000000201";
    const actorId = "00000000-0000-4000-8000-000000000010";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(recordProviderUsageBatch(organizationId, versionId, actorId, []))
      .rejects.toThrow("valid provider usage batch required");
    await expect(recordProviderUsageBatch(organizationId, versionId, actorId, [
      { provider: "grok", op: "live-search", calls: 1, usd: 0.1 },
      { provider: "grok", op: "live-search", calls: 1, usd: 0.1 },
    ])).rejects.toThrow("duplicate provider usage batch line");
    await expect(recordProviderUsageBatch(organizationId, versionId, actorId, [
      { provider: "grok", op: "", calls: 1, usd: 0.1 },
    ])).rejects.toThrow("invalid provider usage batch line");
    await expect(recordProviderUsageBatch(organizationId, versionId, actorId, [
      { provider: "grok", op: "live-search", calls: 2_147_483_648, usd: 0.1 },
    ])).rejects.toThrow("invalid provider usage batch line");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when a core usage batch cannot be recorded", async () => {
    process.env.SUPABASE_URL = "https://database.example";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: "forbidden" }, 403)));

    await expect(recordProviderUsageBatch(
      "00000000-0000-4000-8000-000000000001",
      "00000000-0000-4000-8000-000000000201",
      "00000000-0000-4000-8000-000000000010",
      [{ provider: "claude", op: "analysis", calls: 1, usd: 0.01 }],
    )).rejects.toThrow("provider usage batch attribution failed (403)");
  });
});
