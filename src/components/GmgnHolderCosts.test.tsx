// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GmgnHolderCosts, type GmgnHolderRow } from "./GmgnHolderCosts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const row = (overrides: Partial<GmgnHolderRow> = {}): GmgnHolderRow => ({
  address: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  percent: 7.68,
  usdValue: 19141848,
  costUsd: 52155463,
  profitUsd: -13881568,
  riskTags: [],
  suspicious: false,
  xHandle: null,
  exchange: null,
  ...overrides,
});

function payload(overrides: Record<string, unknown> = {}) {
  return {
    available: true,
    note: null,
    capped: false,
    claims: [],
    holders: [row()],
    ...overrides,
  };
}

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function render() {
  await act(async () => {
    root.render(<GmgnHolderCosts chain="solana" address="MINT" />);
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

describe("what the top holders paid", () => {
  it("shows the entry cost and the direction of the position", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("7.68%");
    expect(container.textContent).toContain("paid");
    // Underwater by 13.9M on a 52.2M cost is a 27% loss, and the sign matters.
    expect(container.textContent).toMatch(/-27%/);
  });

  it("attributes the reading to GMGN rather than stating it as ARGUS's own", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("GMGN's accounting");
    expect(container.textContent).not.toMatch(/ARGUS (?:found|verified|confirmed)/i);
  });

  it("labels a risk tag as GMGN's classification", async () => {
    stub(payload({ holders: [row({ riskTags: ["sniper"], suspicious: true })] }));
    await render();

    expect(container.textContent).toContain("sniper (GMGN)");
  });

  it("says an unreported cost is not measured instead of showing zero", async () => {
    stub(payload({ holders: [row({ costUsd: null, profitUsd: null })] }));
    await render();

    expect(container.textContent).toContain("no entry cost");
    expect(container.textContent).not.toContain("paid $0");
    expect(container.textContent).not.toMatch(/\b0%/);
  });

  it("calls a capped list a floor", async () => {
    stub(payload({ capped: true }));
    await render();

    expect(container.textContent).toContain("a floor");
  });

  it("publishes the reason instead of an empty table when GMGN did not answer", async () => {
    stub({ available: false, note: "GMGN did not respond, so its holder reading was not collected.", capped: false, claims: [], holders: [] });
    await render();

    expect(container.textContent).toContain("did not respond");
    // An absent provider must never read as a token with no concentrated
    // holders, so no row and no figure may render at all.
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toMatch(/\d+\.\d+%/);
  });

  it("marks an associated X handle as an attribution, not proof", async () => {
    stub(payload({ holders: [row({ xHandle: "somedev" })] }));
    await render();

    const link = container.querySelector('a[href="https://x.com/somedev"]');
    expect(link).not.toBeNull();
    expect(link?.getAttribute("title")).toContain("attribution, not proof");
  });
});
