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

describe("consumeInvestigationQuota resilience", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test_key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fails open (allows, no error) when the usage RPC returns non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "statement timeout" }, 503)));
    const quota = await consumeInvestigationQuota(auth, "/api/audit");
    expect(quota.allowed).toBe(true);
    expect(quota.error).toBeUndefined();
  });

  it("fails open when the usage RPC connection throws (e.g. timeout)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("The operation was aborted due to timeout"); }));
    const quota = await consumeInvestigationQuota(auth, "/api/audit");
    expect(quota.allowed).toBe(true);
    expect(quota.error).toBeUndefined();
  });

  it("still blocks a genuine over-limit response (RPC succeeds, allowed=false)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ allowed: false, used: 100, remaining: 0 }])));
    const quota = await consumeInvestigationQuota(auth, "/api/audit");
    expect(quota.allowed).toBe(false);
    expect(quota.error).toBeUndefined();
  });

  it("allows and reports usage when under the limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse([{ allowed: true, used: 3, remaining: 97 }])));
    const quota = await consumeInvestigationQuota(auth, "/api/audit");
    expect(quota).toMatchObject({ allowed: true, used: 3, remaining: 97 });
  });

  it("passes an abort signal (bounded timeout) on the quota call", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([{ allowed: true, used: 1, remaining: 99 }]));
    vi.stubGlobal("fetch", fetchMock);
    await consumeInvestigationQuota(auth, "/api/audit");
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
