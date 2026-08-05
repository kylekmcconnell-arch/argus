import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./gmgn-bundle";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function res() {
  const sent: { status?: number; body?: unknown; headers: Record<string, string> } = { headers: {} };
  const api = {
    status(code: number) { sent.status = code; return api; },
    json(body: unknown) { sent.body = body; return api; },
    setHeader(key: string, value: string) { sent.headers[key] = value; return api; },
  };
  return { api, sent };
}

const info = (overrides: Record<string, unknown> = {}) => ({
  code: 0,
  data: {
    holder_count: 4409,
    image_dup_count: 0,
    stat: {
      top_bundler_trader_percentage: 0.1234,
      top_rat_trader_percentage: 0,
      fresh_wallet_rate: 0.0465,
      top_10_holder_rate: 0.2344,
    },
    dev: { creator_address: "BpH4h6pdBLBnpwiZAhmGqhvkhFXknWU7QSBLQRHGi1Gt", creator_token_status: "creator_hold", cto_flag: 0 },
    wallet_tags_stat: { sniper_wallets: 34, bundler_wallets: 1000 },
    ...overrides,
  },
});

describe("the gmgn bundle route", () => {
  it("rejects a request with no token, before spending a provider call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api, sent } = res();

    await handler({ method: "GET", query: {} } as never, api as never);

    expect(sent.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a non-GET", async () => {
    const { api, sent } = res();
    await handler({ method: "POST", query: {} } as never, api as never);
    expect(sent.status).toBe(405);
  });

  it("returns the launch-pattern reading with GMGN-attributed claims and cap floors", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(info()), {
      status: 200,
      headers: { "content-type": "application/json" },
    })));
    const { api, sent } = res();

    await handler({ method: "GET", query: { chain: "solana", address: "MINT" } } as never, api as never);

    expect(sent.status).toBe(200);
    const body = sent.body as { available: boolean; bundlerVolumePct: number; tagged: { bundler: { count: number; atCap: boolean } }; claims: string[] };
    expect(body.available).toBe(true);
    expect(body.bundlerVolumePct).toBeCloseTo(12.34);
    expect(body.tagged.bundler).toEqual({ count: 1000, atCap: true });
    // Every published sentence names who classified the wallets.
    for (const claim of body.claims) expect(claim).toContain("GMGN");
    expect(body.claims.some((claim) => claim.includes("floor"))).toBe(true);
  });

  it("reports an unconfigured key as a gap rather than a clean launch shape", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api, sent } = res();

    await handler({ method: "GET", query: { chain: "solana", address: "MINT" } } as never, api as never);

    const body = sent.body as { available: boolean; note: string; claims: string[] };
    expect(sent.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.note).toContain("no API key");
    // Nothing may be published from a reading that never happened.
    expect(body.claims).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not let a provider failure be served as a clean reading", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { api, sent } = res();

    await handler({ method: "GET", query: { chain: "solana", address: "MINT" } } as never, api as never);

    const body = sent.body as { available: boolean; claims: string[]; note: string };
    expect(body.available).toBe(false);
    expect(body.claims).toEqual([]);
    expect(body.note).toContain("HTTP 500");
    expect(sent.headers["cache-control"]).toContain("private");
  });
});
