// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OutcomeDeltaStrip, ProviderFailureNotice } from "./ScoreContext";

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
    expect(container.textContent).toContain("report status partial → complete");
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

describe("ProviderFailureNotice", () => {
  it("alarms on rejected checks and names the providers plainly", () => {
    act(() => {
      root.render(<ProviderFailureNotice failures={[
        { provider: "claude", op: "record_verdict", failed: 2, meta: "http_400 credit balance too low" },
        { provider: "claude", op: "basic-facts-search", failed: 3 },
      ]} />);
    });
    expect(container.textContent).toContain("2 source checks were rejected and need attention (claude).");
    expect(container.textContent).not.toContain("no fallback provider");
    expect(container.textContent).toContain("claude · record_verdict · http_400 credit balance too low");
    expect(container.textContent).toContain("This may leave part of the report unanswered");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("keeps no-record answers and outages in proportion instead of alarming", () => {
    act(() => {
      root.render(<ProviderFailureNotice failures={[
        { provider: "github", op: "users/orbitgroup_ai", failed: 1, meta: "subscription/keyed · no_record_404" },
        { provider: "peopledatalabs", op: "person-enrich:monid", failed: 3, meta: "monid_no record found (no_record_404)" },
        { provider: "monid", op: "company/search", failed: 1, meta: "search · Monid request failed (http_502)." },
      ]} />);
    });
    expect(container.textContent).toContain("1 source was temporarily unavailable (monid).");
    expect(container.textContent).toContain("2 sources have no record of this subject (github, peopledatalabs).");
    expect(container.textContent).not.toContain("rejected");
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="note"]')).not.toBeNull();
  });

  it("treats a no-record-only notice as an answer, not a gap", () => {
    act(() => {
      root.render(<ProviderFailureNotice failures={[
        { provider: "github", op: "users/someone", failed: 1, meta: "subscription/keyed · no_record_404" },
      ]} />);
    });
    expect(container.textContent).toContain("1 source has no record of this subject (github).");
    expect(container.textContent).toContain("an answered check, not a gap");
    expect(container.textContent).not.toContain("Run a new scan later");
  });

  it("renders nothing on a clean run", () => {
    act(() => {
      root.render(<ProviderFailureNotice failures={[]} />);
    });
    expect(container.textContent).toBe("");
  });
});
