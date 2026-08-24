// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportExperienceLayout, type ReportCanvasNavItem } from "./ReportCanvasPrimitives";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const items: ReportCanvasNavItem[] = [
  { href: "#report-summary", label: "Summary" },
  { href: "#report-risks", label: "Risks", count: 2 },
  { href: "#report-method", label: "Method" },
];

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

describe("ReportExperienceLayout", () => {
  it("renders one shared shell with a desktop guide and mobile section navigation", () => {
    act(() => {
      root.render(
        <ReportExperienceLayout
          items={items}
          status={{ label: "Checks open", detail: "Two required checks remain.", meta: "8/10 finished", tone: "caution" }}
          nextStep="Confirm who controls the treasury"
        >
          <section id="report-summary">Summary body</section>
          <section id="report-risks">Risk body</section>
          <section id="report-method">Method body</section>
        </ReportExperienceLayout>,
      );
    });

    expect(container.querySelector('[data-report-experience-shell="true"]')).not.toBeNull();
    expect(container.querySelectorAll('nav[aria-label="Report guide"]')).toHaveLength(2);
    expect(container.textContent).toContain("Follow the investigation from the decision to its evidence.");
    expect(container.textContent).toContain("Checks open");
    expect(container.textContent).toContain("Confirm who controls the treasury");
    expect(container.querySelector('a[href="#report-summary"]')?.getAttribute("aria-current")).toBe("location");
  });

  it("keeps evidence out of the orientation rail", () => {
    act(() => {
      root.render(
        <ReportExperienceLayout
          items={items}
          status={{ label: "Ready", detail: "Required checks finished.", tone: "pass" }}
        >
          <section id="report-summary">Exact evidence receipt: source passage 123</section>
        </ReportExperienceLayout>,
      );
    });

    const aside = container.querySelector("aside");
    expect(aside?.textContent).not.toContain("source passage 123");
    expect(container.textContent).toContain("source passage 123");
  });
});
