// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({
  entries: [] as Array<Record<string, unknown>>,
  signOut: vi.fn(),
}));

vi.mock("../auth-context", () => ({
  useArgusAuth: () => ({
    role: "owner",
    user: { displayName: "Kyle McConnell", email: "kyle@example.com" },
    signOut: harness.signOut,
  }),
}));

vi.mock("./ArgusMark", () => ({ ArgusMark: () => <span>ARGUS</span> }));
vi.mock("../lib/watchlist", () => ({ getWatchlist: () => [] }));
vi.mock("../lib/analyst", () => ({ getAnalyst: () => "Kyle McConnell" }));
vi.mock("../lib/avatars", () => ({ auditImage: () => null }));
vi.mock("../lib/runner", () => ({ activeRuns: () => [], subscribeRuns: () => () => undefined }));
vi.mock("../lib/activescans", () => ({ activeScans: () => [], subscribeScans: () => () => undefined }));
vi.mock("../lib/scanrunner", () => ({ activeScanRuns: () => [], subscribeScanRuns: () => () => undefined }));
vi.mock("../lib/recentScored", () => ({ recentScored: () => harness.entries }));
vi.mock("../lib/auditlog", () => ({
  mergedLog: () => harness.entries,
  subscribeLog: () => () => undefined,
  presentedAuditVerdict: (entry: { verdict?: string; coverage?: string }) => (
    entry.verdict === "PASS" && entry.coverage === "provisional" ? "INCOMPLETE" : entry.verdict
  ),
  auditReadinessLabel: (entry: { verdict?: string; coverage?: string }) => (
    entry.verdict === "PASS" && entry.coverage === "provisional" ? "PROVISIONAL" : entry.verdict
  ),
}));

import { ScoreTicker } from "./ScoreTicker";
import { Sidebar } from "./Sidebar";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const entry = (id: string, query: string, score: number, coverage = "ready") => ({
  id,
  ts: Date.now(),
  kind: "person",
  query,
  ref: query.replace(/^@/, ""),
  verdict: "PASS",
  score,
  summary: "Stored person report",
  coverage,
  flags: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  harness.entries = [
    entry("gakonst", "@gakonst", 83, "provisional"),
    entry("world", "@world_xyz", 34),
    entry("jorge", "@jorge_rl02", 10),
    entry("wake", "@wakeonbase", 47),
    entry("shaco", "@realshaco", 43),
  ];
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Recent report controls", () => {
  it("relays the exact stored subject from the real sidebar and visible ticker card", async () => {
    const onOpenRecent = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <>
          <Sidebar
            onNav={() => undefined}
            onAudit={() => undefined}
            onOpenRecent={onOpenRecent}
            view="idle"
          />
          <section data-testid="ticker">
            <ScoreTicker onOpen={onOpenRecent} />
          </section>
        </>,
      );
    });

    expect(container.textContent).toContain("v3.0");
    expect(container.textContent).not.toContain("v2.2");

    const activeNav = container.querySelector<HTMLButtonElement>('aside button[aria-current="page"]');
    expect(activeNav).not.toBeNull();
    expect(activeNav?.className.split(/\s+/)).toContain("sidebar-nav-active");
    const activeRail = activeNav?.querySelector<HTMLElement>('span.absolute[aria-hidden="true"]');
    expect(activeRail).not.toBeNull();
    expect(activeRail?.className.split(/\s+/)).toEqual(expect.arrayContaining(["inset-y-1", "left-0", "w-[2px]", "bg-on-signal/80"]));

    const sidebarLink = [...container.querySelectorAll<HTMLAnchorElement>("aside a")]
      .find((link) => link.textContent?.includes("@gakonst") && link.textContent.includes("handle"));
    expect(sidebarLink).toBeDefined();
    expect(sidebarLink?.textContent).toContain("handle · 83 · checks open");
    expect(sidebarLink?.getAttribute("href")).toBe("?s=gakonst&kind=person");
    await act(async () => sidebarLink?.click());
    expect(onOpenRecent).toHaveBeenLastCalledWith("gakonst", "person");

    onOpenRecent.mockClear();
    const marqueeCopies = container.querySelectorAll<HTMLElement>("[data-testid='ticker'] .scores-marquee > div");
    expect(marqueeCopies).toHaveLength(2);
    expect(marqueeCopies[0]?.hasAttribute("inert")).toBe(false);
    expect(marqueeCopies[1]?.hasAttribute("inert")).toBe(true);
    expect(marqueeCopies[1]?.getAttribute("aria-hidden")).toBe("true");

    const visibleTickerLink = [...(marqueeCopies[0]?.querySelectorAll<HTMLAnchorElement>("a") ?? [])]
      .find((link) => link.textContent?.includes("@gakonst"));
    expect(visibleTickerLink).toBeDefined();
    expect(visibleTickerLink?.getAttribute("href")).toBe("?s=gakonst&kind=person");
    await act(async () => visibleTickerLink?.click());
    expect(onOpenRecent).toHaveBeenLastCalledWith("gakonst", "person");
  });

  it("keeps mobile account utilities inside the drawer scroller", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Sidebar
          onNav={() => undefined}
          onAudit={() => undefined}
          view="idle"
          mobile
          open
        />,
      );
    });

    const drawer = container.querySelector<HTMLElement>('aside[role="dialog"]');
    const scroller = drawer?.querySelector<HTMLElement>(".thin-scroll");
    const account = drawer?.querySelector<HTMLElement>("[data-sidebar-account]");
    expect(drawer).not.toBeNull();
    expect(scroller).not.toBeNull();
    expect(account).not.toBeNull();
    expect(scroller?.contains(account ?? null)).toBe(true);
    expect(account?.className.split(/\s+/)).toContain("mt-4");
  });

  it("keeps report navigation labeled at a stable desktop width", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(
        <Sidebar
          onNav={() => undefined}
          onAudit={() => undefined}
          view="audit"
        />,
      );
    });

    const sidebar = container.querySelector<HTMLElement>('aside[data-sidebar-mode="report"]');
    expect(sidebar).not.toBeNull();
    expect(sidebar?.className.split(/\s+/)).toContain("lg:w-[248px]");
    expect(sidebar?.className.split(/\s+/)).not.toContain("lg:w-[196px]");
    expect(sidebar?.className.split(/\s+/)).not.toContain("lg:w-[72px]");

    const investigationCanvas = [...(sidebar?.querySelectorAll<HTMLButtonElement>("nav button") ?? [])]
      .find((button) => button.textContent?.includes("Investigation canvas"));
    expect(investigationCanvas).toBeDefined();
    expect(investigationCanvas?.querySelector("span.sr-only")).toBeNull();
    expect(sidebar?.textContent).toContain("Recent cases");
    expect(sidebar?.textContent).toContain("Kyle McConnell");
  });
});
