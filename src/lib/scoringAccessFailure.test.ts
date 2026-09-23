import { describe, expect, it } from "vitest";
import { scoringAccessFailure } from "./scoringAccessFailure";
describe("scoring failure presentation", () => {
  it("distinguishes provider access from missing evidence in older saved reports", () => {
    const saved = { providerFailures: [{ provider: "grok", op: "record_verdict", failed: 1, meta: "http_403" }] };
    expect(scoringAccessFailure(saved, true)).toContain("administrator must restore provider access");
    expect(scoringAccessFailure(saved, false)).toBeUndefined();
  });
  it("does not infer scorer access failure from an unrelated lane or transient error", () => {
    for (const [op, meta] of [["live-search", "http_403"], ["record_verdict", "http_503"]]) {
      expect(scoringAccessFailure({ providerFailures: [{ provider: "grok", op, failed: 1, meta }] }, true)).toBeUndefined();
    }
  });
  it("uses the frozen reason when a rejected collector prevented the scoring call", () => {
    expect(scoringAccessFailure({ scoringOutcome: { state: "failed", detail: "failed", capturedAt: "2026-09-22T00:00:00Z", failure: { kind: "provider_access", provider: "grok", httpStatus: 401, diagnostic: "credentials_rejected" } } }, true)).toContain("HTTP 401");
  });
});
