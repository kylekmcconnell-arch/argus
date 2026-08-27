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
    window.history.replaceState({}, "", "/?s=fedi&reportView=enigma");
    await renderSelector(false);

    expect(container.querySelector("[data-owner-control='report-view']")).toBeNull();
    expect(window.location.search).toBe("?s=fedi");
    expect(document.documentElement.dataset.reportLane).toBe("production");
  });

  it("switches presentation without changing the report query", async () => {
    await renderSelector(true);
    const enigma = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Enigma");
    if (!enigma) throw new Error("Enigma selector was not rendered");

    await act(async () => enigma.click());

    expect(window.location.search).toContain("s=fedi");
    expect(window.location.search).toContain("reportView=enigma");
    expect(window.localStorage.getItem(REPORT_VIEW_STORAGE_KEY)).toBe("enigma");
    expect(document.documentElement.dataset.reportLane).toBe("enigma");
    expect(enigma.getAttribute("aria-pressed")).toBe("true");
  });
});
