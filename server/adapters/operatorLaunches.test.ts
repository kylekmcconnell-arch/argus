import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectOperatorLaunches,
  describeLaunchHistory,
  describeLaunchSpacing,
  enrichLaunchPeaks,
  handleSearchTerms,
  launchForClaimedTicker,
  launchForOperatorHandle,
  normalizeXHandle,
  operatorLaunchAnnouncements,
  pumpfunCoin,
  resolveLaunchPeak,
  seriesPeakUsd,
  type PriorLaunch,
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

// Everything below is shaped from eval/recordings/linkrbot plus live probes of
// the same two mints on 2026-08-01.
const UAPE_MINT = "5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump";
const LINKR_MINT = "5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump";
// pump.fun /coins/<uAPE mint>, verbatim fields.
const UAPE_COIN = {
  mint: UAPE_MINT,
  creator: "72aXYDZfdEEJuB2ii1yBJdGQZLGUzhkxy8kucaLf3dEX",
  symbol: "uAPE",
  name: "Hold to Mint",
  twitter: "https://x.com/uapenfts",
  created_timestamp: 1778711061000,
  usd_market_cap: 7184.76374342938,
  ath_market_cap: 288970.5805422813,
  ath_market_cap_timestamp: 1778716144000,
};
// GeckoTerminal daily OHLCV for the uAPE / SOL pool, newest first as the API
// returns it: [ts, open, high, low, close, volume].
const UAPE_OHLCV = [
  [1785888000, 6.338360097435273e-06, 7.12852930779898e-06, 6.338360097435273e-06, 7.12852930779898e-06, 225.07],
  [1785801600, 6.5632216616863345e-06, 6.917131500586729e-06, 6.293334510151574e-06, 6.338360097435273e-06, 312.19],
  [1785715200, 6.473855037813717e-06, 6.67867151410411e-06, 5.7689056776473535e-06, 6.5632216616863345e-06, 446.55],
  [1778976000, 6.579429746217097e-05, 0.00011024798193443435, 5.094668484126272e-05, 8.210669932410797e-05, 135435.88],
  [1778889600, 0.00021096498242474692, 0.00022209843088250185, 5.223044451164898e-05, 6.579429746217097e-05, 762613.83],
  [1778803200, 3.7398167580862486e-05, 0.0002858845758805126, 2.654506826481542e-05, 0.00021096498242474692, 539383.94],
];

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
      if (target.includes("/coins/MINT_SELF")) {
        return new Response(JSON.stringify({
          creator: "BpH4h6", symbol: "LINKR", name: "linkrbot",
          twitter: "https://x.com/linkrbot", created_timestamp: 1785450548000,
        }), { status: 200 });
      }
      // The prior launches carry no launchpad peak, so none is published.
      if (target.includes("/coins/") && !target.includes("?creator=")) return new Response("not found", { status: 404 });
      if (target.includes("geckoterminal")) return new Response("not found", { status: 404 });
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
    // Two dated launches is ONE interval, so the gap is reported and no rate is.
    expect(describeLaunchHistory(history)).toBe(
      "This is launch 3 tied to the same operator. Earlier launches: PMPR now $4.0K; uAPE now $6.6K."
      + " There were 179 days between the two dated launches.",
    );
    // No peak survived, so no launch claims a decline it cannot evidence.
    expect(history.launches.every((launch) => launch.athUsd === undefined)).toBe(true);
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

  // A claim the reader cannot open is a claim ARGUS is asking to be believed on.
  it("carries the permalink of every post it quotes", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async () => searchResponse([
      {
        text: "uAPE is now live\n\nCA: 5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump",
        createdAt: "Wed May 13 22:24:31 +0000 2026",
        url: "https://x.com/S0Ldev/status/2054689272423502206",
        twitterUrl: "https://twitter.com/S0Ldev/status/2054689272423502206",
      },
      // No url field: the id plus the author still make a permalink.
      {
        text: "Why I built @theodevxyz",
        createdAt: "Fri Jan 09 16:05:00 +0000 2026",
        id: "2013044154205442169",
        author: { userName: "S0Ldev" },
      },
      // Nothing to build one from: the post is still reported, without a link.
      { text: "Splitr is now live", createdAt: "Wed Dec 17 21:22:17 +0000 2025" },
      // A url that is not a status permalink is not a receipt.
      { text: "Crafta is now live", createdAt: "Mon Jan 19 00:21:41 +0000 2026", url: "https://crafta.fun" },
    ])));

    const announcements = await operatorLaunchAnnouncements("@S0Ldev");

    expect(announcements.map((entry) => entry.url)).toEqual([
      "https://x.com/S0Ldev/status/2054689272423502206",
      "https://x.com/S0Ldev/status/2013044154205442169",
      undefined,
      undefined,
    ]);
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

  // The receipt on a launch is the post that made the tie. A ticker is tied to
  // a pool by ONE post's date, and an operator says their own ticker over and
  // over, so the quote and the link have to come from that post and not from
  // whichever post happens to mention the ticker first.
  it("quotes the post whose date resolved the launch, not an earlier mention", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [
          // Eight months before the pool exists: this post ties nothing.
          {
            text: "Introducing $PMPR, coming soon",
            createdAt: "Sat Jul 12 00:00:00 +0000 2025",
            url: "https://x.com/S0Ldev/status/1000000000000000001",
          },
          {
            text: "$PMPR is now live",
            createdAt: "Fri Mar 13 00:00:00 +0000 2026",
            url: "https://x.com/S0Ldev/status/1000000000000000002",
          },
        ] }), { status: 200 });
      }
      if (target.includes("pump.fun")) return new Response("not found", { status: 404 });
      if (target.includes("geckoterminal")) return new Response("not found", { status: 404 });
      if (target.includes("/dex/search")) {
        return new Response(JSON.stringify({ pairs: [{
          chainId: "solana",
          url: "https://dexscreener.com/solana/pmpr",
          baseToken: { address: "pmprMint", symbol: "PMPR", name: "Pmpr" },
          fdv: 4000,
          liquidity: { usd: 900 },
          pairCreatedAt: Date.parse("2026-03-01T00:00:00Z"),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches("SUBJECT_MINT", [], "@S0Ldev");

    const pmpr = history.launches.find((launch) => launch.symbol === "PMPR");
    expect(pmpr?.permalink).toBe("https://x.com/S0Ldev/status/1000000000000000002");
    expect(pmpr?.announcement?.text).toBe("$PMPR is now live");
    expect(pmpr?.announcement?.url).toBe("https://x.com/S0Ldev/status/1000000000000000002");
  });
});

describe("dead prior launches still count", () => {
  it("reports claimed projects whose token no longer trades, deduped against resolved ones", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [
          {
            text: "Super excited to announce the launch of my project SINTEL. @sintelterminal",
            createdAt: "Sat Dec 14 22:34:00 +0000 2025",
            url: "https://x.com/S0Ldev/status/2000333528416878775",
          },
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
    // The claim is reported as the operator's own dated words plus a receipt.
    expect(history.claimedProjects[0].url).toBe("https://x.com/S0Ldev/status/2000333528416878775");
    expect(history.claimedProjects[1].url).toBeUndefined();
    const narrative = describeLaunchHistory(history);
    expect(narrative).toContain("claims 3 earlier projects with no live market today");
    expect(narrative).toContain("@sintelterminal (Dec 2025)");
    expect(narrative).toContain("@theodevxyz (Jan 2026)");
    // A project with no live market is never called a rug or an abandonment.
    expect(narrative).not.toMatch(/\b(rug|rugged|abandon|abandoned|exit scam)\b/i);
  });

  // The audited project is not one of the operator's earlier projects. pump.fun
  // supplies the subject's symbol and handle for its own mints, but a verified
  // solana token that launched anywhere else has no launchpad record at all,
  // and the operator's launch post about THIS token names it like any other.
  it("never reports the audited token itself as a dead earlier project", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [{
          text: "$DRIFT is now live. Trade perps at @driftprotocol",
          createdAt: "Wed May 13 22:24:31 +0000 2026",
          url: "https://x.com/driftprotocol/status/2054689272423502206",
        }] }), { status: 200 });
      }
      // Not a pump.fun launch: the launchpad has never heard of this mint.
      if (target.includes("pump.fun")) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches(
      "DriftMint1111111111111111111111111111111111",
      [],
      "@cindyleow",
      { symbol: "DRIFT", handle: "@driftprotocol" },
    );

    expect(history.claimedProjects).toEqual([]);
    expect(history.launches).toEqual([]);
    expect(describeLaunchHistory(history)).toBeNull();
  });
});

