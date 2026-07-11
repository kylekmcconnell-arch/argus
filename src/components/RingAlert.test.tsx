// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  connections: [] as Array<Record<string, unknown>>,
  reconciliation: null as Record<string, unknown> | null,
  subscriber: null as (() => void) | null,
  unsubscribe: vi.fn(),
}));

vi.mock("../graph/store", () => ({
  getContributions: () => [],
  subscribeGraph: (callback: () => void) => {
    harness.subscriber = callback;
    return harness.unsubscribe;
  },
}));

vi.mock("../graph/network", () => ({
  subjectConnections: () => harness.connections,
  reconcileVerdict: () => harness.reconciliation,
}));

import { RingAlert } from "./RingAlert";

const connection = {
  other: "$KNOWN-RUG",
  otherVerdict: "FAIL",
  direct: true,
  ties: [{ key: "wallet:deployer", label: "shared deployer", type: "Identity" }],
};

let container: HTMLDivElement;
let root: Root;

async function renderAlert(snapshotVersion?: number): Promise<void> {
  await act(async () => {
    root.render(<RingAlert handle="$SUBJECT" snapshotVersion={snapshotVersion} />);
  });
}

beforeEach(() => {
  harness.connections = [connection];
  harness.reconciliation = {
    severity: "avoid",
    line: "Hard AVOID regardless of the stored verdict.",
    via: [connection],
  };
  harness.unsubscribe.mockClear();
  harness.subscriber = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("RingAlert snapshot semantics", () => {
  it("presents an AVOID signal as a current overlay without revising the snapshot", async () => {
    await renderAlert(3);

    expect(container.textContent).toContain("Current workspace network overlay");
    expect(container.textContent).toContain("Current overlay suggests AVOID while stored v3 verdict remains unchanged.");
    expect(container.textContent).toContain("was not captured in snapshot v3");
    expect(container.textContent).not.toContain("REVISED");
    expect(container.textContent).not.toContain("overrides the contract score");
    expect(container.textContent).not.toContain("Hard AVOID regardless");
  });

  it("uses CAUTION for a caution reconciliation while preserving the stored verdict", async () => {
    harness.reconciliation = {
      severity: "caution",
      line: "The overlap warrants caution.",
      via: [connection],
    };

    await renderAlert(7);

    expect(container.textContent).toContain("Current overlay suggests CAUTION while stored v7 verdict remains unchanged.");
    expect(container.textContent).not.toContain("REVISED");
  });

  it("preserves revised-verdict behavior outside snapshot mode", async () => {
    await renderAlert();

    expect(container.textContent).toContain("REVISED: AVOID");
    expect(container.textContent).toContain("network reconciliation overrides the contract score");
    expect(container.textContent).toContain("Hard AVOID regardless of the stored verdict.");
  });

  it("refreshes the overlay when the shared graph hydrates", async () => {
    harness.connections = [];
    harness.reconciliation = null;
    await renderAlert(5);
    expect(container.textContent).toBe("");

    harness.connections = [connection];
    harness.reconciliation = {
      severity: "caution",
      line: "The overlap warrants caution.",
      via: [connection],
    };
    await act(async () => harness.subscriber?.());

    expect(container.textContent).toContain("Current overlay suggests CAUTION while stored v5 verdict remains unchanged.");
  });
});
