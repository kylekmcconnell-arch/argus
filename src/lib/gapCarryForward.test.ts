import { describe, expect, it } from "vitest";
import {
  mergeScopedFollowUpChecks,
  scopedFollowUpComparison,
  scopedFollowUpPromotionBlocks,
  selectedCheckIdsForScope,
  type ScopedFollowUpMergeInput,
} from "./gapCarryForward";
import type { ScanCheck } from "./scanChecklist";
import type { ResearchPlan } from "./researchDirector";

const SOURCE_VERSION = "11111111-1111-4111-8111-111111111111";
const SOURCE_FROZEN_AT = "2026-09-10T04:05:00.000Z";
const NOW = "2026-09-11T12:00:00.000Z";

function check(partial: Partial<ScanCheck> & { checkId: string; status: ScanCheck["status"] }): ScanCheck {
  return {
    label: partial.checkId.replace(/-/g, " "),
    decisionCritical: true,
    completedAt: SOURCE_FROZEN_AT,
    provider: "source-provider",
    sourceCount: 3,
    ...partial,
  };
}

function merge(overrides: Partial<ScopedFollowUpMergeInput>) {
  return mergeScopedFollowUpChecks({
    sourceChecks: [],
    freshChecks: [],
    selectedCheckIds: [],
    sourceReportVersionId: SOURCE_VERSION,
    sourceObservedAt: SOURCE_FROZEN_AT,
    now: NOW,
    ...overrides,
  });
}

const row = (result: ReturnType<typeof merge>, checkId: string) =>
  result.rows.find((candidate) => candidate.checkId === checkId);

const merged = (result: ReturnType<typeof merge>, checkId: string) =>
  result.checks.find((candidate) => candidate.checkId === checkId);

describe("selectedCheckIdsForScope", () => {
  const plan: ResearchPlan = {
    schemaVersion: 1,
    intent: "investment_due_diligence",
    subject: "matetokay",
    roles: ["FOUNDER"],
    createdAt: SOURCE_FROZEN_AT,
    tasks: [
      {
        id: "people-and-control",
        capability: "people_and_control",
        question: "Who controls this?",
        why: "Identity gap",
        priority: "critical",
        delegates: ["public-web"],
        checkIds: ["founder-identity", "founder-relationships"],
        triggeredBy: [],
        rank: 1,
        decisionImpact: 5,
        costClass: "medium",
        dispatchReason: "Gap",
        stopWhen: "Bound",
        blockedBy: [],
        state: "unavailable",
      },
      {
        id: "synthesis",
        capability: "analyst_synthesis",
        question: "What follows?",
        why: "Gate",
        priority: "critical",
        delegates: ["axis-scorer"],
        checkIds: [],
        triggeredBy: [],
        rank: 2,
        decisionImpact: 5,
        costClass: "low",
        dispatchReason: "Required",
        stopWhen: "Frozen",
        blockedBy: [],
        state: "partial",
      },
      {
        id: "adverse",
        capability: "legal_and_adverse",
        question: "Any adverse media?",
        why: "Screen",
        priority: "critical",
        delegates: ["adverse-web"],
        checkIds: ["adverse-screen"],
        triggeredBy: [],
        rank: 3,
        decisionImpact: 5,
        costClass: "medium",
        dispatchReason: "Screen",
        stopWhen: "Screened",
        blockedBy: [],
        state: "completed",
      },
    ],
    nextActions: [],
  };

  it("names only the checks the authorized tasks own", () => {
    expect(selectedCheckIdsForScope(plan, ["people-and-control", "synthesis"]).sort())
      .toEqual(["founder-identity", "founder-relationships"]);
  });

  it("does not select checks from tasks the authorization left out", () => {
    expect(selectedCheckIdsForScope(plan, ["people-and-control"])).not.toContain("adverse-screen");
  });

  it("returns nothing without a saved plan", () => {
    expect(selectedCheckIdsForScope(null, ["people-and-control"])).toEqual([]);
  });
});

