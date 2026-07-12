// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceStep } from "../data/evidence";
import { InvestigationProgressCanvas } from "./InvestigationProgressCanvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderCanvas(props: {
  kind: "person" | "token" | "investigation" | "resolution";
  steps: TraceStep[];
  working: boolean;
  hop?: string;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(<InvestigationProgressCanvas {...props} />));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("InvestigationProgressCanvas", () => {
  it("renders only truthful metrics and source tags from observed steps", async () => {
    await renderCanvas({
      kind: "person",
      working: true,
      steps: [
        { phase: "P0 · Intake", label: "Resolve profile", detail: "Profile returned.", source: "twitterapi.io", tone: "good" },
        { phase: "Adverse", label: "Candidate lead", detail: "Needs review.", source: "grok", tone: "warn" },
      ],
    });

    expect(container?.textContent).toContain("2");
    expect(container?.textContent).toContain("twitterapi.io");
    expect(container?.textContent).toContain("grok");
    expect(container?.textContent).toContain("Candidate lead");
    expect(container?.textContent).not.toContain("GitHub");
    expect(container?.querySelectorAll("[aria-label='Observed evidence sources'] .chip")).toHaveLength(2);

    const activeStage = [...(container?.querySelectorAll("ol li") ?? [])]
      .find((element) => element.textContent?.includes("Evidence collection"));
    expect(activeStage?.textContent).toContain("active");
  });

  it("keeps an empty resolution truthful and provider-neutral", async () => {
    await renderCanvas({ kind: "resolution", steps: [], working: true });

    expect(container?.textContent).toContain("Resolving the exact subject");
    expect(container?.textContent).toContain("evidence acquisition has not started");
    expect(container?.textContent).toContain("No source-tagged evidence observed yet");
    expect(container?.textContent).not.toMatch(/DexScreener|GoPlus|Claude|Grok|GitHub/);
  });

  it("uses CSS gaze motion instead of SVG SMIL for the live eye", async () => {
    await renderCanvas({ kind: "token", steps: [], working: true });

    expect(container?.querySelector("animate")).toBeNull();
    const eye = container?.querySelector<SVGSVGElement>("[data-argus-eye-state='searching']");
    const iris = eye?.querySelector(".argus-eye-iris--searching");
    const liveRing = eye?.querySelector(".argus-eye-live-ring");
    expect(eye).not.toBeNull();
    expect(iris).not.toBeNull();
    expect(liveRing).not.toBeNull();
    expect(eye?.querySelector(".argus-eye-evidence-pulse")).toBeNull();
  });

  it("focuses for analysis, settles for finalization, and pulses on real evidence", async () => {
    await renderCanvas({
      kind: "person",
      working: true,
      steps: [{ phase: "P6 · Analyst", label: "Score axes", detail: "Scoring evidence.", tone: "neutral" }],
    });

    expect(container?.querySelector("[data-argus-eye-state='focused']")).not.toBeNull();
    expect(container?.querySelector(".argus-eye-evidence-pulse")).not.toBeNull();

    await act(async () => root?.render(
      <InvestigationProgressCanvas
        kind="person"
        working
        steps={[
          { phase: "P6 · Analyst", label: "Score axes", detail: "Scoring evidence.", tone: "neutral" },
          { phase: "P7 · Finalize", label: "Seal report", detail: "Freezing the report.", tone: "neutral" },
        ]}
      />,
    ));

    expect(container?.querySelector("[data-argus-eye-state='settling']")).not.toBeNull();

    await act(async () => root?.render(
      <InvestigationProgressCanvas
        kind="person"
        working={false}
        steps={[{ phase: "P7 · Finalize", label: "Report sealed", detail: "Done.", tone: "neutral" }]}
      />,
    ));

    expect(container?.querySelector("[data-argus-eye-state='idle']")).not.toBeNull();
    expect(container?.querySelector(".argus-eye-live-ring")).toBeNull();
  });
});
