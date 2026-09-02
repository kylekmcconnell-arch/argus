import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import type { CollectContext } from "./types";
import {
  bioTickerQueries,
  cleanRegistryName,
  collectProjectTokenIdentity,
  launchedProductSearchQueries,
  PLATFORM_CHAIN,
  projectRegistrySearchQueries,
  siteContractCandidates,
  tokenSearchQueries,
} from "./projectToken";

const SOLANA_TOKEN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER_TOKEN = "So11111111111111111111111111111111111111112";
const SSR_TOKEN = "BpdHpqznEgYPXZNrJVRZvBhdWoafYLVVuLxTQo34pump";
const SSR_POOL = "C2TLNU8AwnaWrnAGhQm4X6y9T79mcMnmbKTMsYGPHKJd";
const PONS_TOKEN = "0x39dBED3a2bd333467115dE45665cC57F813C4571";
const PONS_POOL = "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA";
/** Seconds between two daily GeckoTerminal candles. */
const DAY = 86_400;

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json" },
});

function context(handle = "@projectdex", displayName = "Project Dex", website = "https://project.example/") {
  const evidence = emptyEvidence(handle);
  evidence.profile.display_name = displayName;
  evidence.profile.website = website;
  evidence.profile.profile_collection_state = "resolved";
  evidence.profile.profile_provider = "twitterapi";
  evidence.profile.profile_captured_at = "2026-07-12T17:00:00.000Z";
  const ctx: CollectContext = { handle, evidence, emit: vi.fn(), recordCheck: vi.fn() };
  return { ctx, evidence };
}

const search = (overrides: Record<string, unknown> = {}) => ({
  coins: [{ id: "project-token", name: "Project Dex", symbol: "PDX", market_cap_rank: 42, ...overrides }],
});

const details = (overrides: Record<string, unknown> = {}) => ({
  id: "project-token",
  name: "Project Dex",
  symbol: "pdx",
  asset_platform_id: "solana",
  market_cap_rank: 42,
  last_updated: "2026-07-12T16:55:00.000Z",
  platforms: { solana: SOLANA_TOKEN },
  links: { twitter_screen_name: "projectdex", homepage: ["https://project.example/"] },
  market_data: {
    current_price: { usd: 0.5 },
    market_cap: { usd: 500_000_000 },
    fully_diluted_valuation: { usd: 750_000_000 },
    total_volume: { usd: 40_000_000 },
    ath: { usd: 4.75 },
    ath_date: { usd: "2025-01-06T00:00:00.000Z" },
    ath_change_percentage: { usd: -89.47 },
  },
  ...overrides,
});

