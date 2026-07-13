import { describe, expect, it } from "vitest";
import { basicFactQuestionOutcome } from "./basicFactQuestions";

describe("basicFactQuestionOutcome", () => {
  it("keeps a succeeded search with unresolved leads open", () => {
    expect(basicFactQuestionOutcome({
      predicate: "official_token",
      status: "unanswered",
      providerRuns: [{ state: "succeeded" }],
    })).toBe("unresolved");
  });

  it("uses only an explicit completed-empty search as a checked-empty result", () => {
    expect(basicFactQuestionOutcome({
      predicate: "official_token",
      status: "unanswered",
      providerRuns: [{ state: "failed" }, { state: "completed_empty" }],
    })).toBe("checked_empty");
  });

  it.each(["succeeded", "partial", "failed", "skipped"] as const)(
    "keeps a later %s repair open after an earlier completed-empty pass",
    (latestState) => {
      expect(basicFactQuestionOutcome({
        predicate: "public_security",
        status: "unanswered",
        providerRuns: [{ state: "completed_empty" }, { state: latestState }],
      })).toBe("unresolved");
    },
  );

  it("keeps a verified answer answered regardless of provider-run state", () => {
    expect(basicFactQuestionOutcome({
      predicate: "public_security",
      status: "answered",
      providerRuns: [{ state: "partial" }],
    })).toBe("answered");
  });
});
