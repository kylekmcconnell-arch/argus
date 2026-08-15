import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { getCost, withCostLedger } from "../cost";
import type { CollectContext } from "./types";
import { collectProjectTokenIdentity, siteContractCandidates } from "./projectToken";

const SOLANA_TOKEN = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const OTHER_TOKEN = "So11111111111111111111111111111111111111112";
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
});
