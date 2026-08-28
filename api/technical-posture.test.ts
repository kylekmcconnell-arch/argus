import { afterEach, describe, expect, it, vi } from "vitest";
import handler from "./technical-posture";

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

const upstream = (rows: Array<Record<string, unknown>>) => ({ covered: true, rows });
const row = (overrides: Record<string, unknown> = {}) => ({
  ticker: "BTC-USD", timeframe: "1d",
  signals: ["big_green_arrows", "green_bars", "volume_extreme"],
  high_low: ["52w_high"], green_dot_count: 12, red_dot_count: 0,
  bottoms_last_count: 0, bottoms_last_age: null, up_bars_30: 21,
  market_cap_usd: "1500000000000",
  ...overrides,
});

function stubOk(payload: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })));
}

describe("the technical posture route", () => {
  it("rejects a bad symbol before spending a provider call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "not a symbol!!" } } as never, api as never);
    expect(sent.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a non-GET", async () => {
    const { api, sent } = res();
    await handler({ method: "POST", query: {} } as never, api as never);
    expect(sent.status).toBe(405);
  });

  it("reports missing configuration as a gap rather than an empty all-clear", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "BTC" } } as never, api as never);
    const body = sent.body as { available: boolean; note: string };
    expect(sent.status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.note).toContain("not configured");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("translates signal slugs into generic chart language with no vendor terms", async () => {
    vi.stubEnv("CHART_SIGNALS_URL", "http://signals.local");
    vi.stubEnv("CHART_SIGNALS_TOKEN", "t");
    stubOk(upstream([row()]));
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "BTC" } } as never, api as never);

    const body = sent.body as { available: boolean; covered: boolean; stance: string; readings: Array<{ observations: string[] }> };
    expect(body.covered).toBe(true);
    expect(body.stance).toBe("bullish");
    const text = JSON.stringify(body).toLowerCase();
    expect(text).toContain("confirmed bullish breakout");
    expect(text).toContain("volume");
    // the upstream product is never named and raw slugs never leak through
    for (const banned of ["alpha", "goomb", "wick", "trackline", "big_green"]) expect(text).not.toContain(banned);
  });

  it("prefers the USD pair when several quotes share a timeframe", async () => {
    vi.stubEnv("CHART_SIGNALS_URL", "http://signals.local");
    vi.stubEnv("CHART_SIGNALS_TOKEN", "t");
    stubOk(upstream([
      row({ ticker: "BTC-EUR", signals: ["red_bars"] }),
      row({ ticker: "BTC-USD", signals: ["green_bars"] }),
    ]));
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "BTC" } } as never, api as never);
    const body = sent.body as { readings: Array<{ observations: string[] }> };
    expect(body.readings[0].observations.join(" ")).toContain("uptrend");
  });

  it("drops a namesake whose market cap is a different order of magnitude", async () => {
    vi.stubEnv("CHART_SIGNALS_URL", "http://signals.local");
    vi.stubEnv("CHART_SIGNALS_TOKEN", "t");
    stubOk(upstream([row()])); // listed asset at $1.5T
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "BTC", mcap: "250000" } } as never, api as never);
    const body = sent.body as { covered: boolean; note: string };
    expect(body.covered).toBe(false);
    expect(body.note).toContain("misattribution");
  });

  it("does not let an upstream failure be served as a clean reading", async () => {
    vi.stubEnv("CHART_SIGNALS_URL", "http://signals.local");
    vi.stubEnv("CHART_SIGNALS_TOKEN", "t");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const { api, sent } = res();
    await handler({ method: "GET", query: { symbol: "BTC" } } as never, api as never);
    const body = sent.body as { available: boolean; note: string };
    expect(body.available).toBe(false);
    expect(body.note).toContain("500");
  });
});
