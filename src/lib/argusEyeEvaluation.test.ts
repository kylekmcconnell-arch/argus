import { describe, expect, it } from "vitest";
import { evaluateEyeReplay, type EyeCorpusExpectation, type EyeReplayAnswer } from "./argusEyeEvaluation";

const expected: EyeCorpusExpectation = {
  route: { intent: "connections", reasoningMode: "trace" },
  allowedEntityKeys: ["person:alice", "company:acme"],
  allowedEvidenceRefs: ["edge:alice-acme"],
  allowedCitationUrls: ["https://example.com/team"],
  allowedContradictionIds: [],
  maximumBasis: "cited_evidence",
  mustMention: ["bounded"],
  forbiddenClaims: ["controls the wallet"],
};

const compliant: EyeReplayAnswer = {
  route: expected.route,
  entityKeys: expected.allowedEntityKeys,
  evidenceRefs: expected.allowedEvidenceRefs,
  citationUrls: expected.allowedCitationUrls,
  contradictionIds: [],
  basis: "cited_evidence",
  answer: "The saved path is bounded to a public team attribution.",
};

describe("offline ARGUS Eye evaluator", () => {
  it("accepts an adjudicated replay", () => expect(evaluateEyeReplay(expected, compliant)).toEqual([]));

  it("hard-fails invention, unsupported paths, false contradictions, and escalation", () => {
    const failures = evaluateEyeReplay({ ...expected, maximumBasis: "coverage_record" }, {
      ...compliant,
      entityKeys: [...compliant.entityKeys, "person:invented"],
      evidenceRefs: [...compliant.evidenceRefs, "edge:invented"],
      contradictionIds: ["contradiction:false"],
      answer: "Alice controls the wallet.",
    });
    expect(failures.map((failure) => failure.rule)).toEqual(expect.arrayContaining([
      "entity_invention", "unsupported_path", "false_contradiction", "answer_strength", "must_mention", "forbidden_claim",
    ]));
  });
});
