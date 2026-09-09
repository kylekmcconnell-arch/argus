import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@vercel/functions", () => ({ next: () => new Response(null, { status: 204 }) }));
import middleware from "../middleware";
import threat from "./threat-recheck";
import { ledgerUpsert, withLedgerOrganization } from "./_ledger.js";
const org = "00000000-0000-4000-8000-000000000001";
const address = "0x1111111111111111111111111111111111111111";
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://db.example"); vi.stubEnv("SUPABASE_SECRET_KEY", "test");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test"); vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "test");
  vi.stubEnv("CRON_SECRET", "cron"); vi.stubEnv("INTERNAL_API_SECRET", ""); vi.stubEnv("THREAT_ALERT_WEBHOOK", "");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it.each(["social-activity", "find-wallet", "x-authenticity"])("meters paid standalone %s after the daily allowance", async (route) => {
  const mock = vi.fn(async (input) => Response.json(String(input).includes("/auth/") ? { id: "user", email_confirmed_at: "2026-01-01" } : String(input).includes("/rpc/") ? [{ allowed: false, used: 100, remaining: 0 }] : [{ organization_id: org, role: "analyst", active: true }]));
  vi.stubGlobal("fetch", mock);
  const response = await middleware(new Request(`https://app.example/api/${route}`, { method: "POST", headers: { authorization: "Bearer session" } }));
  expect(response.status).toBe(429);
  expect(mock.mock.calls.some(([url]) => String(url).includes("reserve_supplemental_budget"))).toBe(true);
});
it("admits a bounded scan helper without a second supplemental debit", async () => {
  const mock = vi.fn(async (input) => Response.json(String(input).includes("/auth/") ? { id: "user", email_confirmed_at: "2026-01-01" } : String(input).includes("/rpc/claim_scan_supplement") ? true : [{ organization_id: org, role: "analyst", active: true }]));
  vi.stubGlobal("fetch", mock);
  const response = await middleware(new Request("https://app.example/api/social-activity", { method: "POST", headers: { authorization: "Bearer session", "x-argus-scan-key": "run-key-123" }, body: JSON.stringify({ contractAddress: address }) }));
  expect(response.status).toBe(204);
  expect(mock.mock.calls.some(([url]) => String(url).includes("reserve_supplemental_budget"))).toBe(false);
});
it.each(["owner", "analyst"])("enforces %s scope through middleware and the recheck handler", async (role) => {
  const urls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input) => {
    const url = String(input); urls.push(url);
    return Response.json(url.includes("/auth/") ? { id: "00000000-0000-4000-8000-000000000099", email: "test@example.com", email_confirmed_at: "2026-01-01" } : url.includes("argus_members") ? [{ organization_id: org, role, active: true }] : []);
  }));
  const response = await middleware(new Request("https://app.example/api/threat-recheck", { headers: { authorization: "Bearer session" } }));
  expect(response.status).toBe(role === "owner" ? 204 : 403);
  if (role === "owner") {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    await threat({ headers: { authorization: "Bearer session" } } as never, res as never);
    expect(urls.some((url) => url.includes("reports?") && new URL(url).searchParams.get("organization_id") === `eq.${org}`)).toBe(true);
  }
});
it("keys cross-chain ledger writes separately within the same workspace", async () => {
  const rows: Record<string, unknown>[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => { rows.push(JSON.parse(String(init?.body))); return Response.json({}); }));
  const receipt = { address, chain: "ethereum", symbol: "TEST", verdict: "SAFE", risk: 1, flaggedAt: 1, liqThen: 10000 } as const;
  await withLedgerOrganization(org, async () => { await ledgerUpsert(receipt); await ledgerUpsert({ ...receipt, chain: "base" }); });
  expect(rows[0].ref).not.toBe(rows[1].ref);
  expect(rows.every((row) => row.organization_id === org)).toBe(true);
});
it("allows idempotent browser preflight only for an allowed origin", async () => {
  vi.stubEnv("ARGUS_CORS_ORIGINS", "https://client.example");
  for (const origin of ["https://client.example", "https://other.example"]) {
    const response = await middleware(new Request("https://app.example/api/v1/token", { method: "OPTIONS", headers: { origin } }));
    expect(response.headers.get("access-control-allow-origin")).toBe(origin.includes("client") ? origin : null);
    expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
  }
});