const pair = (overrides: Record<string, unknown> = {}) => {
  const pairAddress = typeof overrides.pairAddress === "string" ? overrides.pairAddress : "pool-valid";
  return {
    chainId: "solana",
    pairAddress,
    url: `https://dexscreener.com/solana/${pairAddress}`,
    baseToken: { address: SOLANA_TOKEN, symbol: "PDX" },
    quoteToken: { address: OTHER_TOKEN, symbol: "USDC" },
    priceUsd: "0.51",
    liquidity: { usd: 5_000_000 },
    ...overrides,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verified project-token collection", () => {
  it("binds SSR to the exact contract declared by its official X profile without requiring a website or CoinGecko", async () => {
    const { ctx, evidence } = context("@strategicsuperr", "Strategic Super Reserve SSR", "");
    evidence.profile.bio = `The Strategic Super Reserve by @EnigmaFund Venture Capital: Multichain DTFs to support builders & communities. CA: ${SSR_TOKEN}`;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/tokens/")) return json({
        pairs: [{
          chainId: "solana",
          pairAddress: SSR_POOL,
          url: `https://dexscreener.com/solana/${SSR_POOL}`,
          baseToken: { address: SSR_TOKEN, name: "Strategic Super Reserve", symbol: "SSR" },
          quoteToken: { address: OTHER_TOKEN, symbol: "SOL" },
          priceUsd: "0.0006793",
          marketCap: 679_334,
          fdv: 679_334,
          volume: { h24: 218_441 },
          liquidity: { usd: 68_520 },
          info: { imageUrl: "https://cdn.dexscreener.com/ssr.png" },
        }],
      });
      if (url.includes("/ohlcv/day?")) return json({
        data: { attributes: { ohlcv_list: [
          [300, 0.0006, 0.0008, 0.0005, 0.0006793, 70_000],
          [200, 0.0005, 0.0007, 0.0004, 0.0006, 60_000],
          [100, 0.0004, 0.0006, 0.0003, 0.0005, 50_000],
        ] } },
      });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await collectProjectTokenIdentity(ctx),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({
      state: "executed",
      detail: expect.stringContaining("exact contract explicitly declared"),
      attempts: 2,
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      name: "Strategic Super Reserve",
      symbol: "SSR",
      rank: null,
      address: SSR_TOKEN,
      chain: "solana",
      officialX: "@strategicsuperr",
      sourceUrl: "https://x.com/strategicsuperr",
      priceUsd: 0.0006793,
      marketCapUsd: 679_334,
      fdvUsd: 679_334,
      volume24hUsd: 218_441,
      liquidityUsd: 68_520,
      pairAddress: SSR_POOL,
      imageUrl: "https://cdn.dexscreener.com/ssr.png",
      providers: ["twitterapi", "dexscreener", "geckoterminal"],
      producerSources: {
        identity: {
          provider: "twitterapi",
          sourceUrl: "https://x.com/strategicsuperr",
          capturedAt: "2026-07-12T17:00:00.000Z",
        },
        market: { provider: "dexscreener" },
        liquidity: { provider: "dexscreener" },
        history: { provider: "geckoterminal" },
      },
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
      provider: "twitterapi/dexscreener",
    }));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-product-substance",
      status: "confirmed",
      provider: "twitterapi/dexscreener",
      note: expect.stringContaining("live token-native product"),
    }));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-traction-liveness",
      status: "confirmed",
      provider: "dexscreener/geckoterminal",
    }));
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "dexscreener", op: "project-token-pairs", calls: 1, succeeded: 1 }),
      expect.objectContaining({ provider: "geckoterminal", op: "project-token-ohlcv-day", calls: 1, succeeded: 1 }),
    ]));
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("coingecko"))).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("accepts an exact official X match and freezes market plus bounded pool history", async () => {
    const { ctx, evidence } = context();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [pair()] });
      if (url.includes("/ohlcv/day?")) return json({
        data: { attributes: { ohlcv_list: [
          [300, 0.6, 0.7, 0.49, 0.5, 100],
          [100, 0.4, 0.45, 0.38, 0.4, 80],
          [200, 0.4, 0.65, 0.39, 0.6, 90],
        ] } },
      });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await collectProjectTokenIdentity(ctx),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({ state: "executed", detail: expect.stringContaining("official_x"), attempts: 4 });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "PDX",
      address: SOLANA_TOKEN,
      chain: "solana",
      priceUsd: 0.5,
      marketCapUsd: 500_000_000,
      fdvUsd: 750_000_000,
      volume24hUsd: 40_000_000,
      liquidityUsd: 5_000_000,
      pairAddress: "pool-valid",
      ath: {
        priceUsd: 4.75,
        date: "2025-01-06T00:00:00.000Z",
        drawdownPct: -89.47,
      },
      providers: ["coingecko", "dexscreener", "geckoterminal"],
      capturedAt: expect.any(String),
      producerSources: {
        identity: {
          provider: "coingecko",
          sourceUrl: "https://www.coingecko.com/en/coins/project-token",
          capturedAt: expect.any(String),
        },
        market: {
          provider: "coingecko",
          sourceUrl: "https://www.coingecko.com/en/coins/project-token",
          capturedAt: expect.any(String),
          providerUpdatedAt: "2026-07-12T16:55:00.000Z",
        },
        liquidity: {
          provider: "dexscreener",
          sourceUrl: "https://dexscreener.com/solana/pool-valid",
          capturedAt: expect.any(String),
        },
        history: {
          provider: "geckoterminal",
          sourceUrl: "https://api.geckoterminal.com/api/v2/networks/solana/pools/pool-valid/ohlcv/day?aggregate=1&limit=90&currency=usd",
          capturedAt: expect.any(String),
        },
      },
      history: {
        points: [0.4, 0.6, 0.5],
        first: 0.4,
        last: 0.5,
        peak: 0.6,
        changePct: expect.closeTo(25, 5),
        drawdownPct: expect.closeTo(-16.6667, 3),
        timeframe: "day",
        poolAddress: "pool-valid",
        sourceUrl: "https://api.geckoterminal.com/api/v2/networks/solana/pools/pool-valid/ohlcv/day?aggregate=1&limit=90&currency=usd",
        capturedAt: expect.any(String),
      },
    });
    expect(evidence.projectToken?.producerSources?.liquidity?.capturedAt).not.toBe("2026-07-12T16:55:00.000Z");
    expect(evidence.projectToken?.producerSources?.history?.capturedAt).not.toBe("2026-07-12T16:55:00.000Z");
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "coingecko", op: "project-search", calls: 1, succeeded: 1 }),
      expect.objectContaining({ provider: "coingecko", op: "project-details", calls: 1, succeeded: 1 }),
      expect.objectContaining({ provider: "dexscreener", op: "project-token-pairs", calls: 1, succeeded: 1 }),
      expect.objectContaining({ provider: "geckoterminal", op: "project-token-ohlcv-day", calls: 1, succeeded: 1 }),
    ]));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity", status: "confirmed", provider: "coingecko",
    }));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-traction-liveness", status: "confirmed", provider: "dexscreener/geckoterminal",
    }));
  });

  it("freezes the intraday range, the volume trend and the partial window, not just the closes", async () => {
    const { ctx, evidence } = context();
    // Fourteen daily candles that skip days 8 and 9, close flat all the way
    // through, run 40x inside day 12 alone, and stop trading in the back half.
    // On closes this token is indistinguishable from one that never moved.
    const quiet = [
      ...Array.from({ length: 7 }, (_, index) => [(index + 1) * DAY, 0.5, 0.52, 0.48, 0.5, 100_000]),
      ...Array.from({ length: 7 }, (_, index) => [
        (index + 10) * DAY,
        0.5,
        index === 2 ? 20 : 0.52,
        0.48,
        0.5,
        5_000,
      ]),
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [pair()] });
      if (url.includes("/ohlcv/day?")) return json({ data: { attributes: { ohlcv_list: [...quiet].reverse() } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    const history = evidence.projectToken?.history;
    expect(history?.peak).toBe(0.5);
    expect(history?.drawdownPct).toBeCloseTo(0, 6);
    expect(history?.range).toMatchObject({ high: 20, low: 0.48, measuredPoints: 14 });
    expect(history?.range?.drawdownFromHighPct).toBeCloseTo(-97.5, 3);
    expect(history?.range?.highs).toHaveLength(14);
    expect(history?.volume).toMatchObject({
      recent: { usd: 35_000, candles: 7, measured: 7 },
      prior: { usd: 700_000, candles: 7, measured: 7 },
      isFloor: false,
    });
    expect(history).toMatchObject({ spanPeriods: 16, windowIsPartial: true });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-traction-liveness",
      note: expect.stringContaining("14 frozen day price points across a partly reported 16 day window, with reported volume down 95% against the prior 7 days"),
    }));
  });

  it("keeps a candle whose volume column is missing and calls that volume a floor", async () => {
    const { ctx, evidence } = context();
    const rows = Array.from({ length: 14 }, (_, index) => index === 13
      ? [(index + 1) * DAY, 0.5, 0.52, 0.48, 0.5]
      : [(index + 1) * DAY, 0.5, 0.52, 0.48, 0.5, index < 7 ? 100_000 : 10_000]);
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [pair()] });
      if (url.includes("/ohlcv/day?")) return json({ data: { attributes: { ohlcv_list: [...rows].reverse() } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    const history = evidence.projectToken?.history;
    // The unpriced day still carried a close, so it stays in the window and its
    // volume is simply unmeasured; the sum it is missing from is a floor.
    expect(history?.points).toHaveLength(14);
    expect(history?.volume).toMatchObject({
      recent: { usd: 60_000, candles: 7, measured: 6 },
      isFloor: true,
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-traction-liveness",
      note: expect.stringContaining("(a floor: not every candle reported volume)"),
    }));
  });

  it("accepts a credible official-domain match when CoinGecko has no X handle", async () => {
    const { ctx, evidence } = context("@project_updates", "Project Dex");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details({ links: { twitter_screen_name: "", homepage: ["https://different.example/", "https://app.project.example/"] } }));
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.projectToken).toMatchObject({ verification: "official_domain", homepage: "https://app.project.example/" });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "project-token-identity", status: "confirmed" }));
    expect(ctx.recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ id: "project-traction-liveness" }));
  });

  it("backfills a missing profile website only from the verified token homepage", async () => {
    const { ctx, evidence } = context("@projectdex", "Project Dex", "");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.profile.website).toBe("https://project.example/");
  });

  it("resolves a new Robinhood Chain token from an exact DexScreener X/domain binding when CoinGecko is empty", async () => {
    const { ctx, evidence } = context("@ponsdotfamily", "Pons", "https://ponsfamily.com/launchpad");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({
        pairs: [{
          chainId: "robinhood",
          pairAddress: PONS_POOL,
          url: `https://dexscreener.com/robinhood/${PONS_POOL.toLowerCase()}`,
          baseToken: { address: PONS_TOKEN, name: "Pons", symbol: "PONS" },
          quoteToken: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
          priceUsd: "0.04125",
          marketCap: 32_591_975,
          fdv: 32_591_975,
          volume: { h24: 5_742_660.31 },
          liquidity: { usd: 1_552_550.02 },
          info: {
            websites: [{ url: "https://ponsfamily.com/launchpad", label: "Website" }],
            socials: [{ url: "https://x.com/ponsdotfamily", type: "twitter" }],
          },
        }],
      });
      if (url.includes("/networks/robinhood/") && url.includes("/ohlcv/day?")) return json({
        data: { attributes: { ohlcv_list: [
          [300, 0.03, 0.05, 0.02, 0.04, 1_000],
          [100, 0.01, 0.02, 0.008, 0.01, 500],
          [200, 0.02, 0.04, 0.015, 0.03, 800],
        ] } },
      });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const captured = await withCostLedger(async () => ({
      result: await collectProjectTokenIdentity(ctx),
      cost: getCost(),
    }));

    expect(captured.result).toMatchObject({
      state: "executed",
      detail: expect.stringContaining("identity-bound DEX pair"),
      attempts: 3,
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      name: "Pons",
      symbol: "PONS",
      address: PONS_TOKEN,
      chain: "robinhood",
      homepage: "https://ponsfamily.com/launchpad",
      officialX: "@ponsdotfamily",
      priceUsd: 0.04125,
      marketCapUsd: 32_591_975,
      fdvUsd: 32_591_975,
      volume24hUsd: 5_742_660.31,
      liquidityUsd: 1_552_550.02,
      pairAddress: PONS_POOL,
      providers: ["dexscreener", "geckoterminal"],
      producerSources: {
        identity: {
          provider: "dexscreener",
          sourceUrl: `https://dexscreener.com/robinhood/${PONS_POOL.toLowerCase()}`,
          capturedAt: expect.any(String),
        },
        market: {
          provider: "dexscreener",
          sourceUrl: `https://dexscreener.com/robinhood/${PONS_POOL.toLowerCase()}`,
          capturedAt: expect.any(String),
        },
        liquidity: {
          provider: "dexscreener",
          sourceUrl: `https://dexscreener.com/robinhood/${PONS_POOL.toLowerCase()}`,
          capturedAt: expect.any(String),
        },
        history: {
          provider: "geckoterminal",
          sourceUrl: `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${PONS_POOL}/ohlcv/day?aggregate=1&limit=90&currency=usd`,
          capturedAt: expect.any(String),
        },
      },
      history: {
        points: [0.01, 0.03, 0.04],
        first: 0.01,
        last: 0.04,
        peak: 0.04,
        changePct: 300,
        drawdownPct: 0,
        timeframe: "day",
        poolAddress: PONS_POOL,
        sourceUrl: `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${PONS_POOL}/ohlcv/day?aggregate=1&limit=90&currency=usd`,
        capturedAt: expect.any(String),
      },
    });
    expect(evidence.projectToken?.coingeckoId).toBeUndefined();
    expect(captured.cost.calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "coingecko", op: "project-search", succeeded: 1 }),
      expect.objectContaining({ provider: "dexscreener", op: "project-search", succeeded: 1 }),
      expect.objectContaining({ provider: "geckoterminal", op: "project-token-ohlcv-day", succeeded: 1 }),
    ]));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
      provider: "dexscreener",
    }));
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-traction-liveness",
      status: "confirmed",
      provider: "dexscreener/geckoterminal",
    }));
  });

  it("retries the DEX search without the display name's generic suffix when the full name misses the token", async () => {
    // The $GWOOD shape: the X account is "Greenwood Finance" but the token is
    // named just "Greenwood", and DexScreener's search for the two-word name
    // does not return it at all. The one-word retry finds it; the identity
    // gate still has to bridge the exact X account and official domain.
    const GWOOD_TOKEN = "0x24d8657e10AF588b12de3E102a116f77b9E35ee8";
    const GWOOD_POOL = "0x72678B2e8dDedad5865272A857733d8dC98Eb771";
    const { ctx, evidence } = context("@GwoodFinance", "Greenwood Finance", "https://greenwood.fi/");
    const gwoodPair = {
      chainId: "robinhood",
      pairAddress: GWOOD_POOL,
      url: `https://dexscreener.com/robinhood/${GWOOD_POOL.toLowerCase()}`,
      baseToken: { address: GWOOD_TOKEN, name: "Greenwood", symbol: "GWOOD" },
      quoteToken: { address: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73", symbol: "WETH" },
      priceUsd: "0.005049",
      marketCap: 5_049_766,
      liquidity: { usd: 818_142.12 },
      info: {
        websites: [{ url: "https://greenwood.fi", label: "Website" }],
        socials: [{ url: "https://x.com/GwoodFinance", type: "twitter" }],
      },
    };
    const dexQueries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        dexQueries.push(q);
        // The literal two-word search misses the token; the one-word retry hits.
        return json({ pairs: q === "Greenwood" ? [gwoodPair] : [] });
      }
      if (url.includes("/ohlcv/")) return json({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("identity-bound DEX pair"),
    });
    expect(dexQueries).toEqual(["Greenwood Finance", "Greenwood"]);
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "GWOOD",
      address: GWOOD_TOKEN,
      chain: "robinhood",
      officialX: "@gwoodfinance",
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
      provider: "dexscreener",
    }));
  });

  it("records an unavailable outcome instead of nothing when a registry search fails", async () => {
    // A provider failure used to record NOTHING, so the report fell back to
    // the placeholder "no official token identity was bound to this project
    // account", which reads as an assessed result. The row must say what
    // actually happened: the registries could not be read on this scan.
    const { ctx, evidence } = context("@GwoodFinance", "Greenwood Finance", "https://greenwood.fi/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ error: "rate limited" }, 429);
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ error: "unavailable" }, 500);
      // The own-site declaration tier still runs; let it find nothing.
      if (url.startsWith("https://greenwood.fi")) return new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "partial",
      detail: expect.stringContaining("recorded as an unavailable token-identity outcome"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "unavailable",
      provider: "coingecko/dexscreener",
      note: expect.stringContaining("a rescan can close it"),
    }));
  });

  it("rejects an exact name match when neither official identity surface matches", async () => {
    const { ctx, evidence } = context("@unrelated", "Project Dex", "https://unrelated.example/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url.includes("coingecko.com") && url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
    // The completed-but-unbound search is an assessed null on P3 (substantive
    // for preflight), so a token-referencing project can still be scored.
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "finding",
      note: expect.stringContaining("none links back to the official X account or website domain"),
    }));
    // The disclosure names what the search DID see, so "unresolved" reads as
    // an investigator's finding instead of a shrug.
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      note: expect.stringContaining("under a matching name"),
    }));
  });

  it("records an assessed null only when both registry searches complete with no candidates", async () => {
    const { ctx, evidence } = context("@freshbrand", "Freshbrand Launcher", "https://freshbrand.example/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      attempts: 2,
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "finding",
      provider: "coingecko/dexscreener",
      note: expect.stringContaining("CoinGecko and DexScreener searches completed"),
    }));
  });

  it("rejects a similarly named DEX token when an exact X link is paired with the wrong domain", async () => {
    const { ctx, evidence } = context("@realproject", "Project", "https://realproject.example/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/search")) return json({
        pairs: [{
          chainId: "base",
          pairAddress: "0x2222222222222222222222222222222222222222",
          url: "https://dexscreener.com/base/0x2222222222222222222222222222222222222222",
          baseToken: {
            address: "0x1111111111111111111111111111111111111111",
            name: "Project",
            symbol: "PROJECT",
          },
          liquidity: { usd: 50_000_000 },
          info: {
            websites: [{ url: "https://copycat.example/" }],
            socials: [{ url: "https://x.com/realproject", type: "twitter" }],
          },
        }],
      });
      if (url.includes("coingecko.com") && url.includes("/search?")) return json(search({ name: "Project" }));
      if (url.includes("/coins/project-token?")) return json(details({
        name: "Project",
        links: { twitter_screen_name: "copycatproject", homepage: ["https://copycat.example/"] },
      }));
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.projectToken).toBeUndefined();
  });

  it("rejects a high-liquidity price outlier before selecting the canonical JUP-like pool", async () => {
    const { ctx, evidence } = context("@projectdex", "Project Dex");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [
        pair({
          pairAddress: "pool-outlier",
          quoteToken: { address: OTHER_TOKEN, symbol: "USDC" },
          priceUsd: "7.25",
          liquidity: { usd: 90_000_000 },
        }),
        pair({
          pairAddress: "pool-valid",
          quoteToken: { address: OTHER_TOKEN, symbol: "SOL" },
          priceUsd: "0.49",
          liquidity: { usd: 4_000_000 },
        }),
      ] });
      if (url.includes("/ohlcv/day?")) return json({ data: { attributes: { ohlcv_list: [[100, 0.5, 0.51, 0.48, 0.49, 1_000]] } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.projectToken).toMatchObject({
      pairAddress: "pool-valid",
      liquidityUsd: 4_000_000,
    });
    expect(evidence.projectToken?.pairAddress).not.toBe("pool-outlier");
  });

  it("prefers deep corroborated liquidity over a tiny preferred-quote pool", async () => {
    const { ctx, evidence } = context();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com")) return json({ pairs: [
        pair({
          pairAddress: "tiny-usdc",
          quoteToken: { address: OTHER_TOKEN, symbol: "USDC" },
          priceUsd: "0.50",
          liquidity: { usd: 30_000 },
        }),
        pair({
          pairAddress: "deep-met",
          quoteToken: { address: OTHER_TOKEN, symbol: "MET" },
          priceUsd: "0.49",
          liquidity: { usd: 4_000_000 },
        }),
      ] });
      if (url.includes("/ohlcv/day?")) return json({ data: { attributes: { ohlcv_list: [[100, 0.5, 0.51, 0.48, 0.49, 1_000]] } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.projectToken).toMatchObject({ pairAddress: "deep-met", liquidityUsd: 4_000_000 });
  });

  it("does not fetch details for unrelated CoinGecko search results", async () => {
    const { ctx, evidence } = context("@kyle", "Kyle McConnell", "");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({
        coins: [{ id: "bitcoin", name: "Bitcoin", symbol: "BTC", market_cap_rank: 1 }],
      });
      throw new Error(`unexpected detail request ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      attempts: 2,
      detail: "CoinGecko and DexScreener returned no identity-bound project token",
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("token declared on the project's own site", () => {
  it("recovers an official token declaration after a direct 403", async () => {
    const siteToken = "0xe934e36a439c94017b64a3fece66af12099abf50";
    const sitePool = "0x2222222222222222222222222222222222222222";
    const { ctx, evidence } = context("@projectdex", "Project Dex", "https://project.example/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url === "https://project.example/") return new Response("blocked", { status: 403 });
      if (url.includes(`/latest/dex/tokens/${siteToken}`)) return json({
        pairs: [{
          chainId: "base",
          pairAddress: sitePool,
          url: `https://dexscreener.com/base/${sitePool}`,
          baseToken: { address: siteToken, name: "Project Dex", symbol: "PDX" },
          quoteToken: { address: OTHER_TOKEN, symbol: "USDC" },
          liquidity: { usd: 2_500_000 },
        }],
      });
      if (url.includes("/ohlcv/")) return json({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`unexpected URL ${url}`);
    }));
    const recoverOfficialText = vi.fn(async (url: string) => ({
      status: "ok" as const,
      url,
      host: "project.example",
      contentType: "text/markdown",
      text: `URL Source: ${url}\n\nOfficial token contract: ${siteToken}`,
      contentHash: "recovered-token-page",
      capturedAt: "2026-08-24T20:00:00.000Z",
      retrievalMethod: "reader_recovery" as const,
      retrievalProvider: "jina-reader" as const,
      retrievalUrl: `https://r.jina.ai/${url}`,
    }));

    await expect(collectProjectTokenIdentity(ctx, { recoverOfficialText })).resolves.toMatchObject({ state: "executed" });
    expect(recoverOfficialText).toHaveBeenCalledWith("https://project.example/");
    expect(evidence.projectToken).toMatchObject({
      verification: "official_domain",
      address: siteToken,
      sourceUrl: "https://project.example/",
      producerSources: {
        identity: { provider: "official_site", sourceUrl: "https://project.example/" },
      },
    });
  });

  it("keeps official-site identity separate from DEX market and liquidity producers", async () => {
    const siteToken = "0xe934e36a439c94017b64a3fece66af12099abf50";
    const sitePool = "0x2222222222222222222222222222222222222222";
    const dexSourceUrl = `https://dexscreener.com/base/${sitePool}`;
    const historySourceUrl = `https://api.geckoterminal.com/api/v2/networks/base/pools/${sitePool}/ohlcv/day?aggregate=1&limit=90&currency=usd`;
    const { ctx, evidence } = context("@projectdex", "Project Dex", "https://project.example/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url === "https://project.example/") return new Response(`<button>${siteToken}</button>`, { status: 200 });
      if (url.includes(`/latest/dex/tokens/${siteToken}`)) return json({
        pairs: [{
          chainId: "base",
          pairAddress: sitePool,
          url: dexSourceUrl,
          baseToken: { address: siteToken, name: "Project Dex", symbol: "PDX" },
          quoteToken: { address: "0x1111111111111111111111111111111111111111", symbol: "USDC" },
          priceUsd: "0.25",
          marketCap: 25_000_000,
          fdv: 50_000_000,
          volume: { h24: 1_250_000 },
          liquidity: { usd: 2_500_000 },
        }],
      });
      if (url === historySourceUrl) return json({
        data: { attributes: { ohlcv_list: [[100, 0.2, 0.3, 0.1, 0.25, 50_000]] } },
      });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(evidence.projectToken).toMatchObject({
      verification: "official_domain",
      sourceUrl: "https://project.example/",
      priceUsd: 0.25,
      marketCapUsd: 25_000_000,
      liquidityUsd: 2_500_000,
      producerSources: {
        identity: {
          provider: "official_site",
          sourceUrl: "https://project.example/",
          capturedAt: expect.any(String),
        },
        market: { provider: "dexscreener", sourceUrl: dexSourceUrl, capturedAt: expect.any(String) },
        liquidity: { provider: "dexscreener", sourceUrl: dexSourceUrl, capturedAt: expect.any(String) },
        history: { provider: "geckoterminal", sourceUrl: historySourceUrl, capturedAt: expect.any(String) },
      },
      history: { sourceUrl: historySourceUrl, capturedAt: expect.any(String) },
    });
    expect(evidence.projectToken?.producerSources?.identity.sourceUrl)
      .not.toBe(evidence.projectToken?.producerSources?.market?.sourceUrl);
  });

  it("extracts every distinct address and drops burn sinks", () => {
    // The live stonkbrokers.cash shape: a vault address linked to the
    // explorer, and the token contract behind a copy button.
    const html = `<a href="https://robinhoodchain.blockscout.com/address/0x038a7f4e4e89448ad74e044337c9ac25c11e726b">vault</a>
      <button>0xe934e36a439c94017b64a3fece66af12099abf50</button>
      <span>0x0000000000000000000000000000000000000000</span>
      <span>0xE934E36A439C94017B64A3FECE66AF12099ABF50</span>`;
    expect(siteContractCandidates(html)).toEqual([
      "0x038a7f4e4e89448ad74e044337c9ac25c11e726b",
      "0xe934e36a439c94017b64a3fece66af12099abf50",
    ]);
  });

  it("returns nothing when the page states no address", () => {
    expect(siteContractCandidates("<p>no contracts here</p>")).toEqual([]);
  });

  it("caps how many candidates it will resolve", () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      `0x${String(i).padStart(2, "0")}${"a".repeat(38)}`).join(" ");
    expect(siteContractCandidates(many).length).toBeLessThanOrEqual(10);
  });

  it("binds the CLUTCH / $STONKBROKER token from a second official first-party domain", async () => {
    // Live shape: @CLUTCHMARKETS lists clutch.markets (no contract) and
    // stonkbrokers.cash (vault + token). CoinGecko has no CLUTCH listing,
    // DexScreener name search cannot identity-bind, and only the token CA
    // is tradeable. Unique-ID binding stays mandatory: the second URL is
    // already on the twitterapi profile record, never a search lead.
    const vault = "0x038a7f4e4e89448ad74e044337c9ac25c11e726b";
    const token = "0xe934e36a439c94017b64a3fece66af12099abf50";
    const pool = "0x2222222222222222222222222222222222222222";
    const { ctx, evidence } = context("@CLUTCHMARKETS", "CLUTCH", "https://clutch.markets/");
    evidence.profile.official_websites = [
      "https://clutch.markets/",
      "https://stonkbrokers.cash/",
    ];
    const stonkHtml = `<a href="https://robinhoodchain.blockscout.com/address/${vault}">vault</a>
      <button>${token}</button>
      <span>0x0000000000000000000000000000000000000000</span>
      <span>0xE934E36A439C94017B64A3FECE66AF12099ABF50</span>`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url === "https://clutch.markets/") return new Response("<html><p>CLUTCH markets</p></html>", { status: 200 });
      if (url === "https://stonkbrokers.cash/") return new Response(stonkHtml, { status: 200 });
      if (url.includes(`/latest/dex/tokens/${vault}`)) return json({ pairs: [] });
      if (url.includes(`/latest/dex/tokens/${token}`)) return json({
        pairs: [{
          chainId: "robinhood",
          pairAddress: pool,
          url: `https://dexscreener.com/robinhood/${pool}`,
          baseToken: { address: token, name: "Stonkbroker", symbol: "STONKBROKER" },
          quoteToken: { address: "0x1111111111111111111111111111111111111111", symbol: "WETH" },
          priceUsd: "0.012",
          liquidity: { usd: 180_000 },
        }],
      });
      if (url.includes("/ohlcv/")) return json({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("bound $STONKBROKER from the project's own site"),
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_domain",
      symbol: "STONKBROKER",
      address: token,
      chain: "robinhood",
      homepage: "https://stonkbrokers.cash/",
      sourceUrl: "https://stonkbrokers.cash/",
      producerSources: {
        identity: { provider: "official_site", sourceUrl: "https://stonkbrokers.cash/" },
      },
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
      provider: "site-fetch/dexscreener",
      note: expect.stringContaining("stonkbrokers.cash"),
    }));
  });

  it("binds nothing when two official pages each declare a different tradeable token", async () => {
    const tokenA = "0xe934e36a439c94017b64a3fece66af12099abf50";
    const tokenB = "0x038a7f4e4e89448ad74e044337c9ac25c11e726b";
    const poolA = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const poolB = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { ctx, evidence } = context("@splitproject", "Split Project", "https://alpha.example/");
    evidence.profile.official_websites = [
      "https://alpha.example/",
      "https://beta.example/",
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url === "https://alpha.example/") return new Response(`<button>${tokenA}</button>`, { status: 200 });
      if (url === "https://beta.example/") return new Response(`<button>${tokenB}</button>`, { status: 200 });
      if (url.includes(`/latest/dex/tokens/${tokenA}`)) return json({
        pairs: [{
          chainId: "base",
          pairAddress: poolA,
          url: `https://dexscreener.com/base/${poolA}`,
          baseToken: { address: tokenA, name: "Alpha", symbol: "ALPHA" },
          liquidity: { usd: 80_000 },
        }],
      });
      if (url.includes(`/latest/dex/tokens/${tokenB}`)) return json({
        pairs: [{
          chainId: "base",
          pairAddress: poolB,
          url: `https://dexscreener.com/base/${poolB}`,
          baseToken: { address: tokenB, name: "Beta", symbol: "BETA" },
          liquidity: { usd: 90_000 },
        }],
      });
      if (url.includes("/ohlcv/")) return json({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(ctx.recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
    }));
  });
});

