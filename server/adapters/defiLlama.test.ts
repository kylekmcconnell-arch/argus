import { describe, expect, it } from "vitest";
import { collectProtocolTvl, defiLlamaSlug, formatTvlUsd } from "./defiLlama";

const protocolBody = (over: Record<string, unknown> = {}) => ({
  name: "Aave",
  symbol: "AAVE",
  gecko_id: "aave",
  currentChainTvls: {
    Ethereum: 11_000_000_000,
    Arbitrum: 400_000_000,
    borrowed: 9_000_000_000, // pseudo-segment — must be excluded
    "Ethereum-staking": 200_000_000, // pseudo-segment — must be excluded
  },
  tvl: [
    { date: 1, totalLiquidityUSD: 100 },
    { date: 2, totalLiquidityUSD: 13_700_000_000 },
  ],
  ...over,
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const fetcherReturning = (make: () => Response) =>
  ((_input: string | URL | Request) => Promise.resolve(make())) as unknown as typeof fetch;

describe("collectProtocolTvl", () => {
  it("returns the latest TVL and a chain breakdown, excluding pseudo-segments", async () => {
    const out = await collectProtocolTvl("Aave", { fetcher: fetcherReturning(() => jsonResponse(protocolBody())) });
    expect(out.available).toBe(true);
    if (!out.available) throw new Error("expected available");
    expect(out.value.tvlUsd).toBe(13_700_000_000);
    expect(out.value.symbol).toBe("AAVE");
    expect(out.value.geckoId).toBe("aave");
    expect(out.value.chainBreakdown.map((c) => c.chain)).toEqual(["Ethereum", "Arbitrum"]);
    expect(out.value.chains).toEqual(["Ethereum", "Arbitrum"]);
    expect(out.value.sourceUrl).toBe("https://defillama.com/protocol/aave");
  });

  it("treats a 400 (protocol not found) as a completed no-match, not an outage", async () => {
    const out = await collectProtocolTvl("Nonexistent Thing", {
      fetcher: fetcherReturning(() => new Response("Protocol not found", { status: 400 })),
    });
    expect(out.available).toBe(false);
    if (out.available) throw new Error("expected unavailable");
    expect(out.note).toContain("No DeFiLlama protocol matched");
  });

  it("does not claim TVL when the series is empty", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({ tvl: [] }))),
    });
    expect(out.available).toBe(false);
  });

  it("does not claim TVL when the latest point is zero or non-numeric", async () => {
    const out = await collectProtocolTvl("Aave", {
      fetcher: fetcherReturning(() => jsonResponse(protocolBody({ tvl: [{ date: 2, totalLiquidityUSD: 0 }] }))),
    });
    expect(out.available).toBe(false);
  });

  it("is resilient to a transport error", async () => {
    const throwing = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    const out = await collectProtocolTvl("Aave", { fetcher: throwing });
    expect(out.available).toBe(false);
  });

  it("respects an explicit slug override", async () => {
    let seen = "";
    const spy = ((input: string | URL | Request) => {
      seen = String(input);
      return Promise.resolve(jsonResponse(protocolBody({ name: "Aave V3" })));
    }) as unknown as typeof fetch;
    const out = await collectProtocolTvl("Aave", { fetcher: spy, slug: "aave-v3" });
    expect(seen).toContain("/protocol/aave-v3");
    expect(out.available).toBe(true);
  });
});

describe("defiLlamaSlug", () => {
  it("slugifies a project name", () => {
    expect(defiLlamaSlug("Aave V3")).toBe("aave-v3");
    expect(defiLlamaSlug("  Curve!!  Finance ")).toBe("curve-finance");
    expect(defiLlamaSlug("Uniswap")).toBe("uniswap");
  });
});

describe("formatTvlUsd", () => {
  it("formats compact USD", () => {
    expect(formatTvlUsd(13_699_712_109)).toBe("$13.7B");
    expect(formatTvlUsd(1_500_000)).toBe("$1.5M");
    expect(formatTvlUsd(2_400)).toBe("$2.4K");
    expect(formatTvlUsd(500)).toBe("$500");
  });
});
