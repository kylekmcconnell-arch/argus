import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact } from "../data/evidence";
import { SubjectClass } from "../engine/taxonomy";
import { Audit } from "../engine/audit";
import { deriveProjectDiligenceContext } from "./projectDiligenceContext";

const at = "2026-09-23T12:00:00Z";
const fact = (predicate: BasicFact["predicate"], value: string): BasicFact => ({
  factId: predicate, subjectKey: "@fixture", predicate, value, normalizedValue: value.toLowerCase(), status: "verified", critical: false,
  artifact_verified: true, evidence_origin: "deterministic", provider: "public-web",
  sources: [{ url: "https://fixture.example/about", title: "Official disclosure", excerpt: value, sourceClass: "official_subject", relation: "supports", artifactVerified: true, contentHash: "a".repeat(64), provider: "site-fetch", capturedAt: at }],
});
const fixture = () => {
  const evidence = emptyEvidence("@fixture");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.basicFacts = [fact("tokenomics", "Our token was fair launched on Pump.fun."), fact("product", "Our platform is not yet live and is in development.")];
  return evidence;
};
describe("contextual project diligence", () => {
  it("removes optional fair-launch financing and defers production usage without waiving token safety", () => {
    const context = deriveProjectDiligenceContext(fixture(), at);
    expect(Object.keys(context.axes)).toEqual(["P4_backing_and_partners", "P5_traction_and_liveness"]);
    expect(context.optionalQuestions).toContain("treasury");
    expect(context.optionalQuestions).not.toContain("control");
    expect(context.optionalQuestions).not.toContain("security_incident");
    const audit = new Audit("@fixture", { subject_class: SubjectClass.PROJECT });
    audit.projectAxisTreatments = context.axes;
    for (const axis of ["P1_team_and_identity", "P2_product_substance", "P3_token_conduct", "P6_transparency_integrity"]) audit.setAxis(axis, 0.7 * ({ P1_team_and_identity: 16, P2_product_substance: 24, P3_token_conduct: 20, P6_transparency_integrity: 12 }[axis] ?? 0));
    const result = audit.finalize().role_reports[0];
    expect(result.applicable_weight).toBe(72);
    expect(result.score_total).toBe(70);
    expect(result.score_coverage?.provisional).toBe(false);
  });
  it("reactivates financing when a fair launch later raises and usage when a product is live", () => {
    const evidence = fixture();
    evidence.basicFacts!.push(fact("funding", "$2 million seed round"), fact("product", "Our platform is live on mainnet and accepts deposits."));
    const context = deriveProjectDiligenceContext(evidence, at);
    expect(context.axes).toEqual({});
    expect(context.optionalQuestions).not.toContain("funding");
  });
  it("does not exempt beta products with user funds or infer fair launch from the account bio", () => {
    const evidence = fixture();
    evidence.profile.bio = "A fair launch meme";
    evidence.basicFacts = [fact("product", "The beta platform accepts deposits.")];
    expect(deriveProjectDiligenceContext(evidence, at).axes).toEqual({});
  });
  it.each(["model_lead", "wrong_subject", "unfetched", "negated"])("does not route exemptions from %s", (mode) => {
    const evidence = fixture();
    evidence.basicFacts = [fact("tokenomics", mode === "negated" ? "This is not a fair launch." : "Our token was fair launched.")];
    if (mode === "model_lead") Object.assign(evidence.basicFacts[0], { evidence_origin: "model_lead" });
    if (mode === "wrong_subject") evidence.basicFacts[0].subjectKey = "@unrelated";
    if (mode === "unfetched") Object.assign(evidence.basicFacts[0], { artifact_verified: false });
    expect(deriveProjectDiligenceContext(evidence, at).axes).toEqual({});
  });
  it("never infers no vesting from equal market cap and FDV", () => {
    const evidence = fixture();
    evidence.basicFacts!.push(fact("vesting", "Founder tokens are locked until 2028."));
    expect(deriveProjectDiligenceContext(evidence, at).optionalQuestions).not.toContain("vesting");
  });
});

it("attaches applicability evidence to optional questions rather than labelling them critical gaps", async () => {
  const { buildPointInTimeIntelligence } = await import("../intelligence/buildPointInTimeIntelligence");
  const evidence = fixture();
  evidence.basicFactQuestionLedger = [{ questionId: "project.funding", audience: "project", predicate: "funding", batch: "track_record", question: "What funding rounds are published?", critical: true, status: "unanswered", answerRefs: [], providerRuns: [{ provider: "grounded", phase: "primary", state: "partial" }] }];
  const question = buildPointInTimeIntelligence(evidence)?.questions.find((row) => row.id === "project.funding");
  expect(question).toMatchObject({ state: "not_applicable", materiality: "context" });
  expect(question?.sourceRefs.length).toBeGreaterThan(0);
});

it("does not waive requirements from unresolved stage claims or hide unresolved backing evidence", () => {
  const evidence = fixture();
  evidence.basicFacts![0].status = "unresolved";
  expect(deriveProjectDiligenceContext(evidence, at).launch).toBe("unknown");
  evidence.basicFacts![0].status = "verified";
  const backing = fact("investor", "An attributed backer needing confirmation");
  backing.status = "unresolved";
  evidence.basicFacts!.push(backing);
  expect(deriveProjectDiligenceContext(evidence, at).axes.P4_backing_and_partners).toBeUndefined();
});

it("applies optional disclosure policy to fallback questions without a saved ledger", async () => {
  const { buildPointInTimeIntelligence } = await import("../intelligence/buildPointInTimeIntelligence");
  const snapshot = buildPointInTimeIntelligence(fixture());
  expect(snapshot?.questions.find((row) => row.id === "project.treasury")).toMatchObject({ state: "not_applicable", materiality: "context" });
});