const STONKBROKER = "0xe934e36A439C94017B64a3FecE66AF12099aBF50";
const STONKBROKER_LC = STONKBROKER.toLowerCase();
const STONKBROKER_VAULT = "0x038a7f4e4e89448ad74e044337c9ac25c11e726b";
const STONKBROKER_HTML = `<a href="https://robinhoodchain.blockscout.com/address/${STONKBROKER_VAULT}">vault</a>
      <button>${STONKBROKER_LC}</button>
      <span>0x0000000000000000000000000000000000000000</span>
      <span>0xE934E36A439C94017B64A3FECE66AF12099ABF50</span>`;


describe("investigation contract bind", () => {
  it("treats robinhood as a canonical CoinGecko platform chain", () => {
    expect(PLATFORM_CHAIN.robinhood).toBe("robinhood");
  });

  it("binds $STONKBROKER from the robinhood CA even when the CLUTCH name search is empty", async () => {
    // Contract-first: the investigation already holds $STONKBROKER. CoinGecko
    // search for "CLUTCH" is empty (and must stay unused as a name fallback —
    // DexScreener's "Clutch Markets" hit is a different Robinhood token).
    const { ctx, evidence } = context("@ClutchMarkets", "CLUTCH", "https://clutch.markets");
    ctx.tokenAddress = STONKBROKER;
    ctx.tokenChain = "robinhood";
    ctx.tokenSymbol = "STONKBROKER";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/coins/robinhood/contract/")) {
        expect(url.toLowerCase()).toContain(STONKBROKER_LC);
        return json({
          id: "stonkbroker",
          name: "StonkBroker",
          symbol: "stonkbroker",
          asset_platform_id: "robinhood",
          market_cap_rank: 628,
          last_updated: "2026-08-18T16:00:00.000Z",
          platforms: { robinhood: STONKBROKER },
          links: { twitter_screen_name: "ClutchMarkets", homepage: ["https://stonkbrokers.cash/"] },
          market_data: { current_price: { usd: 0.12 }, market_cap: { usd: 1_200_000 } },
        });
      }
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("official_x"),
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "STONKBROKER",
      address: STONKBROKER,
      chain: "robinhood",
      officialX: "@ClutchMarkets",
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/search?"))).toBe(false);
  });

  it("treats a DexScreener homepage as official when official X already equals the audited handle", async () => {
    const { ctx, evidence } = context("@ClutchMarkets", "CLUTCH", "https://clutch.markets/");
    ctx.tokenAddress = STONKBROKER;
    ctx.tokenChain = "robinhood";
    ctx.tokenSymbol = "STONKBROKER";
    const pool = "0x2222222222222222222222222222222222222222";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/coins/robinhood/contract/")) return json({}, 404);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url.toLowerCase().includes(`/latest/dex/tokens/${STONKBROKER_LC}`)) {
        return json({
          pairs: [{
            chainId: "robinhood",
            pairAddress: pool,
            url: `https://dexscreener.com/robinhood/${pool}`,
            baseToken: { address: STONKBROKER, name: "StonkBroker", symbol: "STONKBROKER" },
            info: {
              websites: [{ url: "https://stonkbrokers.cash/" }],
              socials: [{ type: "twitter", url: "https://x.com/ClutchMarkets" }],
            },
            liquidity: { usd: 80_000 },
          }],
        });
      }
      if (url === "https://clutch.markets/") return new Response("<html><p>CLUTCH markets</p></html>", { status: 200 });
      if (url === "https://stonkbrokers.cash/") return new Response(STONKBROKER_HTML, { status: 200 });
      if (url.includes(`/latest/dex/tokens/${STONKBROKER_VAULT}`)) return json({ pairs: [] });
      if (url.includes("/ohlcv/")) return json({ data: { attributes: { ohlcv_list: [] } } });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("bound $STONKBROKER from the project's own site"),
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_domain",
      symbol: "STONKBROKER",
      address: STONKBROKER_LC,
      chain: "robinhood",
      homepage: "https://stonkbrokers.cash/",
    });
    expect(fetchMock.mock.calls.some(([input]) => String(input) === "https://stonkbrokers.cash/")).toBe(true);
  });

  it("does not treat an unverified DexScreener search homepage as official", async () => {
    const { ctx, evidence } = context("@ClutchMarkets", "CLUTCH", "https://clutch.markets/");
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json({ coins: [] });
      if (url.includes("dexscreener.com/latest/dex/search")) {
        return json({
          pairs: [{
            chainId: "robinhood",
            pairAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            url: "https://dexscreener.com/robinhood/clutch",
            baseToken: { address: "0x1111111111111111111111111111111111111111", name: "Clutch Markets", symbol: "CLUTCH" },
            info: {
              websites: [{ url: "https://unverified-lead.example/" }],
              socials: [{ type: "twitter", url: "https://x.com/SomeOtherClutch" }],
            },
            liquidity: { usd: 90_000 },
          }],
        });
      }
      if (url === "https://clutch.markets/") return new Response("<html><p>CLUTCH markets</p></html>", { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("unverified-lead.example"))).toBe(false);
  });
});

