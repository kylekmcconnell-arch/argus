import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./governance";

afterEach(() => {
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

const UNI = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";
const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("the governance route", () => {
  it("rejects a request with no identity hint, before spending a call", async () => {
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

  it("returns the bound space with concentration and every caveat attached", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: unknown) => {
      const body = String((init as RequestInit).body);
      if (body.includes("spaces(")) {
        return json({ data: { spaces: [{
          id: "uniswapgovernance.eth", name: "Uniswap", verified: true,
          followersCount: 125274, proposalsCount: 197,
          twitter: "uniswapfnd", website: "https://uniswapfoundation.org",
          strategies: [{ name: "uni", params: { address: UNI } }],
        }] } });
      }
      if (body.includes("proposals(")) {
        return json({ data: { proposals: [{
          id: "0x1", title: "[Temp Check] - Four for V4", votes: 118,
          scores: [5347714, 0, 1814], scores_total: 5349528, quorum: 10000000, end: 1770000000,
        }] } });
      }
      return json({ data: { p0: [{ voter: "0xA", vp: 2301704 }, { voter: "0xB", vp: 2002445 }] } });
    }));
    const { api, sent } = res();

    await handler({ method: "GET", query: { name: "Uniswap", address: UNI } } as never, api as never);

    expect(sent.status).toBe(200);
    const body = sent.body as { available: boolean; space: { binding: string }; proposals: Array<{ top2Pct: number }>; claims: string[] };
    expect(body.available).toBe(true);
    expect(body.space.binding).toBe("token_contract");
    expect(body.proposals[0].top2Pct).toBeCloseTo(80.5, 0);
    expect(body.claims.some((claim) => claim.includes("not of tokens held"))).toBe(true);
    expect(body.claims.some((claim) => claim.includes("off-chain signalling"))).toBe(true);
  });

  it("publishes no figures for a space it could not bind", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ data: { spaces: [{
      id: "dodus.eth", name: "uniswap", verified: false, followersCount: 0,
      proposalsCount: 1, twitter: null, website: null,
      strategies: [{ name: "erc20-balance-of", params: { address: UNI } }],
    }] } })));
    const { api, sent } = res();

    await handler({ method: "GET", query: { name: "Uniswap", address: UNI } } as never, api as never);

    const body = sent.body as { available: boolean; space: unknown; proposals: unknown[]; claims: string[] };
    expect(body.available).toBe(false);
    expect(body.space).toBeNull();
    expect(body.proposals).toEqual([]);
    expect(body.claims).toEqual([]);
  });
});
