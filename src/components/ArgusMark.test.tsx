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
  });

  it("renders the hero eye as a neutral point field without a signal iris", () => {
    const svg = renderSvg(<HeroBackdrop className="test-backdrop" />);
    const dotField = svg.querySelector("g");

    expect(dotField?.getAttribute("fill")).toBe("var(--color-ink-faint)");
    expect(dotField?.querySelectorAll("circle").length).toBeGreaterThan(0);
    expect(svg.querySelector('circle[fill="var(--color-signal)"]')).toBeNull();
  });
});
