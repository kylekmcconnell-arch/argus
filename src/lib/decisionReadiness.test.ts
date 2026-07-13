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
      title: "Evidence coverage complete: findings require review",
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

  it("counts a confirmed bounded outcome as ready even when its note preserves partial candidate coverage", () => {
    const result = deriveDecisionReadiness([{
      label: "Portfolio track record",
      status: "confirmed",
      note: "6 relationships verified; bounded candidate coverage remained partial because 1 cited source fetch failed",
      provider: "portfolio-web",
      sourceCount: 6,
    }]);

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      applicable: 1,
      successful: 1,
      unresolved: 0,
      providerUnavailable: 0,
    });
  });

  it("lets explicit decision questions govern readiness while preserving provider diagnostics", () => {
    const result = deriveDecisionReadiness([
      { label: "Verified identity and authority", status: "confirmed", decisionCritical: true },
      { label: "Track record", status: "confirmed", decisionCritical: true },
      { label: "Optional company database", status: "unavailable", decisionCritical: false },
      { label: "Profile image enrichment", status: "unknown", decisionCritical: false },
    ]);

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      total: 2,
      applicable: 2,
      successful: 2,
      unresolved: 0,
      providerUnavailable: 0,
    });
  });

  it("keeps all-check readiness semantics for legacy snapshots without criticality markers", () => {
    const result = deriveDecisionReadiness(checks(["confirmed", "unavailable"]));

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 50,
      applicable: 2,
      successful: 1,
      providerUnavailable: 1,
    });
  });

  it("never calls a zero-role, zero-axis report decision-ready", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding", "checked-empty"]),
      { roleCount: 0, decisionAxisTotal: 0, evidenceBackedAxes: 0 },
    );

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      successful: 3,
      applicable: 3,
      unresolved: 1,
      decisionBlockers: 1,
      title: "Subject routing unresolved",
    });
    expect(result.guidance).toContain("collected intelligence only");
  });

  it("labels a resolved role with no governing axes as incomplete scoring, not failed routing", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding", "checked-empty"]),
      { roleCount: 1, decisionAxisTotal: 0, evidenceBackedAxes: 0 },
    );

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      successful: 3,
      applicable: 3,
      unresolved: 1,
      decisionBlockers: 1,
      title: "Scoring output incomplete",
    });
    expect(result.guidance).toContain("resolved an evidence-backed role");
    expect(result.guidance).toContain("analyst did not return a complete, valid governing-axis score");
    expect(result.guidance).not.toContain("did not resolve an evidence-backed role");
  });

  it("requires qualifying support for every governing axis before becoming ready", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding"]),
      { roleCount: 1, decisionAxisTotal: 4, evidenceBackedAxes: 3 },
    );

    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 75,
      unresolved: 1,
      decisionAxisTotal: 4,
      evidenceBackedAxes: 3,
      decisionBlockers: 1,
      title: "Assessment is provisional",
    });
    expect(result.guidance).toContain("1 governing axis has no qualifying frozen support");
  });
});
