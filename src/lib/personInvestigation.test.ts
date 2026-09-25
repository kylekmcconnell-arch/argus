import { expect, it } from "vitest";
import { buildPersonInvestigation } from "./personInvestigation";
import type { BasicFact } from "../data/evidence";
function fact(overrides: Partial<BasicFact> = {}): BasicFact { return { factId: "fact-1", subjectKey: "x:ada", predicate: "current_role", value: "CTO of Example", normalizedValue: "cto", status: "verified", critical: false, evidence_origin: "deterministic", artifact_verified: true, provider: "public-web", sources: [{ url: "https://example.com/team", excerpt: "@ada is CTO", sourceClass: "official_subject", relation: "supports", capturedAt: "2026-09-25T10:00:00Z", contentHash: "a".repeat(64), artifactVerified: true, provider: "web" }], ...overrides }; }
it("preserves pseudonymous contributions without making capture time into employment time", () => {
  const result = buildPersonInvestigation({ handle: "ada" }, [fact()]);
  expect(result.timeline).toHaveLength(1); expect(result.timeline[0].period).toContain("not established");
  expect(result.timeline[0].recordedAt).toBe("2026-09-25T10:00:00Z");
});
it("prioritizes contradictions and retains counter-evidence", () => {
  const f = fact({ status: "conflicted" }); f.sources.push({ ...f.sources[0], relation: "contradicts", excerpt: "@ada left Example" });
  const result = buildPersonInvestigation({ handle: "ada" }, [f]);
  expect(result.questions[0].priority).toBe("high"); expect(result.questions[0].factIds).toEqual([f.factId]);
  expect(result.timeline[0].sources).toHaveLength(2);
});
it("rejects unbound namesakes and model-only career claims", () => {
  const unbound = fact(); unbound.sources[0].excerpt = "Another person is CTO";
  expect(buildPersonInvestigation({ handle: "ada" }, [unbound, fact({ subjectKey: "x:other" })]).timeline).toEqual([]);
});
