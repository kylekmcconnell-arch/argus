// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => {
  type Listener = () => void;
  const listeners = new Set<Listener>();
  const state = {
    personRuns: [] as Array<Record<string, unknown>>,
    scanRuns: [] as Array<Record<string, unknown>>,
  };
  return {
    state,
    emit: () => { for (const listener of listeners) listener(); },
    subscribe: (cb: Listener) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
});

vi.mock("../lib/runner", () => ({
  activeRuns: () => harness.state.personRuns.filter((run) => run.status === "running"),
  getRun: (handle: string) => harness.state.personRuns.find((run) =>
    String(run.key) === handle.trim().toLowerCase().replace(/^@/, "")),
  subscribeRuns: harness.subscribe,
}));

vi.mock("../lib/scanrunner", () => ({
  activeScanRuns: () => harness.state.scanRuns.filter((run) => run.status === "running"),
  getScanRun: (kind: string, ref: string) => harness.state.scanRuns.find((run) => run.kind === kind && run.ref === ref),
  subscribeScanRuns: harness.subscribe,
}));

vi.mock("./AuditConsole", () => ({
  AuditConsole: ({ handle, working }: { handle: string; working: boolean }) => (
    <div data-testid="mock-console">{handle} · {working ? "working" : "settled"}</div>
  ),
}));

import { ScanTray } from "./ScanTray";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  harness.state.personRuns = [];
  harness.state.scanRuns = [];
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const investigationRun = (status: "running" | "done", steps: Array<{ label: string }> = []) => ({
  id: "inv-1",
  kind: "investigation",
  ref: "0xabc",
  input: "0xabc",
  label: "$EDGE deep dive",
  priv: false,
  steps,
  pct: status === "done" ? 100 : 33,
  status,
  hop: status === "running" ? "Reading the funding record" : undefined,
  startedAt: 1000,
});

describe("ScanTray", () => {
  it("renders nothing without background tasks", async () => {
    await act(async () => {
      root.render(<ScanTray parentLabel="Definitive" onOpen={() => {}} />);
    });
    expect(container.querySelector('[data-testid="scan-tray"]')).toBeNull();
  });

  it("shows a running task with its progress and never navigates on its own", async () => {
    await act(async () => {
      root.render(<ScanTray parentLabel="Definitive" onOpen={() => {}} />);
    });
    harness.state.scanRuns = [investigationRun("running")];
    await act(async () => { harness.emit(); });
    const tray = container.querySelector('[data-testid="scan-tray"]');
    expect(tray).not.toBeNull();
    expect(tray!.textContent).toContain("$EDGE deep dive");
    expect(tray!.textContent).toContain("Reading the funding record");
    expect(tray!.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("33");
  });

  it("flips a finished task green with an Open button that hands the ref back", async () => {
    const onOpen = vi.fn();
    await act(async () => {
      root.render(<ScanTray parentLabel="Definitive" onOpen={onOpen} />);
    });
    harness.state.scanRuns = [investigationRun("running")];
    await act(async () => { harness.emit(); });
    harness.state.scanRuns = [investigationRun("done")];
    await act(async () => { harness.emit(); });
    expect(container.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow")).toBe("100");
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent === "Open report")!;
    await act(async () => { open.click(); });
    expect(onOpen).toHaveBeenCalledWith("0xabc", "investigation");
  });

  it("expands a task to a full-window console under a sticky go-back bar and swaps back", async () => {
    await act(async () => {
      root.render(<ScanTray parentLabel="Definitive" onOpen={() => {}} />);
    });
    harness.state.scanRuns = [investigationRun("running", [{ label: "step one" }])];
    await act(async () => { harness.emit(); });
    const watch = [...container.querySelectorAll("button")].find((button) => button.textContent === "Watch")!;
    await act(async () => { watch.click(); });
    const overlay = container.querySelector('[data-testid="scan-tray-expanded"]');
    expect(overlay).not.toBeNull();
    expect(overlay!.textContent).toContain("Go back to the Definitive report");
    expect(overlay!.querySelector('[data-testid="mock-console"]')?.textContent).toContain("$EDGE deep dive · working");
    const back = [...overlay!.querySelectorAll("button")].find((button) => button.textContent?.includes("Go back"))!;
    await act(async () => { back.click(); });
    expect(container.querySelector('[data-testid="scan-tray-expanded"]')).toBeNull();
    expect(container.querySelector('[data-testid="scan-tray"]')).not.toBeNull();
  });

  it("keeps the currently open report's own ref out of the tray", async () => {
    await act(async () => {
      root.render(<ScanTray parentLabel="Definitive" excludeRef="@definitivefi" onOpen={() => {}} />);
    });
    harness.state.personRuns = [{
      handle: "@definitivefi", key: "definitivefi", steps: [], pct: 20, status: "running", startedAt: 5,
    }];
    await act(async () => { harness.emit(); });
    expect(container.querySelector('[data-testid="scan-tray"]')).toBeNull();
  });
});
