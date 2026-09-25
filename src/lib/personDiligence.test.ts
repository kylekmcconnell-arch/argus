import { describe, expect, it } from "vitest";
import { personLenses, personRelationshipGraph } from "./personDiligence";
import type { Dossier } from "../data/dossier";
const base = { handle: "example", report: { roles: ["FOUNDER"] }, evidence: { ventures: [] }, basicFacts: [] } as unknown as Dossier;
describe("role-aware person evidence model", () => {
  it("distinguishes a coding founder from an investor and does not infer engineering from a weak GitHub guess", () => {
    expect(personLenses(base)).toEqual(["founder"]);
    expect(personLenses({ ...base, githubAssessment: { confidence: "gold" } as Dossier["githubAssessment"] })).toEqual(["founder", "engineer"]);
    expect(personLenses({ ...base, report: { ...base.report, roles: ["INVESTOR"] } })).toEqual(["investor"]);
    expect(personLenses({ ...base, githubAssessment: { confidence: "weak" } as Dossier["githubAssessment"] })).toEqual(["founder"]);
  });
  it("does not turn name-only relationship facts into shared identity keys", () => {
    const fact = { factId: "collaboration:1", predicate: "partnership", value: "Sam Example", status: "verified", evidence_origin: "deterministic", artifact_verified: true, sources: [{ url: "https://example.com/team", artifactVerified: true, excerpt: "Example co-founded Acme with Sam Example.", capturedAt: "2026-09-25" }] } as Dossier["basicFacts"] extends Array<infer T> | undefined ? T : never;
    const dossier = { ...base, basicFacts: [fact] };
    expect(personRelationshipGraph(dossier)).toEqual([]);
    expect(personRelationshipGraph({ ...dossier, identity_binding: "independent_exact_handle" })[0]).toMatchObject({ targetKey: "unresolved:collaboration:1", relation: "collaboration" });
  });
});
