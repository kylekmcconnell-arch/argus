export type EyeEvaluationBasis = "cited_evidence" | "project_attribution" | "coverage_record" | "not_established";

export interface EyeCorpusExpectation {
  route: { intent: string; reasoningMode: string };
  allowedEntityKeys: string[];
  allowedEvidenceRefs: string[];
  allowedCitationUrls: string[];
  allowedContradictionIds: string[];
  maximumBasis: EyeEvaluationBasis;
  mustMention: string[];
  forbiddenClaims: string[];
}

export interface EyeReplayAnswer {
  route: { intent: string; reasoningMode: string };
  entityKeys: string[];
  evidenceRefs: string[];
  citationUrls: string[];
  contradictionIds: string[];
  basis: EyeEvaluationBasis;
  answer: string;
}

export interface EyeEvaluationFailure {
  rule: "route" | "entity_invention" | "unsupported_path" | "false_contradiction" | "citation_posture" | "answer_strength" | "must_mention" | "forbidden_claim";
  detail: string;
}

const BASIS_STRENGTH: Record<EyeEvaluationBasis, number> = {
  not_established: 0,
  coverage_record: 1,
  project_attribution: 2,
  cited_evidence: 3,
};

const outside = (actual: string[], allowed: string[]) => actual.filter((value) => !allowed.includes(value));

/** Deterministic, provider-free grading of a recorded Eye answer. */
export function evaluateEyeReplay(expected: EyeCorpusExpectation, actual: EyeReplayAnswer): EyeEvaluationFailure[] {
  const failures: EyeEvaluationFailure[] = [];
  if (actual.route.intent !== expected.route.intent || actual.route.reasoningMode !== expected.route.reasoningMode) {
    failures.push({ rule: "route", detail: `expected ${expected.route.intent}/${expected.route.reasoningMode}, received ${actual.route.intent}/${actual.route.reasoningMode}` });
  }
  for (const key of outside(actual.entityKeys, expected.allowedEntityKeys)) {
    failures.push({ rule: "entity_invention", detail: key });
  }
  for (const ref of outside(actual.evidenceRefs, expected.allowedEvidenceRefs)) {
    failures.push({ rule: "unsupported_path", detail: ref });
  }
  for (const id of outside(actual.contradictionIds, expected.allowedContradictionIds)) {
    failures.push({ rule: "false_contradiction", detail: id });
  }
  for (const url of outside(actual.citationUrls, expected.allowedCitationUrls)) {
    failures.push({ rule: "citation_posture", detail: url });
  }
  if (actual.basis === "cited_evidence" && actual.citationUrls.length === 0) {
    failures.push({ rule: "citation_posture", detail: "cited_evidence has no citation" });
  }
  if (BASIS_STRENGTH[actual.basis] > BASIS_STRENGTH[expected.maximumBasis]) {
    failures.push({ rule: "answer_strength", detail: `${actual.basis} exceeds ${expected.maximumBasis}` });
  }
  const answer = actual.answer.toLocaleLowerCase();
  for (const phrase of expected.mustMention) {
    if (!answer.includes(phrase.toLocaleLowerCase())) failures.push({ rule: "must_mention", detail: phrase });
  }
  for (const phrase of expected.forbiddenClaims) {
    if (answer.includes(phrase.toLocaleLowerCase())) failures.push({ rule: "forbidden_claim", detail: phrase });
  }
  return failures;
}
