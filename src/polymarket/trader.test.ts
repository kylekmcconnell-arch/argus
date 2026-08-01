import { describe, expect, it } from "vitest";
import { INVALID_INPUT_MESSAGE, fetchTraderRecord, normalizeWalletInput } from "./trader";

// The subject every figure in the lane notes was verified against on
// 2026-08-01: the wallet published beside a "passive $6k / month" claim.
const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";

/** The endpoints stamp rows in unix seconds, so the fixtures do too. */
const secs = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

type RouteKey =
  | "profit" | "volume" | "rank" | "value" | "traded"
  | "positions" | "activityAsc" | "activityDesc" | "pnl";

type Route = { status?: number; body?: unknown; throws?: boolean };

function routeKey(href: string): RouteKey {
  if (href.includes("user-pnl")) return "pnl";
  if (href.includes("/activity")) return href.includes("sortDirection=ASC") ? "activityAsc" : "activityDesc";
  if (href.includes("/positions")) return "positions";
  if (href.includes("/traded")) return "traded";
  if (href.includes("/value")) return "value";
  if (href.includes("/rank")) return "rank";
  if (href.includes("/volume")) return "volume";
  if (href.includes("/profit")) return "profit";
  throw new Error(`unexpected fetch: ${href}`);
}

/**
 * The live payloads, trimmed to the fields the adapter reads. The rank row is
 * the trap as it actually came back: an amount that is volume, beside a rank
 * that is profit's.
 */
function liveRoutes(): Record<RouteKey, Route> {
  return {
    profit: { body: [{ amount: 9964.3, pseudonym: "macau.weather", bio: "", profileImage: "" }] },
    volume: { body: [{ amount: 403462.2, pseudonym: "macau.weather" }] },
    rank: { body: [{ amount: 403657, rank: 14765 }] },
    value: { body: [{ user: WALLET, value: 544.24 }] },
    traded: { body: { user: WALLET, traded: 592 } },
    positions: {
      body: [
        { title: "Will the Fed cut in September?", cashPnl: -150.5, currentValue: 300.2, size: 400 },
        { title: "Typhoon lands in Macau by August?", cashPnl: -46.3, currentValue: 244.04, size: 260 },
      ],
    },
    activityAsc: {
      body: [
        { type: "TRADE", timestamp: secs("2026-06-10T14:02:00Z"), usdcSize: 120 },
        { type: "TRADE", timestamp: secs("2026-06-11T08:30:00Z"), usdcSize: 90 },
      ],
    },
    activityDesc: {
      body: [
        { type: "TRADE", timestamp: secs("2026-08-01T09:15:00Z"), usdcSize: 310 },
        { type: "TRADE", timestamp: secs("2026-07-31T22:40:00Z"), usdcSize: 180 },
      ],
    },
    pnl: {
      body: [
        { t: secs("2026-07-30T00:00:00Z"), p: 8100.12 },
        { t: secs("2026-07-31T00:00:00Z"), p: 9200.44 },
        { t: secs("2026-08-01T00:00:00Z"), p: 9970.38 },
      ],
    },
  };
}

function stub(overrides: Partial<Record<RouteKey, Route>> = {}) {
  const table = { ...liveRoutes(), ...overrides };
  const calls: Array<{ href: string; init: RequestInit | undefined }> = [];
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    calls.push({ href, init });
    const route = table[routeKey(href)];
    if (route.throws) throw new Error("socket hang up");
    const status = route.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => route.body,
    } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("normalizeWalletInput", () => {
  it("takes a raw address in any case", () => {
    expect(normalizeWalletInput(WALLET.toUpperCase().replace("0X", "0x"))).toBe(WALLET);
    expect(normalizeWalletInput(`  ${WALLET}  `)).toBe(WALLET);
  });

  it("takes the profile link people paste out of a thread", () => {
    expect(normalizeWalletInput(`https://polymarket.com/profile/${WALLET}`)).toBe(WALLET);
    expect(normalizeWalletInput(`polymarket.com/profile/${WALLET}/`)).toBe(WALLET);
    expect(normalizeWalletInput(`https://www.polymarket.com/profile/${WALLET}?tab=positions`)).toBe(WALLET);
  });

  it("refuses anything that is not a published wallet", () => {
    // A handle does not resolve to a wallet by any public record. Guessing one
    // would pin a stranger's trading history on a named person.
    expect(normalizeWalletInput("@0xSurferX")).toBeNull();
    expect(normalizeWalletInput("vitalik.eth")).toBeNull();
    expect(normalizeWalletInput("0x4989bfed")).toBeNull();
    expect(normalizeWalletInput("polymarket.com/profile/macau.weather")).toBeNull();
    // An address in some other site's path was not published by Polymarket as
    // this trader's wallet.
    expect(normalizeWalletInput(`https://etherscan.io/profile/${WALLET}`)).toBeNull();
    expect(normalizeWalletInput("")).toBeNull();
    expect(normalizeWalletInput(null)).toBeNull();
  });
});

