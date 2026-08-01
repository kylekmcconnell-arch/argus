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

type ConsoleProps = {
  steps: TraceStep[];
  kind?: "person" | "token" | "investigation" | "resolution";
  working?: boolean;
};

function consoleElement({ steps, kind = "person", working = true }: ConsoleProps) {
  return (
    <AuditConsole
      handle="@subject"
      subtitle="Observed evidence appears below"
      steps={steps}
      working={working}
      mode="live"
      kind={kind}
    />
  );
}

async function renderConsole(props: ConsoleProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root?.render(consoleElement(props)));
}

// Streams a further batch into the console that is already mounted, so the
// scroll state under test survives across renders the way it does in a scan.
async function streamInto(props: ConsoleProps) {
  await act(async () => root?.render(consoleElement(props)));
}

function step(label: string): TraceStep {
  return { phase: "P1 · Sources", label, detail: `${label} returned.`, tone: "neutral" };
}

function scrollPane(): HTMLElement {
  const pane = container?.querySelector<HTMLElement>("[aria-label='Live check updates']");
  if (!pane) throw new Error("scroll pane is not rendered");
  return pane;
}

type Viewport = { scrollTop: number; scrollHeight?: number; clientHeight?: number };

// jsdom has no layout, so the pane's scroll geometry has to be stated outright.
function placeViewport({ scrollTop, scrollHeight = 900, clientHeight = 300 }: Viewport): HTMLElement {
  const pane = scrollPane();
  Object.defineProperty(pane, "scrollHeight", { configurable: true, value: scrollHeight });
  Object.defineProperty(pane, "clientHeight", { configurable: true, value: clientHeight });
  Object.defineProperty(pane, "scrollTop", { configurable: true, writable: true, value: scrollTop });
  return pane;
}

async function scrollPaneTo(viewport: Viewport) {
  const pane = placeViewport(viewport);
  await act(async () => {
    pane.dispatchEvent(new Event("scroll"));
  });
}

function jumpButton(): HTMLButtonElement | null {
  const buttons = Array.from(container?.querySelectorAll("button") ?? []);
  return buttons.find((b) => /jump to latest/i.test(b.textContent ?? "")) ?? null;
}

function stubScrollTo() {
  const spy = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: spy });
  return spy;
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
    const scrollTo = stubScrollTo();
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(true)));

    await renderConsole({
      steps: [{ phase: "Market", label: "$ARG", detail: "Market evidence returned.", tone: "neutral" }],
      kind: "token",
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("follows the newest line while the reader is parked at the bottom", async () => {
    const scrollTo = stubScrollTo();
    await renderConsole({ steps: [step("Fetch site")] });
    await scrollPaneTo({ scrollTop: 600 });
    scrollTo.mockClear();

    await streamInto({ steps: [step("Fetch site"), step("Fetch holders")] });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 900 }));
    expect(jumpButton()).toBeNull();
  });

  it("leaves the scroll position alone when the reader has scrolled up to read", async () => {
    const scrollTo = stubScrollTo();
    await renderConsole({ steps: [step("Fetch site")] });
    // 400px above the bottom: the reader is on a warning, not on the tail.
    await scrollPaneTo({ scrollTop: 200 });
    scrollTo.mockClear();

    await streamInto({ steps: [step("Fetch site"), step("Fetch holders")] });

    expect(scrollTo).not.toHaveBeenCalled();
    expect(jumpButton()).not.toBeNull();
  });

  it("keeps following through the smooth scroll's own intermediate events", async () => {
    const scrollTo = stubScrollTo();
    vi.stubGlobal("matchMedia", vi.fn(() => matchMedia(false)));
    await renderConsole({ steps: [step("Fetch site")] });
    await scrollPaneTo({ scrollTop: 600 });

    // The new line grows the pane before the follow starts, then the smooth
    // scroll walks the viewport down a frame at a time. Those frames sit well
    // above the sticky threshold and must not read as the reader leaving.
    placeViewport({ scrollTop: 600, scrollHeight: 1100 });
    await streamInto({ steps: [step("Fetch site"), step("Fetch holders")] });
    await scrollPaneTo({ scrollTop: 650, scrollHeight: 1100 });
    await scrollPaneTo({ scrollTop: 730, scrollHeight: 1100 });
    scrollTo.mockClear();

    // The next line lands while that animation is still in flight.
    placeViewport({ scrollTop: 730, scrollHeight: 1300 });
    await streamInto({ steps: [step("Fetch site"), step("Fetch holders"), step("Score axes")] });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(jumpButton()).toBeNull();
  });

  it("re-pins to the tail when the reader takes the jump affordance", async () => {
    const scrollTo = stubScrollTo();
    await renderConsole({ steps: [step("Fetch site")] });
    await scrollPaneTo({ scrollTop: 200 });
    await streamInto({ steps: [step("Fetch site"), step("Fetch holders")] });
    scrollTo.mockClear();

    await act(async () => {
      jumpButton()?.click();
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 900 }));
    expect(jumpButton()).toBeNull();

    scrollTo.mockClear();
    await streamInto({ steps: [step("Fetch site"), step("Fetch holders"), step("Score axes")] });

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("parks at the tail again when a fresh scan empties the console", async () => {
    const scrollTo = stubScrollTo();
    await renderConsole({ steps: [step("Fetch site")] });
    await scrollPaneTo({ scrollTop: 200 });
    await streamInto({ steps: [step("Fetch site"), step("Fetch holders")] });
    expect(jumpButton()).not.toBeNull();

    await streamInto({ steps: [] });
    scrollTo.mockClear();
    await streamInto({ steps: [step("Resolve subject")] });

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(jumpButton()).toBeNull();
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
