import { describe, expect, it } from "vitest";
import { runOfflineReleaseCanary } from "./matrix";

describe("deterministic offline release canary", () => {
  it("covers known-good people, a risky actor, sparse identity, and tokens without live providers", async () => {
    const summary = await runOfflineReleaseCanary();

    expect(summary.mode).toBe("offline-fixtures");
    expect(summary.unexpectedUrls).toEqual([]);
    // 4 provider fixtures each for the clean, honeypot, and OFAC-sanctioned
    // token scans (the sanctioned scan reuses the clean-token fixtures with an
    // injected screener, so it adds no /api/sanctions request).
    expect(summary.interceptedFixtureRequests).toBe(12);
    expect(summary.results.map((result) => result.id)).toEqual([
      "person-founder-known-good",
      "person-investor-known-good",
      "person-risky-actor",
      "person-sparse-unknown",
      "token-established-control",
      "token-honeypot-negative",
      "token-ofac-sanctioned",
    ]);
    expect(summary.results.filter((result) => !result.pass)).toEqual([]);
    expect(summary.passed).toBe(summary.total);
  });

  it("serializes concurrent fixture runs and restores the original global fetch", async () => {
    const originalFetch = globalThis.fetch;

    const summaries = await Promise.all([
      runOfflineReleaseCanary(),
      runOfflineReleaseCanary(),
    ]);

    expect(summaries.every((summary) => summary.passed === summary.total)).toBe(true);
    expect(summaries.every((summary) => summary.unexpectedUrls.length === 0)).toBe(true);
    expect(globalThis.fetch).toBe(originalFetch);
  });
});
