import { describe, expect, it } from "vitest";
import {
  resolveTokenizedStockUnderlying,
  tokenizedStockPairingSnapshot,
  underlyingTickerCandidate,
} from "./stockHealth";

const chartBody = (meta: Record<string, unknown> = {}) => ({
  chart: {
    result: [{
      meta: {
        symbol: "AAPL",
        currency: "USD",
        fullExchangeName: "NasdaqGS",
        longName: "Apple Inc.",
        instrumentType: "EQUITY",
        regularMarketPrice: 225,
        fiftyTwoWeekHigh: 260,
        fiftyTwoWeekLow: 160,
        ...meta,
      },
      timestamp: [1_750_000_000, 1_750_086_400],
      indicators: { quote: [{ close: [220, 225] }] },
    }],
    error: null,
  },
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetcherReturning = (make: () => Response) =>
  ((input: string | URL | Request) => {
    void input;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;

describe("underlyingTickerCandidate", () => {
  it("reads the tokenized-stock symbol shapes", () => {
    expect(underlyingTickerCandidate("AAPLx")).toEqual({ ticker: "AAPL", pattern: "xstocks" });
    expect(underlyingTickerCandidate("TSLAX")).toEqual({ ticker: "TSLA", pattern: "xstocks" });
    expect(underlyingTickerCandidate("AAPL.d")).toEqual({ ticker: "AAPL", pattern: "dinari" });
    expect(underlyingTickerCandidate("bCSPX")).toEqual({ ticker: "CSPX", pattern: "backed" });
    expect(underlyingTickerCandidate("AAPL")).toEqual({ ticker: "AAPL", pattern: "bare" });
    expect(underlyingTickerCandidate("0xdead")).toBeNull();
  });
});

describe("resolveTokenizedStockUnderlying", () => {
  const okFetcher = fetcherReturning(() => jsonResponse(chartBody()));

  it("never treats an ordinary crypto ticker as stock exposure", async () => {
    const out = await resolveTokenizedStockUnderlying(
      { symbol: "PEPE", name: "Pepe", chain: "ethereum" },
      { fetcher: okFetcher },
    );
    expect(out).toMatchObject({ resolved: false, reason: "not_tokenized_stock" });
  });

  it("binds an xStocks-style symbol whose name declares the issuer the feed confirms", async () => {
    const out = await resolveTokenizedStockUnderlying(
      { symbol: "AAPLx", name: "Apple xStock", chain: "solana" },
      { fetcher: okFetcher },
    );
    expect(out.resolved).toBe(true);
    if (!out.resolved) throw new Error("expected resolved");
    expect(out.record.ticker).toBe("AAPL");
    expect(out.basis[0]).toContain("agrees");
  });

  it("fails closed when the token's declared issuer disagrees with the feed record", async () => {
    const out = await resolveTokenizedStockUnderlying(
      { symbol: "AAPLx", name: "Definitely Not Apple xStock", chain: "solana" },
      { fetcher: okFetcher },
    );
    expect(out).toMatchObject({ resolved: false, reason: "identity_mismatch" });
  });

  it("binds a bare native stock-token symbol only on a stock-token chain", async () => {
    const onRobinhood = await resolveTokenizedStockUnderlying(
      { symbol: "AAPL", name: null, chain: "robinhood" },
      { fetcher: okFetcher },
    );
    expect(onRobinhood.resolved).toBe(true);
    const onSolana = await resolveTokenizedStockUnderlying(
      { symbol: "AAPL", name: null, chain: "solana" },
      { fetcher: okFetcher },
    );
    expect(onSolana).toMatchObject({ resolved: false, reason: "not_tokenized_stock" });
  });

  it("rejects a pattern symbol whose feed record is not an equity", async () => {
    const out = await resolveTokenizedStockUnderlying(
      { symbol: "AAPLx", name: "Apple xStock", chain: "solana" },
      { fetcher: fetcherReturning(() => jsonResponse(chartBody({ instrumentType: "ETF" }))) },
    );
    expect(out).toMatchObject({ resolved: false, reason: "identity_mismatch" });
  });

  it("keeps outages distinct from a missing listing", async () => {
    expect(await resolveTokenizedStockUnderlying(
      { symbol: "AAPLx", name: "Apple xStock", chain: "solana" },
      { fetcher: fetcherReturning(() => jsonResponse({}, 500)) },
    )).toMatchObject({ resolved: false, reason: "unavailable" });
    expect(await resolveTokenizedStockUnderlying(
      { symbol: "ZZZQx", name: "ZZZQ xStock", chain: "solana" },
      { fetcher: fetcherReturning(() => jsonResponse({ chart: { result: null, error: { description: "No data found" } } }, 404)) },
    )).toMatchObject({ resolved: false, reason: "no_data" });
  });

  it("assembles a frozen pairing snapshot with the exposure and basis", async () => {
    const side = { symbol: "AAPLx", name: "Apple xStock", chain: "solana" };
    const out = await resolveTokenizedStockUnderlying(side, { fetcher: okFetcher });
    if (!out.resolved) throw new Error("expected resolved");
    const snapshot = tokenizedStockPairingSnapshot("token_is_tokenized_stock", side, out);
    expect(snapshot).toMatchObject({
      mode: "point_in_time",
      scoringImpact: "none",
      exposure: "token_is_tokenized_stock",
      tokenizedSymbol: "AAPLx",
      underlying: { ticker: "AAPL", feedLongName: "Apple Inc.", pennyStock: false },
    });
    expect(snapshot.basis.length).toBeGreaterThan(0);
  });
});
