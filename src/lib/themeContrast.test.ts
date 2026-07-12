// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in CSS source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

function token(block: string, name: string): string {
  const match = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing --color-${name}`);
  return match[1];
}

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-fA-F]{2}/g)?.map((value) => Number.parseInt(value, 16) / 255);
  if (!channels || channels.length !== 3) throw new Error(`Invalid color ${hex}`);
  const [red, green, blue] = channels.map((value) => (
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const dark = css.slice(css.indexOf("@theme {"), css.indexOf(":root {"));
const lightStart = css.indexOf(':root[data-theme="light"]');
const light = css.slice(lightStart, css.indexOf("@layer base", lightStart));

describe("ARGUS theme contrast", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ])("keeps normal text tokens at WCAG AA in %s mode", (_theme, block) => {
    const panel = token(block, "panel");
    for (const name of ["ink", "ink-dim", "ink-faint", "signal-lift"]) {
      expect(contrast(token(block, name), panel), `${name} on panel`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ["dark", dark],
    ["light", light],
  ])("keeps button text and control boundaries accessible in %s mode", (_theme, block) => {
    const onSignal = block.includes("--color-on-signal")
      ? token(block, "on-signal")
      : token(dark, "on-signal");
    expect(contrast(onSignal, token(block, "signal"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(block, "control-line"), token(block, "panel"))).toBeGreaterThanOrEqual(3);
  });
});
