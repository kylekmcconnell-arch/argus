// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OperatorNetwork } from "./OperatorNetwork";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const root = "BpH4h6pdVCcdTH7EvHMVK6YcrJPykPx9wJYPzYSbD2cX";
const coinbase = "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE";
const MINTED_AT = 1785450548000; // DexScreener reports pool creation in milliseconds
const ORIGIN_SENTENCE = "Wallet first funded 2026-07-30 20:54 UTC with 2.0 SOL from a KYC'd Coinbase account. It launched this token 95 minutes later.";

const rootTrace = {
  available: true,
  tokensCreated: 1,
  chain: [{ from: root, to: coinbase, label: "Coinbase", kind: "cex" }],
  funder: { address: coinbase, label: "Coinbase", kind: "cex" },
  origin: { address: coinbase, label: "Coinbase", kind: "cex" },
  walletAgeDays: 0,
  walletAgeMinutes: 95,
  walletAgeBasis: "mint",
  walletAgeAsOf: "2026-07-30T22:29:08.000Z",
  seedFunding: { from: coinbase, label: "Coinbase", lamports: 2_000_000_000, sol: 2, at: "2026-07-30T20:54:04.000Z" },
  note: `${ORIGIN_SENTENCE} Funding trail: deployer ← Coinbase.`,
};

let container: HTMLDivElement;
let reactRoot: Root;

// Anything the panel reaches for beyond the deployer trace (Arkham labels) is a
// separate provider, and an unavailable one must not fail the trace under test.
function stubChain(trace: Record<string, unknown>) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/deployer?")) return { ok: true, json: async () => trace };
    return { ok: true, json: async () => ({ available: false }) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function trace(props: Record<string, unknown> = {}) {
  await act(async () => {
    reactRoot.render(
      <OperatorNetwork deployer={root} chain="solana" label="$TEST" panelCostToken="signed-panel" record={false} {...props} />,
    );
  });
  const button = container.querySelector("button");
  await act(async () => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  reactRoot = createRoot(container);
});

afterEach(async () => {
  await act(async () => reactRoot.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("operator trace launch origin", () => {
  // The whole sentence was computed on every trace and shown to nobody: the
  // panel rendered the verdict and the funding spine and dropped the seed.
  it("shows the wallet's funding origin sentence", async () => {
    stubChain(rootTrace);
    await trace();

    expect(container.textContent).toContain(ORIGIN_SENTENCE);
  });

  it("states how old the wallet was at the launch, in the unit that carries the fact", async () => {
    stubChain(rootTrace);
    await trace();

    // 0 days is not the fact. 95 minutes is.
    expect(container.textContent).toContain("wallet 95 minutes old at this launch");
  });

  // An age measured to the scan drifts every time the report is reopened, so it
  // must never be presented as a fact about the launch.
  it("labels a scan-basis age as measured at the scan, not at the launch", async () => {
    stubChain({ ...rootTrace, walletAgeBasis: "scan", walletAgeMinutes: 4320, walletAgeDays: 3 });
    await trace();

    expect(container.textContent).toContain("wallet 3 days old as of this scan");
    expect(container.textContent).not.toContain("at this launch");
  });

  it("says nothing about an age the server could not measure", async () => {
    stubChain({ ...rootTrace, walletAgeDays: null, walletAgeMinutes: null });
    await trace();

    expect(container.textContent).not.toContain("wallet 0 days old");
    expect(container.textContent).not.toMatch(/wallet .* old/);
  });

  // Without this the server can never stamp walletAgeBasis "mint", so the
  // "it launched this token N minutes later" clause is unreachable.
  it("pins the launch instant on the trace request", async () => {
    const fetchMock = stubChain(rootTrace);
    await trace({ mintedAt: MINTED_AT });

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/api/deployer?") && u.includes(`mintedAt=${MINTED_AT}`))).toBe(true);
  });

  it("asks for a scan-basis age when no launch instant is known", async () => {
    const fetchMock = stubChain(rootTrace);
    await trace();

    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("mintedAt="))).toBe(false);
  });
});
