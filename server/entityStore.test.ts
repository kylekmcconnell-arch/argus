import { afterEach, describe, expect, it, vi } from "vitest";
import { readEntityFacts, writeEntityFacts } from "./entityStore";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function stubSupabase(): void {
  vi.stubEnv("SUPABASE_URL", "https://db.example.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
}

const MONTH = 30 * 24 * 3600 * 1000;

describe("entityStore read/write", () => {
  it("readEntityFacts no-ops without Supabase creds", async () => {
    expect(await readEntityFacts("org1", "@vitalikbuterin", MONTH)).toBeNull();
  });

  it("readEntityFacts returns fresh facts, keyed and scoped correctly", async () => {
    stubSupabase();
    const now = new Date().toISOString();
    const fetchMock = vi.fn(async (_url: unknown) => new Response(JSON.stringify([{
      facts: { basicFacts: [{ predicate: "founder", value: "Ethereum" }] },
      entity_type: "FOUNDER", audit_count: 3, updated_at: now,
    }]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const rec = await readEntityFacts("org1", "@vitalikbuterin", MONTH);
    expect(rec?.facts).toEqual({ basicFacts: [{ predicate: "founder", value: "Ethereum" }] });
    expect(rec?.auditCount).toBe(3);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/rest/v1/entity_facts");
    expect(url).toContain("organization_id=eq.org1");
    expect(url).toContain("canonical_key=eq.%40vitalikbuterin");
  });

  it("readEntityFacts rejects stale rows past maxAge", async () => {
    stubSupabase();
    const old = new Date(Date.now() - 100 * 24 * 3600 * 1000).toISOString();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ facts: { a: 1 }, updated_at: old }]), { status: 200 })));
    expect(await readEntityFacts("org1", "@x", MONTH)).toBeNull();
  });

  it("readEntityFacts returns null on a provider error", async () => {
    stubSupabase();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 500 })));
    expect(await readEntityFacts("org1", "@x", MONTH)).toBeNull();
  });

  it("writeEntityFacts upserts with merge + increments the audit count", async () => {
    stubSupabase();
    const calls: Array<{ url: string; init?: { method?: string; headers?: Record<string, string>; body?: string } }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("select=audit_count")) return new Response(JSON.stringify([{ audit_count: 2 }]), { status: 200 });
      return new Response(null, { status: 201 });
    }));

    const ok = await writeEntityFacts("org1", "@vitalikbuterin", {
      handle: "@VitalikButerin", displayName: "vitalik.eth", entityType: "FOUNDER",
      facts: { basicFacts: [1], roles: ["FOUNDER"] },
    });
    expect(ok).toBe(true);
    const upsert = calls.find((c) => c.init?.method === "POST");
    expect(upsert?.url).toContain("on_conflict=organization_id,canonical_key");
    expect(upsert?.init?.headers?.prefer).toContain("resolution=merge-duplicates");
    const row = JSON.parse(upsert!.init!.body!)[0];
    expect(row.canonical_key).toBe("@vitalikbuterin");
    expect(row.audit_count).toBe(3);
    expect(row.facts).toEqual({ basicFacts: [1], roles: ["FOUNDER"] });
    expect(row.display_name).toBe("vitalik.eth");
  });

  it("writeEntityFacts no-ops without an organization", async () => {
    stubSupabase();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await writeEntityFacts(undefined, "@x", { facts: {} })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
