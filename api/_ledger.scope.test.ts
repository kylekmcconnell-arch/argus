import { afterEach, describe, expect, it, vi } from "vitest";
import { ledgerGet, ledgerUpsert, withLedgerOrganization } from "./_ledger.js";
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("threat ledger tenant scope", () => {
  it("keeps simultaneous workspaces on separate reads and unique write keys", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.example");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    const requests: { url: string; body: Record<string, unknown> | null }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response("[]", { status: 200 });
    }));
    const organizations = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"];
    await Promise.all(organizations.map((org) => withLedgerOrganization(org, async () => {
      await ledgerGet("0x123");
      await ledgerUpsert({ address: "0x123", chain: "ethereum", symbol: "TEST", verdict: "SAFE", risk: 1, flaggedAt: 1, liqThen: 1 });
    })));
    for (const org of organizations) {
      expect(requests.some((r) => r.url.includes(`organization_id=eq.${org}`))).toBe(true);
      expect(requests.some((r) => r.url.includes("on_conflict=organization_id,ref,kind") && r.body?.organization_id === org)).toBe(true);
    }
  });
  it("does not return a clean empty history when storage fails", async () => {
    vi.stubEnv("SUPABASE_URL", "https://db.example"); vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("error", { status: 503 })));
    await expect(withLedgerOrganization("00000000-0000-4000-8000-000000000001", () => ledgerGet("0x123"))).rejects.toThrow("threat_ledger_http_503");
  });
});
