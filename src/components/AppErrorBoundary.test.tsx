// @vitest-environment jsdom

import { act, lazy, Suspense } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary, isStaleChunkError } from "./AppErrorBoundary";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function Boom({ error }: { error: Error }): never {
  throw error;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.sessionStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe("isStaleChunkError", () => {
  it("recognizes how each browser reports a chunk that no longer exists", () => {
    expect(isStaleChunkError(new Error("Failed to fetch dynamically imported module: https://argus/assets/Report-a1b2.js"))).toBe(true);
    expect(isStaleChunkError(new Error("error loading dynamically imported module"))).toBe(true);
    expect(isStaleChunkError(new Error("Importing a module script failed."))).toBe(true);
    expect(isStaleChunkError(new Error("Unable to preload CSS for /assets/Report-a1b2.css"))).toBe(true);
    expect(isStaleChunkError(new Error("Cannot read properties of undefined (reading 'available')"))).toBe(false);
    expect(isStaleChunkError("nonsense")).toBe(false);
  });
});

describe("AppErrorBoundary", () => {
  it("renders children untouched when nothing throws", async () => {
    await act(async () => root.render(<AppErrorBoundary><p>report</p></AppErrorBoundary>));
    expect(container.textContent).toBe("report");
  });

  it("recovers a stale-chunk crash by reloading once instead of blanking the page", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "https://argus.example/", reload },
    });

    await act(async () => root.render(
      <AppErrorBoundary><Boom error={new Error("Failed to fetch dynamically imported module: /assets/Report-a1b2.js")} /></AppErrorBoundary>,
    ));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("ARGUS updated while this tab was open");
    expect(container.textContent).not.toBe("");
  });

  it("stops auto-reloading when the failure repeats inside the cooldown", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "https://argus.example/", reload },
    });
    window.sessionStorage.setItem("argus:stale-chunk-reload", String(Date.now()));

    await act(async () => root.render(
      <AppErrorBoundary><Boom error={new Error("Failed to fetch dynamically imported module: /assets/Report-a1b2.js")} /></AppErrorBoundary>,
    ));

    expect(reload).not.toHaveBeenCalled();
    expect(container.textContent).toContain("older ARGUS than the server");
    expect(container.textContent).toContain("Reload ARGUS");
  });

  it("catches the real mechanism: a lazy page chunk that 404s after a deploy", async () => {
    // Not a synthetic throw. This is how the failure actually arrives: a
    // lazy() page import rejects and surfaces through Suspense, exactly as
    // observed in prod (InvestigationRun-DFK9jHnX.js returning 404).
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, href: "https://argus.example/", reload },
    });
    const StalePage = lazy(() => Promise.reject(
      new Error("Failed to fetch dynamically imported module: https://argus.example/assets/InvestigationRun-DFK9jHnX.js"),
    ));

    await act(async () => root.render(
      <AppErrorBoundary>
        <Suspense fallback={<p>loading</p>}>
          <StalePage />
        </Suspense>
      </AppErrorBoundary>,
    ));

    expect(reload).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("ARGUS updated while this tab was open");
  });

  it("names a genuine render failure instead of disappearing", async () => {
    await act(async () => root.render(
      <AppErrorBoundary><Boom error={new Error("Cannot read properties of undefined (reading 'available')")} /></AppErrorBoundary>,
    ));

    expect(container.textContent).toContain("Something in this view failed to render");
    expect(container.textContent).toContain("No saved report was changed");
    expect(container.textContent).toContain("Cannot read properties of undefined");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe("consumeStaleChunkReloadNotice", () => {
  const store = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => { map.set(key, value); },
      removeItem: (key: string) => { map.delete(key); },
    } as Storage;
  };

  it("reports a fresh auto-reload exactly once and leaves the cooldown marker intact", async () => {
    const { consumeStaleChunkReloadNotice, RELOAD_MARKER } = await import("./AppErrorBoundary");
    const storage = store();
    storage.setItem(RELOAD_MARKER, String(Date.now()));

    expect(consumeStaleChunkReloadNotice(storage)).toBe(true);
    // Marker survives so the boundary's one-reload-per-cooldown guard still holds.
    expect(storage.getItem(RELOAD_MARKER)).not.toBeNull();
    // A second boot inside the window (or a re-render) shows nothing new.
    expect(consumeStaleChunkReloadNotice(storage)).toBe(false);
  });

  it("stays silent with no marker, an old marker, or no storage", async () => {
    const { consumeStaleChunkReloadNotice, RELOAD_MARKER } = await import("./AppErrorBoundary");
    expect(consumeStaleChunkReloadNotice(store())).toBe(false);
    const stale = store();
    stale.setItem(RELOAD_MARKER, String(Date.now() - 10 * 60_000));
    expect(consumeStaleChunkReloadNotice(stale)).toBe(false);
    expect(consumeStaleChunkReloadNotice(undefined)).toBe(false);
  });
});