describe("mergeScopedFollowUpChecks", () => {
  it("preserves completed checks the narrow follow-up never assessed", () => {
    // This is the @matetokay regression: a scoped identity follow-up returned a
    // dossier in which adverse-screen was unavailable and the founder asset and
    // repeat-backing checks had not run at all.
    const result = merge({
      sourceChecks: [
        check({ checkId: "adverse-screen", status: "checked-empty", note: "No adverse media found." }),
        check({ checkId: "founder-asset-distinction", status: "confirmed" }),
        check({ checkId: "founder-repeat-backing", status: "reported" }),
        check({ checkId: "founder-identity", status: "unavailable" }),
      ],
      freshChecks: [
        check({ checkId: "adverse-screen", status: "unavailable", provider: "retry", completedAt: NOW }),
        check({ checkId: "founder-asset-distinction", status: "unknown", provider: "retry", completedAt: NOW }),
        check({ checkId: "founder-repeat-backing", status: "unknown", provider: "retry", completedAt: NOW }),
        check({ checkId: "founder-identity", status: "unavailable", provider: "retry", completedAt: NOW }),
      ],
      selectedCheckIds: ["founder-identity"],
    });

    expect(merged(result, "adverse-screen")?.status).toBe("checked-empty");
    expect(merged(result, "founder-asset-distinction")?.status).toBe("confirmed");
    expect(merged(result, "founder-repeat-backing")?.status).toBe("reported");
    expect(result.summary.carriedForward).toBe(3);
    expect(result.summary.stillOpen).toBe(1);
  });

  it("keeps the original observation time, provider and source version on carried rows", () => {
    const result = merge({
      sourceChecks: [check({ checkId: "adverse-screen", status: "checked-empty" })],
      freshChecks: [check({ checkId: "adverse-screen", status: "unknown", provider: "retry", completedAt: NOW })],
      selectedCheckIds: ["founder-identity"],
    });

    const carried = merged(result, "adverse-screen");
    expect(carried?.completedAt).toBe(SOURCE_FROZEN_AT);
    expect(carried?.provider).toBe("source-provider");
    expect(carried?.carriedForward).toMatchObject({
      sourceReportVersionId: SOURCE_VERSION,
      observedAt: SOURCE_FROZEN_AT,
      reason: "not_selected",
    });
    expect(row(result, "adverse-screen")?.carried).toBe(true);
  });

  it("records a recovered check as freshly measured, not carried", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "founder-identity", status: "unavailable" }),
        check({ checkId: "adverse-screen", status: "checked-empty" }),
      ],
      freshChecks: [check({ checkId: "founder-identity", status: "confirmed", provider: "retry", completedAt: NOW })],
      selectedCheckIds: ["founder-identity"],
    });

    expect(row(result, "founder-identity")?.disposition).toBe("recovered");
    expect(merged(result, "founder-identity")?.carriedForward).toBeUndefined();
    expect(merged(result, "founder-identity")?.completedAt).toBe(NOW);
    expect(result.summary.recovered).toBe(1);
  });

  it("resolves one selected check while another stays unavailable", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "founder-identity", status: "unavailable" }),
        check({ checkId: "founder-relationships", status: "unavailable" }),
      ],
      freshChecks: [
        check({ checkId: "founder-identity", status: "confirmed", completedAt: NOW }),
        check({ checkId: "founder-relationships", status: "unavailable", completedAt: NOW }),
      ],
      selectedCheckIds: ["founder-identity", "founder-relationships"],
    });

    expect(result.summary.recovered).toBe(1);
    expect(result.summary.stillOpen).toBe(1);
    expect(row(result, "founder-relationships")?.disposition).toBe("still_open");
  });

  it("carries evidence a selected retry failed to reproduce and flags the regression", () => {
    const result = merge({
      sourceChecks: [check({ checkId: "adverse-screen", status: "checked-empty" })],
      freshChecks: [check({ checkId: "adverse-screen", status: "unavailable", completedAt: NOW })],
      selectedCheckIds: ["adverse-screen"],
    });

    expect(merged(result, "adverse-screen")?.status).toBe("checked-empty");
    expect(merged(result, "adverse-screen")?.carriedForward?.reason).toBe("retry_did_not_reproduce");
    expect(result.summary.retryRegressed).toBe(1);
  });

  it("qualifies carried evidence that is outside its freshness window", () => {
    const result = merge({
      sourceChecks: [check({
        checkId: "adverse-screen",
        status: "checked-empty",
        completedAt: "2026-01-01T00:00:00.000Z",
      })],
      freshChecks: [],
      selectedCheckIds: ["founder-identity"],
      freshnessHorizonDays: 90,
    });

    expect(merged(result, "adverse-screen")?.status).toBe("stale");
    expect(merged(result, "adverse-screen")?.carriedForward?.observedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(result.summary.carriedStale).toBe(1);
  });

  it("keeps a not-applicable determination instead of reopening it", () => {
    const result = merge({
      sourceChecks: [check({ checkId: "token-conduct", status: "not-applicable" })],
      freshChecks: [check({ checkId: "token-conduct", status: "unknown", completedAt: NOW })],
      selectedCheckIds: [],
    });

    expect(merged(result, "token-conduct")?.status).toBe("not-applicable");
    expect(result.summary.notApplicable).toBe(1);
  });

  it("treats a check only the fresh run produced as newly measured", () => {
    const result = merge({
      sourceChecks: [],
      freshChecks: [check({ checkId: "new-signal", status: "confirmed", completedAt: NOW })],
      selectedCheckIds: ["new-signal"],
    });

    expect(row(result, "new-signal")?.disposition).toBe("newly_measured");
    expect(result.summary.newlyMeasured).toBe(1);
  });

  it("matches legacy rows without a checkId by label", () => {
    const result = merge({
      sourceChecks: [{ label: "Adverse media screen", status: "checked-empty", completedAt: SOURCE_FROZEN_AT }],
      freshChecks: [{ label: "Adverse media screen", status: "unknown", completedAt: NOW }],
      selectedCheckIds: [],
    });

    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].status).toBe("checked-empty");
    expect(result.summary.carriedForward).toBe(1);
  });

  it("does not carry an outcome the source version never had", () => {
    const result = merge({
      sourceChecks: [check({ checkId: "founder-legal", status: "unavailable" })],
      freshChecks: [],
      selectedCheckIds: [],
    });

    expect(merged(result, "founder-legal")?.status).toBe("unavailable");
    expect(merged(result, "founder-legal")?.carriedForward).toBeUndefined();
    expect(result.summary.notSelectedOpen).toBe(1);
  });
});

