// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TraceStep } from "../data/evidence";
import { AuditConsole } from "./AuditConsole";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo");

function matchMedia(matches: boolean): MediaQueryList {
  return {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
}

async function renderConsole({
  steps,
  kind = "person",
  working = true,
}: {
  steps: TraceStep[];
  kind?: "person" | "token" | "investigation" | "resolution";
  working?: boolean;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(
    <AuditConsole
      handle="@subject"
      subtitle="Observed evidence appears below"
      steps={steps}
      working={working}
      mode="live"
      kind={kind}
    />,
  ));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  vi.unstubAllGlobals();
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
});

describe("AuditConsole", () => {
  it("exposes busy state and announces only the latest real event politely", async () => {
    const steps: TraceStep[] = [
      { phase: "P0 · Intake", label: "Resolve profile", detail: "Profile returned.", tone: "neutral" },
      { phase: "Analyst", label: "Score axes", detail: "Scoring collected evidence.", source: "claude", tone: "neutral" },
    ];
    await renderConsole({ steps });

    const status = container?.querySelector("[role='status']");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    const announcement = container?.querySelector("[aria-live='polite']");
    expect(announcement?.textContent).toBe("Analyst: Score axes. Scoring collected evidence.");
    expect(announcement?.textContent).not.toContain("Resolve profile");
    expect(status?.contains(announcement ?? null)).toBe(false);
    expect(container?.textContent).not.toMatch(/\b\d+%/);
  });

  it("uses non-animated auto-scroll when reduced motion is requested", async () => {
    const scrollTo = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: scrollTo });
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(true)));

    await renderConsole({
      steps: [{ phase: "Market", label: "$ARG", detail: "Market evidence returned.", tone: "neutral" }],
      kind: "token",
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("labels an empty resolution without inventing provider activity", async () => {
    await renderConsole({ steps: [], kind: "resolution" });

    expect(container?.textContent).toContain("Finding @subject");
    expect(container?.textContent).toContain("Finding the right match");
    expect(container?.textContent).not.toContain("Checking @subject");
    expect(container?.textContent).not.toContain("Live check");
    expect(container?.textContent).toContain("Resolving the exact subject");
    expect(container?.textContent).toContain("Confirming the official name and links before searching sources");
    expect(container?.textContent).toContain("source search has not started");
    expect(container?.textContent).not.toMatch(/DexScreener|GoPlus|Claude|Grok|GitHub/);
  });
});
