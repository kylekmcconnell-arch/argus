// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ARGUS_THEME_COLORS,
  ARGUS_THEME_STORAGE_KEY,
  applyArgusTheme,
  currentArgusTheme,
  initializeArgusTheme,
  nextArgusTheme,
  normalizeArgusTheme,
  persistArgusTheme,
  readStoredArgusTheme,
  setArgusTheme,
} from "./theme";

beforeEach(() => {
  document.documentElement.dataset.theme = "dark";
  document.documentElement.style.colorScheme = "dark";
  document.head.innerHTML = '<meta name="theme-color" content="#060a12">';
});

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("ARGUS theme normalization", () => {
  it("accepts light and defaults every other value to dark", () => {
    expect(normalizeArgusTheme("light")).toBe("light");
    expect(normalizeArgusTheme("dark")).toBe("dark");
    expect(normalizeArgusTheme("system")).toBe("dark");
    expect(normalizeArgusTheme(null)).toBe("dark");
  });

  it("toggles only between the supported themes", () => {
    expect(nextArgusTheme("dark")).toBe("light");
    expect(nextArgusTheme("light")).toBe("dark");
    expect(nextArgusTheme("corrupt")).toBe("light");
  });
});

describe("ARGUS theme persistence", () => {
  it("reads a valid preference and rejects corrupted storage values", () => {
    const storage = memoryStorage({ [ARGUS_THEME_STORAGE_KEY]: "light" });
    expect(readStoredArgusTheme(storage)).toBe("light");

    storage.setItem(ARGUS_THEME_STORAGE_KEY, "sepia");
    expect(readStoredArgusTheme(storage)).toBe("dark");
  });

  it("falls back safely when storage is blocked", () => {
    const blocked = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("blocked"); }),
    };

    expect(readStoredArgusTheme(blocked)).toBe("dark");
    expect(persistArgusTheme("light", blocked)).toBe("light");
  });
});

describe("ARGUS theme application", () => {
  it("synchronizes the root theme, native controls, and browser chrome", () => {
    expect(applyArgusTheme("light", document)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute("content"))
      .toBe(ARGUS_THEME_COLORS.light);
    expect(currentArgusTheme(document)).toBe("light");
  });

  it("applies and persists a user choice through one operation", () => {
    const storage = memoryStorage();
    expect(setArgusTheme("light", { document, storage })).toBe("light");
    expect(storage.getItem(ARGUS_THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("can apply a temporary theme without changing the saved preference", () => {
    const storage = memoryStorage({ [ARGUS_THEME_STORAGE_KEY]: "dark" });
    setArgusTheme("light", { document, storage, persist: false });
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(storage.getItem(ARGUS_THEME_STORAGE_KEY)).toBe("dark");
  });

  it("initializes the runtime from the validated saved preference", () => {
    const storage = memoryStorage({ [ARGUS_THEME_STORAGE_KEY]: "light" });
    expect(initializeArgusTheme({ document, storage })).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
