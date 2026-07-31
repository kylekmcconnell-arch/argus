import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectOperatorLaunches,
  describeLaunchHistory,
  handleSearchTerms,
  launchForOperatorHandle,
  normalizeXHandle,
} from "./operatorLaunches";

afterEach(() => {
  vi.unstubAllGlobals();
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
