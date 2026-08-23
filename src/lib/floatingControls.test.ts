// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in CSS source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("floating control stylesheet contract", () => {
  it("separates the launchers and yields feedback while ARGUS Eye is open", () => {
    const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

    expect(css).toContain(".feedback-launcher {");
    expect(css).toContain("bottom: calc(env(safe-area-inset-bottom, 0px) + 5rem);");
    expect(css).toContain(':root:has(.argus-eye-assistant [aria-expanded="true"]) .feedback-launcher');
    expect(css).toContain("visibility: hidden;");
  });
});
