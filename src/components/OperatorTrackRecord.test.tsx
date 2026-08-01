// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OperatorTrackRecord, type OperatorLaunchHistoryView } from "./OperatorTrackRecord";

/**
 * The fixtures are the recorded $LINKR audit (token
 * 5NHPWfmaUi19A5sjR3rCx1X2HuGYrasoTF9RmxCspump, operator @S0Ldev) in
 * eval/recordings/linkrbot, re-probed live on 2026-08-01. Nothing here is
 * invented except where a comment says so:
 *
 *   dexscreener /latest/dex/tokens/5E2woTdd...pump -> baseToken.symbol "uAPE",
 *     baseToken.name "Hold to Mint", fdv 7082, liquidity.usd 7248.16,
 *     info.socials[0].url "https://x.com/uapenfts"
 *   pump.fun /coins/5E2woTdd...pump -> creator
 *     "72aXYDZfdEEJuB2ii1yBJdGQZLGUzhkxy8kucaLf3dEX" (a DIFFERENT wallet from
 *     the subject's, which is why uAPE surfaced through the operator's own
 *     post and not the creator index), created_timestamp 1778711061000,
 *     ath_market_cap 288970.5805422813, ath_market_cap_timestamp 1778716144000
 *   pump.fun /coins/5NHPWfma...pump -> creator
 *     "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX",
 *     created_timestamp 1785450548000
 *
 * The claim quotes and permalinks are the operator's real posts from the
 * recorded twitterapi advanced_search response.
 */

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
});

const CREATOR_WALLET = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
/** pump.fun created_timestamp 1785450548000 for the token under audit. */
const SUBJECT_MINTED_AT = "2026-07-30T22:29:08.000Z";
const UAPE_POST = "https://x.com/S0Ldev/status/2054689272423502206";

/** The one prior launch that still resolves to a live pool. */
const uape: OperatorLaunchHistoryView["launches"][number] = {
  symbol: "uAPE",
  name: "Hold to Mint",
  mint: "5E2woTdd2Gc4BpfE4yDPC4rTEJCo3fijhveDxhaZpump",
  chain: "solana",
  fdvUsd: 7082,
  liquidityUsd: 7248.16,
  xHandle: "uapenfts",
  mintedAt: "2026-05-13T22:24:21.000Z",
  athUsd: 288970.5805422813,
  athAt: "2026-05-13T23:49:04.000Z",
  permalink: UAPE_POST,
  url: "https://dexscreener.com/solana/9b9ftcwjuutdsf9zd79qysb9aprinfiuj4bsbggbwrye",
  link: "operator_announcement",
  announcement: {
    text: "uAPE is now live Solana needed more mechanic-driven ecosystems around NFTs and fewer meaningless collectibles",
    at: "2026-05-13T22:24:31.000Z",
    url: UAPE_POST,
  },
};

/**
 * A stand-in third launch, in the shape pump.fun's creator index returns. It
 * exists only to supply a third date; no real token is priced by it.
 */
const walletSibling: OperatorLaunchHistoryView["launches"][number] = {
  symbol: "PRIOR",
  name: "prior launch",
  mint: "7YtQmZk3rWbN2sVdE9fJxLpH4uCgA6nT8vRkMwXyQ1pump",
  chain: "solana",
  fdvUsd: 11434.72522119566,
  liquidityUsd: null,
  mintedAt: "2026-06-02T10:00:00.000Z",
  url: "https://pump.fun/coin/7YtQmZk3rWbN2sVdE9fJxLpH4uCgA6nT8vRkMwXyQ1pump",
  link: "same_creator_wallet",
};

/** Projects the operator claims, with no live market behind them. */
const claimedProjects: OperatorLaunchHistoryView["claimedProjects"] = [
  {
    label: "@craftadotfun",
    at: "2026-01-19T00:21:41.000Z",
    quote: "Excited to announce the launch of my project @craftadotfun Crafta lets you build end-to-end websites and web apps using Claude Opus 4.5",
    url: "https://x.com/S0Ldev/status/2013044154205442169",
  },
  {
    label: "$ELVES",
    at: "2025-12-02T00:14:41.000Z",
    quote: "Just launched my project $ELVES. Hold $ELVES complete the X posting quests and earn SOL.",
    url: "https://x.com/S0Ldev/status/1995647773748986044",
  },
  {
    label: "Splitr",
    at: "2025-12-17T21:22:17.000Z",
    quote: "Splitr is now live Creators and beneficiaries of different tokens shouldn’t have to chase devs to get paid out.",
  },
];

const history = (overrides: Partial<OperatorLaunchHistoryView> = {}): OperatorLaunchHistoryView => ({
  creatorWallet: CREATOR_WALLET,
  launches: [uape],
  subjectMintedAt: SUBJECT_MINTED_AT,
  totalLaunches: 2,
  claimedProjects: [],
  ...overrides,
});

