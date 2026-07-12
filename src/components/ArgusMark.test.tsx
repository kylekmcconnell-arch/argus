// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ArgusMark, HeroBackdrop } from "./ArgusMark";

function renderSvg(element: React.ReactNode): SVGSVGElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(element);
  const svg = host.querySelector<SVGSVGElement>("svg");
  if (!svg) throw new Error("Expected an SVG to render");
  return svg;
}

describe("ARGUS eye marks", () => {
  it("keeps the compact mark neutral except for its signal iris and highlight", () => {
    const svg = renderSvg(<ArgusMark size={32} />);
    const dotField = svg.querySelector("g");

    expect(dotField?.getAttribute("fill")).toBe("var(--color-ink-faint)");
    expect(dotField?.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('circle[fill="var(--color-signal)"]')).toHaveLength(1);
    expect(svg.querySelectorAll('circle[fill="var(--color-on-signal)"]')).toHaveLength(1);
    expect(svg.querySelector('circle[fill="var(--color-void)"]')).toBeNull();
    expect(svg.getAttribute("data-argus-eye-state")).toBe("idle");
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
    expect(svg.querySelector(".argus-eye-live-ring")).toBeNull();
    expect(svg.querySelector(".argus-eye-evidence-pulse")).toBeNull();
  });

  it("moves the complete live iris as one searching eye and pulses on evidence", () => {
    const svg = renderSvg(
      <ArgusMark size={88} live motion="searching" eventKey="2:Evidence:Profile returned" />,
    );
    const iris = svg.querySelector(".argus-eye-iris");

    expect(svg.getAttribute("data-argus-eye-state")).toBe("searching");
    expect(iris?.getAttribute("class")).toContain("argus-eye-iris--searching");
    expect(iris?.querySelector(".argus-eye-live-ring")).not.toBeNull();
    expect(iris?.querySelector(".argus-eye-evidence-pulse")).not.toBeNull();
    expect(iris?.querySelector('circle[fill="var(--color-eye-pupil)"]')).not.toBeNull();
    expect(svg.querySelector("animate")).toBeNull();
  });

  it("keeps a non-live mark centered even when a motion mode is supplied", () => {
    const svg = renderSvg(<ArgusMark size={32} motion="focused" eventKey="ignored" />);

    expect(svg.getAttribute("data-argus-eye-state")).toBe("idle");
    expect(svg.querySelector(".argus-eye-iris")?.getAttribute("class")).toContain("argus-eye-iris--idle");
    expect(svg.querySelector(".argus-eye-live-ring")).toBeNull();
    expect(svg.querySelector(".argus-eye-evidence-pulse")).toBeNull();
  });

  it("renders the hero eye as a neutral point field without a signal iris", () => {
    const svg = renderSvg(<HeroBackdrop className="test-backdrop" />);
    const dotField = svg.querySelector("g");

    expect(dotField?.getAttribute("fill")).toBe("var(--color-ink-faint)");
    expect(dotField?.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(svg.querySelector('circle[fill="var(--color-signal)"]')).toBeNull();
  });
});
