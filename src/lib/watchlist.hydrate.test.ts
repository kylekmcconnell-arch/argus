import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getWatchlist, hydrateSharedWatchlist, parseSharedWatchItem } from "./watchlist";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared watchlist hydration", () => {
  it("drops malformed shared rows instead of persisting them into every browser", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      watches: [
        // An older client's row: no snapshot at all.
        { id: "@nosnapshot", kind: "person", label: "@nosnapshot", addedAt: 1 },
        // No kind, no label.
        { id: "0x1111111111111111111111111111111111111111", snapshot: { verdict: "PASS", score: 80 } },
        // Snapshot without a verdict.
        { id: "@noverdict", kind: "person", label: "@noverdict", addedAt: 1, snapshot: { score: 70 } },
        null,
        "garbage",
        // A well-formed row survives.
        { id: "@sound", kind: "person", label: "@sound", addedAt: 2, snapshot: { verdict: "CAUTION", score: 55, completenessState: "partial" } },
      ],
    }), { status: 200 })));

    await hydrateSharedWatchlist();

    expect(getWatchlist()).toEqual([
      expect.objectContaining({ id: "@sound", kind: "person", label: "@sound", snapshot: expect.objectContaining({ verdict: "CAUTION", score: 55, completenessState: "partial" }) }),
    ]);
  });

  it("validates the fields the Watchlist page reads", () => {
    expect(parseSharedWatchItem({ id: "@a", kind: "person", label: "@a", snapshot: { verdict: "PASS", score: null } })).toMatchObject({
      id: "@a", kind: "person", label: "@a", snapshot: { verdict: "PASS", score: null },
    });
    expect(parseSharedWatchItem({ id: "@a", kind: "site", label: "@a", snapshot: { verdict: "PASS", score: 1 } })).toBeNull();
    expect(parseSharedWatchItem({ id: "@a", kind: "person", label: "", snapshot: { verdict: "PASS", score: 1 } })).toBeNull();
    expect(parseSharedWatchItem({ id: "@a", kind: "person", label: "@a", snapshot: { verdict: "PASS", score: "80" } })).toBeNull();
    expect(parseSharedWatchItem({ id: "@a", kind: "person", label: "@a" })).toBeNull();
  });
});
