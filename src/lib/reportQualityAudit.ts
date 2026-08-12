export type ReportQualitySeverity = "error" | "warning";

export interface ReportQualityExpectation {
  verdictIn?: string[];
  scoreMin?: number;
  scoreMax?: number;
  minVerifiedFacts?: number;
  neverIncomplete?: boolean;
  expectedRole?: string;
  mustSurface?: string[];
  mustNotAppear?: string[];
}

export interface StoredReportQualityInput {
  kind: string;
  ref: string;
  query: string;
  version: number;
  verdict: string | null;
  score: number | null;
  completeness: string | null;
  attestation: string | null;
  createdAt: string | null;
  payload: unknown;
}

export interface ReportQualityFinding {
  severity: ReportQualitySeverity;
  code: string;
  message: string;
}

export interface ReportQualityResult {
  subject: string;
  version: number;
  findings: ReportQualityFinding[];
  errorCount: number;
  warningCount: number;
}

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const numeric = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const finding = (
  severity: ReportQualitySeverity,
  code: string,
  message: string,
): ReportQualityFinding => ({ severity, code, message });

const isActionableSource = (value: unknown): boolean => {
  const source = text(value);
  if (!source) return false;
  try {
    const parsed = new URL(source);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (!host) return false;
    if (
      (host === "google.com" || host === "bing.com" || host === "duckduckgo.com")
      && /\/search|\/html/i.test(parsed.pathname)
    ) return false;
    return true;
  } catch {
    return false;
  }
};

const directSubjectFinding = (value: JsonRecord): boolean => {
  const scope = record(value.finding_scope);
  if (!Object.keys(scope).length) return true;
  const targetScope = text(scope.scope);
  const relationship = text(scope.relationship_to_subject);
  return targetScope === "direct_subject" || relationship === "self";
};

const reportObject = (kind: string, payload: JsonRecord): JsonRecord => {
  if (kind === "investigation") return record(record(payload.token).report);
  return record(payload.report);
};

const identityContamination = (value: JsonRecord): boolean => {
  const combined = `${text(value.claim)} ${text(value.conflict)}`.toLowerCase();
  const entityMismatch = /\b(?:wrong entity|unrelated (?:company|entity|project)|different (?:company|entity|project)|belongs to (?:an?|the) (?:unrelated|different)|not (?:the|this) (?:audited )?(?:company|entity|project)|returned .* data, not|attributed to the wrong entity)\b/.test(combined);
  const materialIdentityField = /\b(?:funding|leadership|founder|team|identity|company|venture|source url|domain)\b/.test(combined);
  return entityMismatch && materialIdentityField;
};

