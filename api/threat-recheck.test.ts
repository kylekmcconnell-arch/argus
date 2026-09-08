import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./_auth.js", () => ({ requireArgusAuth: vi.fn() }));
import { requireArgusAuth } from "./_auth.js";
import handler from "./threat-recheck";
const orgA = "00000000-0000-4000-8000-000000000001";
const orgB = "00000000-0000-4000-8000-000000000002";
const address = "So11111111111111111111111111111111111111112";
const receipt = { address, chain: "solana", symbol: "TEST", verdict: "SAFE", risk: 1, liqThen: 10000, checkedAt: 1, flaggedAt: 1 };
async function run(authorization = "Bearer cron") {
  let body: Record<string, unknown> = {};
  const res = { status() { return this; }, json(value: Record<string, unknown>) { body = value; return this; } };
  await handler({ headers: { authorization } } as never, res as never);
  return body;
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SUPABASE_URL", "https://db.example"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
  vi.stubEnv("CRON_SECRET", "cron"); vi.stubEnv("ARGUS_THREAT_ORGANIZATION_ID", orgA);
  vi.stubEnv("THREAT_ALERT_WEBHOOK", "https://hook.example");
  vi.mocked(requireArgusAuth).mockResolvedValue({ organizationId: orgA, userId: "user", role: "owner" } as never);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function mockNetwork(failed = false) {
  const requests: { url: string; body?: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input, init) => {
    const url = String(input);
    requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.startsWith("https://api.dexscreener.com")) return failed ? new Response("error", { status: 503 }) : Response.json({ pairs: [] });
    if (url.startsWith("https://db.example") && !init?.body) {
      const params = new URL(url).searchParams;
      if (params.get("select") === "organization_id,payload") return Response.json(
        [orgA, orgB].filter((org) => !params.get("organization_id") || params.get("organization_id") === `eq.${org}`)
          .map((organization_id) => ({ organization_id, payload: receipt })));
      return Response.json([]);
    }
    return Response.json({});
  }));
  return requests;
}
describe("organization-wide threat rechecks", () => {
  it("checks all organizations while keeping identical address writes and alerts scoped", async () => {
    const requests = mockNetwork();
    expect(await run()).toMatchObject({ available: true, updated: 2, alerts: 2 });
    const writes = requests.filter((r) => r.body?.kind === "threat-receipt");
    expect(writes.map((r) => r.body?.organization_id).sort()).toEqual([orgA, orgB]);
    expect(requests.filter((r) => r.body?.kind === "threat-alert").map((r) => r.body?.organization_id).sort()).toEqual([orgA, orgB]);
    expect(requests.filter((r) => r.url === "https://hook.example")).toHaveLength(1);
    expect(requireArgusAuth).not.toHaveBeenCalled();
  });
  it("restricts manual owner runs to their own organization", async () => {
    const requests = mockNetwork();
    expect(await run("Bearer owner")).toMatchObject({ updated: 1 });
    expect(requests.filter((r) => r.body?.organization_id === orgB)).toHaveLength(0);
    expect(requireArgusAuth).toHaveBeenCalled();
  });
  it("defers unavailable reads without declaring a dead market or publishing alerts", async () => {
    const requests = mockNetwork(true);
    expect(await run()).toMatchObject({ available: false, failures: 2, updated: 0, alerts: 0 });
    const writes = requests.filter((r) => r.body?.kind === "threat-receipt");
    for (const write of writes) {
      expect(write.body?.payload).toMatchObject({ checkedAt: 1, liqThen: 10000, recheckAfter: expect.any(Number) });
      expect(write.body?.payload).not.toHaveProperty("status");
    }
    expect(requests.some((r) => r.url === "https://hook.example")).toBe(false);
  });
});
