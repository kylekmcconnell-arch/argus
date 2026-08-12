import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The route is the unit under test, so the two src/polymarket entry points are
// stubbed the way deployer-origin.test.ts stubs _cache and _auth. Only
// fetchTraderRecord is replaced inside trader.js: the wallet rules stay the real
// ones, because "rejected before spending a call" is worth nothing if the thing
// doing the rejecting is a mock. The stub fetcher still goes out over global
// fetch, which keeps the network the observable boundary.
//
// Mocking _cache also proves this route never reaches for the panel-cost
// machinery. resolvePanelCostVersion is the gate that 409s a live scan, and
// this suite asserts it is never consulted.
const { analyzeRecord, cacheGetJson, cacheSetJson, fetchTraderRecord, requireArgusAuth, resolvePanelCostVersion } = vi.hoisted(() => ({
  analyzeRecord: vi.fn(),
  cacheGetJson: vi.fn(),
  cacheSetJson: vi.fn(),
  fetchTraderRecord: vi.fn(),
  requireArgusAuth: vi.fn(),
  resolvePanelCostVersion: vi.fn(),
}));

vi.mock("./_auth.js", () => ({ requireArgusAuth }));
vi.mock("./_cache.js", () => ({ cacheGetJson, cacheSetJson, resolvePanelCostVersion }));
vi.mock("../src/polymarket/trader.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/polymarket/trader.js")>()),
  fetchTraderRecord,
}));
vi.mock("../src/polymarket/record.js", () => ({ analyzeRecord }));

import { INVALID_INPUT_MESSAGE } from "../src/polymarket/trader.js";
import handler from "./polymarket-trader";

// Subject throughout: the wallet @0xSurferX published beside a "passive $6k a
// month" claim, read live on 2026-08-01. Figures are the verified ones.
const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";
const PROFIT = 9964.3;
const VOLUME = 403462.2;

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

// The seven keyless endpoints the lane verified, keyed by host + path so the
// stub does not care how the adapter spells its query string.
function polymarketFetch(down: string[] = []) {
  return vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    const route = `${url.hostname}${url.pathname}`;
    if (down.includes(route)) return new Response("upstream error", { status: 500 });
    switch (route) {
      case "lb-api.polymarket.com/profit":
        return json([{ amount: PROFIT, pseudonym: "macau.weather", name: null }]);
      case "lb-api.polymarket.com/volume":
        return json([{ amount: VOLUME }]);
      case "data-api.polymarket.com/value":
        return json([{ user: WALLET, value: 544.24 }]);
      case "data-api.polymarket.com/traded":
        return json({ user: WALLET, traded: 592 });
      case "data-api.polymarket.com/positions":
        return json([
          { title: "Will BTC close above 90k in August?", cashPnl: -142.5, currentValue: 310.4 },
          { title: "Fed cuts in September?", cashPnl: -54.3, currentValue: 233.84 },
        ]);
      case "data-api.polymarket.com/activity":
        return json([
          { timestamp: 1780099200, type: "TRADE", usdcSize: 120 },
          { timestamp: 1785628800, type: "TRADE", usdcSize: 240 },
        ]);
      case "user-pnl-api.polymarket.com/user-pnl":
        return json([{ t: 1780099200, p: 0 }, { t: 1785628800, p: 9970.38 }]);
      default:
        return new Response("not found", { status: 404 });
    }
  });
}

// A stand-in for the adapter that reads the same endpoints the real one does and
// records one sentence per endpoint that did not answer. What the route is being
// tested on is what it does with failures[], not how the adapter fills it.
async function stubAdapter(wallet: string) {
  const calls: Array<[string, string]> = [
    ["profit", `https://lb-api.polymarket.com/profit?window=all&limit=1&address=${wallet}`],
    ["volume", `https://lb-api.polymarket.com/volume?window=all&limit=1&address=${wallet}`],
    ["value", `https://data-api.polymarket.com/value?user=${wallet}`],
    ["traded", `https://data-api.polymarket.com/traded?user=${wallet}`],
    ["positions", `https://data-api.polymarket.com/positions?user=${wallet}&limit=500`],
    ["activity", `https://data-api.polymarket.com/activity?user=${wallet}&limit=500`],
    ["pnl", `https://user-pnl-api.polymarket.com/user-pnl?user_address=${wallet}&interval=all&fidelity=1d`],
  ];
  const answered: Record<string, any> = {};
  const failures: string[] = [];
  for (const [name, url] of calls) {
    const r = await fetch(url);
    if (r.ok) answered[name] = await r.json();
    else failures.push(`Polymarket ${name} did not answer.`);
  }
  const positions = (answered.positions ?? []).map((p: any) => ({ title: p.title, cashPnlUsd: p.cashPnl, currentValueUsd: p.currentValue }));
  return {
    wallet,
    displayName: answered.profit?.[0]?.pseudonym ?? null,
    profitUsd: answered.profit?.[0]?.amount ?? null,
    volumeUsd: answered.volume?.[0]?.amount ?? null,
    portfolioValueUsd: answered.value?.[0]?.value ?? null,
    marketsTraded: answered.traded?.traded ?? null,
    rank: null,
    firstTradeAt: answered.activity ? "2026-06-10T00:00:00.000Z" : null,
    lastTradeAt: answered.activity ? "2026-08-01T00:00:00.000Z" : null,
    pnlSeries: (answered.pnl ?? []).map((p: any) => ({ at: new Date(p.t * 1000).toISOString(), cumulativeUsd: p.p })),
    openPositions: positions,
    unrealizedPnlUsd: answered.positions ? positions.reduce((s: number, p: any) => s + p.cashPnlUsd, 0) : null,
    failures,
  };
}

