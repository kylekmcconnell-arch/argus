import { describe, expect, it } from "vitest";
import { headerCaseLabel, publicCaseLabel, reportIdentity } from "./caseLabel";

const SAME_CASE_ID = "aaf133f8-7a13-4df0-ae17-000000000008";
const EXPECTED_CASE_LABEL = "PA-AAF133F87A134DF0AE17";

describe("publicCaseLabel", () => {
  it("formats a case UUID as a PA- label matching existing audit_id style", () => {
    expect(publicCaseLabel(SAME_CASE_ID)).toBe(EXPECTED_CASE_LABEL);
    expect(publicCaseLabel("00000000-0000-4000-8000-000000000101")).toBe("PA-00000000000040008000");
  });

  it("keeps an already-public PA- case id stable", () => {
    expect(publicCaseLabel("PA-42A62AED77094B45AC29")).toBe("PA-42A62AED77094B45AC29");
    expect(publicCaseLabel("pa-42a62aed77094b45ac29")).toBe("PA-42A62AED77094B45AC29");
  });

  it("returns null for missing or non-hex fixture ids", () => {
    expect(publicCaseLabel(undefined)).toBeNull();
    expect(publicCaseLabel("")).toBeNull();
    expect(publicCaseLabel("case-token")).toBeNull();
  });
});

describe("reportIdentity across rescans", () => {
  it("keeps the case label stable from v8 to v9 while report IDs stay unique", () => {
    const v8 = reportIdentity({
      caseId: SAME_CASE_ID,
      auditId: "PA-AAF133F87A134DF0AE17",
    });
    const v9 = reportIdentity({
      caseId: SAME_CASE_ID,
      auditId: "PA-A74E3B463FCB43C89558",
    });

    expect(v8.caseLabel).toBe(EXPECTED_CASE_LABEL);
    expect(v9.caseLabel).toBe(EXPECTED_CASE_LABEL);
    expect(v8.caseLabel).toBe(v9.caseLabel);
    expect(v8.reportId).toBe("PA-AAF133F87A134DF0AE17");
    expect(v9.reportId).toBe("PA-A74E3B463FCB43C89558");
    expect(v8.reportId).not.toBe(v9.reportId);
  });

  it("uses the per-scan audit id only when no saved case exists yet", () => {
    expect(headerCaseLabel({ auditId: "PA-LIVE-SCAN-FINGERPRINT" })).toBe("PA-LIVE-SCAN-FINGERPRINT");
    expect(headerCaseLabel({
      caseId: SAME_CASE_ID,
      auditId: "PA-A74E3B463FCB43C89558",
    })).toBe(EXPECTED_CASE_LABEL);
  });
});
