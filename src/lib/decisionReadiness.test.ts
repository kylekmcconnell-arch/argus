import { describe, expect, it } from "vitest";
import {
  deriveDecisionReadiness,
  PROVISIONAL_COVERAGE_FLOOR_PERCENT,
} from "./decisionReadiness";
import type { CheckStatus, ScanCheck } from "./scanChecklist";

const checks = (statuses: readonly CheckStatus[]): ScanCheck[] =>
  statuses.map((status, index) => ({ label: `Check ${index + 1}`, status }));

describe("deriveDecisionReadiness", () => {
  it("keeps an empty or entirely not-applicable report incomplete", () => {
    expect(deriveDecisionReadiness([])).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      applicable: 0,
      successful: 0,
      unresolved: 0,
      title: "Investigation incomplete",
    });

    const result = deriveDecisionReadiness(checks(["not-applicable", "not-applicable"]));
    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      total: 2,
      applicable: 0,
      notApplicable: 2,
    });
    expect(result.guidance).toContain("No applicable checks");
  });

  it("reports each unresolved reason and keeps thin coverage incomplete", () => {
    const result = deriveDecisionReadiness(checks([
      "confirmed",
      "unknown",
      "unknown",
      "unavailable",
      "stale",
      "not-applicable",
    ]));

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 20,
      total: 6,
      applicable: 5,
      successful: 1,
      unresolved: 4,
      unknown: 2,
      providerUnavailable: 1,
      stale: 1,
      notApplicable: 1,
    });
    expect(result.guidance).toContain("2 not completed");
    expect(result.guidance).toContain("1 provider path unavailable");
    expect(result.guidance).toContain("Do not treat the score or verdict as investment-ready");
  });

  it("marks substantial but unfinished coverage provisional at the policy floor", () => {
    const completed: CheckStatus[] = Array.from({ length: 7 }, () => "confirmed");
    const result = deriveDecisionReadiness(checks([
      ...completed,
      "unknown",
      "unavailable",
      "stale",
    ]));

    expect(PROVISIONAL_COVERAGE_FLOOR_PERCENT).toBe(70);
    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 70,
      applicable: 10,
      successful: 7,
      unresolved: 3,
      title: "Assessment is provisional",
    });
    expect(result.guidance).toContain("Treat the score and verdict as provisional");
  });

  it("requires every applicable check to have an observable outcome before becoming ready", () => {
    const result = deriveDecisionReadiness(checks([
      "confirmed",
      "finding",
      "checked-empty",
      "not-applicable",
    ]));

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      applicable: 3,
      successful: 3,
      unresolved: 0,
      findings: 1,
      checkedEmpty: 1,
      title: "Evidence coverage complete — findings require review",
    });
    expect(result.guidance).toContain("including 1 finding");
    expect(result.guidance).toContain("not an investment recommendation");
  });

  it("floors display coverage so an unresolved check never rounds up to 100%", () => {
    const almostComplete: CheckStatus[] = [
      ...Array.from({ length: 199 }, () => "confirmed" as const),
      "unknown",
    ];
    const result = deriveDecisionReadiness(checks(almostComplete));

    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 99,
      applicable: 200,
      successful: 199,
      unresolved: 1,
    });
  });

  it("does not confuse a completed finding with missing execution coverage", () => {
    const result = deriveDecisionReadiness(checks(["finding", "finding"]));

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      successful: 2,
      findings: 2,
      unknown: 0,
    });
  });
});
