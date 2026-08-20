import type {
  DecisionLensId,
  DerivedIntelligenceSignal,
  IntelligenceQuestion,
  IntelligenceSpineSnapshot,
} from "../intelligence/types";
import {
  EVIDENCE_POSTURE_RANK,
  evidencePostureForSignal,
  type EvidencePosture,
} from "./evidenceReasoning";

export interface IntelligenceBriefItem {
  id: string;
  title: string;
  detail: string;
  provenance: string;
  domain: string;
  sourceRefs: string[];
  evidencePosture: EvidencePosture["kind"];
  independentOriginCount: number;
  originCount: number;
}

export interface IntelligenceBrief {
  supports: IntelligenceBriefItem[];
  pressures: IntelligenceBriefItem[];
  context: IntelligenceBriefItem[];
  questions: IntelligenceBriefItem[];
}

const SEVERITY_RANK: Record<DerivedIntelligenceSignal["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  context: 3,
};

const MATERIALITY_RANK: Record<IntelligenceQuestion["materiality"], number> = {
  critical: 0,
  important: 1,
  context: 2,
};

const QUESTION_STATE_RANK: Partial<Record<IntelligenceQuestion["state"], number>> = {
  unavailable: 0,
  unresolved: 1,
  partial: 2,
  reported: 3,
};

