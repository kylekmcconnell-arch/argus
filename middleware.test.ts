import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/functions", () => ({
  next: vi.fn(() => new Response(null, { status: 204 })),
}));

import { next } from "@vercel/functions";
import middleware from "./middleware";
import { issueScanPanelToken } from "./api/_cache.js";

const TEST_ORG = "00000000-0000-4000-8000-000000000001";
const PANEL_SECRET = "panel-capability-test-secret";
/** A paid panel needs a capability; mint the real thing rather than a stub. */
const panelCapability = () => issueScanPanelToken(TEST_ORG, "scan-run-key-12345") as string;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Case Brief middleware policy", () => {
  beforeEach(() => {
    vi.mocked(next).mockClear();
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
    vi.stubEnv("PANEL_COST_TOKEN_SECRET", PANEL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("allows the public sign-in request without a bearer token", async () => {
    const response = await middleware(new Request("https://argus.example/api/signin", {
      method: "POST",
      headers: { origin: "https://argus.example", "content-type": "application/json" },
      body: JSON.stringify({ email: "enigma@enigma-fund.com" }),
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows public join and leaderboard requests without a bearer token", async () => {
    for (const path of ["/api/join", "/api/leaderboard"]) {
      vi.mocked(next).mockClear();
      const response = await middleware(new Request(`https://argus.example${path}`, { method: "GET" }));
      expect(response.status, path).toBe(204);
      expect(next).toHaveBeenCalledOnce();
    }
  });

  it("admits only the exact provider-billing feed token before Supabase auth", async () => {
    vi.stubEnv("ARGUS_BILLING_FEED_TOKEN", "provider-feed-secret");

    const allowed = await middleware(new Request("https://argus.example/api/provider-billing", {
      headers: { authorization: "Bearer provider-feed-secret" },
    }));
    expect(allowed.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();

    vi.mocked(next).mockClear();
    for (const authorization of ["", "Bearer wrong", "Bearer provider-feed-secret-extra"]) {
      const rejected = await middleware(new Request("https://argus.example/api/provider-billing", {
        headers: authorization ? { authorization } : {},
      }));
      expect(rejected.status).toBe(401);
    }
    expect(next).not.toHaveBeenCalled();
  });

  it("fails the provider-billing route closed when its feed token is unset", async () => {
    vi.stubEnv("ARGUS_BILLING_FEED_TOKEN", "");
    const response = await middleware(new Request("https://argus.example/api/provider-billing", {
      headers: { authorization: "Bearer any-value" },
    }));
    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("lets an authenticated waitlist user reach account growth without membership", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000099",
        email_confirmed_at: "2026-08-21T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/account-growth", {
      headers: { authorization: "Bearer waitlist-token" },
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
  });

  it("does not expose a nearby sign-in path", async () => {
    const response = await middleware(new Request("https://argus.example/api/signin/admin", {
      method: "POST",
    }));

    expect(response.status).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("advertises PATCH for configured Case Brief CORS origins", async () => {
    vi.stubEnv("ARGUS_CORS_ORIGINS", "https://partner.example");

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "OPTIONS",
      headers: { origin: "https://partner.example" },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://partner.example");
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(next).not.toHaveBeenCalled();
  });

  it("allows a viewer to read Case Brief without consuming analyst quota", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/case-brief?caseId=00000000-0000-4000-8000-000000000101",
      { headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["alerts", "holder-history", "holder-alerts"])("allows a viewer to read tenant-scoped %s without consuming analyst quota", async (route) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      `https://argus.example/api/${route}`,
      { headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires analyst access to dismiss an alert", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/alerts?ref=al%3Aone",
      { method: "DELETE", headers: { authorization: "Bearer viewer-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
  });

  it("requires analyst access for an augmentation POST", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "POST",
      headers: { authorization: "Bearer viewer-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an analyst augmentation POST after reserving the explicit workspace supplemental budget", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99 }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "POST",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(false);
  });

  it("requires owner access for augmentation review views", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?view=pending",
      { headers: { authorization: "Bearer analyst-token" } },
    ));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "owner" });
    expect(next).not.toHaveBeenCalled();
  });

  it("does not meter an owner augmentation review view", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request(
      "https://argus.example/api/augment?view=learnings",
      { headers: { authorization: "Bearer owner-token" } },
    ));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires owner access for augmentation PATCH decisions", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "PATCH",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "owner" });
    expect(next).not.toHaveBeenCalled();
  });

  it("allows an owner augmentation PATCH decision without a hidden daily API counter", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/augment", {
      method: "PATCH",
      headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", id: "00000000-0000-4000-8000-000000000101" }),
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(false);
  });

  it("does not consult usage accounting before a protected report write", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "owner",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/report", {
      method: "POST",
      headers: { authorization: "Bearer owner-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not allow a viewer to mutate Case Brief", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "PATCH",
      headers: { authorization: "Bearer viewer-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "insufficient_role", requiredRole: "analyst" });
    expect(next).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("allows an analyst collaboration mutation without consuming paid-scan quota", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        id: "00000000-0000-4000-8000-000000000010",
        email_confirmed_at: "2026-07-11T00:00:00.000Z",
      }))
      .mockResolvedValueOnce(jsonResponse([{
        organization_id: "00000000-0000-4000-8000-000000000001",
        role: "analyst",
        active: true,
      }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/case-brief", {
      method: "POST",
      headers: { authorization: "Bearer analyst-token", "content-type": "application/json" },
      body: "{}",
    }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/rest/v1/rpc/consume_usage_quota"))).toBe(false);
  });
  // /api/ask and /api/reclassify reserve their own unit from the handler
  // after validation (reserveSupplementalBudget). Pre-reserving here charged
  // the daily allowance for 409s, clarification-only turns and provider
  // outages that delivered nothing.
  it.each(["/api/ask", "/api/reclassify"])("admits %s without a middleware budget reservation", async (path) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "00000000-0000-4000-8000-000000000010", email_confirmed_at: "2026-07-11T00:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: "00000000-0000-4000-8000-000000000001", role: "owner", active: true }]))
      .mockResolvedValueOnce(jsonResponse([{ allowed: false, used: 100, remaining: 0 }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await middleware(new Request(`https://argus.example${path}`, { method: "POST", headers: { authorization: "Bearer owner-token" } }));
    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("reserve_supplemental_budget"))).toBe(false);
  });

  it.each([['/api/x-find',false],['/api/x-find',null],['/api/deep-launch',false],['/api/deep-launch',null]])("blocks %s when budget admission is %s", async (path, allowed) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "00000000-0000-4000-8000-000000000010", email_confirmed_at: "2026-07-11T00:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: "00000000-0000-4000-8000-000000000001", role: "analyst", active: true }]))
      .mockResolvedValueOnce(allowed === null ? jsonResponse({}, 503) : jsonResponse([{ allowed, used: 100, remaining: 0 }]));
    vi.stubGlobal("fetch", fetchMock);
    const response = await middleware(new Request(`https://argus.example${path}`, { method: "POST", headers: { authorization: "Bearer analyst-token", "x-argus-panel-token": panelCapability() } }));
    expect(response.status).toBe(allowed === null ? 503 : 429);
    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toMatchObject({ p_organization_id: "00000000-0000-4000-8000-000000000001", p_daily_limit: 100 });
  });

  it('lets a viewer read saved launch analysis without reserving budget', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: '00000000-0000-4000-8000-000000000010', email_confirmed_at: '2026-07-11T00:00:00Z' }))
      .mockResolvedValueOnce(jsonResponse([{ organization_id: '00000000-0000-4000-8000-000000000001', role: 'viewer', active: true }]));
    vi.stubGlobal('fetch', fetchMock);
    const response = await middleware(new Request('https://argus.example/api/deep-launch?reportVersionId=fixture', { headers: { authorization: 'Bearer viewer-token' } }));
    expect(response.status).toBe(204); expect(fetchMock).toHaveBeenCalledTimes(2);
  });

});