function expectationFindings(
  input: StoredReportQualityInput,
  report: JsonRecord,
  payloadText: string,
  expectation: ReportQualityExpectation | undefined,
): ReportQualityFinding[] {
  if (!expectation) return [];
  const findings: ReportQualityFinding[] = [];
  const verdict = text(report.composite_verdict) || text(input.verdict);
  const score = numeric(report.governing_score) ?? input.score;
  const role = text(report.governing_role);
  if (expectation.neverIncomplete && verdict === "INCOMPLETE") {
    findings.push(finding("error", "expected_decision_missing", "Known subject returned INCOMPLETE."));
  }
  if (expectation.expectedRole && role && role !== expectation.expectedRole) {
    findings.push(finding(
      "error",
      "governing_role_mismatch",
      `Governing role ${role} does not match expected ${expectation.expectedRole}.`,
    ));
  }
  if (expectation.verdictIn?.length && (!verdict || !expectation.verdictIn.includes(verdict))) {
    findings.push(finding(
      "error",
      "verdict_outside_expectation",
      `Verdict ${verdict || "missing"} is outside [${expectation.verdictIn.join(", ")}].`,
    ));
  }
  if (expectation.scoreMin !== undefined && (score === null || score < expectation.scoreMin)) {
    findings.push(finding(
      "error",
      "score_below_expectation",
      `Score ${score ?? "missing"} is below ${expectation.scoreMin}.`,
    ));
  }
  if (expectation.scoreMax !== undefined && score !== null && score > expectation.scoreMax) {
    findings.push(finding(
      "error",
      "score_above_expectation",
      `Score ${score} is above ${expectation.scoreMax}.`,
    ));
  }
  for (const pattern of expectation.mustSurface ?? []) {
    if (!new RegExp(pattern, "i").test(payloadText)) {
      findings.push(finding("error", "required_finding_missing", `Report does not surface /${pattern}/i.`));
    }
  }
  for (const pattern of expectation.mustNotAppear ?? []) {
    if (new RegExp(pattern, "i").test(payloadText)) {
      findings.push(finding("error", "forbidden_attribution_present", `Report contains forbidden /${pattern}/i.`));
    }
  }
  const verifiedFacts = array(record(input.payload).basicFacts).filter((value) => {
    const status = text(record(value).status);
    return status === "verified" || status === "corroborated";
  }).length;
  if (
    expectation.minVerifiedFacts !== undefined
    && input.attestation === "server_collected"
    && verifiedFacts < expectation.minVerifiedFacts
  ) {
    findings.push(finding(
      "error",
      "verified_fact_floor_missed",
      `Verified fact count ${verifiedFacts} is below ${expectation.minVerifiedFacts}.`,
    ));
  }
  return findings;
}

