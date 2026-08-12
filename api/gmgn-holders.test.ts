import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./gmgn-holders";

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

const trader = (overrides: Record<string, unknown> = {}) => ({
  address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  amount_percentage: 0.0768,
  total_cost: 52155463.65,
  realized_profit: -13881568.58,
  unrealized_profit: 0,
  ...overrides,
});

describe("the gmgn holders route", () => {
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

  it("returns holders with cost basis and the attributed claims", async () => {
    vi.stubEnv("GMGN_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      JSON.stringify({ code: 0, data: { list: [trader({ is_suspicious: true, tags: ["sniper"] })] } }),
      { status: 200, headers: { "content-type": "application/json" } },
    )));
    const { api, sent } = res();

    await handler({ method: "GET", query: { chain: "solana", address: "MINT" } } as never, api as never);

    expect(sent.status).toBe(200);
    const body = sent.body as { available: boolean; holders: Array<Record<string, unknown>>; claims: string[] };
    expect(body.available).toBe(true);
    expect(body.holders[0].costUsd).toBeCloseTo(52155463.65);
    expect(body.holders[0].riskTags).toEqual(["sniper"]);
    // Every published sentence names who classified the wallet.
    for (const claim of body.claims) expect(claim).toContain("GMGN");
  });

  it("reports an unconfigured key as a gap rather than an empty holder list", async () => {
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
    // A day-long server cache would freeze this outage into an answer.
    expect(sent.headers["cache-control"]).toContain("max-age=60");
  });
});