// The peak is the half of a track record the current price cannot show. It is
// also the half a launchpad will happily lie about, so it gets its own gate.
describe("resolveLaunchPeak", () => {
  it("rejects the corrupt pump.fun peaks the top list actually returns", () => {
    // Every one of these is a real ath_market_cap read from
    // frontend-api-v3.pump.fun/coins?sort=market_cap on 2026-08-01. Eight of
    // the top fifty came back like this.
    const corrupt: Array<[string, number, number]> = [
      ["Fartcoin", 129186694.27869894, 428151807937.17694],
      ["jellyjelly", 55583785.531043805, 4.131527643839513e22],
      ["arc", 53217000.83926055, 1.9898151941481314e23],
      ["ZEREBRO", 33719327.87414645, 2.1958674885036183e20],
      ["pippin", 16328619.713026948, 9.023316820413354e18],
      ["ACT", 8353060.885228079, 1.5148462916022252e21],
      ["Ban", 68241979.80483544, 1.4770088094472203e21],
      ["Bert", 8209670.975879638, 7.882360658846243e20],
    ];
    for (const [symbol, currentUsd, launchpadAthUsd] of corrupt) {
      expect(resolveLaunchPeak({ currentUsd, launchpadAthUsd }), symbol).toBeUndefined();
    }
  });

  it("accepts a real run that clears both gates", () => {
    // ANSEM, from the same sample: $207M now against a $450M peak.
    expect(resolveLaunchPeak({
      currentUsd: 207488265.82051644,
      launchpadAthUsd: 449957637.6129033,
      launchpadAthAt: "2025-01-06T00:00:00.000Z",
    })).toEqual({ athUsd: 449957637.6129033, athAt: "2025-01-06T00:00:00.000Z" });
  });

  it("refuses a peak at or below what the token is worth today", () => {
    expect(resolveLaunchPeak({ currentUsd: 7082, launchpadAthUsd: 7082 })).toBeUndefined();
    expect(resolveLaunchPeak({ currentUsd: 7082, launchpadAthUsd: 6000 })).toBeUndefined();
    expect(resolveLaunchPeak({ currentUsd: 7082, seriesPeakUsd: 6000 })).toBeUndefined();
    expect(resolveLaunchPeak({ currentUsd: 7082 })).toBeUndefined();
    // A token worth more than the ceiling still gets a floor: a peak below
    // today is refused rather than waved through as "unknown current value".
    expect(resolveLaunchPeak({ currentUsd: 5e10, launchpadAthUsd: 9e9 })).toBeUndefined();
  });

  it("takes the launchpad peak only when the traded series corroborates it", () => {
    // uAPE, live 2026-08-01: pump.fun says $288,970.58 and the GeckoTerminal
    // daily closes imply $209,588. 1.38x apart, which is what an intraday high
    // looks like next to a daily close, so the finer-grained value is used.
    expect(resolveLaunchPeak({
      currentUsd: 7082,
      seriesPeakUsd: 209587.97,
      launchpadAthUsd: 288970.5805422813,
      launchpadAthAt: "2026-05-13T23:49:04.000Z",
    })).toEqual({ athUsd: 288970.5805422813, athAt: "2026-05-13T23:49:04.000Z" });
  });

  it("falls back to the observed series when the launchpad number is nowhere near it", () => {
    // Fartcoin's corrupt 4.28e11 against a series that says $2.5B. The trades
    // win, and no timestamp is invented for a peak the series cannot date.
    expect(resolveLaunchPeak({
      currentUsd: 129186694,
      seriesPeakUsd: 2.5e9,
      launchpadAthUsd: 428151807937.17694,
      launchpadAthAt: "2025-01-19T00:00:00.000Z",
    })).toEqual({ athUsd: 2.5e9 });
  });

  it("prefers the series when the launchpad under-reports it", () => {
    expect(resolveLaunchPeak({
      currentUsd: 7082,
      seriesPeakUsd: 209587.97,
      launchpadAthUsd: 20000,
      launchpadAthAt: "2026-05-13T23:49:04.000Z",
    })).toEqual({ athUsd: 209587.97 });
  });
});