function sentence(value: string): string {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return /[.!?]$/.test(cleaned) ? cleaned : `${cleaned}.`;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function signalEvidenceLabel(signal: DerivedIntelligenceSignal): string {
  return signal.evidenceState === "verified"
    ? "Verified saved evidence"
    : signal.evidenceState === "measured"
      ? "Measured saved evidence"
      : signal.evidenceState === "bounded"
        ? "Bounded saved evidence"
        : "Source-reported context";
}

function signalItem(
  snapshot: IntelligenceSpineSnapshot,
  signal: DerivedIntelligenceSignal,
): IntelligenceBriefItem {
  const sourceRefs = unique(signal.sourceRefs);
  const headline = sentence(signal.headline);
  const posture = evidencePostureForSignal(snapshot, signal);
  return {
    id: `intelligence-signal:${signal.id}`,
    title: signal.evidenceState === "reported_context"
      ? `Source-reported context: ${headline.charAt(0).toLowerCase()}${headline.slice(1)}`
      : headline,
    detail: [sentence(signal.finding), sentence(signal.whyItMatters)].filter(Boolean).join(" "),
    provenance: `${signalEvidenceLabel(signal)} · ${posture.label} · score-neutral derivation`,
    domain: signal.domain,
    sourceRefs,
    evidencePosture: posture.kind,
    independentOriginCount: posture.independentOriginCount,
    originCount: posture.originCount,
  };
}

function questionItem(question: IntelligenceQuestion): IntelligenceBriefItem {
  const sourceRefs = unique(question.sourceRefs);
  const state = question.state.replaceAll("_", " ");
  return {
    id: `intelligence-question:${question.id}`,
    title: sentence(question.prompt),
    detail: sentence(question.basis),
    provenance: `${question.materiality} question · ${state} · score-neutral`,
    domain: question.domain,
    sourceRefs,
    evidencePosture: "unanchored",
    independentOriginCount: 0,
    originCount: sourceRefs.length,
  };
}

/**
 * Project the complete saved signal and question registers into a concise case
 * brief. This only selects and orders records. It never changes their evidence
 * state, the governing score, or the saved Intelligence Spine.
 */
export function deriveIntelligenceBrief(
  snapshot: IntelligenceSpineSnapshot,
  lensId: DecisionLensId = "investment",
): IntelligenceBrief {
  const lens = snapshot.lenses.find((candidate) => candidate.id === lensId);
  const explicitSignalRank = new Map((lens?.signalIds ?? []).map((id, index) => [id, index]));
  const domainRank = new Map((lens?.domainPriority ?? []).map((domain, index) => [domain, index]));
  const originalSignalRank = new Map(snapshot.signals.map((signal, index) => [signal.id, index]));

  const orderedSignals = [...snapshot.signals]
    .filter((signal) => signal.kind !== "coverage_gap")
    .sort((left, right) => {
      // Severity outranks lens relevance for HIGH severity, and only for it.
      // A lens is meant to change emphasis, but every consumer of this brief
      // truncates its list, so letting a lens sort a high-severity risk below
      // the cut is how switching lens makes a direct concern vanish from the
      // surface a reader actually reads. Lower bands keep full lens ordering.
      const leftHigh = left.severity === "high" ? 0 : 1;
      const rightHigh = right.severity === "high" ? 0 : 1;
      if (leftHigh !== rightHigh) return leftHigh - rightHigh;
      const leftExplicit = explicitSignalRank.get(left.id);
      const rightExplicit = explicitSignalRank.get(right.id);
      if (leftExplicit != null || rightExplicit != null) {
        if (leftExplicit == null) return 1;
        if (rightExplicit == null) return -1;
        if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
      }
      const leftDomain = domainRank.get(left.domain) ?? Number.POSITIVE_INFINITY;
      const rightDomain = domainRank.get(right.domain) ?? Number.POSITIVE_INFINITY;
      if (leftDomain !== rightDomain) return leftDomain - rightDomain;
      if (SEVERITY_RANK[left.severity] !== SEVERITY_RANK[right.severity]) {
        return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
      }
      // When two claims are equally material, prefer the one with stronger
      // source independence. Citation count alone is not corroboration.
      const leftPosture = evidencePostureForSignal(snapshot, left);
      const rightPosture = evidencePostureForSignal(snapshot, right);
      if (EVIDENCE_POSTURE_RANK[leftPosture.kind] !== EVIDENCE_POSTURE_RANK[rightPosture.kind]) {
        return EVIDENCE_POSTURE_RANK[leftPosture.kind] - EVIDENCE_POSTURE_RANK[rightPosture.kind];
      }
      return (originalSignalRank.get(left.id) ?? 0) - (originalSignalRank.get(right.id) ?? 0);
    });

  const explicitQuestionRank = new Map((lens?.unresolvedQuestionIds ?? []).map((id, index) => [id, index]));
  const questions = [...snapshot.questions]
    // The complete Decision Intelligence panel retains not_collected questions
    // as the research universe. The concise report brief promotes only work
    // that produced context, partially completed, or actually failed. This
    // prevents a static template from displacing the scan's observed blockers.
    .filter((question) => Object.hasOwn(QUESTION_STATE_RANK, question.state))
    .sort((left, right) => {
      const leftExplicit = explicitQuestionRank.get(left.id);
      const rightExplicit = explicitQuestionRank.get(right.id);
      if (leftExplicit != null || rightExplicit != null) {
        if (leftExplicit == null) return 1;
        if (rightExplicit == null) return -1;
        if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
      }
      if (MATERIALITY_RANK[left.materiality] !== MATERIALITY_RANK[right.materiality]) {
        return MATERIALITY_RANK[left.materiality] - MATERIALITY_RANK[right.materiality];
      }
      const leftState = QUESTION_STATE_RANK[left.state] ?? Number.POSITIVE_INFINITY;
      const rightState = QUESTION_STATE_RANK[right.state] ?? Number.POSITIVE_INFINITY;
      if (leftState !== rightState) return leftState - rightState;
      const leftDomain = domainRank.get(left.domain) ?? Number.POSITIVE_INFINITY;
      const rightDomain = domainRank.get(right.domain) ?? Number.POSITIVE_INFINITY;
      return leftDomain - rightDomain || left.id.localeCompare(right.id);
    })
    .map(questionItem);

  return {
    supports: orderedSignals.filter((signal) => signal.polarity === "support").map((signal) => signalItem(snapshot, signal)),
    pressures: orderedSignals.filter((signal) => signal.polarity === "risk" || signal.polarity === "mixed").map((signal) => signalItem(snapshot, signal)),
    // "unknown" polarity belongs with neutral context, not nowhere. Filtering
    // for "neutral" alone silently dropped every signal the spine declined to
    // polarize, including the single-signer Safe-compatible authority reading,
    // so a token whose only derived control concern was that authority
    // produced a brief that never mentioned it. Context is the honest home:
    // the reader sees it without ARGUS asserting a polarity it did not derive.
    context: orderedSignals
      .filter((signal) => signal.polarity === "neutral" || signal.polarity === "unknown")
      .map((signal) => signalItem(snapshot, signal)),
    questions,
  };
}
