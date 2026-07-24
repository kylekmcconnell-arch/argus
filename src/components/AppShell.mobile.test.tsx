// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  signOut: vi.fn(),
  runs: [] as Array<Record<string, unknown>>,
}));

vi.mock("../auth-context", () => ({
  useArgusAuth: () => ({
    role: "owner",
    user: { displayName: "Kyle McConnell", email: "kyle@example.com" },
    signOut: harness.signOut,
  }),
}));

vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span aria-hidden="true">ARGUS</span> }));
vi.mock("../lib/watchlist", () => ({ getWatchlist: () => [] }));
vi.mock("../lib/analyst", () => ({ getAnalyst: () => "Kyle McConnell" }));
vi.mock("../lib/avatars", () => ({ auditImage: () => null }));
vi.mock("../lib/runner", () => ({ activeRuns: () => harness.runs, subscribeRuns: () => () => undefined }));
vi.mock("../lib/activescans", () => ({ activeScans: () => [], subscribeScans: () => () => undefined }));
vi.mock("../lib/scanrunner", () => ({ activeScanRuns: () => [], subscribeScanRuns: () => () => undefined }));
vi.mock("../lib/auditlog", () => ({
  mergedLog: () => [],
  subscribeLog: () => () => undefined,
  presentedAuditVerdict: () => "INCOMPLETE",
}));

import { AppShell } from "./AppShell";
import { ARGUS_THEME_STORAGE_KEY } from "../lib/theme";

let container: HTMLDivElement;
let root: Root;
const storageValues = new Map<string, string>();

function mobileMatchMedia(): MediaQueryList {
  return {
    matches: true,
    media: "(max-width: 1023px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
  } as unknown as MediaQueryList;
}

async function renderShell(): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AppShell onNav={vi.fn()} onAudit={vi.fn()} view="idle">
        <button type="button">Page action</button>
      </AppShell>,
    );
  });
}

function drawer(): HTMLElement {
  const element = container.querySelector<HTMLElement>("#argus-navigation-drawer");
  if (!element) throw new Error("Navigation drawer was not rendered");
  return element;
}

function menuButton(): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>("button[aria-label='Open navigation']");
  if (!element) throw new Error("Navigation trigger was not rendered");
  return element;
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.runs = [];
  storageValues.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storageValues.get(key) ?? null,
    setItem: (key: string, value: string) => storageValues.set(key, value),
    clear: () => storageValues.clear(),
  });
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
  vi.stubGlobal("matchMedia", vi.fn(() => mobileMatchMedia()));
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  }));
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.unstubAllGlobals();
});

describe("AppShell mobile navigation drawer", () => {
  it("keeps the closed drawer inert and exposes it as a modal dialog only while open", async () => {
    await renderShell();

    expect(drawer().getAttribute("aria-hidden")).toBe("true");
    expect(drawer().hasAttribute("inert")).toBe(true);
    expect(drawer().getAttribute("role")).toBeNull();
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");

    await act(async () => menuButton().click());

    expect(drawer().getAttribute("role")).toBe("dialog");
    expect(drawer().getAttribute("aria-modal")).toBe("true");
    expect(drawer().getAttribute("aria-label")).toBe("ARGUS navigation");
    expect(drawer().hasAttribute("aria-hidden")).toBe(false);
    expect(drawer().hasAttribute("inert")).toBe(false);
    expect(menuButton().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(drawer().querySelector("button[aria-label='Close navigation']"));
  });

  it("traps keyboard focus, closes on Escape, and restores focus to the trigger", async () => {
    await renderShell();
    await act(async () => menuButton().click());

    const focusable = [...drawer().querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), summary, input:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    const first = focusable[0];
    const last = focusable.at(-1);
    expect(first).toBeDefined();
    expect(last).toBeDefined();

    first?.focus();
    await act(async () => {
      drawer().dispatchEvent(new KeyboardEvent("keydown", {
        key: "Tab",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(document.activeElement).toBe(last);

    last?.focus();
    await act(async () => {
      drawer().dispatchEvent(new KeyboardEvent("keydown", {
        key: "Tab",
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(document.activeElement).toBe(first);

    await act(async () => {
      drawer().dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(drawer().getAttribute("aria-hidden")).toBe("true");
    expect(drawer().hasAttribute("inert")).toBe(true);
    expect(menuButton().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(menuButton());
  });

  it("persists the explicit light-mode action from a dark session", async () => {
    await renderShell();
    await act(async () => menuButton().click());

    const lightMode = drawer().querySelector<HTMLButtonElement>("button[aria-label='Switch to light mode']");
    expect(lightMode).not.toBeNull();
    expect(document.documentElement.dataset.theme).toBe("dark");

    await act(async () => lightMode?.click());

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(localStorage.getItem(ARGUS_THEME_STORAGE_KEY)).toBe("light");
    expect(drawer().querySelector("button[aria-label='Switch to dark mode']")).not.toBeNull();
  });

  it("shows observed evidence activity instead of a synthetic completion percentage", async () => {
    harness.runs = [{
      handle: "@alice",
      key: "alice",
      steps: [{ phase: "Market", label: "Pair observed", detail: "Evidence returned.", tone: "neutral" }],
      pct: 55,
      status: "running",
      startedAt: 1,
    }];
    await renderShell();
    await act(async () => menuButton().click());

    expect(drawer().textContent).toContain("1 evidence event · Market");
    expect(drawer().textContent).not.toContain("55%");
    expect(drawer().textContent).not.toContain("generating");
  });
});