describe("seriesPeakUsd", () => {
  it("turns a price series into today's dollars via the ratio, not the raw price", () => {
    const history = { points: [], first: 1, last: 7.12852930779898e-06, peak: 0.00021096498242474692, changePct: 0, drawdownPct: 0, timeframe: "day" };
    // uAPE: 29.59x off its daily-close peak, and $7,082 today.
    expect(seriesPeakUsd(history, 7082)).toBeCloseTo(209587.97, 0);
  });

  it("returns null rather than a number it cannot ground", () => {
    const history = { points: [], first: 1, last: 0, peak: 1, changePct: 0, drawdownPct: 0, timeframe: "day" };
    expect(seriesPeakUsd(history, 7082)).toBeNull();
    expect(seriesPeakUsd(null, 7082)).toBeNull();
    expect(seriesPeakUsd({ ...history, last: 1 }, null)).toBeNull();
  });
});

describe("pumpfunCoin", () => {
  it("reads the peak, its timestamp and the mint time from the real LINKR record", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      mint: LINKR_MINT,
      creator: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
      symbol: "LINKR",
      name: "linkrbot",
      twitter: "https://x.com/linkrbot",
      created_timestamp: 1785450548000,
      usd_market_cap: 12675.17991677002,
      ath_market_cap: 288300.74538054527,
      ath_market_cap_timestamp: 1785460436000,
    }), { status: 200 })));

    expect(await pumpfunCoin(LINKR_MINT)).toEqual({
      creator: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
      symbol: "LINKR",
      name: "linkrbot",
      xHandle: "linkrbot",
      createdAt: "2026-07-30T22:29:08.000Z",
      fdvUsd: 12675.17991677002,
      athUsd: 288300.74538054527,
      athAt: "2026-07-31T01:13:56.000Z",
    });
  });
});