describe("launched-product CoinGecko recall", () => {
  it("builds registry queries from launched product ticker and name, not only CLUTCH", () => {
    expect(launchedProductSearchQueries([
      { name: "StonkBrokers", tokenTicker: "$STONKBROKER", domain: "stonkbrokers.cash" },
    ])).toEqual(["STONKBROKER", "StonkBrokers"]);
    expect(projectRegistrySearchQueries("CLUTCH", [
      { name: "StonkBrokers", tokenTicker: "STONKBROKER" },
    ])).toEqual(["CLUTCH", "STONKBROKER", "StonkBrokers"]);
  });

  it("binds $STONKBROKER from CoinGecko when the company name search is empty and official X matches", async () => {
    const { ctx, evidence } = context("@ClutchMarkets", "CLUTCH", "https://clutch.markets/");
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "Clutch Markets launched StonkBrokers",
      audience: "",
      boundHandle: "clutchmarkets",
      boundDomain: "clutch.markets",
      sourceUrls: ["https://clutch.markets/"],
      launchedProducts: [{ name: "StonkBrokers", tokenTicker: "STONKBROKER", domain: "stonkbrokers.cash" }],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        if (query.toLowerCase() === "clutch" || query.toLowerCase() === "clutchmarkets") return json({ coins: [] });
        if (query.toLowerCase() === "stonkbroker" || query.toLowerCase() === "stonkbrokers") {
          return json({ coins: [{ id: "stonkbroker", name: "StonkBroker", symbol: "STONKBROKER", market_cap_rank: 576 }] });
        }
        throw new Error(`unexpected search ${query}`);
      }
      if (url.includes("/coins/stonkbroker?")) {
        return json({
          id: "stonkbroker",
          name: "StonkBroker",
          symbol: "stonkbroker",
          asset_platform_id: "robinhood",
          market_cap_rank: 576,
          last_updated: "2026-08-19T20:00:00.000Z",
          platforms: { robinhood: STONKBROKER },
          links: { twitter_screen_name: "ClutchMarkets", homepage: ["https://stonkbrokers.cash/marketplace"] },
          market_data: { current_price: { usd: 0.017 }, market_cap: { usd: 27_000_000 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("official_x"),
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "STONKBROKER",
      coingeckoId: "stonkbroker",
      address: STONKBROKER,
      chain: "robinhood",
      officialX: "@ClutchMarkets",
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
    }));
  });

  it("binds a CoinGecko token whose current official X lives in homepage links after twitter_screen_name went stale", async () => {
    // Altcoinist / $ALTT: CoinGecko still lists twitter_screen_name Altcoinist_com
    // while homepage includes https://x.com/Altcoinist. The audited handle is
    // @altcoinist, and the X profile may not even publish a website field.
    // Official-X identity must still bind so token conduct can be assessed.
    const ALTT = "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d";
    const ALTT_POOL = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const { ctx, evidence } = context("@altcoinist", "Altcoinist", "");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        return json({ coins: [{ id: "altcoinist-token", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 1730 }] });
      }
      if (url.includes("/coins/altcoinist-token?")) {
        return json({
          id: "altcoinist-token",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "base",
          market_cap_rank: 1730,
          last_updated: "2026-09-02T16:00:00.000Z",
          platforms: { base: ALTT },
          links: {
            twitter_screen_name: "Altcoinist_com",
            homepage: ["https://www.altcoinist.com/", "https://x.com/Altcoinist"],
          },
          market_data: {
            current_price: { usd: 0.016 },
            market_cap: { usd: 4_159_100 },
            total_volume: { usd: 120_000 },
          },
        });
      }
      if (url.toLowerCase().includes(`/latest/dex/tokens/${ALTT}`)) {
        return json({
          pairs: [{
            chainId: "base",
            pairAddress: ALTT_POOL,
            url: `https://dexscreener.com/base/${ALTT_POOL}`,
            baseToken: { address: ALTT, name: "Altcoinist", symbol: "ALTT" },
            quoteToken: { address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC" },
            priceUsd: "0.016",
            liquidity: { usd: 205_000 },
          }],
        });
      }
      if (url.includes("/ohlcv/day?")) return json({
        data: { attributes: { ohlcv_list: [
          [300, 0.015, 0.018, 0.014, 0.016, 80_000],
          [200, 0.014, 0.016, 0.013, 0.015, 70_000],
          [100, 0.013, 0.015, 0.012, 0.014, 60_000],
        ] } },
      });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("official_x"),
    });
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      name: "Altcoinist Token",
      symbol: "ALTT",
      coingeckoId: "altcoinist-token",
      address: ALTT,
      chain: "base",
      officialX: "@Altcoinist",
      homepage: "https://www.altcoinist.com/",
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
      note: expect.stringContaining("$ALTT"),
    }));
  });

  it("does not bind a same-ticker CoinGecko namesake whose official X and domain are someone else", async () => {
    const OTHER_ALTT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { ctx, evidence } = context("@altcoinist", "Altcoinist", "https://www.altcoinist.com/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        return json({ coins: [{ id: "random-altt", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 80 }] });
      }
      if (url.includes("/coins/random-altt?")) {
        return json({
          id: "random-altt",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "ethereum",
          platforms: { ethereum: OTHER_ALTT },
          links: {
            twitter_screen_name: "SomeOtherALTT",
            homepage: ["https://unrelated-altt.example/", "https://x.com/SomeOtherALTT"],
          },
          market_data: { current_price: { usd: 0.5 } },
        });
      }
      if (url.includes("dexscreener.com/latest/dex/search")) return json({ pairs: [] });
      if (url.includes("dexscreener.com/latest/dex/tokens/")) return json({ pairs: [] });
      if (url === "https://www.altcoinist.com/") return new Response("<html><p>Altcoinist</p></html>", { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "finding",
      note: expect.stringContaining("none links back to the official X account or website domain"),
    }));
  });

  it("still finds the identity-bound token when the display name is a slogan and the handle matches", async () => {
    const ALTT = "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d";
    const { ctx, evidence } = context("@altcoinist", "The Trader In Your Pocket", "");
    const searches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        searches.push(query);
        if (query.toLowerCase() === "altcoinist") {
          return json({ coins: [{ id: "altcoinist-token", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 1730 }] });
        }
        return json({ coins: [] });
      }
      if (url.includes("/coins/altcoinist-token?")) {
        return json({
          id: "altcoinist-token",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "base",
          platforms: { base: ALTT },
          links: {
            twitter_screen_name: "Altcoinist_com",
            homepage: ["https://www.altcoinist.com/", "https://x.com/Altcoinist"],
          },
          market_data: { current_price: { usd: 0.016 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(searches.some((query) => query.toLowerCase() === "altcoinist")).toBe(true);
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "ALTT",
      officialX: "@Altcoinist",
    });
  });

  it("does not bind a launched-product CoinGecko hit whose official X is someone else", async () => {
    const { ctx, evidence } = context("@ClutchMarkets", "CLUTCH", "https://clutch.markets/");
    evidence.subjectOrientation = {
      kind: "PROJECT",
      what: "lab",
      audience: "",
      boundHandle: "clutchmarkets",
      boundDomain: "clutch.markets",
      sourceUrls: ["https://clutch.markets/"],
      launchedProducts: [{ name: "StonkBrokers", tokenTicker: "STONKBROKER" }],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        return json({ coins: [{ id: "stonkbroker", name: "StonkBroker", symbol: "STONKBROKER", market_cap_rank: 576 }] });
      }
      if (url.includes("/coins/stonkbroker?")) {
        return json({
          id: "stonkbroker",
          name: "StonkBroker",
          symbol: "stonkbroker",
          asset_platform_id: "robinhood",
          platforms: { robinhood: STONKBROKER },
          links: { twitter_screen_name: "SomeOtherDesk", homepage: ["https://unrelated.example/"] },
          market_data: { current_price: { usd: 0.017 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      if (url === "https://clutch.markets/") return new Response("<html><p>CLUTCH markets</p></html>", { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
  });
});

describe("registry queries for decorated display names", () => {
  // Verified live against the public CoinGecko search on 2026-09-02:
  //   "Altcoinist ($ALTT)"            -> no coins
  //   "Altcoinist 🚀"                  -> no coins
  //   "$ALTT"                          -> no coins
  //   "Altcoinist" / "ALTT"            -> altcoinist-token
  // So the raw decorated string must never be the only query sent.
  it("strips emoji and cashtag decoration and adds the ticker as its own query", () => {
    expect(tokenSearchQueries("Altcoinist ($ALTT)")).toEqual(["Altcoinist", "ALTT"]);
    expect(tokenSearchQueries("Altcoinist 🚀")).toEqual(["Altcoinist"]);
    expect(tokenSearchQueries("Altcoinist 🚀 | Trade Smarter")).toEqual(["Altcoinist"]);
    expect(tokenSearchQueries("Altcoinist | $ALTT on Base")).toEqual(["Altcoinist", "ALTT"]);
    expect(tokenSearchQueries("Altcoinist - The Trader In Your Pocket")).toEqual(["Altcoinist"]);
    expect(tokenSearchQueries("$ALTT")).toEqual(["ALTT"]);
  });

  it("keeps the existing suffix-stripping and plain-name behaviour", () => {
    expect(tokenSearchQueries("Greenwood Finance")).toEqual(["Greenwood Finance", "Greenwood"]);
    expect(tokenSearchQueries("CLUTCH")).toEqual(["CLUTCH"]);
    expect(tokenSearchQueries("Layer3 (L3)")).toEqual(["Layer3", "L3"]);
    expect(tokenSearchQueries("Acme Labs (Beta)")).toEqual(["Acme Labs", "Acme"]);
    expect(cleanRegistryName("  ✨ Ondo.Finance ✨ ")).toBe("Ondo.Finance");
  });

  it("treats a short bio cashtag list as a self-declared ticker but not a promoter's watchlist", () => {
    expect(bioTickerQueries("The home of $ALTT on Base. Trade smarter.")).toEqual(["ALTT"]);
    expect(bioTickerQueries("$ALTT and $altt are the same ticker")).toEqual(["ALTT"]);
    expect(bioTickerQueries("Bags: $BTC $ETH $SOL $DOGE $PEPE. NFA.")).toEqual([]);
    expect(bioTickerQueries("no ticker here, $5 minimum")).toEqual([]);
  });

  it("binds the token when the display name is decorated and only the cleaned name and ticker match", async () => {
    const ALTT = "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d";
    const { ctx, evidence } = context("@altcoinist", "Altcoinist 🚀 ($ALTT)", "");
    const searches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        searches.push(query);
        // The live registry returns nothing for any decorated form.
        if (/[^\w\s]/u.test(query)) return json({ coins: [] });
        if (query.toLowerCase() === "altcoinist" || query.toLowerCase() === "altt") {
          return json({ coins: [{ id: "altcoinist-token", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 1730 }] });
        }
        return json({ coins: [] });
      }
      if (url.includes("/coins/altcoinist-token?")) {
        return json({
          id: "altcoinist-token",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "base",
          platforms: { base: ALTT },
          links: {
            twitter_screen_name: "Altcoinist_com",
            homepage: ["https://www.altcoinist.com/", "https://x.com/Altcoinist"],
          },
          market_data: { current_price: { usd: 0.016 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(searches).not.toContain("Altcoinist 🚀 ($ALTT)");
    expect(searches.map((query) => query.toLowerCase())).toEqual(expect.arrayContaining(["altcoinist", "altt"]));
    expect(evidence.projectToken).toMatchObject({
      verified: true,
      verification: "official_x",
      symbol: "ALTT",
      officialX: "@Altcoinist",
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "confirmed",
    }));
  });

  it("REGRESSION SHAPE: a slogan name plus a bio cashtag reaches the registry through the ticker", async () => {
    const ALTT = "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d";
    const { ctx, evidence } = context("@tradesmarter_hq", "The Trader In Your Pocket", "");
    evidence.profile.bio = "Trade smarter with $ALTT on Base.";
    const searches: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        searches.push(query);
        if (query.toLowerCase() === "altt") {
          return json({ coins: [{ id: "altcoinist-token", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 1730 }] });
        }
        return json({ coins: [] });
      }
      if (url.includes("/coins/altcoinist-token?")) {
        return json({
          id: "altcoinist-token",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "base",
          platforms: { base: ALTT },
          links: { twitter_screen_name: "tradesmarter_hq", homepage: ["https://www.altcoinist.com/"] },
          market_data: { current_price: { usd: 0.016 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({ state: "executed" });
    expect(searches.map((query) => query.toLowerCase())).toContain("altt");
    expect(evidence.projectToken).toMatchObject({ verified: true, symbol: "ALTT", officialX: "@tradesmarter_hq" });
  });

  it("does not bind a bio cashtag whose registry record belongs to someone else", async () => {
    const { ctx, evidence } = context("@somekol", "Some KOL", "");
    evidence.profile.bio = "Long $ALTT since day one.";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        if (query.toLowerCase() === "altt") {
          return json({ coins: [{ id: "altcoinist-token", name: "Altcoinist Token", symbol: "ALTT", market_cap_rank: 1730 }] });
        }
        return json({ coins: [] });
      }
      if (url.includes("/coins/altcoinist-token?")) {
        return json({
          id: "altcoinist-token",
          name: "Altcoinist Token",
          symbol: "altt",
          asset_platform_id: "base",
          platforms: { base: "0x1b5ce2a593a840e3ad3549a34d7b3dec697c114d" },
          links: { twitter_screen_name: "Altcoinist", homepage: ["https://www.altcoinist.com/", "https://x.com/Altcoinist"] },
          market_data: { current_price: { usd: 0.016 } },
        });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no identity-bound project token"),
    });
    expect(evidence.projectToken).toBeUndefined();
  });
});

describe("a throttled registry query never completes the identity search", () => {
  it("records unavailable, not an assessed tokenless null, when one of the CoinGecko queries was throttled", async () => {
    // Public CoinGecko returns HTTP 429 "Throttled" after a few quick queries.
    // The name query is the one that would have found the token; the ticker
    // query completed empty. That is an incomplete search, never "no token".
    const { ctx, evidence } = context("@altcoinist", "Altcoinist ($ALTT)", "https://www.altcoinist.com/");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) {
        const query = decodeURIComponent((url.split("query=")[1] ?? "").split("&")[0] ?? "");
        if (query.toLowerCase() === "altcoinist") return new Response("Throttled", { status: 429 });
        return json({ coins: [] });
      }
      if (url.includes("dexscreener.com")) return json({ pairs: [] });
      if (url === "https://www.altcoinist.com/") return new Response("<html><p>Altcoinist</p></html>", { status: 200 });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "partial",
      detail: expect.stringContaining("CoinGecko search failed for 1 of 2 queries"),
    });
    expect(evidence.projectToken).toBeUndefined();
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "unavailable",
      note: expect.stringContaining("provider gap, not an assessed result"),
    }));
    expect(ctx.recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ status: "finding" }));
  });
});

describe("DexScreener's null-pairs answer is a completed empty market read", () => {
  // Verified live on 2026-09-02: GET /latest/dex/tokens/<unknown address>
  // returns {"schemaVersion":"1.0.0","pairs":null}, not an empty array.
  it("records an official bio contract with no market as an assessed finding, not a provider outage", async () => {
    const { ctx, evidence } = context("@prelaunchdex", "Prelaunch Dex", "");
    evidence.profile.bio = `Launching soon. CA: ${PONS_TOKEN}`;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("dexscreener.com/latest/dex/tokens/")) return json({ schemaVersion: "1.0.0", pairs: null });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("no market for that exact address"),
    });
    expect(ctx.recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "project-token-identity",
      status: "finding",
      note: expect.stringContaining("no market for that exact address"),
    }));
    expect(ctx.recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ status: "unavailable" }));
  });

  it("keeps a registry-bound token without any DEX pool as a fully executed bind", async () => {
    const { ctx, evidence } = context();
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("coingecko.com") && url.includes("/search?")) return json(search());
      if (url.includes("/coins/project-token?")) return json(details());
      if (url.includes("dexscreener.com/latest/dex/tokens/")) return json({ schemaVersion: "1.0.0", pairs: null });
      throw new Error(`unexpected URL ${url}`);
    }));

    await expect(collectProjectTokenIdentity(ctx)).resolves.toMatchObject({
      state: "executed",
      detail: expect.stringContaining("without a price-corroborated DEX pair"),
    });
    expect(evidence.projectToken).toMatchObject({ verified: true, symbol: "PDX" });
    expect(evidence.projectToken?.liquidityUsd).toBeUndefined();
  });
});