const render = (props: Parameters<typeof OperatorTrackRecord>[0]) => {
  act(() => {
    root.render(<OperatorTrackRecord {...props} />);
  });
};

/**
 * ARGUS never asserts what it cannot verify. A prior launch trading far under
 * its peak, or a claim with no live market, is never described as abandonment,
 * failure or fraud anywhere on this panel.
 */
const ACCUSATIONS = /\b(rug|rugs|rugged|rugpull|scam|scams|scammer|fraud|fraudulent|abandon|abandoned|abandonment|dead|died|failed|failure|worthless|dumped|exit)\b/i;

describe("OperatorTrackRecord", () => {
  it("renders nothing when this is the only launch and nothing is claimed", () => {
    render({
      history: history({ launches: [], totalLaunches: 1, claimedProjects: [] }),
      operatorHandle: "@S0Ldev",
    });
    expect(container.textContent).toBe("");
    expect(container.querySelector("section")).toBeNull();
  });

  it("heads the dossier with the operator, their linked handle, and the creator wallet", () => {
    render({ history: history(), operatorHandle: "@S0Ldev", creatorWallet: CREATOR_WALLET });
    expect(container.textContent).toContain("Operator track record");
    expect(container.querySelector('a[href="https://x.com/S0Ldev"]')?.textContent).toBe("@S0Ldev");
    const walletLink = container.querySelector(`a[href="https://pump.fun/profile/${CREATOR_WALLET}"]`);
    expect(walletLink?.textContent).toBe("creator wallet BpH4…D2cX");
    expect(walletLink?.getAttribute("title")).toBe(CREATOR_WALLET);
    expect(container.textContent).toContain("Launch 2 of 2 traced to this operator.");
  });

  it("gives a resolved prior launch its own row: symbol, mint date, value now, and how it was tied", () => {
    render({ history: history(), operatorHandle: "S0Ldev" });
    const row = container.querySelector("ol li");
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("uAPE");
    expect(row?.textContent).toContain("minted May 2026");
    // dexscreener fdv 7082 in the report canvas's one USD style.
    expect(row?.textContent).toContain("$7.08K");
    expect(row?.textContent).toContain("value now");
    expect(row?.textContent).toContain("Hold to Mint · the operator's own launch post");
    expect(row?.querySelector('a[href="https://dexscreener.com/solana/9b9ftcwjuutdsf9zd79qysb9aprinfiuj4bsbggbwrye"]')).not.toBeNull();
    // The receipt: the post that claimed the launch, one click away.
    expect(row?.querySelector(`a[href="${UAPE_POST}"]`)?.textContent).toBe("the post");
    expect(container.textContent).toContain("dexscreener markets");
    // A row can show a dated peak next to today's value, so the footer cannot
    // say every number on the panel is today's.
    expect(container.textContent).toContain("Each launch's value now is what the market says today");
    expect(container.textContent).not.toContain("Every value is what the market says today");
  });

  it("spaces the two launches and states the decline from the vetted peak", () => {
    render({ history: history(), operatorHandle: "S0Ldev" });
    // pump.fun mints: uAPE 2026-05-13, the subject 2026-07-30.
    expect(container.textContent).toContain("The two dated launches are 11 weeks apart.");
    // fdv 7082 against ath_market_cap 288970.58, peaked the day it minted.
    expect(container.textContent).toContain("down 97.5% from its $289K peak in May 2026");
  });

  it("says nothing about a peak the sources could not vet, and never prices a missing market", () => {
    render({
      history: history({ launches: [{ ...uape, athUsd: undefined, athAt: undefined }] }),
      operatorHandle: "S0Ldev",
    });
    // Not in a row, and not in the footer either: a panel with no vetted peak
    // never uses the word.
    expect(container.textContent).not.toContain("peak");
    expect(container.textContent).toContain("Each launch's value now is what the market says today.");

    render({
      history: history({ launches: [{ ...uape, fdvUsd: null, athUsd: undefined, athAt: undefined }] }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent).toContain("not reported");
    expect(container.textContent).not.toContain("$0");
    expect(container.textContent).not.toContain("N/A");
  });

  it("keeps claimed projects in a quieter group, in the operator's own dated words", () => {
    render({
      history: history({ launches: [], totalLaunches: 1, claimedProjects }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent).toContain("The operator's own claims");
    // What the posts DO: announce a launch and name a project. Not "this
    // account says it launched X": the recorded @pmpr_bot claim comes from
    // "Creator rewards config is now live ... Just tag @pmpr_bot", a post that
    // claims authorship of nothing, and the panel must not put words in it.
    expect(container.textContent).toContain("This account's own launch posts name 3 other projects.");
    expect(container.textContent).not.toContain("says it launched");
    expect(container.textContent).toContain("the claim, its date, and the operator's own words");
    // No resolved launch, so no launch count and no ledger of rows.
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toContain("Launch 1 of 1");

    const items = container.querySelectorAll("ul li");
    expect(items.length).toBe(3);
    expect(items[0].textContent).toContain("@craftadotfun");
    expect(items[0].textContent).toContain("Jan 2026");
    expect(items[0].textContent).toContain("\"Excited to announce the launch of my project @craftadotfun");
    expect(items[0].querySelector('a[href="https://x.com/S0Ldev/status/2013044154205442169"]')).not.toBeNull();
    expect(items[1].textContent).toContain("$ELVES");
    expect(items[1].textContent).toContain("Dec 2025");
    // Splitr's claim carried no permalink; the quote still stands on its own.
    expect(items[2].textContent).toContain("Splitr");
    expect(items[2].querySelector("a")).toBeNull();
    expect(items[2].querySelector("blockquote")?.textContent).toContain("Splitr is now live");
    // The claimed group is a wash, not a second bordered card.
    expect(items[0].className).toContain("panel-inset");
  });

  it("reports a claim as a claim and never as an outcome", () => {
    render({
      history: history({ launches: [uape, walletSibling], totalLaunches: 3, claimedProjects }),
      operatorHandle: "S0Ldev",
      creatorWallet: CREATOR_WALLET,
    });
    const copy = container.textContent ?? "";
    expect(copy).not.toMatch(ACCUSATIONS);
    expect(copy).toContain("No traded market resolved to them in this scan");
    expect(copy).toContain("own launch posts name");
    // Neutral surface: a track record is not a stamped finding or an alarm.
    expect(container.querySelector(".finding")).toBeNull();
    expect(container.querySelector(".tint-avoid")).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reads as one project when there is one", () => {
    render({
      history: history({ launches: [], totalLaunches: 1, claimedProjects: [claimedProjects[2]] }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent).toContain("This account's own launch posts name 1 other project.");
    expect(container.textContent).toContain("No traded market resolved to it in this scan");
  });

  it("keeps the claimed-only panel free of accusation too", () => {
    render({
      history: history({ launches: [], totalLaunches: 1, claimedProjects }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent ?? "").not.toMatch(ACCUSATIONS);
  });
});

describe("the interval between launches", () => {
  const spacing = (mintedAt: string, subjectMintedAt: string): string => {
    render({
      history: history({ launches: [{ ...uape, mintedAt }], subjectMintedAt }),
      operatorHandle: "S0Ldev",
    });
    return container.textContent ?? "";
  };

  it("counts days, then weeks, then months, and never editorializes", () => {
    expect(spacing("2026-05-13T00:00:00Z", "2026-05-14T00:00:00Z")).toContain("are 1 day apart.");
    expect(spacing("2026-05-13T00:00:00Z", "2026-05-20T00:00:00Z")).toContain("are 7 days apart.");
    expect(spacing("2026-05-13T22:24:21Z", "2026-07-30T22:29:08Z")).toContain("are 11 weeks apart.");
    expect(spacing("2025-12-02T00:00:00Z", "2026-07-30T00:00:00Z")).toContain("are 8 months apart.");
    // Two launches hours apart is a real launchpad pattern, not a rounding case.
    expect(spacing("2026-05-13T02:00:00Z", "2026-05-13T08:00:00Z")).toContain("are under a day apart.");
  });

  it("stays silent unless exactly two launches carry a launchpad date", () => {
    render({
      history: history({ launches: [{ ...uape, mintedAt: undefined }] }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent).toContain("Launch 2 of 2 traced to this operator.");
    expect(container.textContent).not.toContain("apart");

    // Three dates is two intervals, which is a rate this panel will not claim.
    render({
      history: history({ launches: [uape, walletSibling], totalLaunches: 3 }),
      operatorHandle: "S0Ldev",
    });
    expect(container.textContent).toContain("Launch 3 of 3 traced to this operator.");
    expect(container.textContent).not.toContain("apart");
  });
});

describe("the decline from peak", () => {
  const withPeak = (fdvUsd: number | null, athUsd: number | undefined): string => {
    render({
      history: history({ launches: [{ ...uape, fdvUsd, athUsd, athAt: undefined }] }),
      operatorHandle: "S0Ldev",
    });
    return container.textContent ?? "";
  };

  it("states a decline only when both numbers are real and the drop is material", () => {
    expect(withPeak(7082, 288970.5805422813)).toContain("down 97.5% from its $289K peak");
    expect(withPeak(7082, undefined)).not.toContain("peak");
    expect(withPeak(null, 288970.5805422813)).not.toContain("peak");
    // At its high, under a stale high, or inside the noise floor: no decline claimed.
    expect(withPeak(7082, 7082)).not.toContain("peak");
    expect(withPeak(7082, 6000)).not.toContain("peak");
    expect(withPeak(7082, 7500)).not.toContain("peak");
    expect(withPeak(7082, 8000)).toContain("down 11.5% from its $8.00K peak");
  });
});
