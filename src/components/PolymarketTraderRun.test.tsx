// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolymarketTraderRun } from "./PolymarketTraderRun";
import { resolveInput } from "../lib/resolveInput";

/**
 * The lane, mounted. Every other test in this lane checks one module; these
 * check that a person pasting a link reaches the record at all, and that the
 * two ways the check can fail are told apart on screen. An unanswered lookup
 * rendered as an empty record would tell a reader a wallet traded nothing.
 *
 * fetch is stubbed throughout. Nothing here touches the network.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WALLET = "0x4989bfed5900ba096b08ba1f9b718464527c983e";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const copy = () => container.textContent ?? "";

const RECORD = {
  wallet: WALLET,
  displayName: "macau.weather",
  profitUsd: 9964.3,
  volumeUsd: 403462.2,
  portfolioValueUsd: 544.24,
  marketsTraded: 592,
  rank: 14765,
  firstTradeAt: "2026-06-10T14:02:11.000Z",
  lastTradeAt: "2026-08-01T09:41:03.000Z",
  pnlSeries: [
    { at: "2026-06-10T00:00:00.000Z", cumulativeUsd: 0 },
    { at: "2026-07-22T00:00:00.000Z", cumulativeUsd: 10210.2 },
    { at: "2026-08-01T00:00:00.000Z", cumulativeUsd: 9970.38 },
  ],
  openPositions: [{ title: "Fed decision in September?", cashPnlUsd: -196.8, currentValueUsd: 544.24 }],
  unrealizedPnlUsd: -196.8,
  failures: [],
};

const ANALYSIS = {
  windowDays: 53,
  returnOnVolumePct: 2.47,
  maxDrawdownUsd: 982,
  maxDrawdownPct: 9.6,
  greenDayPct: 69.8,
  bestDayUsd: 1612,
  worstDayUsd: -847,
  recentSharePct: 81.1,
  monthlyRateUsd: 5640.17,
  notes: ["This is a 53-day record. A window that short cannot support a monthly figure as a run rate."],
};

function stubFetch(response: { ok?: boolean; status?: number; body: unknown }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(String(url));
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
    } as unknown as Response;
  }));
  return calls;
}

async function mount(wallet = WALLET) {
  await act(async () => root.render(<PolymarketTraderRun wallet={wallet} />));
}

describe("the Polymarket lane is reachable from a pasted profile link", () => {
  it("routes the link to the trader lane and asks the route for that exact wallet", async () => {
    // The path a user actually walks: paste, resolve, mount, fetch.
    const resolved = resolveInput(`https://polymarket.com/profile/${WALLET}`);
    expect(resolved).toEqual({ kind: "polymarket", ref: WALLET });

    const calls = stubFetch({ body: { wallet: WALLET, available: true, partial: false, record: RECORD, analysis: ANALYSIS } });
    await mount(resolved.ref);

    expect(calls).toEqual([`/api/polymarket-trader?wallet=${WALLET}`]);
    expect(copy()).toContain("This wallet cleared $9.96K");
    expect(copy()).toContain("53 days on record");
    // The caveat the route carried arrives on the page rather than stopping at
    // the wire: the notes are the reason the record is safe to publish.
    expect(copy()).toContain("cannot support a monthly figure as a run rate");
    // No claim was published with a pasted link, so no verdict is manufactured.
    expect(copy()).not.toContain("claim holds");
  });

  it("says a lookup that did not complete established nothing, and shows no record", async () => {
    stubFetch({ body: { wallet: WALLET, available: false, error: "boom", note: "Polymarket record lookup failed." } });
    await mount();

    expect(copy()).toContain("nothing about its trading record was established either way");
    expect(copy()).toContain("a gap in this scan, not a finding about the wallet");
    // The difference that matters: a failed read must never render as a record
    // of zeroes, which a reader would take for a wallet that traded nothing.
    expect(copy()).not.toContain("realized profit");
    expect(copy()).not.toContain("$0");
  });

  it("shows the route's own refusal sentence when the wallet was rejected", async () => {
    const refusal = "That is not a Polymarket wallet. Give a 0x address or a polymarket.com/profile link";
    stubFetch({ ok: false, status: 400, body: { error: refusal } });
    await mount();

    expect(copy()).toContain(refusal);
  });

  it("treats a request that threw the same as one that failed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    await mount();

    expect(copy()).toContain("nothing about its trading record was established either way");
  });
});
