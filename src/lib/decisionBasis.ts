import type { AxisEvidenceRecord } from "../data/evidence";
import type { AxisScore, RoleReport } from "../engine";

export type DecisionBasisStatus = "grounded" | "partial" | "contested" | "gap";

export interface DecisionBasisRow {
  axis: string;
  score: number;
  weight: number;
  rationale: string;
  support: AxisEvidenceRecord[];
  counter: AxisEvidenceRecord[];
  gapArtifacts: AxisEvidenceRecord[];
  gaps: string[];
  status: DecisionBasisStatus;
}

export interface DecisionBasisModel {
  available: boolean;
  role: string | null;
  rows: DecisionBasisRow[];
  evidenceBacked: number;
  grounded: number;
  partial: number;
  contested: number;
  gaps: number;
}

const EMPTY_MODEL: DecisionBasisModel = {
  available: false,
  role: null,
  rows: [],
  evidenceBacked: 0,
  grounded: 0,
  partial: 0,
  contested: 0,
  gaps: 0,
};

const ARTIFACT_ID = /^art_v1_[a-f0-9]{64}$/;
const VERIFICATION_STATES = new Set<AxisEvidenceRecord["verification"]>([
  "verified",
  "reported",
  "observed",
  "checked_empty",
  "unavailable",
]);

const SUPPORTING_VERIFICATIONS = new Set<AxisEvidenceRecord["verification"]>([
  "verified",
  "reported",
  "observed",
]);

const COUNTER_VERIFICATIONS = new Set<AxisEvidenceRecord["verification"]>([
  "verified",
  "reported",
  "observed",
]);

// A completed clear screen is an observed outcome, not missing coverage. Keep
// it in the frozen catalog for auditability, but never turn it into an investor
// open question. Only genuinely unavailable coverage belongs in gapArtifacts.
const GAP_VERIFICATIONS = new Set<AxisEvidenceRecord["verification"]>(["unavailable"]);

function cleanText(value: unknown, max = 240): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, max) : null;
}

function cleanGaps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const gaps: string[] = [];
  for (const candidate of value) {
    const gap = cleanText(candidate);
    if (!gap || seen.has(gap)) continue;
    seen.add(gap);
    gaps.push(gap);
    if (gaps.length === 6) break;
  }
  return gaps;
}

function cleanRefs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const candidate of value) {
    const ref = cleanText(candidate, 180);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
    if (refs.length === 24) break;
  }
  return refs;
}

function structurallyValid(record: AxisEvidenceRecord): boolean {
  return record.kind === "axis_evidence"
    && ARTIFACT_ID.test(record.artifactId)
    && Boolean(cleanText(record.provider, 100))
    && Boolean(cleanText(record.operation, 100))
    && Boolean(cleanText(record.section, 100))
    && Boolean(cleanText(record.title, 500))
    && /^[a-f0-9]{64}$/i.test(record.contentHash)
    && record.artifactId.slice("art_v1_".length) === record.contentHash.toLowerCase()
    && Array.isArray(record.eligibleAxes)
    && VERIFICATION_STATES.has(record.verification)
    && (record.scope === "direct_subject" || record.scope === "subject_context");
}

function catalogIndex(catalog: readonly AxisEvidenceRecord[]): Map<string, AxisEvidenceRecord> {
  const index = new Map<string, AxisEvidenceRecord>();
  const ambiguous = new Set<string>();
  for (const record of catalog) {
    if (!structurallyValid(record)) continue;
    if (index.has(record.artifactId)) {
      ambiguous.add(record.artifactId);
      continue;
    }
    index.set(record.artifactId, record);
  }
  for (const artifactId of ambiguous) index.delete(artifactId);
  return index;
}

function resolveRefs(
  refs: unknown,
  axis: string,
  index: ReadonlyMap<string, AxisEvidenceRecord>,
  allowed: ReadonlySet<AxisEvidenceRecord["verification"]>,
  excluded = new Set<string>(),
): AxisEvidenceRecord[] {
  return cleanRefs(refs)
    .filter((artifactId) => !excluded.has(artifactId))
    .map((artifactId) => index.get(artifactId))
    .filter((record): record is AxisEvidenceRecord => Boolean(
      record
      && record.eligibleAxes.includes(axis)
      && allowed.has(record.verification),
    ));
}

function statusFor(
  support: readonly AxisEvidenceRecord[],
  counter: readonly AxisEvidenceRecord[],
  gapArtifacts: readonly AxisEvidenceRecord[],
  gaps: readonly string[],
): DecisionBasisStatus {
  if (support.length > 0 && counter.length === 0 && gapArtifacts.length === 0 && gaps.length === 0) return "grounded";
  if (counter.length > 0) return "contested";
  if (support.length > 0) return "partial";
  return "gap";
}

/**
 * Resolve only explicit v1 axis citations. Older reports deliberately return an
 * unavailable model instead of guessing relationships from prose or URLs.
 */
export function buildDecisionBasis(
  roleReport: RoleReport | undefined,
  catalog: readonly AxisEvidenceRecord[] | undefined,
  lineageVersion: number | undefined,
): DecisionBasisModel {
  if (!roleReport || lineageVersion !== 1) return EMPTY_MODEL;

  const index = catalogIndex(catalog ?? []);
  const rows = Object.entries(roleReport.axes).map(([axis, score]: [string, AxisScore]) => {
    const support = resolveRefs(score.evidenceRefs, axis, index, SUPPORTING_VERIFICATIONS);
    const supportIds = new Set(support.map((record) => record.artifactId));
    const gapArtifacts = resolveRefs(score.evidenceRefs, axis, index, GAP_VERIFICATIONS, supportIds);
    const excluded = new Set([...supportIds, ...gapArtifacts.map((record) => record.artifactId)]);
    const counter = resolveRefs(score.counterEvidenceRefs, axis, index, COUNTER_VERIFICATIONS, excluded);
    const gaps = cleanGaps(score.gaps);
    return {
      axis,
      score: score.score,
      weight: score.weight,
      rationale: score.rationale,
      support,
      counter,
      gapArtifacts,
      gaps,
      status: statusFor(support, counter, gapArtifacts, gaps),
    } satisfies DecisionBasisRow;
  });

  return {
    available: true,
    role: roleReport.role,
    rows,
    evidenceBacked: rows.filter((row) => row.support.length > 0).length,
    grounded: rows.filter((row) => row.status === "grounded").length,
    partial: rows.filter((row) => row.status === "partial").length,
    contested: rows.filter((row) => row.status === "contested").length,
    gaps: rows.filter((row) => row.status === "gap").length,
  };
}
