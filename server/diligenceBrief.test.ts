import { describe, expect, it, vi } from "vitest";
import { collectDiligenceBrief, diligenceSources, validateDiligenceHypotheses } from "./diligenceBrief";
import { emptyEvidence } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import type { DiligenceSource } from "../src/lib/diligenceBrief";
const source: DiligenceSource = { id: "fact:0", factId: "fact", predicate: "product", value: "FHE", status: "verified", url: "https://example.com/docs", excerpt: "Example's protocol computes on encrypted data using FHE.", capturedAt: "2026-09-25T00:00:00Z", contentHash: "hash", relation: "supports", sourceClass: "official_subject" };
const hypothesis = { topic: "advantage", text: "Encrypted computation could support confidential workflows.", sourceIds: [source.id], limitations: "This is a company claim; performance is not independently established.", whatWouldChange: "A reproducible benchmark and documented key-management assumptions." };
describe("bounded diligence synthesis", () => {
  it("rejects invented citations, missing limits and wrong subject methodology", () => {
    expect(validateDiligenceHypotheses({ hypotheses: [{ ...hypothesis, sourceIds: ["invented"] }] }, [source], "company")).toEqual([]);
    expect(validateDiligenceHypotheses({ hypotheses: [{ ...hypothesis, limitations: "" }] }, [source], "company")).toEqual([]);
    expect(validateDiligenceHypotheses({ hypotheses: [hypothesis] }, [source], "person")).toEqual([]);
  });
  it("always labels analysis as a hypothesis and includes known counter-evidence", () => {
    const result = validateDiligenceHypotheses({ hypotheses: [hypothesis] }, [source, { ...source, id: "fact:1", relation: "contradicts", excerpt: "The current release does not implement FHE." }], "company");
    expect(result[0]).toMatchObject({ kind: "analytical_hypothesis", sourceIds: ["fact:0", "fact:1"] });
  });
  it("does not buy analysis without verified sources", async () => {
    const generate = vi.fn();
    const result = await collectDiligenceBrief(emptyEvidence("example"), { available: () => true, generate });
    expect(generate).not.toHaveBeenCalled();
    expect(result.status).toBe("unavailable");
  });
  it("excludes unbound personal history and adverse or wallet evidence from speculative prose", () => {
    const ev = emptyEvidence("example");
    ev.roles = [SubjectClass.FOUNDER];
    ev.basicFacts = [{ factId: "fact", subjectKey: "x:example", predicate: "product", value: "Engine", normalizedValue: "engine", status: "verified", critical: false, sources: [{ ...source, artifactVerified: true, sourceClass: "official_subject", provider: "test" }], evidence_origin: "deterministic", artifact_verified: true, provider: "public-web" }];
    expect(diligenceSources(ev)).toEqual([]);
    ev.profile.identity_binding = "independent_exact_handle";
    expect(diligenceSources(ev)).toHaveLength(1);
    ev.basicFacts[0].predicate = "legal_regulatory_event";
    expect(diligenceSources(ev)).toEqual([]);
    ev.basicFacts[0].predicate = "treasury";
    expect(diligenceSources(ev)).toEqual([]);
  });
});
it("requires relationship or contribution evidence for team hypotheses, not generic product evidence", () => {
  expect(validateDiligenceHypotheses({ hypotheses: [{ ...hypothesis, topic: "team_fit" }] }, [source], "company")).toEqual([]);
  expect(validateDiligenceHypotheses({ hypotheses: [{ ...hypothesis, topic: "team_fit" }] }, [{ ...source, predicate: "track_record" }], "company")).toHaveLength(1);
});