describe("one analyst cannot spend the whole workspace day (#356)", () => {
  beforeEach(() => {
    vi.mocked(next).mockClear();
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
    vi.stubEnv("PANEL_COST_TOKEN_SECRET", PANEL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const authThenMember = () => vi.fn()
    .mockResolvedValueOnce(jsonResponse({
      id: "00000000-0000-4000-8000-000000000010",
      email_confirmed_at: "2026-07-11T00:00:00.000Z",
    }))
    .mockResolvedValueOnce(jsonResponse([{
      organization_id: "00000000-0000-4000-8000-000000000001",
      role: "analyst",
      active: true,
    }]));

  // /api/ask reserves in its handler, so the middleware-side reservation is
  // asserted on a middleware-metered panel instead.
  const askRequest = () => new Request("https://argus.example/api/arkham", {
    headers: { authorization: "Bearer analyst-token", "x-argus-panel-token": panelCapability() },
  });

  it("passes the configured per-user cap to the reservation", async () => {
    vi.stubEnv("ARGUS_SUPPLEMENTAL_USER_DAILY_LIMIT", "25");
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99, reason: null }]));
    vi.stubGlobal("fetch", fetchMock);

    await middleware(askRequest());

    const reservation = fetchMock.mock.calls.find(([input]) => String(input).includes("reserve_supplemental_budget"));
    expect(reservation).toBeDefined();
    expect(JSON.parse(String(reservation![1].body))).toMatchObject({ p_user_daily_limit: 25 });
  });

  it("tells an analyst who hit their own cap that the workspace still has budget", async () => {
    vi.stubEnv("ARGUS_SUPPLEMENTAL_USER_DAILY_LIMIT", "25");
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: false, used: 40, remaining: 60, reason: "user_daily_limit" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(askRequest());

    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body).toMatchObject({ error: "supplemental_user_daily_limit_reached", limit: 25 });
    expect(String(body.message)).toContain("workspace still has budget");
    expect(next).not.toHaveBeenCalled();
  });

  it("still reports a genuinely exhausted workspace as a workspace limit", async () => {
    vi.stubEnv("ARGUS_SUPPLEMENTAL_USER_DAILY_LIMIT", "25");
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: false, used: 100, remaining: 0, reason: "workspace_daily_limit" }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(askRequest());

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: "supplemental_daily_limit_reached" });
  });

  it("sends no per-user cap when none is configured, keeping the previous behaviour", async () => {
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99, reason: null }]));
    vi.stubGlobal("fetch", fetchMock);

    await middleware(askRequest());

    const reservation = fetchMock.mock.calls.find(([input]) => String(input).includes("reserve_supplemental_budget"));
    expect(JSON.parse(String(reservation![1].body)).p_user_daily_limit).toBeNull();
  });

  it("forwards the workspace so a gated panel can attribute its spend", async () => {
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99, reason: null }]));
    vi.stubGlobal("fetch", fetchMock);

    await middleware(askRequest());

    const forwarded = (next.mock.calls[0]?.[0] as { request?: { headers?: Headers } } | undefined)?.request?.headers;
    expect(forwarded?.get("x-argus-organization-id")).toBe("00000000-0000-4000-8000-000000000001");
  });

  it("overwrites a client-supplied workspace header instead of trusting it", async () => {
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99, reason: null }]));
    vi.stubGlobal("fetch", fetchMock);

    await middleware(new Request("https://argus.example/api/arkham", {
      headers: {
        authorization: "Bearer analyst-token",
        "x-argus-panel-token": panelCapability(),
        "x-argus-organization-id": "00000000-0000-4000-8000-0000000000ff",
      },
    }));

    const forwarded = (next.mock.calls[0]?.[0] as { request?: { headers?: Headers } } | undefined)?.request?.headers;
    expect(forwarded?.get("x-argus-organization-id")).toBe("00000000-0000-4000-8000-000000000001");
  });
});

