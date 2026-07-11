// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AxisEvidenceRecord } from "../data/evidence";
import type { RoleReport } from "../engine";
import { DecisionBasis } from "./DecisionBasis";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hashFor = (value: string): string => Array.from(value)
  .map((character) => character.charCodeAt(0).toString(16).padStart(2, "0"))
  .join("")
  .padEnd(64, "0")
  .slice(0, 64);

const artifactIdFor = (value: string): string => `art_v1_${hashFor(value)}`;

const evidence = (
  artifactId: string,
  axis: string,
  overrides: Partial<AxisEvidenceRecord> = {},
): AxisEvidenceRecord => ({
  artifactId: artifactIdFor(artifactId),
  kind: "axis_evidence",
  provider: "github",
  operation: "profile-resolution",
  section: "code-footprint",
  title: `Frozen ${artifactId}`,
  excerpt: "Exact frozen evidence used by the scorer.",
  sourceUrl: `https://example.com/evidence/${artifactId}?version=1`,
  capturedAt: "2026-07-11T15:00:00.000Z",
  contentHash: hashFor(artifactId),
  eligibleAxes: [axis],
  verification: "verified",
  scope: "direct_subject",
  ...overrides,
});

const roleReport = (supportId = artifactIdFor("support-artifact"), counterId = artifactIdFor("counter-artifact")): RoleReport => ({
  role: "FOUNDER",
  verdict: "CAUTION",
  raw_total: 61,
  score_total: 61,
  cap_applied: null,
  dox_bonus: 0,
  axes: {
    F2_track_record: {
      score: 18,
      weight: 28,
      role: "FOUNDER",
      rationale: "Stored analyst synthesis.",
      evidenceRefs: [supportId],
      counterEvidenceRefs: [counterId],
      gaps: [],
    },
    F4_build_substance: {
      score: 5,
      weight: 15,
      role: "FOUNDER",
      rationale: "Repository ownership is unresolved.",
      evidenceRefs: [],
      counterEvidenceRefs: [],
      gaps: ["Repository ownership was not resolved."],
    },
  },
});

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  window.history.replaceState(null, "", window.location.pathname);
});

describe("DecisionBasis", () => {
  it("renders a truthful legacy fallback and an optional rescan action", () => {
    const onRescan = vi.fn();
    act(() => {
      root.render(<DecisionBasis roleReport={roleReport()} catalog={[]} onRescan={onRescan} />);
    });

    expect(container.textContent).toContain("Lineage unavailable");
    expect(container.textContent).toContain("will not infer them from analyst prose");
    const rescan = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Rescan to capture lineage");
    expect(rescan).toBeDefined();
    expect(rescan?.className).toContain("min-h-11");
    act(() => rescan?.click());
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("renders all axes, accessible tab state, and exact safe source links", () => {
    const support = evidence("support-artifact", "F2_track_record");
    const counter = evidence("counter-artifact", "F2_track_record", {
      provider: "courtlistener",
      operation: "case-search",
      verification: "reported",
      sourceUrl: "https://example.com/counter/case?id=42",
    });
    act(() => {
      root.render(<DecisionBasis roleReport={roleReport()} catalog={[support, counter]} lineageVersion={1} />);
    });

    expect(container.textContent).toContain("Decision basis");
    expect(container.textContent).toContain("Founder");
    expect(container.textContent).toContain("0/2 axes grounded · 1 mixed · 1 gap");

    const axisButtons = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    expect(axisButtons).toHaveLength(2);
    expect(axisButtons.map((button) => button.id)).toEqual([
      "decision-basis-F2_track_record",
      "decision-basis-F4_build_substance",
    ]);
    expect(axisButtons.every((button) => button.tagName === "BUTTON" && button.className.includes("min-h-11"))).toBe(true);
    expect(axisButtons.map((button) => button.tabIndex)).toEqual([-1, 0]);
    expect(axisButtons.filter((button) => button.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(axisButtons[0].getAttribute("aria-controls")).toBe(axisButtons[1].getAttribute("aria-controls"));

    axisButtons[0].focus();
    expect(document.activeElement).toBe(axisButtons[0]);
    act(() => axisButtons[0].click());
    expect(axisButtons[0].getAttribute("aria-selected")).toBe("true");
    expect(axisButtons[1].getAttribute("aria-selected")).toBe("false");

    const detailId = axisButtons[0].getAttribute("aria-controls");
    expect(detailId).toBeTruthy();
    expect(document.getElementById(detailId!)?.getAttribute("role")).toBe("tabpanel");
    expect(container.textContent).toContain("Frozen support-artifact");
    expect(container.textContent).toContain(`Artifact ${artifactIdFor("support-artifact").slice(0, 12)}…`);
    expect(container.textContent).toContain(`SHA-256 ${hashFor("support-artifact").slice(0, 12)}…`);
    expect(container.querySelector('a[href="https://example.com/evidence/support-artifact?version=1"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://example.com/counter/case?id=42"]')).not.toBeNull();
  });

  it("selects the linked axis and supports keyboard tab navigation", async () => {
    window.history.replaceState(null, "", "#decision-basis-F2_track_record");
    act(() => {
      root.render(<DecisionBasis roleReport={roleReport()} catalog={[]} lineageVersion={1} />);
    });
    await act(async () => Promise.resolve());

    const axisTabs = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')];
    expect(axisTabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain("Track record");

    axisTabs[0].focus();
    act(() => axisTabs[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    await act(async () => Promise.resolve());
    expect(axisTabs[1].getAttribute("aria-selected")).toBe("true");
    expect(window.location.hash).toBe("#decision-basis-F4_build_substance");
  });

  it("does not render unsafe credential-bearing source URLs", () => {
    const support = evidence("support-artifact", "F2_track_record", {
      sourceUrl: "https://user:secret@example.com/private",
    });
    const report = roleReport(support.artifactId, artifactIdFor("missing-counter"));
    report.axes.F4_build_substance.gaps = [];
    act(() => {
      root.render(<DecisionBasis roleReport={report} catalog={[support]} lineageVersion={1} />);
    });

    const trackRecord = [...container.querySelectorAll<HTMLButtonElement>('button[aria-controls]')]
      .find((button) => button.textContent?.includes("Track record"));
    act(() => trackRecord?.click());
    expect(container.textContent).toContain("Frozen support-artifact");
    expect(container.querySelector('a[href*="user:secret"]')).toBeNull();
  });
});
