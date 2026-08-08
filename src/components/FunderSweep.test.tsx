// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../graph/store", () => ({ recordForensicEntities: vi.fn() }));

import { FunderSweep } from "./FunderSweep";

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
  vi.unstubAllGlobals();
});

describe("FunderSweep coverage", () => {
  it("renders partial positive counts as lower bounds", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      available: true,
      completed: false,
      truncated: true,
      providerFailed: false,
      countsAreLowerBounds: true,
      ownLaunches: 2,
      ownTokens: [{ mint: "Mint111111111111111111111111111111111111" }],
      seededCount: 1,
      seededDeployers: [{
        wallet: "Wallet1111111111111111111111111111111111",
        tokensCreated: 3,
        sampleTokens: [],
      }],
      note: "The funder sweep did not complete. Counts are lower bounds.",
    }), { status: 200, headers: { "content-type": "application/json" } })));

    await act(async () => root.render(<FunderSweep wallet="WalletRoot11111111111111111111111111111" />));
    const run = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Serial-launch sweep"));
    await act(async () => run?.click());

    expect(container.textContent).toContain("Partial sweep");
    expect(container.textContent).toContain("At least 2");
    expect(container.textContent).toContain("Other deployers observed (At least 1)");
    expect(container.textContent).not.toContain("No serial-launch pattern");
  });
});
