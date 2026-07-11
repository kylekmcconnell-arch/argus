import { describe, expect, it } from "vitest";
import { auditReadinessLabel, hasCoverageGap, presentedAuditVerdict } from "./auditlog";

describe("audit-list verdict presentation", () => {
  it.each([undefined, "partial", "incomplete", "failed"])(
    "does not present a PASS as clearance when coverage is %s",
    (coverage) => {
      expect(presentedAuditVerdict({ verdict: "PASS", coverage })).toBe("INCOMPLETE");
    },
  );

  it.each(["ready", "complete", "rendered", "recovered"])(
    "preserves PASS when coverage is explicitly %s",
    (coverage) => {
      expect(presentedAuditVerdict({ verdict: "PASS", coverage })).toBe("PASS");
    },
  );

  it("labels substantial but unfinished coverage as provisional", () => {
    expect(auditReadinessLabel({ verdict: "PASS", coverage: "provisional" })).toBe("PROVISIONAL");
  });

  it.each(["CAUTION", "FAIL", "AVOID"])(
    "never hides an existing %s risk finding behind incomplete coverage",
    (verdict) => {
      expect(presentedAuditVerdict({ verdict, coverage: "incomplete" })).toBe(verdict);
    },
  );

  it("counts missing person/token coverage as a gap without reclassifying site reports", () => {
    expect(hasCoverageGap({ kind: "person", verdict: "PASS" })).toBe(true);
    expect(hasCoverageGap({ kind: "token", verdict: "FAIL", coverage: "partial" })).toBe(true);
    expect(hasCoverageGap({ kind: "person", verdict: "PASS", coverage: "ready" })).toBe(false);
    expect(hasCoverageGap({ kind: "site", verdict: "PASS", coverage: "rendered" })).toBe(false);
  });
});
