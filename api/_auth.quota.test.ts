import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeInvestigationQuota } from "./_auth";
import type { AuthContext } from "./_auth";

const auth: AuthContext = {
  userId: "00000000-0000-4000-8000-000000000010",
  email: "owner@example.com",
  organizationId: "00000000-0000-4000-8000-000000000001",
  role: "owner",
  displayName: "Owner",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("consumeInvestigationQuota credit policy", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("charges owners through the same visible credit ledger", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ allowed: true, balance_millis: 49_999_000 }]));
    vi.stubGlobal("fetch", fetchMock);
    const quota = await consumeInvestigationQuota(auth, "/api/audit");
    expect(quota.allowed).toBe(true);
    expect(quota).toMatchObject({ used: 1, remaining: 49_999, creditRemaining: 49_999 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("blocks an analyst only when the visible credit ledger is exhausted", async () => {
    const analyst: AuthContext = { ...auth, role: "analyst", email: "analyst@example.com" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ allowed: false, balance_millis: 0 }])));
    const quota = await consumeInvestigationQuota(analyst, "/api/audit");
    expect(quota.allowed).toBe(false);
    expect(quota.reason).toBe("credit_budget_exhausted");
  });

  it("allows an analyst and reports the visible remaining credits", async () => {
    const analyst: AuthContext = { ...auth, role: "analyst", email: "analyst@example.com" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ allowed: true, balance_millis: 9_000 }])));
    const quota = await consumeInvestigationQuota(analyst, "/api/audit");
    expect(quota).toMatchObject({ allowed: true, used: 1, remaining: 9, creditRemaining: 9 });
  });

  it("fails closed with an explicit ledger error when credits cannot be checked", async () => {
    const analyst: AuthContext = { ...auth, role: "analyst", email: "analyst@example.com" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "statement timeout" }, 503)));
    const quota = await consumeInvestigationQuota(analyst, "/api/audit");
    expect(quota).toMatchObject({ allowed: false, error: "credit_ledger_unavailable" });
  });

  it("uses one bounded credit-ledger request and never calls daily usage accounting", async () => {
    const analyst: AuthContext = { ...auth, role: "analyst", email: "analyst@example.com" };
    const fetchMock = vi.fn(async () => jsonResponse([{ allowed: true, balance_millis: 9_000 }]));
    vi.stubGlobal("fetch", fetchMock);
    await consumeInvestigationQuota(analyst, "/api/audit");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/consume_investigation_credit");
    expect(url).not.toContain("consume_usage_quota");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
