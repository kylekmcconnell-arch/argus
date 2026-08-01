import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectOperatorLaunches,
  describeLaunchHistory,
  handleSearchTerms,
  launchForClaimedTicker,
  launchForOperatorHandle,
  normalizeXHandle,
  operatorLaunchAnnouncements,
} from "./operatorLaunches";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const pair = (over: Record<string, unknown> = {}) => ({
  chainId: "solana",
  url: "https://dexscreener.com/solana/pool1",
  baseToken: { address: "5E2woTdd2Gmint", symbol: "uAPE", name: "uAPE" },
  fdv: 6595,
  liquidity: { usd: 7061 },
  info: { socials: [{ url: "https://x.com/uapenfts", type: "twitter" }] },
  ...over,
});

describe("normalizeXHandle + handleSearchTerms", () => {
  it("reads a handle from any X url shape and rejects junk", () => {
    expect(normalizeXHandle("https://x.com/uapenfts")).toBe("uapenfts");
    expect(normalizeXHandle("https://twitter.com/S0Ldev/status/1")).toBe("s0ldev");
    expect(normalizeXHandle("@LinkrBot")).toBe("linkrbot");
    expect(normalizeXHandle("https://x.com/i/communities/2002")).toBeNull();
    expect(normalizeXHandle("")).toBeNull();
  });

  it("searches the handle AND its stem, because a ticker rarely equals the handle", () => {
    // The real miss: dexscreener finds "uape", never "uapenfts".
    expect(handleSearchTerms("uapenfts")).toEqual(["uapenfts", "uape"]);
    expect(handleSearchTerms("linkrbot")).toEqual(["linkrbot", "linkr"]);
    expect(handleSearchTerms("aave")).toEqual(["aave"]);
  });
});

describe("launchForOperatorHandle", () => {
  it("accepts a token only when its own metadata names the exact handle", async () => {
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const term = String(url).split("q=")[1];
      // The handle itself finds nothing; the stem finds the token.
      if (term === "uapenfts") return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
      return new Response(JSON.stringify({ pairs: [pair()] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const launch = await launchForOperatorHandle("@uapenfts");

    expect(launch).toMatchObject({ symbol: "uAPE", fdvUsd: 6595, xHandle: "uapenfts", link: "operator_bio_project" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never accepts a name-alike token that does not claim the handle", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pairs: [
        pair({ baseToken: { address: "imposter", symbol: "uAPE", name: "uAPE" }, info: { socials: [{ url: "https://x.com/someoneelse" }] } }),
        pair({ baseToken: { address: "noSocials", symbol: "uAPE", name: "uAPE" }, info: {} }),
      ],
    }), { status: 200 })));

    expect(await launchForOperatorHandle("@uapenfts")).toBeNull();
  });

  it("prefers the deepest pool when the same token lists more than once", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      pairs: [
        pair({ liquidity: { usd: 500 }, url: "https://dexscreener.com/solana/shallow" }),
        pair({ liquidity: { usd: 7061 }, url: "https://dexscreener.com/solana/deep" }),
      ],
    }), { status: 200 })));

    expect((await launchForOperatorHandle("@uapenfts"))?.url).toContain("deep");
  });
});

describe("collectOperatorLaunches", () => {
  it("combines same-wallet history with the operator's claimed projects, deduped", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("/coins/") && !target.includes("?creator=")) {
        return new Response(JSON.stringify({
          creator: "BpH4h6", symbol: "LINKR", name: "linkrbot",
          twitter: "https://x.com/linkrbot", created_timestamp: 1785450548000,
        }), { status: 200 });
      }
      if (target.includes("?creator=")) {
        return new Response(JSON.stringify([
          { mint: "MINT_SELF", symbol: "LINKR", usd_market_cap: 95226 },
          { mint: "MINT_OLD", symbol: "PMPR", usd_market_cap: 4000, created_timestamp: 1770000000000 },
        ]), { status: 200 });
      }
      return new Response(JSON.stringify({ pairs: [pair()] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches("MINT_SELF", ["@uapenfts", "@linkrbot"]);

    expect(history.creatorWallet).toBe("BpH4h6");
    // Self excluded from both paths; the subject's own handle never re-resolves.
    expect(history.launches.map((launch) => launch.symbol).sort()).toEqual(["PMPR", "uAPE"]);
    expect(history.totalLaunches).toBe(3);
    expect(describeLaunchHistory(history)).toBe(
      "This is launch 3 tied to the same operator. Earlier launches: PMPR now $4.0K; uAPE now $6.6K.",
    );
  });

  it("stays silent for a token with no launchpad record and no operator projects", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404 })));

    const history = await collectOperatorLaunches("SOME_MINT", []);

    expect(history.launches).toEqual([]);
    expect(history.totalLaunches).toBe(1);
    expect(describeLaunchHistory(history)).toBeNull();
  });
});

