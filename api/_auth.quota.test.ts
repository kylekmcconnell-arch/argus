import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeInvestigationQuota, refundInvestigationCredit, rejectSupplementalReservation, reserveSupplementalBudget } from "./_auth";
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

describe("refundInvestigationCredit", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("writes one idempotent positive refund row bound to the debit key", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(refundInvestigationCredit(auth, "scan-key-123", "scan_run_already_claimed")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/credit_ledger?on_conflict=organization_id,idempotency_key");
    expect((init.headers as Record<string, string>).prefer).toContain("ignore-duplicates");
    expect(JSON.parse(String(init.body))).toMatchObject({
      organization_id: auth.organizationId,
      user_id: auth.userId,
      amount_millis: 1000,
      reason: "refund",
      idempotency_key: `refund:investigation:${auth.userId}:scan-key-123`,
      metadata: { debitKey: `investigation:${auth.userId}:scan-key-123`, cause: "scan_run_already_claimed" },
    });
  });

  it("reports a refused refund instead of throwing into the route", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    await expect(refundInvestigationCredit(auth, "scan-key-123", "x")).resolves.toBe(false);
  });
});

describe("reserveSupplementalBudget", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
    vi.stubEnv("ARGUS_SUPPLEMENTAL_DAILY_LIMIT", "");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reserves one unit through the same RPC and limit the middleware used", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ allowed: true, used: 3, remaining: 97 }]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(reserveSupplementalBudget(auth, "/api/ask")).resolves.toEqual({ allowed: true, used: 3, remaining: 97, limit: 100 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/rest/v1/rpc/reserve_supplemental_budget");
    expect(JSON.parse(String(init.body))).toEqual({
      p_organization_id: auth.organizationId,
      p_user_id: auth.userId,
      p_route: "/api/ask",
      p_daily_limit: 100,
    });
  });

  it("fails closed with stable codes when the limit is unset or the store does not answer", async () => {
    vi.stubEnv("ARGUS_SUPPLEMENTAL_DAILY_LIMIT", "0");
    await expect(reserveSupplementalBudget(auth, "/api/ask")).resolves.toMatchObject({ allowed: false, error: "supplemental_budget_not_configured" });
    vi.stubEnv("ARGUS_SUPPLEMENTAL_DAILY_LIMIT", "");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    await expect(reserveSupplementalBudget(auth, "/api/ask")).resolves.toMatchObject({ allowed: false, error: "supplemental_budget_unavailable" });
  });

  it("writes the standard refusal response", () => {
    const captured: { status?: number; body?: unknown } = {};
    const res = {
      setHeader() { return res; },
      status(code: number) { captured.status = code; return res; },
      json(body: unknown) { captured.body = body; return res; },
    };
    expect(rejectSupplementalReservation(res as never, { allowed: true, limit: 100 })).toBe(false);
    expect(rejectSupplementalReservation(res as never, { allowed: false, limit: 100 })).toBe(true);
    expect(captured).toEqual({ status: 429, body: expect.objectContaining({ error: "supplemental_daily_limit_reached", limit: 100 }) });
    expect(rejectSupplementalReservation(res as never, { allowed: false, limit: 100, error: "supplemental_budget_unavailable" })).toBe(true);
    expect(captured.status).toBe(503);
  });
});
