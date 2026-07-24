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

    expect(container.textContent).toContain("New connection warning");
    expect(container.textContent).toContain("Connections found after this report was saved suggest AVOID. Saved report v3 has not changed.");
    expect(container.textContent).toContain("This connection was found after saved report v3");
    expect(container.textContent).not.toContain("UPDATED RESULT");
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

    expect(container.textContent).toContain("Connections found after this report was saved suggest CAUTION. Saved report v7 has not changed.");
    expect(container.textContent).not.toContain("UPDATED RESULT");
  });

  it("preserves revised-verdict behavior outside snapshot mode", async () => {
    await renderAlert();

    expect(container.textContent).toContain("UPDATED RESULT: AVOID");
    expect(container.textContent).toContain("A serious connection changes the token-only result");
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

    expect(container.textContent).toContain("Connections found after this report was saved suggest CAUTION. Saved report v5 has not changed.");
  });
});
