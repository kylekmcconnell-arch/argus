// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function stubHealth(services: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ services }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

/** The module caches one readiness read per session, so each case needs a fresh copy. */
async function renderAlert() {
  vi.resetModules();
  const { ServiceAlert } = await import("./ServiceAlert");
  await act(async () => {
    root.render(<ServiceAlert />);
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

describe("the deployment configuration diagnostic", () => {
  it("says nothing when the only unconfigured providers are retired", async () => {
    // The live symptom: Crunchbase and Reddit are commented out of the adapter
    // registry and cannot run, yet every report carried a red "2 providers are
    // unavailable, this report has reduced coverage" because their keys are
    // unset. No coverage was lost and no rescan could have changed it.
    stubHealth([
      { id: "anthropic", label: "Claude research + analyst", ok: true },
      { id: "crunchbase", label: "Crunchbase (company funding)", ok: false, retired: true, detail: "retired: DeFiLlama and Monid/Akta cover funding and backing" },
      { id: "reddit", label: "Reddit (community signal)", ok: false, retired: true, detail: "retired: Reddit API access was not approved" },
    ]);
    await renderAlert();

    expect(container.textContent).toBe("");
  });

  it("still raises a provider this build actually uses", async () => {
    stubHealth([
      { id: "crunchbase", label: "Crunchbase (company funding)", ok: false, retired: true },
      { id: "helius", label: "Helius (Solana deployer + wallet age)", ok: false, action: "configure HELIUS_API_KEY", detail: "not configured in this deployment" },
    ]);
    await renderAlert();

    expect(container.textContent).toContain("Helius");
    expect(container.textContent).toContain("is not configured in this deployment");
    // The retired lane must not be counted into the headline or listed.
    expect(container.textContent).not.toContain("Crunchbase");
    expect(container.textContent).not.toContain("2 providers");
  });

  it("does not claim which lanes a missing key feeds", async () => {
    stubHealth([
      { id: "helius", label: "Helius (Solana deployer + wallet age)", ok: false, action: "configure HELIUS_API_KEY" },
    ]);
    await renderAlert();

    // The old copy asserted "team search, portfolios, namesake, identity"
    // depend on whatever happens to be down, which this banner cannot know.
    expect(container.textContent).not.toContain("Deep digs");
    expect(container.textContent).toContain("does not establish whether any report lost coverage");
    expect(container.textContent).not.toContain("missing from this report");
  });
});