describe("a paid panel must present a capability (#356)", () => {
  beforeEach(() => {
    vi.mocked(next).mockClear();
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-test-key");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
    vi.stubEnv("PANEL_COST_TOKEN_SECRET", PANEL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const authThenMember = () => vi.fn()
    .mockResolvedValueOnce(jsonResponse({ id: "00000000-0000-4000-8000-000000000010", email_confirmed_at: "2026-07-11T00:00:00.000Z" }))
    .mockResolvedValueOnce(jsonResponse([{ organization_id: TEST_ORG, role: "analyst", active: true }]));

  const panelRequest = (headers: Record<string, string>) =>
    new Request("https://argus.example/api/cluster", { headers: { authorization: "Bearer analyst-token", ...headers } });

  it("refuses a paid panel with no capability, before any budget is spent", async () => {
    const fetchMock = authThenMember();
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(panelRequest({}));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "panel_capability_required" });
    expect(next).not.toHaveBeenCalled();
    // The refusal must not reserve a supplemental unit.
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("reserve_supplemental_budget"))).toBe(false);
  });

  it("admits a scan capability, so a panel opened mid-scan still works", async () => {
    const fetchMock = authThenMember();
    fetchMock.mockResolvedValueOnce(jsonResponse([{ allowed: true, used: 1, remaining: 99, reason: null }]));
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(panelRequest({ "x-argus-panel-token": panelCapability() }));

    expect(response.status).toBe(204);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("refuses a capability issued to another workspace", async () => {
    const otherOrgToken = issueScanPanelToken("00000000-0000-4000-8000-0000000000ff", "scan-run-key-12345") as string;
    vi.stubGlobal("fetch", authThenMember());

    const response = await middleware(panelRequest({ "x-argus-panel-token": otherOrgToken }));

    expect(response.status).toBe(409);
    expect(next).not.toHaveBeenCalled();
  });

  it("refuses a forged or altered capability", async () => {
    const [payload, signature] = panelCapability().split(".");
    for (const forged of [`${payload}x.${signature}`, `${payload}.${"A".repeat(43)}`, payload, "not-a-token"]) {
      vi.stubGlobal("fetch", authThenMember());
      const response = await middleware(panelRequest({ "x-argus-panel-token": forged }));
      expect(response.status, forged.slice(0, 24)).toBe(409);
    }
  });

  it("leaves unpaid authenticated routes alone", async () => {
    const fetchMock = authThenMember();
    vi.stubGlobal("fetch", fetchMock);

    const response = await middleware(new Request("https://argus.example/api/report", {
      headers: { authorization: "Bearer analyst-token" },
    }));

    expect(response.status).toBe(204);
  });
});

describe("the paid-panel list matches the routes that resolve a capability", () => {
  it("names every route that attributes cost through a panel token", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const source = readFileSync(new URL("./middleware.ts", import.meta.url), "utf8");
    const listed = new Set(
      [...(/const PAID_PANEL_PATHS = new Set\(\[([\s\S]*?)\]\.map/.exec(source)?.[1] ?? "")
        .matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]),
    );

    const resolvers = readdirSync(new URL("./api/", import.meta.url))
      // .d.ts only declares the helper; it is not a route.
      .filter((file) => file.endsWith(".ts") && !file.endsWith(".d.ts") && !file.includes(".test."))
      .filter((file) => readFileSync(new URL(`./api/${file}`, import.meta.url), "utf8").includes("resolvePanelCostVersion"))
      .map((file) => file.replace(/\.ts$/, ""));

    // A route that starts attributing cost is a paid panel, and must be gated
    // with the others rather than quietly staying open.
    expect([...resolvers].sort()).toEqual([...listed].sort());
  });
});
