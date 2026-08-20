import type { ProjectStrengthBandRecord } from "../data/evidence";
import type { DecisionBasisRow } from "./decisionBasis";
import {
  evidencePostureForAxisArtifacts,
  type EvidencePosture,
  type EvidencePostureKind,
} from "./evidenceReasoning";

export type AxisEvidenceLimitReason = "open_question" | "source_unavailable" | "origin_shortfall";

export interface AxisEvidenceLimit {
  axis: string;
  title: string;
  detail: string;
  posture: EvidencePosture;
  questionCount: number;
  reason: AxisEvidenceLimitReason;
}

type StrengthBandLookup = Readonly<Record<string, Pick<ProjectStrengthBandRecord, "tier"> | undefined>>;

const CONCRETE_AXIS_GAP_TITLES: Record<string, string> = {
  P1_team_and_identity: "Still needed: independently bound core-team identities and current operating roles.",
  P2_product_substance: "Still needed: independent proof of a live product and recent delivery activity.",
  P3_token_conduct: "Still needed: an official token-to-project binding plus contract, supply, liquidity, and control records.",
  P4_backing_and_partners: "Still needed: counterparty acknowledgment of any named backer or partner.",
  P5_traction_and_liveness: "Still needed: independently measured usage, volume, retention, or customer adoption.",
  P6_transparency_integrity: "Still needed: a legal-operator record plus independent governance, security-review, or public-code proof.",
};

const ORIGIN_SHORTFALL_POSTURES = new Set<EvidencePostureKind>([
  "externally_supported",
  "multi_provider_context",
  "first_party_only",
  "bounded_coverage",
  "single_source_context",
  "unanchored",
]);

const GENERIC_GAP_PATTERNS = [
  /^verified evidence on .+ (?:is|remains) (?:thin|limited|weak|insufficient)\.?$/i,
  /^independent verification (?:is|remains) (?:thin|limited|weak|insufficient)\.?$/i,
  /^(?:source|evidence) support (?:is|remains) (?:thin|limited|weak|insufficient)\.?$/i,
  /^evidence (?:is|remains) (?:thin|limited|weak|missing|insufficient)\.?$/i,
];