describe("scopedFollowUpPromotionBlocks", () => {
  it("blocks promotion while carried evidence sits outside the fresh score", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "adverse-screen", status: "checked-empty" }),
        check({ checkId: "founder-identity", status: "unavailable" }),
      ],
      freshChecks: [check({ checkId: "founder-identity", status: "confirmed", completedAt: NOW })],
      selectedCheckIds: ["founder-identity"],
    });

    expect(result.scoreBasis).toBe("fresh_scope_only");
    const codes = scopedFollowUpPromotionBlocks(result).map((block) => block.code);
    expect(codes).toContain("carried_evidence_not_rescored");
  });

  it("blocks a follow-up that recovered nothing", () => {
    const result = merge({
      sourceChecks: [check({ checkId: "founder-identity", status: "unavailable" })],
      freshChecks: [check({ checkId: "founder-identity", status: "unavailable", completedAt: NOW })],
      selectedCheckIds: ["founder-identity"],
    });

    expect(scopedFollowUpPromotionBlocks(result).map((block) => block.code)).toContain("no_progress");
  });

  it("allows promotion when the retry covered every check the source held", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "founder-identity", status: "unavailable" }),
        check({ checkId: "adverse-screen", status: "checked-empty" }),
      ],
      freshChecks: [
        check({ checkId: "founder-identity", status: "confirmed", completedAt: NOW }),
        check({ checkId: "adverse-screen", status: "checked-empty", completedAt: NOW }),
      ],
      selectedCheckIds: ["founder-identity", "adverse-screen"],
    });

    expect(result.scoreBasis).toBe("fresh_covers_merged_evidence");
    expect(scopedFollowUpPromotionBlocks(result)).toEqual([]);
  });

  it("does not count a carried non-critical row against the score basis", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "founder-identity", status: "unavailable" }),
        check({ checkId: "enrichment", status: "confirmed", decisionCritical: false }),
      ],
      freshChecks: [check({ checkId: "founder-identity", status: "confirmed", completedAt: NOW })],
      selectedCheckIds: ["founder-identity"],
    });

    expect(result.summary.carriedForward).toBe(1);
    expect(result.scoreBasis).toBe("fresh_covers_merged_evidence");
    expect(scopedFollowUpPromotionBlocks(result)).toEqual([]);
  });
});

describe("scopedFollowUpComparison", () => {
  it("separates recovered, carried, still open and regressed areas for review", () => {
    const result = merge({
      sourceChecks: [
        check({ checkId: "founder-identity", status: "unavailable", label: "Founder identity" }),
        check({ checkId: "founder-relationships", status: "unavailable", label: "Founder relationships" }),
        check({ checkId: "adverse-screen", status: "checked-empty", label: "Adverse screen" }),
        check({ checkId: "founder-legal", status: "confirmed", label: "Founder legal" }),
      ],
      freshChecks: [
        check({ checkId: "founder-identity", status: "confirmed", label: "Founder identity", completedAt: NOW }),
        check({ checkId: "founder-relationships", status: "unavailable", label: "Founder relationships", completedAt: NOW }),
        check({ checkId: "founder-legal", status: "unavailable", label: "Founder legal", completedAt: NOW }),
      ],
      selectedCheckIds: ["founder-identity", "founder-relationships", "founder-legal"],
    });
    const comparison = scopedFollowUpComparison(result);

    expect(comparison.areas.recovered).toEqual(["Founder identity"]);
    expect(comparison.areas.stillOpen).toEqual(["Founder relationships"]);
    expect(comparison.areas.retryRegressed).toEqual(["Founder legal"]);
    expect(comparison.areas.carried).toEqual(["Adverse screen"]);
    expect(comparison.promotable).toBe(false);
    expect(comparison.sourceReportVersionId).toBe(SOURCE_VERSION);
  });
});
