// @vitest-environment jsdom

import { act, StrictMode, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ConsoleProps = {
  handle: string;
  subtitle: string;
  steps: unknown[];
  working: boolean;
  mode: "live" | "curated";
  kind?: "person" | "token" | "investigation";
  hop?: string;
  pct?: number;
};

const harness = vi.hoisted(() => ({
  personRun: null as null | Record<string, unknown>,
  scanRuns: {
    token: null as null | Record<string, unknown>,
    investigation: null as null | Record<string, unknown>,
  },
  runListener: null as null | (() => void),
  scanListener: null as null | (() => void),
  consoleProps: [] as ConsoleProps[],
}));

vi.mock("./AuditConsole", () => ({
  AuditConsole: (props: ConsoleProps) => {
    harness.consoleProps.push(props);
    return (
      <div
        data-kind={props.kind}
        data-working={String(props.working)}
        data-hop={props.hop}
      >
        {props.subtitle}
      </div>
    );
  },
}));

vi.mock("../lib/runner", () => ({
  getRun: () => harness.personRun,
  subscribeRuns: (listener: () => void) => {
    harness.runListener = listener;
    return () => {
      if (harness.runListener === listener) harness.runListener = null;
    };
  },
}));

vi.mock("../lib/scanrunner", () => ({
  getScanRun: (kind: "token" | "investigation") => harness.scanRuns[kind],
  subscribeScanRuns: (listener: () => void) => {
    harness.scanListener = listener;
    return () => {
      if (harness.scanListener === listener) harness.scanListener = null;
    };
  },
}));

import { InvestigationRun } from "./InvestigationRun";
import { LiveRun } from "./LiveRun";
import { TokenRun } from "./TokenRun";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const input = { kind: "token" as const, ref: ADDRESS, via: "evm" as const };

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function render(element: ReactElement): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<StrictMode>{element}</StrictMode>);
  });
}

function latestConsole(kind: ConsoleProps["kind"]): ConsoleProps {
  const props = harness.consoleProps.findLast((entry) => entry.kind === kind);
  if (!props) throw new Error(`No ${kind ?? "unknown"} console render was captured`);
  return props;
}

beforeEach(() => {
  harness.personRun = null;
  harness.scanRuns.token = null;
  harness.scanRuns.investigation = null;
  harness.runListener = null;
  harness.scanListener = null;
  harness.consoleProps.length = 0;
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("run view console state", () => {
  it("portrays an initial person-run attachment as active without numeric progress", async () => {
    await render(<LiveRun handle="alice" onDone={vi.fn()} onError={vi.fn()} />);

    const props = latestConsole("person");
    expect(props).toMatchObject({
      handle: "@alice",
      subtitle: "Live evidence acquisition · observed sources appear as they respond · continues in background",
      working: true,
      mode: "live",
      kind: "person",
    });
    expect(props).not.toHaveProperty("pct");
  });

  it("fires person completion once and never portrays the terminal run as working", async () => {
    const dossier = { handle: "@alice", report: { audit_id: "person-run" } };
    harness.personRun = {
      handle: "@alice",
      key: "alice",
      steps: [],
      pct: 100,
      status: "done",
      dossier,
      startedAt: 10,
      priv: false,
    };
    const onDone = vi.fn();
    const onError = vi.fn();

    await render(<LiveRun handle="alice" onDone={onDone} onError={onError} />);

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(dossier);
    expect(onError).not.toHaveBeenCalled();
    expect(latestConsole("person").working).toBe(false);
  });

  it("fires a token error once and leaves the terminal console idle", async () => {
    harness.scanRuns.token = {
      id: "token-run-1",
      kind: "token",
      ref: ADDRESS,
      input: ADDRESS,
      label: "TOKEN",
      priv: false,
      steps: [],
      pct: 71,
      status: "error",
      error: "provider timeout",
      startedAt: 20,
    };
    const onDone = vi.fn();
    const onError = vi.fn();

    await render(<TokenRun input={input} onDone={onDone} onError={onError} />);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(latestConsole("token")).toMatchObject({
      subtitle: "Live market and contract evidence · observed sources appear as they respond · continues in background",
      working: false,
      kind: "token",
    });
    expect(latestConsole("token")).not.toHaveProperty("pct");
  });

  it("passes the observed investigation hop and fires completion once", async () => {
    const investigation = { token: { address: ADDRESS, symbol: "ARG" } };
    harness.scanRuns.investigation = {
      id: "investigation-run-1",
      kind: "investigation",
      ref: ADDRESS,
      input: ADDRESS,
      label: "ARG",
      priv: true,
      steps: [],
      pct: 56,
      status: "running",
      hop: "Tracing project identity",
      startedAt: 30,
    };
    const onDone = vi.fn();
    const onError = vi.fn();

    await render(<InvestigationRun input={input} onDone={onDone} onError={onError} />);

    expect(latestConsole("investigation")).toMatchObject({
      subtitle: "Live multi-surface evidence · observed sources appear as they respond · continues in background",
      working: true,
      kind: "investigation",
      hop: "Tracing project identity",
    });
    expect(latestConsole("investigation")).not.toHaveProperty("pct");

    await act(async () => {
      Object.assign(harness.scanRuns.investigation!, {
        status: "done",
        pct: 100,
        result: investigation,
      });
      harness.scanListener?.();
    });
    await act(async () => harness.scanListener?.());

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith(investigation, true, "investigation-run-1");
    expect(onError).not.toHaveBeenCalled();
    expect(latestConsole("investigation").working).toBe(false);
  });
});