describe("fetchTraderRecord input handling", () => {
  it("refuses a handle without making a single request", async () => {
    const { fetchImpl, calls } = stub();
    await expect(fetchTraderRecord("@0xSurferX", { fetchImpl })).rejects.toThrow(INVALID_INPUT_MESSAGE);
    expect(calls).toHaveLength(0);
  });

  it("reports the record under the normalised wallet", async () => {
    const { fetchImpl } = stub();
    const record = await fetchTraderRecord(`https://polymarket.com/profile/${WALLET.toUpperCase().replace("0X", "0x")}`, { fetchImpl });
    expect(record.wallet).toBe(WALLET);
  });
});

describe("the rank trap", () => {
  // /rank returns amount=403657 for BOTH rankType=pnl and rankType=vol, and
  // that amount is volume. Real profit was 9964.30. Reading the amount would
  // publish a profit forty times the truth.
  it("takes only the rank from the rank endpoint", async () => {
    const { fetchImpl } = stub();
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.rank).toBe(14765);
    expect(record.profitUsd).toBe(9964.3);
    expect(record.volumeUsd).toBe(403462.2);
    // The trap amount must not reach any field, profit or volume alike.
    expect(JSON.stringify(record)).not.toContain("403657");
  });

  it("leaves profit unmeasured rather than borrowing another endpoint's amount", async () => {
    const { fetchImpl } = stub({ profit: { status: 500 } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.profitUsd).toBeNull();
    expect(record.volumeUsd).toBe(403462.2);
    expect(record.rank).toBe(14765);
    expect(record.failures).toEqual([
      "Polymarket's all-time profit leaderboard was temporarily unavailable, so all-time profit is unmeasured.",
    ]);
    expect(JSON.stringify(record)).not.toContain("403657");
  });

  it("stays unmeasured when the profit leaderboard has no row for the wallet", async () => {
    // The tempting shortcut is to reach for the amount the rank endpoint did
    // return. That amount is volume, so this must stay null.
    const { fetchImpl } = stub({ profit: { body: [] } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.profitUsd).toBeNull();
    expect(record.rank).toBe(14765);
    expect(JSON.stringify(record)).not.toContain("403657");
    expect(record.failures).toEqual([
      "Polymarket's all-time profit leaderboard has no record of this wallet, so all-time profit is unmeasured.",
    ]);
  });
});

describe("independent sources", () => {
  it("keeps every other field when one endpoint falls over", async () => {
    const { fetchImpl } = stub({ value: { throws: true } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.portfolioValueUsd).toBeNull();
    expect(record.profitUsd).toBe(9964.3);
    expect(record.volumeUsd).toBe(403462.2);
    expect(record.marketsTraded).toBe(592);
    expect(record.openPositions).toHaveLength(2);
    expect(record.pnlSeries).toHaveLength(3);
    expect(record.firstTradeAt).toBe("2026-06-10T14:02:00.000Z");
    expect(record.failures).toEqual([
      "Polymarket's portfolio value source was temporarily unavailable, so the current portfolio value is unmeasured.",
    ]);
  });

  it("says what did not answer in proportion", async () => {
    const { fetchImpl } = stub({
      volume: { status: 404 },
      traded: { status: 403 },
      pnl: { status: 503 },
    });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.failures).toEqual([
      "Polymarket's all-time volume leaderboard has no record of this wallet, so all-time volume is unmeasured.",
      "Polymarket's markets-traded source rejected the request, so the count of markets traded is unmeasured.",
      "Polymarket's daily profit and loss series was temporarily unavailable, so the daily profit and loss curve is unmeasured.",
    ]);
    expect(record.volumeUsd).toBeNull();
    expect(record.marketsTraded).toBeNull();
    expect(record.pnlSeries).toEqual([]);
  });

  it("treats an absent value as unmeasured and never as zero", async () => {
    const { fetchImpl } = stub({ value: { body: [] }, traded: { body: {} } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.portfolioValueUsd).toBeNull();
    expect(record.marketsTraded).toBeNull();
    expect(record.failures).toContain(
      "Polymarket's portfolio value source has no record of this wallet, so the current portfolio value is unmeasured.",
    );
  });

  it("keeps the leaderboard label without letting it stand in for a figure", async () => {
    const { fetchImpl } = stub({ profit: { status: 500 } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.displayName).toBe("macau.weather");
    expect(record.profitUsd).toBeNull();
  });
});

describe("realized and unrealized stay separate", () => {
  it("sums the open book on its own and leaves profit alone", async () => {
    const { fetchImpl } = stub();
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.openPositions).toEqual([
      { title: "Will the Fed cut in September?", cashPnlUsd: -150.5, currentValueUsd: 300.2 },
      { title: "Typhoon lands in Macau by August?", cashPnlUsd: -46.3, currentValueUsd: 244.04 },
    ]);
    expect(record.unrealizedPnlUsd).toBeCloseTo(-196.8, 6);
    // The realized figure is untouched by the open book: the two are different
    // questions and never add up to one headline.
    expect(record.profitUsd).toBe(9964.3);
    expect(record.openPositionsCapped).toBe(false);
  });

  it("leaves the unrealized sum unmeasured when positions did not answer", async () => {
    const { fetchImpl } = stub({ positions: { status: 500 } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.unrealizedPnlUsd).toBeNull();
    expect(record.openPositions).toEqual([]);
    expect(record.failures).toContain(
      "Polymarket's open positions source was temporarily unavailable, so the open book and its unrealized profit and loss are unmeasured.",
    );
  });

  it("counts an answered empty book as a measured zero", async () => {
    const { fetchImpl } = stub({ positions: { body: [] } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.unrealizedPnlUsd).toBe(0);
    expect(record.failures).toEqual([]);
  });

  it("marks a full page of positions as a floor", async () => {
    const { fetchImpl } = stub();
    const record = await fetchTraderRecord(WALLET, { fetchImpl, positionLimit: 2 });

    expect(record.openPositions).toHaveLength(2);
    expect(record.openPositionsCapped).toBe(true);
  });

  it("marks the book a floor when a row could not be read, rather than counting it as zero", async () => {
    const { fetchImpl } = stub({
      positions: {
        body: [
          { title: "Will the Fed cut in September?", cashPnl: -150.5, currentValue: 300.2 },
          { title: "Unpriced market", currentValue: 244.04 },
        ],
      },
    });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.openPositions).toHaveLength(1);
    expect(record.unrealizedPnlUsd).toBe(-150.5);
    expect(record.openPositionsCapped).toBe(true);
  });
});

describe("how long the record actually runs", () => {
  it("dates both ends from their own page and ignores redemptions", async () => {
    const { fetchImpl } = stub({
      activityDesc: {
        body: [
          // A redemption is a payout on a settled market, not a trade. Counting
          // it would stretch the record past the last time this wallet traded.
          { type: "REDEEM", timestamp: secs("2026-08-05T12:00:00Z") },
          { type: "TRADE", timestamp: secs("2026-08-01T09:15:00Z") },
        ],
      },
    });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.firstTradeAt).toBe("2026-06-10T14:02:00.000Z");
    expect(record.lastTradeAt).toBe("2026-08-01T09:15:00.000Z");
    expect(record.activitySpanIsFloor).toBe(false);
  });

  it("calls the span a floor when only a capped recent page answered", async () => {
    const { fetchImpl } = stub({ activityAsc: { status: 500 } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl, activityLimit: 2 });

    // The earliest row of a full descending page is a page boundary, not a first
    // trade, so the window is a minimum and any rate from it is a maximum.
    expect(record.firstTradeAt).toBe("2026-07-31T22:40:00.000Z");
    expect(record.lastTradeAt).toBe("2026-08-01T09:15:00.000Z");
    expect(record.activitySpanIsFloor).toBe(true);
    expect(record.failures).toEqual([
      "Polymarket's activity feed was temporarily unavailable, so the record is dated from a capped page and its span is a minimum, not a measured length.",
    ]);
  });

  it("says nothing was lost when the surviving page covered the whole feed", async () => {
    const { fetchImpl } = stub({ activityAsc: { status: 500 } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.firstTradeAt).toBe("2026-07-31T22:40:00.000Z");
    expect(record.activitySpanIsFloor).toBe(false);
    expect(record.failures).toEqual([
      "Polymarket's activity feed was temporarily unavailable, so the record was dated from the page that did answer, which covered the whole feed.",
    ]);
  });

  it("leaves both ends unmeasured when the feed is silent", async () => {
    const { fetchImpl } = stub({ activityAsc: { status: 500 }, activityDesc: { throws: true } });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.firstTradeAt).toBeNull();
    expect(record.lastTradeAt).toBeNull();
    expect(record.failures).toEqual([
      "Polymarket's activity feed was temporarily unavailable, so the first and last trade dates are unmeasured.",
    ]);
  });

  it("reads the feed's unix seconds as seconds", async () => {
    const { fetchImpl } = stub();
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    // Read as milliseconds this row lands in 1970 and a 53-day record reads as
    // a 56-year one.
    expect(Date.parse(record.firstTradeAt ?? "")).toBe(Date.parse("2026-06-10T14:02:00Z"));
  });
});

describe("the daily curve", () => {
  it("keeps the series cumulative and in order", async () => {
    const { fetchImpl } = stub({
      pnl: {
        body: [
          { t: secs("2026-08-01T00:00:00Z"), p: 9970.38 },
          { t: secs("2026-07-30T00:00:00Z"), p: 8100.12 },
          { t: secs("2026-07-31T00:00:00Z"), p: 9200.44 },
        ],
      },
    });
    const record = await fetchTraderRecord(WALLET, { fetchImpl });

    expect(record.pnlSeries.map((point) => point.cumulativeUsd)).toEqual([8100.12, 9200.44, 9970.38]);
    expect(record.pnlSeries.map((point) => point.at)).toEqual([
      "2026-07-30T00:00:00.000Z",
      "2026-07-31T00:00:00.000Z",
      "2026-08-01T00:00:00.000Z",
    ]);
    // The last point tracks all-time profit because the points are running
    // totals. Treated as daily gains they would sum to nearly three times it.
    // The two sources disagree by $6.08 live, which is why this checks the
    // order of magnitude rather than an equality neither endpoint promises.
    const summed = record.pnlSeries.reduce((total, point) => total + point.cumulativeUsd, 0);
    expect(summed).toBeGreaterThan(27000);
    const last = record.pnlSeries[record.pnlSeries.length - 1].cumulativeUsd;
    expect(Math.abs(last - (record.profitUsd ?? 0))).toBeLessThan(10);
  });
});

describe("the requests themselves", () => {
  it("asks every source at once, keyless, bounded and on a timeout", async () => {
    const calls: Array<{ href: string; init: RequestInit | undefined }> = [];
    let open = () => {};
    const gate = new Promise<void>((resolve) => { open = () => resolve(); });
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ href: String(url), init });
      await gate;
      return { ok: true, status: 200, json: async () => [] } as Response;
    }) as unknown as typeof fetch;

    const pending = fetchTraderRecord(WALLET, { fetchImpl });
    await Promise.resolve();
    // Nine requests are in flight before any of them has answered.
    expect(calls).toHaveLength(9);
    open();
    await pending;

    for (const call of calls) {
      expect(call.init?.signal).toBeInstanceOf(AbortSignal);
      expect(call.init?.headers).toBeUndefined();
      expect(call.href).not.toMatch(/api[_-]?key|authorization|token=/i);
      expect(call.href.startsWith("https://")).toBe(true);
    }

    const hrefs = calls.map((call) => call.href);
    expect(hrefs.filter((href) => href.includes("/activity"))).toHaveLength(2);
    expect(hrefs.some((href) => href.includes("sortDirection=ASC"))).toBe(true);
    expect(hrefs.some((href) => href.includes("sortDirection=DESC"))).toBe(true);
    expect(hrefs.every((href) => !href.includes("/activity") || href.includes("limit=500"))).toBe(true);
    expect(hrefs.some((href) => href.includes("/positions") && href.includes("limit=500"))).toBe(true);
    expect(hrefs.some((href) => href.includes("rankType=pnl"))).toBe(true);
  });
});
