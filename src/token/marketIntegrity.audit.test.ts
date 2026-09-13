// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditToken } from "./audit";
import { tokenCompositionRow } from "../lib/tokenPresentation";
import { orderByPlainAxis } from "../lib/dimensionChapters";

const ADDRESS = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const uniShapedPair = {
  chainId: "ethereum",
  dexId: "0xF028F723ED1D0fE01cC59973C49298AA95c57472",
  pairAddress: "0x1111111111111111111111111111111111111111",
  baseToken: { address: ADDRESS, name: "Uniswap", symbol: "UNI" },
  quoteToken: { symbol: "USDC" },
  liquidity: { usd: 162_220_055 },
  marketCap: 5_495_026_099_675_436,
  fdv: 5_650_000_000,
  volume: { h24: 27_695_047 },
  txns: { h24: { buys: 1, sells: 2 } },
  priceChange: { h24: 1.2 },
  pairCreatedAt: Date.now() - 2175 * 86400000,
};

function stub(pair: unknown, gecko?: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (input: Parameters<typeof fetch>[0]) => {
    const url = String(input);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
    if (url.includes("dexscreener")) return json({ pairs: [pair] });
    if (url.includes("gopluslabs")) return json({ code: 1, result: { [ADDRESS.toLowerCase()]: { is_open_source: "1", owner_address: "0x1", is_honeypot: "0", buy_tax: "0", sell_tax: "0", holder_count: "10", is_in_dex: "1", cannot_sell_all: "0" } } });
    if (url.includes("api.coingecko.com")) {
      return gecko === undefined
        ? json({}, 404)
        : json(gecko);
    }
    return json({});
  }));
}

describe("UNI-shaped market integrity in the token audit", () => {
  it("does not publish a DexScreener overflow as circulating cap, and omits incomplete swap counts", async () => {
    stub(uniShapedPair);
    const dossier = await auditToken({ kind: "token", via: "evm", ref: ADDRESS, chain: "ethereum" }, undefined, { force: true, skipSim: true });
    expect(dossier?.mcap).toBeUndefined();
    expect(dossier?.fdv).toBe(5_650_000_000);
    expect(dossier?.marketEvidence?.mcap).toBe(false);
    expect(dossier?.quoteSymbol).toBe("USDC");
    expect(dossier?.findings.some((finding) => finding.claim.includes("not a usable USD value"))).toBe(true);

    const t1 = dossier!.axes.find((axis) => axis.key === "T1")!;
    expect(t1.rationale).toContain("(UNI/USDC)");
    const t5 = dossier!.axes.find((axis) => axis.key === "T5")!;
    expect(t5.rationale).toContain("Swap counts from this pool were incomplete");
    expect(t5.rationale).not.toMatch(/1 buys/);

    const rows = orderByPlainAxis(dossier!.axes.map(tokenCompositionRow));
    expect(rows.find((row) => row.axis === "T5")?.rationale).toContain("Swap counts from this feed were incomplete");
    expect(rows.find((row) => row.axis === "T3")?.label).toBe("Buy and sell tax");
    expect(rows.find((row) => row.axis === "T3")?.rationale).toContain("This is not total trading cost");
    expect(rows.find((row) => row.axis === "T1")?.rationale).toContain("this pool only");
  });

  it("takes circulating cap from CoinGecko when the pair figure is unusable", async () => {
    stub(uniShapedPair, {
      id: "uniswap",
      market_cap_rank: 26,
      tickers: [{ market: { name: "Binance", identifier: "binance" } }],
      market_data: { market_cap: { usd: 3_976_000_000 }, fully_diluted_valuation: { usd: 5_650_000_000 } },
    });
    const dossier = await auditToken({ kind: "token", via: "evm", ref: ADDRESS, chain: "ethereum" }, undefined, { force: true });
    expect(dossier?.mcap).toBe(3_976_000_000);
    expect(dossier?.fdv).toBe(5_650_000_000);
    expect(dossier?.marketEvidence?.mcap).toBe(true);
    expect(dossier?.findings.some((finding) => finding.claim.includes("taken from CoinGecko"))).toBe(true);
    expect(dossier!.headline).not.toMatch(/Clears the forensic bar|authorities revoked|Team:/i);
  });
});