// A 53-day window cannot support an annualised claim, so the derivation reports
// the window and a backward-looking monthly average with the caveat attached.
const ANALYSIS = {
  windowDays: 53,
  returnOnVolumePct: 2.47,
  maxDrawdownUsd: 982,
  maxDrawdownPct: 9.6,
  greenDayPct: 69.8,
  bestDayUsd: 1612,
  worstDayUsd: -847,
  recentSharePct: 81.1,
  monthlyRateUsd: 5639.4,
  notes: ["The record is 53 days long, which is too short to project forward."],
};

async function run(query: Record<string, string>, method = "GET") {
  const captured: { status?: number; body?: any } = {};
  const res = {
    status(code: number) { captured.status = code; return this; },
    json(body: unknown) { captured.body = body; return this; },
  };
  await handler({ method, query, headers: {} } as never, res as never);
  return captured;
}

describe("GET /api/polymarket-trader", () => {
  beforeEach(() => {
    requireArgusAuth.mockReset();
    resolvePanelCostVersion.mockReset();
    cacheGetJson.mockReset().mockResolvedValue(null);
    cacheSetJson.mockReset().mockResolvedValue(undefined);
    fetchTraderRecord.mockReset().mockImplementation(stubAdapter);
    analyzeRecord.mockReset().mockReturnValue(ANALYSIS);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-08-01T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("serves the record and the derivation without a persisted report version", async () => {
    vi.stubGlobal("fetch", polymarketFetch());

    const { status, body } = await run({ wallet: WALLET });

    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.partial).toBe(false);
    expect(resolvePanelCostVersion).not.toHaveBeenCalled();
    expect(body.record).toMatchObject({ wallet: WALLET, profitUsd: PROFIT, volumeUsd: VOLUME, marketsTraded: 592 });
    // Realized and unrealized stay separate figures: the sum of the open
    // positions' cashPnl is a different question from the profit endpoint.
    expect(body.record.unrealizedPnlUsd).toBeCloseTo(-196.8, 5);
    expect(body.record.profitUsd).toBe(PROFIT);
  });

  // Two code paths that word the same fact differently is the defect this lane
  // was told to avoid, so the route hands back exactly what record.ts derived.
  it("returns the derivation it was given rather than recomputing one", async () => {
    vi.stubGlobal("fetch", polymarketFetch());

    const { body } = await run({ wallet: WALLET });

    expect(analyzeRecord).toHaveBeenCalledTimes(1);
    expect(analyzeRecord).toHaveBeenCalledWith(body.record);
    expect(body.analysis).toEqual(ANALYSIS);
    expect(body.analysis.windowDays).toBe(53);
  });

  // A published wallet proves that wallet's record and nothing about who holds
  // its keys, the same proven-vs-attributed split DeployerAttribution draws.
  it("never presents the wallet as proof of who owns it", async () => {
    vi.stubGlobal("fetch", polymarketFetch());

    const { body } = await run({ wallet: WALLET });

    expect(body.attribution.kind).toBe("published-wallet");
    expect(body.attribution.proves).toBe("the trading record of this wallet");
    expect(body.attribution.doesNotProve).toEqual([
      "that the account which published it holds its keys",
      "that the same person trades no other wallet",
    ]);
  });

  it("reads the wallet out of a polymarket profile link", async () => {
    vi.stubGlobal("fetch", polymarketFetch());

    const { status, body } = await run({ wallet: `https://polymarket.com/profile/${WALLET}` });

    expect(status).toBe(200);
    expect(body.wallet).toBe(WALLET);
    expect(body.record.profitUsd).toBe(PROFIT);
  });

  it("rejects an address that cannot answer before spending a call", async () => {
    const fetchMock = polymarketFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { status, body } = await run({ wallet: "0xSurferX" });

    expect(status).toBe(400);
    expect(body).toEqual({ error: INVALID_INPUT_MESSAGE });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fetchTraderRecord).not.toHaveBeenCalled();
  });

  // An X handle is not resolvable to a wallet. Guessing one would pin a
  // stranger's record on a person, so the claim is simply not checkable.
  it("does not guess a wallet for a handle", async () => {
    const fetchMock = polymarketFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { status } = await run({ wallet: "@0xSurferX" });

    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // An address in some other site's profile path was not published by
  // Polymarket as this trader's wallet, so it is not one.
  it("does not accept a profile path on another host", async () => {
    const fetchMock = polymarketFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { status } = await run({ wallet: `https://polymarket.com.example.net/profile/${WALLET}` });

    expect(status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // EVM identity is case-insensitive, so a checksummed address and a lowercased
  // one are one subject: one cache entry, and one spelling in the reply.
  it("answers a checksummed address under its canonical spelling", async () => {
    vi.stubGlobal("fetch", polymarketFetch());

    const { body } = await run({ wallet: `0x4989BFED5900BA096B08BA1F9B718464527C983E` });

    expect(body.wallet).toBe(WALLET);
    expect(body.record.wallet).toBe(WALLET);
    expect(String(cacheSetJson.mock.calls[0][0])).toContain(WALLET);
  });

  it("refuses a method that is not GET before spending a call", async () => {
    const fetchMock = polymarketFetch();
    vi.stubGlobal("fetch", fetchMock);

    const { status, body } = await run({ wallet: WALLET }, "POST");

    expect(status).toBe(405);
    expect(body).toEqual({ error: "GET required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // A missing endpoint leaves an unmeasured field, never a zero, and the fields
  // that did answer are still worth serving.
  it("still returns the fields that answered when one provider is down", async () => {
    vi.stubGlobal("fetch", polymarketFetch(["data-api.polymarket.com/positions"]));

    const { status, body } = await run({ wallet: WALLET });

    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.partial).toBe(true);
    expect(body.record.profitUsd).toBe(PROFIT);
    expect(body.record.marketsTraded).toBe(592);
    expect(body.record.unrealizedPnlUsd).toBeNull();
    expect(body.record.openPositions).toEqual([]);
    expect(body.record.failures).toEqual(["Polymarket positions did not answer."]);
  });

  // The one that matters: a provider outage frozen into the cache would serve
  // the next caller a gap it cannot see.
  it("never caches a record that has a failure in it", async () => {
    vi.stubGlobal("fetch", polymarketFetch(["data-api.polymarket.com/positions"]));

    await run({ wallet: WALLET });

    expect(cacheSetJson).not.toHaveBeenCalled();
  });

  it("caches a complete record on the wallet and serves it inside the TTL", async () => {
    vi.stubGlobal("fetch", polymarketFetch());
    await run({ wallet: WALLET });

    expect(cacheSetJson).toHaveBeenCalledTimes(1);
    const [key, value] = cacheSetJson.mock.calls[0] as [string, any];
    expect(key).toContain(WALLET);
    expect(value.record.profitUsd).toBe(PROFIT);

    cacheGetJson.mockResolvedValue(value);
    const fetchMock = polymarketFetch();
    vi.stubGlobal("fetch", fetchMock);
    fetchTraderRecord.mockClear();
    vi.setSystemTime(Date.now() + 60_000);

    const { body } = await run({ wallet: WALLET });

    expect(body._cached).toBe(true);
    expect(body.record.profitUsd).toBe(PROFIT);
    expect(body.analysis).toEqual(ANALYSIS);
    expect(fetchTraderRecord).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // An open position's value moves with the market, so a record held past the
  // short TTL is answering today's question with an older curve.
  it("re-reads the record once the short TTL has passed", async () => {
    vi.stubGlobal("fetch", polymarketFetch());
    await run({ wallet: WALLET });
    const [, value] = cacheSetJson.mock.calls[0] as [string, any];

    cacheGetJson.mockResolvedValue(value);
    fetchTraderRecord.mockClear();
    vi.setSystemTime(Date.now() + 6 * 60 * 1000);
    vi.stubGlobal("fetch", polymarketFetch());

    const { body } = await run({ wallet: WALLET });

    expect(body._cached).toBeUndefined();
    expect(fetchTraderRecord).toHaveBeenCalledTimes(1);
  });

  it("reports a lookup that never completed, and caches nothing", async () => {
    fetchTraderRecord.mockRejectedValue(new Error("polymarket unreachable"));
    vi.stubGlobal("fetch", polymarketFetch());

    const { status, body } = await run({ wallet: WALLET });

    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.note).toBe("Polymarket record lookup failed.");
    expect(body.record).toBeUndefined();
    expect(cacheSetJson).not.toHaveBeenCalled();
  });
});
