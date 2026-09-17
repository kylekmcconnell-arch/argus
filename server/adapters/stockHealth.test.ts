import { describe, expect, it } from "vitest";
import { collectStockHealth, computeSeriesHealth, issuerNamesAgree } from "./stockHealth";

const LISTING = {
  ticker: "EXMP",
  issuer: "Example Corp",
  exchange: "NASDAQ",
  registryFactId: "fact-listing",
  registrySourceUrl: "https://www.sec.gov/files/company_tickers_exchange.json",
};

const DAY = 86_400;
const start = 1_750_000_000;

const chartBody = (over: {
  meta?: Record<string, unknown>;
  closes?: Array<number | null>;
} = {}) => {
  const closes = over.closes ?? Array.from({ length: 251 }, (_, i) => 100 + i * 0.5);
  return {
    chart: {
      result: [{
        meta: {
          symbol: "EXMP",
          currency: "USD",
          fullExchangeName: "NasdaqGS",
          longName: "Example Corp",
          instrumentType: "EQUITY",
          regularMarketPrice: closes.filter((c): c is number => c !== null).at(-1) ?? 0,
          fiftyTwoWeekHigh: 230,
          fiftyTwoWeekLow: 100,
          ...over.meta,
        },
        timestamp: closes.map((_, i) => start + i * DAY),
        indicators: { quote: [{ close: closes }] },
      }],
      error: null,
    },
  };
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetcherReturning = (make: () => Response) =>
  ((input: string | URL | Request) => {
    void input;
    return Promise.resolve(make());
  }) as unknown as typeof fetch;

describe("issuerNamesAgree", () => {
  it("agrees across legal-suffix noise, one-way containment, and nothing else", () => {
    expect(issuerNamesAgree("Example Corp", "Example Corp.")).toBe(true);
    expect(issuerNamesAgree("Coinbase Global", "Coinbase Global, Inc.")).toBe(true);
    expect(issuerNamesAgree("Apple", "Apple Inc.")).toBe(true);
    expect(issuerNamesAgree("Example Corp", "Exemplar Holdings")).toBe(false);
    expect(issuerNamesAgree("Inc", "Inc")).toBe(false); // suffix-only names carry no identity
  });
});

describe("computeSeriesHealth", () => {
  it("computes trend, drawdown, and volatility from a close series", () => {
    const points = Array.from({ length: 251 }, (_, i) => ({
      date: new Date((start + i * DAY) * 1000).toISOString().slice(0, 10),
      close: i < 125 ? 100 + i : 225 - (i - 125) * 0.5,
    }));
    const health = computeSeriesHealth(points);
    expect(health.change1yPct).not.toBeNull();
    expect(health.maxDrawdown1yPct).toBeLessThan(0);
    expect(health.annualizedVolatilityPct).not.toBeNull();
    expect(health.trend.length).toBeGreaterThan(40);
    expect(health.trend.at(-1)).toEqual(points.at(-1));
  });

  it("handles an empty series without inventing readings", () => {
    const health = computeSeriesHealth([]);
    expect(health.change30dPct).toBeNull();
    expect(health.change1yPct).toBeNull();
    expect(health.annualizedVolatilityPct).toBeNull();
    expect(health.trend).toHaveLength(0);
  });
});

describe("collectStockHealth", () => {
  it("freezes a full health snapshot for an agreeing equity record", async () => {
    const out = await collectStockHealth(LISTING, { fetcher: fetcherReturning(() => jsonResponse(chartBody())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value).toMatchObject({
      mode: "point_in_time",
      scoringImpact: "none",
      ticker: "EXMP",
      issuer: "Example Corp",
      currency: "USD",
      pennyStock: false,
      binding: { registryFactId: "fact-listing", feedLongName: "Example Corp", instrumentType: "EQUITY" },
    });
    expect(out.value.fiftyTwoWeekPositionPct).not.toBeNull();
    expect(out.value.change1yPct).not.toBeNull();
    expect(out.value.trend.length).toBeGreaterThan(40);
  });

  it("marks a sub-$5 USD price as penny-stock range", async () => {
    const closes = Array.from({ length: 251 }, () => 3.2);
    const out = await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse(chartBody({ closes, meta: { fiftyTwoWeekHigh: 4, fiftyTwoWeekLow: 2 } }))),
    });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.pennyStock).toBe(true);
  });

  it("withholds the snapshot when the feed record is not an equity", async () => {
    const out = await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse(chartBody({ meta: { instrumentType: "CRYPTOCURRENCY" } }))),
    });
    expect(out).toMatchObject({ available: false, reason: "identity_mismatch" });
  });

  it("withholds the snapshot when neither issuer name nor exchange corroborates", async () => {
    const out = await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse(chartBody({
        meta: { longName: "Different Industries", fullExchangeName: "LSE" },
      }))),
    });
    expect(out).toMatchObject({ available: false, reason: "identity_mismatch" });
  });

  it("accepts an exchange-corroborated record whose long name is absent", async () => {
    const out = await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse(chartBody({ meta: { longName: null } }))),
    });
    expect(out.available).toBe(true);
  });

  it("keeps outage, missing listing, and identity mismatch distinct", async () => {
    expect(await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse({ chart: { result: null, error: { code: "Not Found", description: "No data found, symbol may be delisted" } } }, 404)),
    })).toMatchObject({ available: false, reason: "no_data" });
    expect(await collectStockHealth(LISTING, {
      fetcher: fetcherReturning(() => jsonResponse({ boom: true }, 500)),
    })).toMatchObject({ available: false, reason: "unavailable" });
    expect(await collectStockHealth(LISTING, {
      fetcher: (() => Promise.reject(new Error("socket hang up"))) as unknown as typeof fetch,
    })).toMatchObject({ available: false, reason: "unavailable" });
  });

  it("refuses a ticker the market feed URL scheme cannot express", async () => {
    const out = await collectStockHealth({ ...LISTING, ticker: "not a ticker" }, {
      fetcher: fetcherReturning(() => jsonResponse(chartBody())),
    });
    expect(out).toMatchObject({ available: false, reason: "no_data" });
  });
});
