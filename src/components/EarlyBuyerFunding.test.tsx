// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EarlyBuyerFunding } from "./EarlyBuyerFunding";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const FUNDER = "Funder11xxxxxxxxxxxxxxxxxxxxxxxxxx";
const W1 = "Wa11et11xxxxxxxxxxxxxxxxxxxxxxxxxx";
const W2 = "Wa11et12xxxxxxxxxxxxxxxxxxxxxxxxxx";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    mint: "MINT",
    available: true,
    reachedLaunch: true,
    windowTxCount: 100,
    buyersFound: 36,
    buyersCapped: false,
    buyersTraced: 36,
    tracedIsPartial: false,
    labelsAvailable: true,
    creator: null,
    sameBlock: [{ slot: 123, count: 9 }],
    sameTx: [],
    clusters: [{
      funder: FUNDER,
      funderIsCreator: false,
      size: 2,
      members: [
        { address: W1, receivedUi: 1000, paidInFirstTx: true, remainingUi: 100 },
        { address: W2, receivedUi: 500, paidInFirstTx: false, remainingUi: 80 },
      ],
      receivedTotalUi: 1500,
      remainingTotalUi: 180,
      stillHeldPct: 12,
    }],
    cexFunded: [{ address: W2, exchange: "Binance" }],
    unresolvedFunding: 0,
    note: "36 wallets took supply in the token's first 100 transactions. 2 of the 36 traced received their first SOL from the same wallet.",
    ...overrides,
  };
}

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function render(chain = "solana") {
  await act(async () => {
    root.render(<EarlyBuyerFunding chain={chain} mint="MINT" />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("who funded the first buyers", () => {
  it("renders the shared-funder shape with what the group still holds", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("2 wallets seeded by");
    expect(container.textContent).toContain("still holds 12%");
    // Shape, never a verdict.
    expect(container.textContent).not.toMatch(/bundled|rug|scam/i);
  });

  it("labels a handed transfer differently from a buy", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("(transferred)");
  });

  it("names exchange-funded wallets and why they never cluster", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("Binance");
    expect(container.textContent).toContain("never clustered");
  });

  it("says the balances were unreadable rather than showing a held share", async () => {
    stub(payload({
      clusters: [{
        funder: FUNDER,
        funderIsCreator: false,
        size: 2,
        members: [
          { address: W1, receivedUi: 1000, paidInFirstTx: true, remainingUi: null },
          { address: W2, receivedUi: 500, paidInFirstTx: true, remainingUi: 80 },
        ],
        receivedTotalUi: 1500,
        remainingTotalUi: null,
        stillHeldPct: null,
      }],
    }));
    await render();

    expect(container.textContent).toContain("current holdings unreadable");
    expect(container.textContent).not.toContain("still holds");
  });

  it("publishes coverage floors when the trace was partial", async () => {
    stub(payload({ tracedIsPartial: true, buyersTraced: 20, unresolvedFunding: 3 }));
    await render();

    expect(container.textContent).toContain("traced for 20 of 36");
    expect(container.textContent).toContain("unresolved is not independent");
  });

  it("shows the honest refusal when the launch window was unreachable", async () => {
    stub({ mint: "MINT", available: true, reachedLaunch: false, note: "This token has more history than this trace can page back through, so its launch window was not reachable and no early-buyer reading was taken." });
    await render();

    expect(container.textContent).toContain("not reachable");
    expect(container.textContent).not.toContain("seeded by");
  });

  it("renders nothing off Solana", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await render("ethereum");

    expect(container.textContent).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
