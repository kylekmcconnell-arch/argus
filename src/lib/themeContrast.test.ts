// Vitest runs this file in Node; the application tsconfig intentionally omits Node globals.
// @ts-expect-error -- test-only access to the checked-in CSS source.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const themeSource = readFileSync(new URL("./theme.ts", import.meta.url), "utf8");
const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

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
const lightStart = css.indexOf('\n:root[data-theme="light"] {') + 1;
const light = css.slice(lightStart, css.indexOf("@layer base", lightStart));

const DARK_SURFACES = ["void", "panel", "panel-2", "sidebar"] as const;
const LIGHT_SURFACES = ["void", "panel", "panel-2", "sidebar"] as const;
const TEXT_TOKENS = ["ink", "ink-dim", "ink-faint", "signal-lift"] as const;
const SEMANTIC_TOKENS = ["pass", "caution", "fail", "avoid", "unverifiable"] as const;

const LIGHT_PALETTE = {
  void: "#f7f7f5",
  panel: "#ffffff",
  "panel-2": "#f2f2f0",
  sidebar: "#ffffff",
  line: "#e7e7e4",
  "line-2": "#d3d3d0",
  "control-line": "#8a8a8f",
  ink: "#111111",
  "ink-dim": "#6e6e73",
  "ink-faint": "#6d6d73",
  signal: "#111111",
  "signal-dim": "#2c2c2e",
  "signal-lift": "#111111",
  "accent-tint": "#ececea",
  pass: "#00a86b",
  caution: "#b87300",
  fail: "#d63f3f",
  avoid: "#d63f3f",
  unverifiable: "#6f5bd3",
} as const;

const SEMANTIC_PALETTES = {
  dark: {
    pass: "#00c805",
    caution: "#d68a00",
    fail: "#eb5151",
    avoid: "#eb5151",
    unverifiable: "#8b7cf6",
  },
  light: {
    pass: "#00a86b",
    caution: "#b87300",
    fail: "#d63f3f",
    avoid: "#d63f3f",
    unverifiable: "#6f5bd3",
  },
} as const;

describe("ARGUS theme contrast", () => {
  it("keeps every dark text token at WCAG AA across every base surface", () => {
    for (const foregroundName of TEXT_TOKENS) {
      for (const backgroundName of DARK_SURFACES) {
        expect(
          contrast(token(dark, foregroundName), token(dark, backgroundName)),
          `${foregroundName} on ${backgroundName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps every dark verdict color at WCAG AA across every base surface", () => {
    for (const foregroundName of SEMANTIC_TOKENS) {
      for (const backgroundName of DARK_SURFACES) {
        expect(
          contrast(token(dark, foregroundName), token(dark, backgroundName)),
          `${foregroundName} on ${backgroundName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the dark signal and control boundary visible across every base surface", () => {
    for (const backgroundName of DARK_SURFACES) {
      const background = token(dark, backgroundName);
      expect(
        contrast(token(dark, "signal"), background),
        `signal on ${backgroundName}`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrast(token(dark, "control-line"), background),
        `control-line on ${backgroundName}`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps every light text token at WCAG AA across every base surface", () => {
    for (const foregroundName of TEXT_TOKENS) {
      for (const backgroundName of LIGHT_SURFACES) {
        expect(
          contrast(token(light, foregroundName), token(light, backgroundName)),
          `${foregroundName} on light ${backgroundName}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each([
    ["dark", dark],
    ["light", light],
  ])("keeps button text and panel control boundaries accessible in %s mode", (_theme, block) => {
    const onSignal = block.includes("--color-on-signal") ? token(block, "on-signal") : token(dark, "on-signal");
    expect(contrast(onSignal, token(block, "signal"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token(block, "control-line"), token(block, "panel"))).toBeGreaterThanOrEqual(3);
  });

  it("locks the complete light color palette", () => {
    for (const [name, expected] of Object.entries(LIGHT_PALETTE)) {
      expect(token(light, name), name).toBe(expected);
    }
  });

  it.each([
    ["dark", dark, SEMANTIC_PALETTES.dark],
    ["light", light, SEMANTIC_PALETTES.light],
  ] as const)("locks the %s semantic verdict palette", (_theme, block, expected) => {
    for (const [name, value] of Object.entries(expected)) {
      expect(token(block, name), name).toBe(value);
    }
  });

  it("keeps CSS, runtime theme colors, and the pre-paint browser chrome synchronized", () => {
    const runtimeDark = themeSource.match(/dark:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
    const runtimeLight = themeSource.match(/light:\s*"(#[0-9a-fA-F]{6})"/)?.[1];
    const initialChrome = html.match(/<meta name="theme-color" content="(#[0-9a-fA-F]{6})"/)?.[1];
    const prePaintChrome = html.match(/theme === "light" \? "(#[0-9a-fA-F]{6})" : "(#[0-9a-fA-F]{6})"/)?.slice(1);

    expect(runtimeDark).toBe(token(dark, "void"));
    expect(runtimeLight).toBe(token(light, "void"));
    expect(initialChrome).toBe(runtimeLight);
    expect(prePaintChrome).toEqual([runtimeLight, runtimeDark]);
  });
});
