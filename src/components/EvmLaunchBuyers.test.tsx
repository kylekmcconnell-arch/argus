// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvmLaunchBuyers } from "./EvmLaunchBuyers";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const payload = {
  available: true,
  note: "36+ first distinct pool recipients were reconstructed from the token's first 2,000 blocks.",
  sourceUrl: "https://explorer.example/token/0xabc",
  decimals: 18,
  creationBlock: 100,
  pool: "0x0000000000000000000000000000000000000003",
  creator: "0x0000000000000000000000000000000000000009",
  buyers: [
    { address: "0x0000000000000000000000000000000000000010", firstBlock: 110, boughtRaw: "400000000000000000000", remainingRaw: "100000000000000000000", transactionOrigin: "0x0000000000000000000000000000000000000099", contractWallet: false },
    { address: "0x0000000000000000000000000000000000000011", firstBlock: 110, boughtRaw: "200000000000000000000", remainingRaw: "50000000000000000000", transactionOrigin: "0x0000000000000000000000000000000000000099", contractWallet: true },
  ],
  buyersCapped: true,
  sameBlock: [{ block: 110, count: 2 }],
  sharedOrigins: [{ address: "0x0000000000000000000000000000000000000099", count: 2 }],
  boughtRaw: "600000000000000000000",
  remainingRaw: "150000000000000000000",
  totalSupplyRaw: "1000000000000000000000",
};

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("EVM launch buyers", () => {
  it("shows concentration, retention, bursts and keeps a submitter distinct from a funder", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } })));
    await act(async () => { root.render(<EvmLaunchBuyers chain="robinhood" address="0xabc" />); });

    expect(container.textContent).toContain("2+ wallets");
    expect(container.textContent).toContain("60.0% of supply");
    expect(container.textContent).toContain("75.0% net reduction");
    expect(container.textContent).toContain("2 buyers in block 110");
    expect(container.textContent).toContain("Common transaction submitters");
    expect(container.textContent).toContain("not proof of a shared funder or owner");
    expect(container.textContent).not.toMatch(/launch was bundled|bundle detected/i);
  });

  it("does not call an unsupported chain", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => { root.render(<EvmLaunchBuyers chain="ethereum" address="0xabc" />); });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
