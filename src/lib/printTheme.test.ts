import { describe, expect, it } from "vitest";

import { installPrintTheme } from "./printTheme";
import { applyArgusTheme, currentArgusTheme } from "./theme";

// Minimal event target: capture the listeners so tests can fire print events.
function fakeWindow() {
  const listeners: Record<string, Array<() => void>> = {};
  return {
    addEventListener(type: string, fn: () => void) { (listeners[type] ??= []).push(fn); },
    removeEventListener(type: string, fn: () => void) {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
    fire(type: string) { for (const fn of listeners[type] ?? []) fn(); },
    count: () => Object.values(listeners).reduce((n, l) => n + l.length, 0),
  };
}

function fakeDocument(theme: string) {
  return {
    documentElement: { dataset: { theme } as { theme?: string }, style: { colorScheme: theme } },
    querySelector: () => null,
  };
}

describe("installPrintTheme - the PDF is always the light (website) theme", () => {
  it("flips a dark screen to light for the print pass and restores it after", () => {
    const doc = fakeDocument("dark");
    // Wire the module's default document through explicit apply calls: install
    // reads/writes via theme.ts helpers, which accept the real document; here
    // we simulate by applying to the same fake before/after.
    applyArgusTheme("dark", doc);
    const w = fakeWindow();
    // Patch globalThis.document so theme.ts helpers see the fake.
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = doc;
    try {
      installPrintTheme(w);
      w.fire("beforeprint");
      expect(currentArgusTheme(doc as never)).toBe("light");
      w.fire("afterprint");
      expect(currentArgusTheme(doc as never)).toBe("dark");
    } finally {
      if (prev === undefined) delete g.document; else g.document = prev;
    }
  });

  it("leaves an already-light screen untouched (no restore churn)", () => {
    const doc = fakeDocument("light");
    const w = fakeWindow();
    const g = globalThis as { document?: unknown };
    const prev = g.document;
    g.document = doc;
    try {
      installPrintTheme(w);
      w.fire("beforeprint");
      w.fire("afterprint");
      expect(currentArgusTheme(doc as never)).toBe("light");
    } finally {
      if (prev === undefined) delete g.document; else g.document = prev;
    }
  });

  it("uninstalls both listeners", () => {
    const w = fakeWindow();
    const uninstall = installPrintTheme(w);
    expect(w.count()).toBe(2);
    uninstall();
    expect(w.count()).toBe(0);
  });
});