// A serial launcher who splits deployer wallets still announces every launch
// from one account. These posts reach launches no wallet index and no bio can.
describe("operator launch announcements", () => {
  const searchResponse = (tweets: unknown[]) => new Response(
    JSON.stringify({ tweets }), { status: 200, headers: { "content-type": "application/json" } },
  );

  it("reads launches the operator claims, and never a contract they merely mention", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async () => searchResponse([
      { text: "uAPE is now live  Solana needed more mechanic-driven ecosystems", createdAt: "Wed May 13 22:24:00 +0000 2026" },
      { text: "Why I built @theodevxyz  An AI agent redefining narrative in crypto", createdAt: "Fri Jan 09 16:05:00 +0000 2026" },
      // The trap: the operator asks their own bot about someone else's coin.
      { text: "hey @linkrbot what can you tell me about this coin: Ge87EtsjwRQbHaqQmKRno69RFTwh9bfSsm99XNxTpump", createdAt: "Thu Jul 31 09:00:00 +0000 2026" },
      { text: "gm, shipping all day", createdAt: "Thu Jul 31 08:00:00 +0000 2026" },
    ])));

    const announcements = await operatorLaunchAnnouncements("@S0Ldev");

    expect(announcements).toHaveLength(2);
    expect(announcements[0]).toMatchObject({ tickers: [], handles: [], mints: [], names: ["uAPE"] });
    expect(announcements[0].text).toContain("uAPE is now live");
    expect(announcements[1].handles).toEqual(["theodevxyz"]);
    // The demo query names a contract but claims nothing: never a launch.
    expect(announcements.some((entry) => entry.mints.length)).toBe(false);
  });

  it("stays silent without a key", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    expect(await operatorLaunchAnnouncements("@S0Ldev")).toEqual([]);
  });
});

describe("launchForClaimedTicker", () => {
  const searchResponse = (pairs: unknown[]) => new Response(JSON.stringify({ pairs }), { status: 200 });

  it("rejects a recycled ticker pooled long after the claim", async () => {
    // The real case: $trippin claimed in Feb, TRIPPIN pooled in July by someone else.
    vi.stubGlobal("fetch", vi.fn(async () => searchResponse([{
      chainId: "solana",
      baseToken: { address: "trippinMint", symbol: "TRIPPIN", name: "trippin" },
      fdv: 0,
      liquidity: { usd: 10 },
      pairCreatedAt: Date.parse("2026-07-12T00:00:00Z"),
    }])));

    expect(await launchForClaimedTicker("trippin", "2026-02-14T00:00:00Z")).toBeNull();
  });

  it("accepts a token of that symbol pooled within the claim window", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => searchResponse([{
      chainId: "solana",
      baseToken: { address: "pmprMint", symbol: "PMPR", name: "Pmpr" },
      fdv: 4000,
      liquidity: { usd: 900 },
      pairCreatedAt: Date.parse("2026-03-01T00:00:00Z"),
    }])));

    const launch = await launchForClaimedTicker("PMPR", "2026-03-13T00:00:00Z");
    expect(launch).toMatchObject({ symbol: "PMPR", mint: "pmprMint", fdvUsd: 4000 });
  });

  it("needs a claim date at all, since a bare symbol proves nothing", async () => {
    expect(await launchForClaimedTicker("PMPR", undefined)).toBeNull();
  });
});

describe("dead prior launches still count", () => {
  it("reports claimed projects whose token no longer trades, deduped against resolved ones", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [
          { text: "Super excited to announce the launch of my project SINTEL. @sintelterminal", createdAt: "Sat Dec 14 22:34:00 +0000 2025" },
          { text: "Why I built @theodevxyz", createdAt: "Fri Jan 09 16:05:00 +0000 2026" },
          { text: "uAPE is now live", createdAt: "Wed May 13 22:24:00 +0000 2026" },
        ] }), { status: 200 });
      }
      if (target.includes("/coins/")) {
        return new Response(JSON.stringify({ creator: "wallet1", symbol: "LINKR", twitter: "https://x.com/linkrbot" }), { status: 200 });
      }
      if (target.includes("?creator=")) return new Response(JSON.stringify([]), { status: 200 });
      // No dead project resolves to a live pool.
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches("MINT_SELF", [], "@S0Ldev");

    expect(history.launches).toEqual([]);
    expect(history.claimedProjects.map((project) => project.label)).toEqual(["@sintelterminal", "@theodevxyz", "uAPE"]);
    expect(history.claimedProjects[0].quote).toContain("launch of my project SINTEL");
    const narrative = describeLaunchHistory(history);
    expect(narrative).toContain("claims 3 earlier projects with no live market today");
    expect(narrative).toContain("@sintelterminal (Dec 2025)");
    expect(narrative).toContain("@theodevxyz (Jan 2026)");
  });
});
