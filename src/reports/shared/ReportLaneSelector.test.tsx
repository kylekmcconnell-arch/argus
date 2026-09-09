// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReportLaneProvider } from "./ReportLaneContext";
import { ReportLaneSelector } from "./ReportLaneSelector";
import { REPORT_VIEW_STORAGE_KEY } from "./resolveReportLane";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const storage = new Map<string, string>();

async function renderSelector(allowSelection: boolean): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <ReportLaneProvider allowSelection={allowSelection} manageSelection>
        <ReportLaneSelector />
      </ReportLaneProvider>,
    );
  });
}

beforeEach(() => {
  storage.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
    },
  });
  window.history.replaceState({}, "", "/?s=fedi");
  window.localStorage.clear();
  delete document.documentElement.dataset.reportLane;
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  storage.clear();
});

describe("owner report selector", () => {
  it("does not render for a non-owner and strips a forged selection", async () => {
    window.history.replaceState({}, "", "/?s=fedi&reportView=developer");
    await renderSelector(false);

    expect(container.querySelector("[data-owner-control='report-view']")).toBeNull();
    expect(window.location.search).toBe("?s=fedi");
    expect(document.documentElement.dataset.reportLane).toBe("production");
  });

  it("switches presentation without changing the report query", async () => {
    await renderSelector(true);
    const developer = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Developer");
    if (!developer) throw new Error("Developer selector was not rendered");

    await act(async () => developer.click());

    expect(window.location.search).toContain("s=fedi");
    expect(window.location.search).toContain("reportView=developer");
    expect(window.localStorage.getItem(REPORT_VIEW_STORAGE_KEY)).toBe("developer");
    expect(document.documentElement.dataset.reportLane).toBe("developer");
    expect(developer.getAttribute("aria-pressed")).toBe("true");
  });

  it("offers only Production and Developer", async () => {
    await renderSelector(true);
    expect([...container.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Production", "Developer"]);
  });

  it.each([["kyle", "production"], ["enigma", "production"], ["raw", "developer"]])("canonicalizes old %s links and preferences", async (old, current) => {
    window.history.replaceState({}, "", `/?s=fedi&reportView=${old}#evidence`);
    storage.set(REPORT_VIEW_STORAGE_KEY, old);
    await renderSelector(true);
    expect(document.documentElement.dataset.reportLane).toBe(current);
    expect(storage.get(REPORT_VIEW_STORAGE_KEY)).toBe(current);
    expect(window.location.search).toBe(current === "production" ? "?s=fedi" : "?s=fedi&reportView=developer");
    expect(window.location.hash).toBe("#evidence");
  });

  it("removes Developer immediately when owner selection is revoked", async () => {
    storage.set(REPORT_VIEW_STORAGE_KEY, "developer");
    await renderSelector(true);
    await act(async () => root.render(<ReportLaneProvider allowSelection={false} manageSelection><ReportLaneSelector /></ReportLaneProvider>));
    expect(container.querySelector("button")).toBeNull();
    expect(document.documentElement.dataset.reportLane).toBe("production");
    expect(storage.has(REPORT_VIEW_STORAGE_KEY)).toBe(false);
  });
});