describe("enrichLaunchPeaks", () => {
  const uape: PriorLaunch = {
    symbol: "uAPE",
    name: "Hold to Mint",
    mint: UAPE_MINT,
    chain: "solana",
    fdvUsd: 7082,
    liquidityUsd: 7248.16,
    url: "https://dexscreener.com/solana/9b9ftcwjuutdsf9zd79qysb9aprinfiuj4bsbggbwrye",
    link: "operator_announcement",
  };

  const solanaSources = (over: { coin?: unknown; ohlcv?: unknown } = {}) =>
    vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("frontend-api-v3.pump.fun/coins/")) {
        return over.coin === null
          ? new Response("not found", { status: 404 })
          : new Response(JSON.stringify(over.coin ?? UAPE_COIN), { status: 200 });
      }
      if (target.includes("/pools?page=1")) {
        return new Response(JSON.stringify({
          data: [{ id: "solana_9b9fTcWjUUTdSf9Zd79qysB9apriNfiUJ4BsbGGbWrYe", attributes: { address: "9b9fTcWjUUTdSf9Zd79qysB9apriNfiUJ4BsbGGbWrYe" } }],
        }), { status: 200 });
      }
      if (target.includes("/ohlcv/day")) {
        return over.ohlcv === null
          ? new Response("not found", { status: 404 })
          : new Response(JSON.stringify({ data: { attributes: { ohlcv_list: over.ohlcv ?? UAPE_OHLCV } } }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });

  it("gives the real uAPE launch its mint date and a corroborated peak", async () => {
    vi.stubGlobal("fetch", solanaSources());

    const [launch] = await enrichLaunchPeaks([uape]);

    expect(launch.mintedAt).toBe("2026-05-13T22:24:21.000Z");
    expect(launch.athUsd).toBeCloseTo(288970.58, 2);
    expect(launch.athAt).toBe("2026-05-13T23:49:04.000Z");
  });

  it("still publishes the observed peak when pump.fun has nothing to say", async () => {
    vi.stubGlobal("fetch", solanaSources({ coin: null }));

    const [launch] = await enrichLaunchPeaks([uape]);

    expect(launch.athUsd).toBeCloseTo(209587.97, 0);
    // The series carries no timestamp, so no date is invented for the peak.
    expect(launch.athAt).toBeUndefined();
    expect(launch.mintedAt).toBeUndefined();
  });

  it("leaves the peak undefined when neither source can support one", async () => {
    vi.stubGlobal("fetch", solanaSources({ coin: { ...UAPE_COIN, ath_market_cap: 4.28e11 }, ohlcv: null }));

    const [launch] = await enrichLaunchPeaks([uape]);

    expect(launch.athUsd).toBeUndefined();
    expect(launch.athAt).toBeUndefined();
    // Everything else about the launch survives untouched.
    expect(launch).toMatchObject({ symbol: "uAPE", fdvUsd: 7082, link: "operator_announcement" });
  });

  it("never spends a launchpad lookup on a chain the launchpad does not serve", async () => {
    const fetchMock = solanaSources();
    vi.stubGlobal("fetch", fetchMock);

    await enrichLaunchPeaks([{ ...uape, chain: "ethereum", mint: "0xabc" }]);

    expect(fetchMock.mock.calls.every(([url]) => !String(url).includes("pump.fun"))).toBe(true);
  });
});