export function auditStoredReportQuality(
  input: StoredReportQualityInput,
  expectation?: ReportQualityExpectation,
): ReportQualityResult {
  const findings: ReportQualityFinding[] = [];
  const payload = record(input.payload);
  const report = reportObject(input.kind, payload);
  const subject = input.query || input.ref;
  const payloadText = JSON.stringify(payload);

  if (!Object.keys(payload).length) {
    findings.push(finding("error", "payload_missing", "Immutable report payload is missing."));
  }
  if (input.kind === "person" && input.attestation === "server_collected" && !Object.keys(report).length) {
    findings.push(finding("error", "decision_report_missing", "Server-collected person report has no decision report."));
  }

  const reportVerdict = text(report.composite_verdict) || text(report.verdict);
  const reportScore = numeric(report.governing_score) ?? numeric(report.score_total);
  if (reportVerdict && input.verdict && reportVerdict !== input.verdict) {
    findings.push(finding(
      "error",
      "stored_verdict_mismatch",
      `Stored verdict ${input.verdict} differs from payload verdict ${reportVerdict}.`,
    ));
  }
  if (reportScore !== null && input.score !== null && reportScore !== input.score) {
    findings.push(finding(
      "error",
      "stored_score_mismatch",
      `Stored score ${input.score} differs from payload score ${reportScore}.`,
    ));
  }

  const finalizedAt = text(report.finalized_at);
  if (finalizedAt) {
    const finalizedMs = Date.parse(finalizedAt);
    const createdMs = input.createdAt ? Date.parse(input.createdAt) : Number.NaN;
    if (!Number.isFinite(finalizedMs)) {
      findings.push(finding("error", "invalid_finalized_at", `Invalid finalized_at value ${finalizedAt}.`));
    } else if (
      input.attestation === "server_collected"
      && (finalizedMs < Date.UTC(2020, 0, 1)
        || (Number.isFinite(createdMs) && finalizedMs > createdMs + 60 * 60 * 1000))
    ) {
      findings.push(finding(
        payload.axisCitationVersion === 1 ? "error" : "warning",
        "impossible_finalized_at",
        `finalized_at ${finalizedAt} is inconsistent with immutable version creation.`,
      ));
    }
  }

  for (const raw of array(payload.contradictions)) {
    const contradiction = record(raw);
    if (
      text(contradiction.severity) === "high"
      && text(contradiction.confidence) === "high"
      && identityContamination(contradiction)
    ) {
      findings.push(finding(
        "error",
        "identity_contamination",
        `High-confidence entity mismatch: ${text(contradiction.conflict).slice(0, 240)}`,
      ));
    }
  }

  for (const raw of array(report.publishable_findings)) {
    const published = record(raw);
    const eligible = text(published.evidence_origin) !== "model_lead"
      && published.artifact_verified !== false
      && numeric(published.independent_source_count) !== null
      && (numeric(published.independent_source_count) ?? 0) >= 1
      && ["Verified", "Reported"].includes(text(published.verification_status))
      && directSubjectFinding(published);
    if (!eligible) {
      findings.push(finding(
        "error",
        "unpublishable_finding_published",
        `Published finding is not verified direct-subject evidence: ${text(published.claim).slice(0, 180)}`,
      ));
    }
  }

  const leads = array(report.investigative_leads).map(record);
  const unactionableLeads = leads.filter((lead) =>
    !isActionableSource(lead.source_url) && !text(lead.content_hash));
  if (unactionableLeads.length) {
    findings.push(finding(
      "warning",
      "unactionable_investigative_leads",
      `${unactionableLeads.length} investigative lead${unactionableLeads.length === 1 ? "" : "s"} lack a direct source.`,
    ));
  }
  if (leads.length > 8) {
    findings.push(finding(
      "warning",
      "investigative_lead_overload",
      `${leads.length} unverified leads overwhelm the decision report.`,
    ));
  }

  for (const raw of array(payload.basicFacts)) {
    const fact = record(raw);
    const status = text(fact.status);
    if (status !== "verified" && status !== "corroborated") continue;
    const sources = array(fact.sources).map(record);
    const label = `${text(fact.predicate) || "fact"}: ${text(fact.value).slice(0, 120)}`;
    if (!sources.length || sources.every((source) => !isActionableSource(source.url))) {
      findings.push(finding("error", "verified_fact_without_source", `Verified ${label} has no direct source.`));
    }
    if (sources.some((source) => source.artifactVerified === false)) {
      findings.push(finding("error", "unverified_artifact_in_fact", `Verified ${label} contains an unverified artifact.`));
    }
    if (
      text(fact.predicate) === "funding"
      && fact.floorEligible !== false
      && sources.length > 0
      && sources.every((source) =>
        ["defillama", "monid"].includes(text(source.provider))
        && text(source.sourceClass) === "other_public")
    ) {
      findings.push(finding(
        "error",
        "aggregator_funding_can_lift_score",
        `Aggregator-only ${label} is eligible to lift a score floor without first-party or independent corroboration.`,
      ));
    }
  }

  for (const rawRole of array(report.role_reports)) {
    const role = record(rawRole);
    for (const [axisName, rawAxis] of Object.entries(record(role.axes))) {
      const axis = record(rawAxis);
      const axisScore = numeric(axis.score) ?? 0;
      const axisWeight = numeric(axis.weight) ?? 0;
      const refs = [...array(axis.evidenceRefs), ...array(axis.counterEvidenceRefs)].filter((value) => text(value));
      if (axisWeight > 0 && axisScore / axisWeight >= 0.4 && refs.length === 0) {
        findings.push(finding(
          "error",
          "material_axis_without_lineage",
          `${axisName} scores ${axisScore}/${axisWeight} without evidence references.`,
        ));
      }
    }
  }

  if (
    input.kind === "person"
    && input.attestation === "server_collected"
    && reportVerdict !== "INCOMPLETE"
    && payload.axisCitationVersion !== 1
  ) {
    findings.push(finding(
      "warning",
      "legacy_axis_lineage",
      "Decision predates strict frozen axis-citation lineage.",
    ));
  }

  findings.push(...expectationFindings(input, report, payloadText, expectation));
  return {
    subject,
    version: input.version,
    findings,
    errorCount: findings.filter((item) => item.severity === "error").length,
    warningCount: findings.filter((item) => item.severity === "warning").length,
  };
}
