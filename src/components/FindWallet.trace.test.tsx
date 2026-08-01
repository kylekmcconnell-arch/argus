// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../graph/store", () => ({
  recordContribution: () => {},
  walletContribution: () => null,
  knownAddresses: () => [],
}));
vi.mock("./FunderSweep", () => ({ FunderSweep: () => null }));
vi.mock("./ScoreTicker", () => ({ ScoreTicker: () => null }));

import { FindWallet } from "./FindWallet";

const WALLET = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const COINBASE = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const ORIGIN_SENTENCE = "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It launched this token 95 minutes later.";

const TRAIL = {
  wallet: WALLET,
  available: true,
  funder: { address: COINBASE, label: "Coinbase", kind: "cex" },
  origin: { address: COINBASE, label: "Coinbase", kind: "cex" },
  terminatesAtCex: true,
  hops: 1,
  tokensCreated: 1,
  serialDeployer: false,
  walletAgeDays: 0,
  walletAgeMinutes: 95,
  walletAgeBasis: "mint",
  seedFunding: { from: COINBASE, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" },
  firstActivity: "2026-07-30",
  note: `${ORIGIN_SENTENCE} Funding trail: deployer ← Coinbase.`,
};

let container: HTMLDivElement;
let reactRoot: Root;
let urls: string[];

// The resolver always answers with one Solana wallet; the trace route is what
// each case varies.
function stubRoutes(trace: () => Response) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.startsWith("/api/find-wallet")) {
      return new Response(JSON.stringify({ wallets: [{ address: WALLET, chain: "solana", source: "self-disclosed bio" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return trace();
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

async function resolveAndTrace() {
  await act(async () => { reactRoot.render(<FindWallet onAudit={() => {}} onReset={() => {}} />); });
  await act(async () => { button("vitalik.eth")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { button("trace funding")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  urls = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("find wallet funding trace", () => {
  // The defect: /api/deployer needs a panel token bound to a persisted report
  // version, which this page never has, so every trace 409'd and the button
  // flipped to "traced" over an empty bordered box.
  it("traces through the scan-time route, not the gated panel one", async () => {
    stubRoutes(() => new Response(JSON.stringify(TRAIL), { status: 200, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(urls.some((u) => u.startsWith("/api/deployer-origin?"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/deployer?"))).toBe(false);
    expect(container.textContent).toContain(ORIGIN_SENTENCE);
  });

  it("states the exchange as where the money came from, never where it went", async () => {
    stubRoutes(() => new Response(JSON.stringify(TRAIL), { status: 200, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(container.textContent).toContain("funded from Coinbase");
    // The trace only ever walks upstream, so an arrow pointing at the exchange
    // asserts the opposite of the evidence.
    expect(container.textContent).not.toContain("funds →");
  });

  // This page resolves a bare wallet, not a token, so it has no launch instant to
  // pin and the server measures the age to the scan. It says so.
  it("gives the age in the unit that carries the fact, and says what it is measured to", async () => {
    stubRoutes(() => new Response(JSON.stringify({ ...TRAIL, walletAgeBasis: "scan" }), { status: 200, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(container.textContent).toContain("wallet 95 minutes old as of this scan");
    // 0 days is not the fact, and it is the number this row used to print.
    expect(container.textContent).not.toContain("age 0d");
  });

  // The mint count is read off the wallet's most recent transactions, so it is a
  // lower bound. This row could never show it before (every trace answered 409),
  // so the floor had to be marked the moment it became reachable.
  it("shows the mint count as a floor, never as the wallet's lifetime total", async () => {
    stubRoutes(() => new Response(JSON.stringify(TRAIL), { status: 200, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(container.textContent).toContain("1+ tokens minted");
    // "1 token minted" reads as the whole of what this wallet ever did.
    expect(container.textContent).not.toContain("1 token minted");
  });

  it("says a failed trace failed instead of rendering an empty box", async () => {
    stubRoutes(() => new Response(JSON.stringify({ error: "invalid_panel_context", message: "Rescan before running it." }), { status: 409, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(container.textContent).toContain("Funding trail could not be traced");
    // A trace that never ran has not traced anything.
    expect(button("traced")).toBeUndefined();
    expect(button("trace funding")).toBeDefined();
  });

  it("reports an unavailable provider as unavailable, not as a clean wallet", async () => {
    stubRoutes(() => new Response(JSON.stringify({ available: false, note: "Helius not configured; funding trail unavailable." }), { status: 200, headers: { "content-type": "application/json" } }));
    await resolveAndTrace();

    expect(container.textContent).toContain("Helius not configured");
    expect(container.textContent).not.toContain("0 tokens minted");
  });
});
