// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutcomeDeltaStrip } from "./ScoreContext";

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
});

const prior = (overrides: Partial<Parameters<typeof OutcomeDeltaStrip>[0]["prior"]> = {}) => ({
  version: 4,
  score: 74,
  verdict: "CAUTION",
  completeness: "partial",
  capturedAt: "2026-07-18T12:00:00.000Z",
  delta: "Since last scan (v4, 2026-07-18): score 74 -> 90 (+16)",
  ...overrides,
});

describe("OutcomeDeltaStrip", () => {
  it("shows a rising score, verdict change, and coverage change as chips", () => {
    act(() => {
      root.render(<OutcomeDeltaStrip prior={prior()} score={90} verdict="PASS" coverage="complete" />);
    });
    expect(container.textContent).toContain("since v4");
    expect(container.textContent).toContain("score 74 → 90 (+16)");
    expect(container.textContent).toContain("verdict CAUTION → PASS");
    expect(container.textContent).toContain("coverage partial → complete");
    expect(container.querySelector(".tint-pass")).not.toBeNull();
  });

  it("marks a falling score as caution and hides unchanged verdict and coverage", () => {
    act(() => {
      root.render(<OutcomeDeltaStrip prior={prior({ score: 80, verdict: "PASS", completeness: "complete" })} score={75} verdict="PASS" coverage="complete" />);
    });
    expect(container.textContent).toContain("score 80 → 75 (-5)");
    expect(container.textContent).not.toContain("verdict");
    expect(container.textContent).not.toContain("coverage");
    expect(container.querySelector(".tint-caution")).not.toBeNull();
  });

  it("states a steady score plainly", () => {
    act(() => {
      root.render(<OutcomeDeltaStrip prior={prior({ score: 75, verdict: "PASS", completeness: "complete" })} score={75} verdict="PASS" coverage="complete" />);
    });
    expect(container.textContent).toContain("score steady at 75");
  });

  it("renders nothing when there is no comparable outcome", () => {
    act(() => {
      root.render(<OutcomeDeltaStrip prior={prior({ score: null, verdict: null, completeness: null })} score={75} verdict="PASS" coverage="complete" />);
    });
    expect(container.textContent).toBe("");
  });
});
