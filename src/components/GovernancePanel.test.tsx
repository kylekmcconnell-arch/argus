// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GovernancePanel, type GovernancePayload } from "./GovernancePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function payload(overrides: Partial<GovernancePayload> = {}): GovernancePayload {
  return {
    available: true,
    note: null,
    space: {
      id: "uniswapgovernance.eth",
      name: "Uniswap",
      verifiedBySnapshot: true,
      followers: 125274,
      proposalCount: 197,
      binding: "token_contract",
    },
    proposals: [{
      id: "0x1",
      title: "[Temp Check] - Four for V4",
      voters: 118,
      totalVotingPower: 5349528,
      quorum: 10000000,
      quorumMet: false,
      topVoters: [
        { address: "0x8d07D2251f0ad2d3d4d2c6e0d1f1a1b1c1d1e1f1", votingPower: 2301704, sharePct: 43.0 },
        { address: "0x683a4F9912345678901234567890123456789012", votingPower: 2002445, sharePct: 37.4 },
      ],
      top1Pct: 43.0,
      top2Pct: 80.5,
      contested: true,
      topVoterCouldHaveFlipped: false,
      endedAt: "2026-01-01T00:00:00.000Z",
    }],
    delegationDetected: true,
    claims: [
      "These are shares of the voting power cast, not of tokens held.",
      "Snapshot records off-chain signalling votes.",
    ],
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
    root.render(<GovernancePanel name="Uniswap" address="0x1f98" handle="@Uniswap" website="https://uniswap.org" />);
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

describe("who decides", () => {
  it("shows how few addresses carried the vote, over the number that voted", async () => {
    stub(payload());
    await render();

    // 80.5% of the voting power cast, rounded for display.
    expect(container.textContent).toContain("top 2 = 81%");
    expect(container.textContent).toContain("of 118 voters");
  });

  it("says how the space was tied to this project", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("Verified by Snapshot");
    expect(container.textContent).toContain("voting strategy reading this token's contract");
  });

  it("carries the voting-power caveat and never concludes capture", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("not of tokens held");
    expect(container.textContent).not.toMatch(/captur|centrali/i);
  });

  it("marks a proposal that closed below its own quorum", async () => {
    stub(payload());
    await render();

    expect(container.textContent).toContain("closed below quorum");
  });

  it("publishes the reason and no figures when no space could be bound", async () => {
    stub(payload({
      available: false,
      space: null,
      proposals: [],
      claims: [],
      note: "A Snapshot space with a similar name exists, but nothing ties it to this project.",
    }));
    await render();

    expect(container.textContent).toContain("nothing ties it to this project");
    // An unbound space must never render a figure that reads as this project's.
    expect(container.querySelector("ol")).toBeNull();
    expect(container.textContent).not.toMatch(/top 2/);
  });

  it("says concentration is unmeasured when a bound space has no voting record", async () => {
    stub(payload({
      proposals: [],
      claims: [],
      note: "uniswapgovernance.eth has no closed proposals, so there is no voting record to measure.",
    }));
    await render();

    expect(container.textContent).toContain("no closed proposals");
    expect(container.textContent).not.toMatch(/top 2/);
  });
});
