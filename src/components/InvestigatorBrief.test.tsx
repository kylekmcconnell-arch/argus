// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NoticedRail, VerdictArgumentBlock } from "./InvestigatorBrief";
import type { NoticedSignal } from "../lib/reportInsights";

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

const signal = (overrides: Partial<NoticedSignal>): NoticedSignal => ({
  id: "lp-unlocked",
  severity: "alert",
  headline: "None of the trading liquidity is locked",
  detail: "0% of DEX liquidity is locked or burned, so the trading pool can be removed at any time.",
  anchor: "#investigation-visuals",
  ...overrides,
});

describe("NoticedRail", () => {
  it("renders at most three signals with their anchors", async () => {
    await act(async () => root.render(<NoticedRail signals={[
      signal({}),
      signal({ id: "holder-concentration", headline: "One wallet holds 30% of the supply", detail: "A single holder can move the price on its own." }),
      signal({ id: "supply-overhang", severity: "watch", headline: "Only 41% of the supply is circulating", detail: "Most of the supply has not been released yet." }),
      signal({ id: "deep-drawdown", severity: "note", headline: "Trading 94% below its lifetime high", detail: "Recovery to prior highs is rare." }),
    ]} />));

    expect(container.textContent).toContain("Argus noticed");
    expect(container.textContent).toContain("None of the trading liquidity is locked");
    expect(container.textContent).toContain("One wallet holds 30% of the supply");
    expect(container.textContent).toContain("Only 41% of the supply is circulating");
    expect(container.textContent).not.toContain("lifetime high");
    expect(container.querySelector('a[href="#investigation-visuals"]')).not.toBeNull();
  });

  it("renders nothing when no rule fired", async () => {
    await act(async () => root.render(<NoticedRail signals={[]} />));
    expect(container.textContent).toBe("");
  });
});

describe("VerdictArgumentBlock", () => {
  it("renders only the lines the argument actually has", async () => {
    await act(async () => root.render(<VerdictArgumentBlock argument={{
      forLine: null,
      againstLine: "The score is capped: honeypot confirmed.",
      moveLine: "No checks remain open; a rescan would test whether this result still holds.",
    }} />));

    expect(container.textContent).not.toContain("Strongest evidence");
    expect(container.textContent).toContain("Sharpest concern");
    expect(container.textContent).toContain("honeypot confirmed");
    expect(container.textContent).toContain("What would change it");
  });
});
