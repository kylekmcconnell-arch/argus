import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VercelRequest } from "@vercel/node";
import handler, {
  parseCoinGeckoQuota,
  parseGithubQuota,
  parseMonidBalance,
  parseOpenRouterKey,
  parseTwitterQuota,
  resetProviderBillingCache,
} from "./provider-billing";

function responseHarness() {
  const captured: { status?: number; body?: Record<string, unknown>; headers: Record<string, string> } = { headers: {} };
  const response = {
    setHeader(name: string, value: string) { captured.headers[name.toLowerCase()] = value; return response; },
    status(code: number) { captured.status = code; return response; },
    json(body: unknown) { captured.body = body as Record<string, unknown>; return response; },
  };
  return { captured, response };
}

function request(token = "feed-secret", method = "GET"): VercelRequest {
  return { method, headers: { authorization: `Bearer ${token}` } } as unknown as VercelRequest;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CHECKED_AT = "2026-08-23T12:00:00.000Z";

describe("provider billing parsers", () => {
  it("publishes only an exact USD Monid balance and does not net held funds", () => {
    expect(parseMonidBalance({
      balance: { value: 21.5, currency: "USD" },
      held: { value: 2, currency: "USD" },
    }, CHECKED_AT)).toMatchObject({
      state: "live",
      scope: "account",
      balanceUsd: 21.5,
      currency: "USD",
      checkedAt: CHECKED_AT,
      detail: expect.stringContaining("not netted"),
    });
    expect(parseMonidBalance({ balance: { value: 21.5, currency: "EUR" } }, CHECKED_AT)).toBeNull();
    expect(parseMonidBalance({ balance: { value: -1, currency: "USD" } }, CHECKED_AT)).toBeNull();
  });

  it("keeps OpenRouter key limits separate from exact monthly USD usage", () => {
    expect(parseOpenRouterKey({ data: {
      usage_monthly: 4.25,
      limit: 100,
      limit_remaining: 75,
    } }, CHECKED_AT)).toMatchObject({
      state: "live",
      scope: "api_key",
      spentMonthUsd: 4.25,
      currency: "USD",
      quota: { limit: 100, remaining: 75 },
    });
    expect(parseOpenRouterKey({ data: { limit: 100, limit_remaining: 75 } }, CHECKED_AT)).toBeNull();
  });

  it("reports GitHub, twitterapi.io, and CoinGecko as quota rather than USD", () => {
    expect(parseGithubQuota({ resources: { core: { limit: 5000, remaining: 4900, reset: 1_787_500_000 } } }, CHECKED_AT))
      .toMatchObject({ state: "configured_no_usage_api", scope: "quota", quota: { used: 100, limit: 5000, remaining: 4900 } });
    expect(parseTwitterQuota({ data: { recharge_credits: 1234 } }, CHECKED_AT))
      .toMatchObject({ state: "configured_no_usage_api", quota: { remaining: 1234, period: "provider_credits" } });
    expect(parseCoinGeckoQuota({ data: { plan: "Analyst", monthly_call_credit: 10000, current_total_monthly_calls: 250 } }, CHECKED_AT))
      .toMatchObject({ state: "configured_no_usage_api", plan: "Analyst", quota: { used: 250, limit: 10000, remaining: 9750 } });
  });
});

describe("GET /api/provider-billing", () => {
  beforeEach(() => {
    resetProviderBillingCache();
    vi.stubEnv("ARGUS_BILLING_FEED_TOKEN", "feed-secret");
    for (const name of [
      "XAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "TWITTERAPI_KEY", "X_API_BEARER",
      "GITHUB_TOKEN", "PDL_API_KEY", "COINGECKO_API_KEY", "CRYPTORANK_API_KEY", "MONID_API_KEY",
      "HELIUS_API_KEY", "ETHERSCAN_API_KEY", "ARKHAM_API_KEY", "GMGN_API_KEY", "GOOGLE_SAFE_BROWSING_KEY",
      "SERPER_API_KEY", "SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY",
    ]) vi.stubEnv(name, "");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails closed for an unset, missing, or mismatched feed token", async () => {
    for (const token of ["wrong", ""]) {
      const { captured, response } = responseHarness();
      const req = token ? request(token) : ({ method: "GET", headers: {} } as unknown as VercelRequest);
      await handler(req, response as never);
      expect(captured.status).toBe(401);
    }
    vi.stubEnv("ARGUS_BILLING_FEED_TOKEN", "");
    const { captured, response } = responseHarness();
    await handler(request(), response as never);
    expect(captured.status).toBe(401);
  });

  it("rejects mutation methods without calling a provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { captured, response } = responseHarness();
    await handler(request("feed-secret", "POST"), response as never);
    expect(captured.status).toBe(405);
    expect(captured.headers.allow).toBe("GET");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aggregates only exact upstream USD and preserves provider-specific failures", async () => {
    vi.stubEnv("MONID_API_KEY", "monid-private-value");
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-private-value");
    vi.stubEnv("GITHUB_TOKEN", "github-private-value");
    const fetchMock = vi.fn().mockImplementation((input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("monid.ai")) return Promise.resolve(json({ balance: { value: 25.5, currency: "USD" } }));
      if (url.includes("openrouter.ai")) return Promise.resolve(json({ data: { usage_monthly: 3.75, limit: 20, limit_remaining: 9 } }));
      if (url.includes("github.com")) return Promise.resolve(json({ message: "downstream unavailable" }, 503));
      throw new Error(`unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { captured, response } = responseHarness();

    await handler(request(), response as never);

    expect(captured.status).toBe(200);
    expect(captured.headers["cache-control"]).toBe("no-store");
    expect(captured.body).toMatchObject({
      available: true,
      mode: "provider_account_billing",
      summary: {
        liveConnectors: 2,
        providerAccounts: 3,
        unresolvedAccounts: 1,
        exactSpendMonthUsd: 3.75,
        exactBalanceUsd: 25.5,
      },
    });
    const serialized = JSON.stringify(captured.body);
    expect(serialized).not.toContain("private-value");
    const providers = captured.body?.providers as Array<Record<string, unknown>>;
    expect(providers.find((row) => row.id === "github")).toMatchObject({ state: "error", scope: "quota", checkedAt: expect.any(String) });
    expect(providers.find((row) => row.id === "claude")).toMatchObject({ state: "not_configured" });
  });

  it("caches a complete snapshot for 60 seconds without changing checkedAt", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "openrouter-private-value");
    const fetchMock = vi.fn().mockResolvedValue(json({ data: { usage_monthly: 2 } }));
    vi.stubGlobal("fetch", fetchMock);
    const first = responseHarness();
    const second = responseHarness();
    await handler(request(), first.response as never);
    await handler(request(), second.response as never);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(second.captured.body).toEqual(first.captured.body);
  });
});
