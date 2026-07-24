import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import type { CollectContext } from "./types";
import { collectProjectTokenIdentity } from "./projectToken";

const SOLANA_TOKEN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER_TOKEN = "So11111111111111111111111111111111111111112";
const PONS_TOKEN = "0x39dBED3a2bd333467115dE45665cC57F813C4571";
const PONS_POOL = "0x10CC6BD38112cAc182db90B6a71d8Bb5939526bA";

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

const pair = (overrides: Record<string, unknown> = {}) => ({
  chainId: "solana",
  pairAddress: "pool-valid",
  baseToken: { address: SOLANA_TOKEN, symbol: "PDX" },
  quoteToken: { address: OTHER_TOKEN, symbol: "USDC" },
  priceUsd: "0.51",
  liquidity: { usd: 5_000_000 },
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("verified project-token collection", () => {
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
      },
    });
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
      note: expect.stringContaining("neither registry produced a contract bound to the official X account or website domain"),
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
