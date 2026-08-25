// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in CSS source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("canonical report score layout", () => {
  it("centers the score against the complete decision brief on wide screens", () => {
    expect(css).toMatch(/\.decision-brief-heading\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\)/s);
    expect(css).toMatch(/\.decision-score-lockup\s*\{[^}]*grid-column:\s*2/s);
    expect(css).not.toMatch(/\.decision-score-lockup\s*\{[^}]*border-left:/s);
  });

  it("stacks and centers the score before the layout can overlap", () => {
    expect(css).toMatch(/@media \(max-width: 1023px\)[\s\S]*?\.decision-score-lockup\s*\{[^}]*grid-column:\s*1[^}]*width:\s*100%/s);
  });
});