// The real LINKR investigation, replayed end to end from its recording: the
// operator claims uAPE in a post, the post names the CA, and the launch comes
// back with a receipt, a peak and a mint date.
describe("the LINKR track record", () => {
  it("reports uAPE's decline honestly and calls the gap a gap, not a cadence", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [{
          text: "uAPE is now live\n\nSolana needed more mechanic-driven ecosystems around NFTs and fewer meaningless collectibles\n\nCA: 5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump\n\nWelcome to the jungle",
          createdAt: "Wed May 13 22:24:31 +0000 2026",
          url: "https://x.com/S0Ldev/status/2054689272423502206",
        }] }), { status: 200 });
      }
      if (target.includes(`/coins/${LINKR_MINT}`)) {
        return new Response(JSON.stringify({
          creator: "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
          symbol: "LINKR", name: "linkrbot", twitter: "https://x.com/linkrbot",
          created_timestamp: 1785450548000, usd_market_cap: 12675.17991677002,
          ath_market_cap: 288300.74538054527, ath_market_cap_timestamp: 1785460436000,
        }), { status: 200 });
      }
      if (target.includes(`/coins/${UAPE_MINT}`)) return new Response(JSON.stringify(UAPE_COIN), { status: 200 });
      // The creator index returned only the subject itself in the real run.
      if (target.includes("?creator=")) {
        return new Response(JSON.stringify([{ mint: LINKR_MINT, symbol: "LINKR", usd_market_cap: 15216.5 }]), { status: 200 });
      }
      if (target.includes("dexscreener.com/latest/dex/tokens/")) {
        return new Response(JSON.stringify({ pairs: [{
          chainId: "solana",
          url: "https://dexscreener.com/solana/9b9ftcwjuutdsf9zd79qysb9aprinfiuj4bsbggbwrye",
          baseToken: { address: UAPE_MINT, name: "Hold to Mint", symbol: "uAPE" },
          fdv: 7082,
          liquidity: { usd: 7248.16 },
          info: { socials: [{ url: "https://x.com/uapenfts", type: "twitter" }] },
        }] }), { status: 200 });
      }
      if (target.includes("/pools?page=1")) {
        return new Response(JSON.stringify({
          data: [{ id: "solana_pool", attributes: { address: "9b9fTcWjUUTdSf9Zd79qysB9apriNfiUJ4BsbGGbWrYe" } }],
        }), { status: 200 });
      }
      if (target.includes("/ohlcv/day")) {
        return new Response(JSON.stringify({ data: { attributes: { ohlcv_list: UAPE_OHLCV } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches(LINKR_MINT, [], "@S0Ldev");

    expect(history.subjectMintedAt).toBe("2026-07-30T22:29:08.000Z");
    expect(history.launches).toHaveLength(1);
    const [uape] = history.launches;
    expect(uape).toMatchObject({
      symbol: "uAPE",
      mint: UAPE_MINT,
      fdvUsd: 7082,
      mintedAt: "2026-05-13T22:24:21.000Z",
      permalink: "https://x.com/S0Ldev/status/2054689272423502206",
      link: "operator_announcement",
    });
    expect(uape.announcement?.url).toBe("https://x.com/S0Ldev/status/2054689272423502206");
    expect(uape.athUsd).toBeCloseTo(288970.58, 2);

    const narrative = describeLaunchHistory(history);
    expect(narrative).toBe(
      "This is launch 2 tied to the same operator. Earlier launches: uAPE now $7.1K, down 97.5% from its peak."
      + " There were 78 days between the two dated launches.",
    );
    // Two launches is one interval. It is never a rate, and never an accusation.
    expect(narrative).not.toContain("every 78 days");
    expect(narrative).not.toMatch(/\b(rug|rugged|abandon|abandoned|exit scam|dumped)\b/i);
  });
});

describe("describeLaunchSpacing", () => {
  const dated = (mintedAt: string): PriorLaunch => ({
    symbol: "X", mint: mintedAt, chain: "solana", fdvUsd: 1, liquidityUsd: null,
    url: "https://pump.fun/coin/x", link: "same_creator_wallet", mintedAt,
  });
  const base = { totalLaunches: 1, claimedProjects: [] };

  it("says nothing from a single dated point", () => {
    expect(describeLaunchSpacing({ ...base, launches: [], subjectMintedAt: "2026-07-30T22:29:08.000Z" })).toBeNull();
    expect(describeLaunchSpacing({ ...base, launches: [dated("2026-05-13T22:24:21.000Z")] })).toBeNull();
  });

  it("reports one interval as an interval", () => {
    expect(describeLaunchSpacing({
      ...base,
      launches: [dated("2026-05-13T22:24:21.000Z")],
      subjectMintedAt: "2026-07-30T22:29:08.000Z",
    })).toBe("There were 78 days between the two dated launches.");
  });

  it("reports a typical spacing only once there are two intervals to take it from", () => {
    // The four dates S0Ldev's own posts carry: SINTEL, Crafta, uAPE, LINKR.
    // Three intervals of 36, 115 and 78 days, so 78 is a real median rather
    // than a single gap wearing the word "median".
    expect(describeLaunchSpacing({
      ...base,
      launches: [
        dated("2025-12-14T22:34:00.000Z"),
        dated("2026-01-19T00:21:41.000Z"),
        dated("2026-05-13T22:24:21.000Z"),
      ],
      subjectMintedAt: "2026-07-30T22:29:08.000Z",
    })).toBe("There were 4 dated launches over 228 days, a median of 78 days apart.");
  });

  it("ignores launches with no launchpad mint date rather than guessing one", () => {
    const undatedLaunch = { ...dated("2026-05-13T22:24:21.000Z") };
    delete undatedLaunch.mintedAt;
    expect(describeLaunchSpacing({
      ...base,
      launches: [undatedLaunch],
      subjectMintedAt: "2026-07-30T22:29:08.000Z",
    })).toBeNull();
  });

  // A launch resolved through dexscreener carries no launchpad mint date, so
  // the dated launches are not necessarily the last ones and their count is
  // not the operator's launch count. The sentence says which launches it is
  // talking about rather than implying an order and a total it cannot show,
  // and it can never contradict the launch count in the sentence before it.
  it("never passes the dated launches off as the last ones, or as all of them", () => {
    const undatedLaunch = { ...dated("2026-06-20T00:00:00.000Z") };
    delete undatedLaunch.mintedAt;

    const oneInterval = describeLaunchSpacing({
      ...base,
      launches: [dated("2026-05-13T22:24:21.000Z"), undatedLaunch],
      subjectMintedAt: "2026-07-30T22:29:08.000Z",
    });
    expect(oneInterval).toBe("There were 78 days between the two dated launches.");
    expect(oneInterval).not.toContain("the last two");

    const many = describeLaunchHistory({
      launches: [
        dated("2025-12-14T22:34:00.000Z"),
        dated("2026-01-19T00:21:41.000Z"),
        dated("2026-05-13T22:24:21.000Z"),
        undatedLaunch,
      ],
      subjectMintedAt: "2026-07-30T22:29:08.000Z",
      totalLaunches: 5,
      claimedProjects: [],
    });
    expect(many).toContain("This is launch 5 tied to the same operator.");
    expect(many).toContain("There were 4 dated launches over 228 days");
    // "There were 4 launches" next to "this is launch 5" is a contradiction the
    // reader has no way to resolve.
    expect(many).not.toMatch(/There were 4 launches/);
  });
});

describe("describeLaunchHistory decline phrasing", () => {
  const launch = (over: Partial<PriorLaunch>): PriorLaunch => ({
    symbol: "uAPE", mint: UAPE_MINT, chain: "solana", fdvUsd: 7082, liquidityUsd: null,
    url: "https://pump.fun/coin/x", link: "same_creator_wallet", ...over,
  });

  it("states the decline only when a peak survived the gate", () => {
    expect(describeLaunchHistory({
      launches: [launch({ athUsd: 288970.5805422813 })], totalLaunches: 2, claimedProjects: [],
    })).toContain("uAPE now $7.1K, down 97.5% from its peak");
    expect(describeLaunchHistory({
      launches: [launch({})], totalLaunches: 2, claimedProjects: [],
    })).toContain("uAPE now $7.1K.");
  });

  it("stays quiet about a move off the peak too small to mean anything", () => {
    expect(describeLaunchHistory({
      launches: [launch({ fdvUsd: 100000, athUsd: 104000 })], totalLaunches: 2, claimedProjects: [],
    })).toContain("uAPE now $100K.");
  });

  it("never reports a decline for a launch trading at or above its peak", () => {
    expect(describeLaunchHistory({
      launches: [launch({ fdvUsd: 300000, athUsd: 288970 })], totalLaunches: 2, claimedProjects: [],
    })).toContain("uAPE now $300K.");
  });
});

describe("one project claimed two ways is one project", () => {
  it("merges a handle with the ticker that shares its stem", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const target = String(url);
      if (target.includes("advanced_search")) {
        return new Response(JSON.stringify({ tweets: [
          { text: "Creator rewards config is now live, just tag @pmpr_bot", createdAt: "Fri Mar 13 07:37:00 +0000 2026" },
          { text: "$PMPR transfers and balance checks are now live!", createdAt: "Wed Mar 11 04:19:00 +0000 2026" },
        ] }), { status: 200 });
      }
      if (target.includes("/coins/")) {
        return new Response(JSON.stringify({ creator: "w1", symbol: "LINKR", twitter: "https://x.com/linkrbot" }), { status: 200 });
      }
      if (target.includes("?creator=")) return new Response(JSON.stringify([]), { status: 200 });
      return new Response(JSON.stringify({ pairs: [] }), { status: 200 });
    }));

    const history = await collectOperatorLaunches("MINT_SELF", [], "@S0Ldev");

    // Before: @pmpr_bot and $PMPR were counted as two separate dead projects.
    expect(history.claimedProjects).toHaveLength(1);
    expect(history.claimedProjects[0].label).toBe("@pmpr_bot");
  });
});
