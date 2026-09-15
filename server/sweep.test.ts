import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "../src/token/audit";
import { runSweep } from "./sweep";

vi.mock("../src/token/audit", () => ({ auditToken: vi.fn() }));

const ORG = "00000000-0000-4000-8000-000000000001";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** One fetch mock answering the watchlist, graph, open-case and upsert reads in order. */
function backend(watches: unknown[]) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("kind=eq.watch")) return jsonResponse(watches);
    if (url.includes("graph_contributions")) return jsonResponse([]);
    if (url.includes("/cases?")) return jsonResponse(watches.map((watch) => ({ canonical_ref: (watch as { payload: { item: { id: string } } }).payload.item.id })));
    return jsonResponse([]);
  });
}

const tokenWatch = (id: string) => ({ ref: id, payload: { item: { id, kind: "token", label: id, chain: "ethereum", via: "evm", snapshot: { verdict: "PASS", score: 80 } } } });

describe("watchlist sweep credentials", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  // 2026-09-14 deep-dive OR-3: the sweep read only the legacy service_role
  // variables and always sent Bearer, so a deployment rotated to the
  // documented sb_secret_* key swept nothing and reported a completed sweep.
  it("uses the sb_secret_* key without a Bearer header, like every other server module", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_rotated");
    const fetchMock = backend([]);
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSweep(ORG);

    expect(result.unavailable).toBeUndefined();
    expect(result.note).toBe("watchlist empty");
    expect(fetchMock).toHaveBeenCalled();
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.apikey).toBe("sb_secret_rotated");
    expect(headers.authorization).toBeUndefined();
  });

  it("still accepts the legacy service_role JWT with its Bearer header", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-jwt");
    const fetchMock = backend([]);
    vi.stubGlobal("fetch", fetchMock);
    await runSweep(ORG);
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer legacy-jwt");
  });

  it("reports an unreachable backend as unavailable instead of a clean sweep", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(runSweep(ORG)).resolves.toMatchObject({ checked: 0, unavailable: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("watchlist sweep budget and ledger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:00:00.000Z"));
    vi.stubEnv("SUPABASE_URL", "https://database.example");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_rotated");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("stops starting token checks when the route deadline is near and reports the deferral", async () => {
    vi.stubGlobal("fetch", backend([tokenWatch("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"), tokenWatch("0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), tokenWatch("0xcccccccccccccccccccccccccccccccccccccccc")]));
    vi.mocked(auditToken).mockImplementation(async () => {
      // Each audit consumes 12 s of the clock.
      vi.setSystemTime(Date.now() + 12_000);
      return null;
    });
    const deadlineAt = Date.now() + 30_000;

    const result = await runSweep(ORG, { deadlineAt });

    // 30 s left: first check starts (needs 20 s). 18 s left afterwards: the
    // second and third are deferred, but every watch still got its ring check.
    expect(auditToken).toHaveBeenCalledTimes(1);
    expect(result.checked).toBe(3);
    expect(result.deferred).toBe(2);
    expect(result.note).toContain("deferred");
    const [, , options] = vi.mocked(auditToken).mock.calls[0];
    expect(options).toMatchObject({ skipSim: true, deadlineAt: expect.any(Number) });
    expect((options as { deadlineAt: number }).deadlineAt).toBeLessThan(deadlineAt);
  });

  it("owns an isolated cost ledger and returns it with the result", async () => {
    vi.stubGlobal("fetch", backend([]));
    const result = await runSweep(ORG);
    expect(result.cost).toMatchObject({ schemaVersion: 1, calls: [] });
  });
});