function cleanSentence(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function concreteGapTitle(axis: string, gaps: readonly string[]): string {
  const specific = gaps
    .map(cleanSentence)
    .find((gap) => gap.length <= 180 && !GENERIC_GAP_PATTERNS.some((pattern) => pattern.test(gap)));
  if (specific) return specific;
  return CONCRETE_AXIS_GAP_TITLES[axis]
    ?? `Still needed: an independently sourced record for ${axis.replace(/^[A-Z]+\d+[\s_-]*/i, "").replace(/[_-]+/g, " ").trim() || "this decision area"}.`;
}

const MATERIAL_GAP_LANGUAGE =
  /\b(?:unavailable|outage|failed|failure|timeout|error|conflict|contradict|mismatch|disput|ambiguous|unknown|unresolved|unable to determine|could not determine|could not be verified|not verified)\b/i;

const ASSESSED_NULL_ABSENCE_LANGUAGE: Readonly<Record<string, RegExp>> = {
  P3_token_conduct:
    /(?:\b(?:no|without|none|absent|missing|null|tokenless|not issued|does not issue|has not issued)\b[^.!?]{0,100}\b(?:token|contract|mint)\b|\b(?:token|contract|mint)\b[^.!?]{0,100}\b(?:none|absent|missing|null|not found|not issued|does not exist|could be tied|could be bound)\b)/i,
  P4_backing_and_partners:
    /(?:\b(?:no|without|none|absent|missing|undisclosed|bootstrapped|self[- ]funded|unfunded)\b[^.!?]{0,100}\b(?:backer|backing|investor|investment|funding|financing|partner|partnership)\b|\b(?:backer|backing|investor|investment|funding|financing|partner|partnership)\b[^.!?]{0,100}\b(?:none|absent|missing|not found|not disclosed|not announced)\b)/i,
};

function absenceOnlyAssessedNullGap(axis: string, gap: string): boolean {
  const cleaned = gap.replace(/\s+/g, " ").trim();
  if (!cleaned || MATERIAL_GAP_LANGUAGE.test(cleaned)) return false;
  return ASSESSED_NULL_ABSENCE_LANGUAGE[axis]?.test(cleaned) ?? false;
}

function neutralAssessedNull(
  row: DecisionBasisRow,
  strengthBands: StrengthBandLookup,
): boolean {
  if (
    (row.axis !== "P3_token_conduct" && row.axis !== "P4_backing_and_partners")
    || strengthBands[row.axis]?.tier !== "assessed_null"
    || row.counter.length > 0
    || row.gapArtifacts.length > 0
  ) return false;

  // A completed check that establishes absence is an assessed result, not an
  // evidence weakness. Preserve operational outages, unresolved bindings, and
  // conflicting records; suppress only prose that repeats the neutral absence.
  return row.gaps.length === 0
    || row.gaps.every((gap) => absenceOnlyAssessedNullGap(row.axis, gap));
}

function limitDetail(
  row: DecisionBasisRow,
  posture: EvidencePosture,
  reason: AxisEvidenceLimitReason,
): string {
  if (reason === "source_unavailable") {
    const unavailable = row.gapArtifacts[0];
    const record = unavailable?.title ? `“${unavailable.title}”` : "A required source check";
    const explanation = unavailable?.excerpt ? ` ${cleanSentence(unavailable.excerpt)}` : "";
    return `The saved collection record marks ${record} unavailable.${explanation}`.trim();
  }
  if (posture.kind === "unanchored") {
    return "No eligible supporting artifact is tied to this decision area in the saved evidence catalog.";
  }
  if (posture.kind === "first_party_only") {
    return "The saved citations come only from the subject's own channels; no independent origin is tied to this decision area.";
  }
  if (posture.kind === "multi_provider_context") {
    return "External data services provide context, but no independent publisher, counterparty, registry, or direct observation corroborates this decision area.";
  }
  if (posture.independentOriginCount < 2 && posture.kind !== "direct_observation") {
    return `The saved citations resolve to ${posture.originCount} distinct source ${posture.originCount === 1 ? "origin" : "origins"}, including ${posture.independentOriginCount} independent. Repeated citations from the same publisher or content are counted once.`;
  }
  return `The cited evidence is independently grounded, but ${Math.max(row.gaps.length, row.gapArtifacts.length)} specific diligence ${Math.max(row.gaps.length, row.gapArtifacts.length) === 1 ? "question remains" : "questions remain"} open.`;
}

/**
 * Separate evidence confidence from performance. Scores say how the subject
 * performed; these rows say whether the saved record is sufficiently grounded.
 */
export function deriveAxisEvidenceLimits(
  rows: readonly DecisionBasisRow[],
  strengthBands: StrengthBandLookup = {},
): AxisEvidenceLimit[] {
  return rows.flatMap((row) => {
    if (neutralAssessedNull(row, strengthBands)) return [];

    const posture = evidencePostureForAxisArtifacts(row.support);
    const hasUnavailableSource = row.gapArtifacts.length > 0;
    const hasOpenQuestion = row.gaps.length > 0;
    const hasOriginShortfall = ORIGIN_SHORTFALL_POSTURES.has(posture.kind);
    if (!hasUnavailableSource && !hasOpenQuestion && !hasOriginShortfall) return [];

    const reason: AxisEvidenceLimitReason = hasUnavailableSource
      ? "source_unavailable"
      : hasOpenQuestion
        ? "open_question"
        : "origin_shortfall";
    const questionCount = Math.max(row.gaps.length, row.gapArtifacts.length);
    return [{
      axis: row.axis,
      title: concreteGapTitle(row.axis, row.gaps),
      detail: limitDetail(row, posture, reason),
      posture,
      questionCount,
      reason,
    }];
  });
}
