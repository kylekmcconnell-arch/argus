// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenMarketPresentation } from "../lib/tokenMarketPresentation";
import { auditToken, type TokenDossier } from "./audit";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const POOL = "0x2222222222222222222222222222222222222222";
const WALLET = "0x4444444444444444444444444444444444444444";
const input = { kind: "token", via: "evm", ref: ADDRESS } as const;
const OVERFLOW = 5.5e15;

const pair = (over: { marketCap?: number; fdv?: number } = {}) => ({
  chainId: "ethereum", dexId: "uniswap", pairAddress: POOL,
  baseToken: { address: ADDRESS, name: "UNI", symbol: "UNI" },
  quoteToken: { address: "0xweth", symbol: "WETH" },
  liquidity: { usd: 25_000_000 },
  fdv: over.fdv ?? 5_670_000_000,
  marketCap: over.marketCap ?? OVERFLOW,
  txns: { h24: { buys: 40, sells: 42 } }, volume: { h24: 8_000_000 },
});

const CLEAN_GOPLUS = {
  is_open_source: "1", is_mintable: "0", transfer_pausable: "0", selfdestruct: "0", is_in_dex: "1",
  buy_tax: "0", sell_tax: "0", cannot_sell_all: "0", is_honeypot: "0", holder_count: "120",
  owner_address: WALLET, hidden_owner: "0", can_take_back_ownership: "0",
  holders: [{ address: WALLET, percent: "0.04", is_contract: 0 }],
};

function stubProviders(opts: { pair?: ReturnType<typeof pair>; gecko?: unknown } = {}) {
  vi.stubGlobal("fetch", vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("/latest/dex/tokens/")) return Response.json({ pairs: [opts.pair ?? pair()] });
    if (u.includes("gopluslabs")) return Response.json({ code: 1, result: { [ADDRESS]: CLEAN_GOPLUS } });
    if (u.includes("/api/bytecode")) return Response.json({ available: false });
    if (u.includes("api.coingecko.com")) {
      return Response.json(opts.gecko ?? {
        id: "uniswap",
        tickers: [{ market: { name: "Binance", identifier: "binance" } }],
        market_cap_rank: 30,
        market_data: {
          market_cap: { usd: 3_960_000_000 },
          fully_diluted_valuation: { usd: 5_670_000_000 },
        },
        links: { homepage: [], twitter_screen_name: "" },
      });
    }
    return Response.json({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DexScreener market cap above the $20T ceiling is unmeasured", () => {
  it("does not publish an overflow pair cap when CoinGecko is unavailable", async () => {
    stubProviders();
    const d = await auditToken(input, undefined, { force: true, skipSim: true });
    expect(d?.mcap).not.toBe(OVERFLOW);
    expect(d?.marketEvidence?.mcap).toBe(false);
    expect(d?.fdv).toBe(5_670_000_000);
    expect(d?.marketEvidence?.fdv).toBe(true);
    expect(JSON.stringify(d!.trace)).not.toContain("5,500,000,000,000,000");
  });

  it("prefers CoinGecko circulating cap and FDV when the pair overflows", async () => {
    stubProviders();
    const d = await auditToken(input, undefined, { force: true });
    expect(d?.mcap).toBe(3_960_000_000);
    expect(d?.fdv).toBe(5_670_000_000);
    expect(d?.marketEvidence?.mcap).toBe(true);
    expect(d?.findings.some((f) => /unlock or dilution overhang/i.test(f.claim))).toBe(false);
  });

  it("hides a frozen overflow cap from presentation even if the receipt claims it was measured", () => {
    expect(tokenMarketPresentation({
      mcap: OVERFLOW, fdv: 5_670_000_000,
      marketEvidence: { mcap: true, fdv: true, liquidityUsd: false, vol24: false, ageDays: false },
    } as TokenDossier)).toEqual({
      marketCap: null,
      fullyDilutedValuation: 5_670_000_000,
      liquidityUsd: null, volume24h: null, ageDays: null,
    });
  });
});
