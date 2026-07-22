import { afterEach, describe, expect, it, vi } from "vitest";
import { auditReadinessLabel, hasCoverageGap, presentedAuditVerdict, reconcileAuditOutcome } from "./auditlog";

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

describe("reconcileAuditOutcome (chip vs active-report truth)", () => {
  const seed = () => [
    // newest-first, mirroring the real log: last RUN logged 80 · provisional...
    { id: "b", ts: 2, kind: "person", query: "@stanikulechov", ref: "@stanikulechov", verdict: "PASS", score: 80, coverage: "provisional", summary: "old run" },
    // ...an older historical row that must NOT be rewritten...
    { id: "a", ts: 1, kind: "person", query: "@stanikulechov", ref: "@stanikulechov", verdict: "PASS", score: 78, coverage: "partial", summary: "older" },
    // ...and an unrelated subject.
    { id: "c", ts: 3, kind: "person", query: "@other", ref: "@other", verdict: "PASS", score: 60, coverage: "partial", summary: "other" },
  ];
  const stubStorage = () => {
    const store = new Map<string, string>([["argus:auditlog", JSON.stringify(seed())]]);
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    vi.stubGlobal("localStorage", fake);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    return store;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("rewrites only the NEWEST matching row to the active stored outcome", () => {
    const store = stubStorage();
    reconcileAuditOutcome("@stanikulechov", "person", { verdict: "PASS", score: 82, coverage: "complete" });
    const rows = JSON.parse(store.get("argus:auditlog")!) as Array<{ id: string; score: number; coverage: string }>;
    expect(rows.find((r) => r.id === "b")).toMatchObject({ score: 82, coverage: "complete" });
    // History and other subjects untouched.
    expect(rows.find((r) => r.id === "a")).toMatchObject({ score: 78, coverage: "partial" });
    expect(rows.find((r) => r.id === "c")).toMatchObject({ score: 60 });
  });

  it("is a no-op when the newest row already matches the stored outcome", () => {
    const store = stubStorage();
    const before = store.get("argus:auditlog");
    reconcileAuditOutcome("@stanikulechov", "person", { verdict: "PASS", score: 80, coverage: "provisional" });
    expect(store.get("argus:auditlog")).toBe(before);
  });
});
