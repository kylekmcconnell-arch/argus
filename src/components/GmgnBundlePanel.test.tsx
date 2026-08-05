// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GmgnBundlePanel, type GmgnBundlePayload } from "./GmgnBundlePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const CREATOR = "BpH4h6pdBLBnpwiZAhmGqhvkhFXknWU7QSBLQRHGi1Gt";

function payload(overrides: Partial<GmgnBundlePayload> = {}): GmgnBundlePayload {
  return {
    available: true,
    note: null,
    holderCount: 4409,
    bundlerVolumePct: 12.34,
    insiderVolumePct: null,
    entrapmentVolumePct: 14.78,
    botVolumePct: null,
    botWalletCount: 130,
    freshWalletHolderPct: 4.65,
    sniperHoldPct: 0.95,
    top10HolderPct: 23.44,
    creatorHoldPct: 0.96,
    devTeamHoldPct: null,
    creatorCreatedCount: 4,
    imageDupCount: 0,
    tagged: {
      sniper: { count: 34, atCap: false },
      bundler: { count: 1000, atCap: true },
      insider: null,
      fresh: { count: 802, atCap: false },
    },
    creatorAddress: CREATOR,
    creatorStillHolds: false,
    twitterRenames: 0,
    communityTakeover: null,
    dexscreenerBoost: 99,
    claims: [],
    ...overrides,
  };
}

function stub(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  })));
}

async function render(knownDeployer?: string | null) {
  await act(async () => {
    root.render(<GmgnBundlePanel chain="solana" address="MINT" knownDeployer={knownDeployer} />);
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

describe("how the launch was bought", () => {
  it("shows GMGN's volume shares and attributes them as GMGN's classification", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("12.3%");
    expect(container.textContent).toContain("GMGN's classification");
    expect(container.textContent).toContain("not findings ARGUS verified independently");
    expect(container.textContent).not.toMatch(/ARGUS (?:found|confirmed)/i);
    // The panel never draws the conclusion.
    expect(container.textContent).not.toMatch(/was bundled/i);
  });

  it("renders a count at GMGN's cap as 1,000+ with the floor explained", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("1,000+");
    expect(container.textContent).toContain("floor, never a total");
  });

  it("notes when two unrelated providers agree on who launched the token", async () => {
    stub(payload());
    await render(CREATOR);

    expect(container.textContent).toContain("two unrelated providers agree");
  });

  it("notes when GMGN's creator differs from the deployer ARGUS resolved", async () => {
    stub(payload());
    await render("7NsngNMtXJNdHgeK4znQDZ5PJ19ykVvQvEF7BT5KFjMv");

    expect(container.textContent).toContain("differs from the deployer ARGUS resolved");
  });

  it("reports the creator exit as GMGN's account", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("GMGN reports the creator has closed its position");
  });

  it("publishes the reason instead of an empty grid when GMGN did not answer", async () => {
    stub({ ...payload({ available: false }), note: "GMGN did not respond, so its launch-pattern reading was not collected." });
    await render();

    expect(container.textContent).toContain("did not respond");
    expect(container.textContent).not.toMatch(/\d+\.\d+%/);
  });
});
