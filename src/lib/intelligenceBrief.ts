import type {
  DecisionLensId,
  DerivedIntelligenceSignal,
  IntelligenceQuestion,
  IntelligenceSpineSnapshot,
} from "../intelligence/types";
import { publicIntelligenceText, publicQuestionStateLabel, publicSignalCopy } from "./intelligencePresentation";

export interface IntelligenceBriefItem {
  id: string;
  title: string;
  detail: string;
  provenance: string;
  domain: string;
  sourceRefs: string[];
}

export interface IntelligenceBrief {
  supports: IntelligenceBriefItem[];
  pressures: IntelligenceBriefItem[];
  context: IntelligenceBriefItem[];
  questions: IntelligenceBriefItem[];
}

/**
 * A frozen intelligence spine may retain an older unanswered question after a
 * later deterministic binding proves the project's official token. Consumers
 * may omit that stale question from concise next-step lists without mutating
 * the saved question register or its lineage receipt.
 */
export function isOfficialTokenQuestion(item: Pick<IntelligenceBriefItem, "id" | "title">): boolean {
  return /official[_ .-](?:crypto[_ .-])?token/i.test(item.id)
    || /\bofficial (?:crypto )?token\b/i.test(item.title);
}

/** A frozen ledger can retain this question after subject orientation binds it. */
export function isOfficialIdentityQuestion(item: Pick<IntelligenceBriefItem, "id" | "title">): boolean {
  return /official[_ .-]identity/i.test(item.id)
    || /what exact project or company does this account represent/i.test(item.title);
}

/** A product-description question is stale once bound orientation answers it. */
export function isProductDescriptionQuestion(item: Pick<IntelligenceBriefItem, "id" | "title">): boolean {
  return /(?:live[_ .-])?(?:product|service)[_ .-](?:surface|description|offering)/i.test(item.id)
    || /what live products? or services? does the project provide/i.test(item.title)
    || /what (?:does|is) (?:the )?(?:project|product).*(?:do|provide)/i.test(item.title);
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

function signalProvenance(signal: DerivedIntelligenceSignal, sourceCount: number): string {
  const evidence = signal.evidenceState === "verified"
    ? "Verified evidence"
    : signal.evidenceState === "measured"
      ? "Direct measurement"
      : signal.evidenceState === "bounded"
        ? "Limited observation"
        : "Reported by a source";
  return `${evidence}${sourceCount > 0 ? ` · ${sourceCount} source${sourceCount === 1 ? "" : "s"}` : ""}`;
}

function signalItem(signal: DerivedIntelligenceSignal): IntelligenceBriefItem {
  const sourceRefs = unique(signal.sourceRefs);
  const copy = publicSignalCopy(signal);
  return {
    id: `intelligence-signal:${signal.id}`,
    title: sentence(copy.headline),
    detail: [sentence(copy.finding), sentence(copy.whyItMatters)].filter(Boolean).join(" "),
    provenance: signalProvenance(signal, sourceRefs.length),
    domain: signal.domain,
    sourceRefs,
  };
}

function questionItem(question: IntelligenceQuestion): IntelligenceBriefItem {
  const sourceRefs = unique(question.sourceRefs);
  const materiality = question.materiality.charAt(0).toUpperCase() + question.materiality.slice(1);
  return {
    id: `intelligence-question:${question.id}`,
    title: sentence(publicIntelligenceText(question.prompt)),
    detail: sentence(publicIntelligenceText(question.basis)),
    provenance: `${materiality} question · ${publicQuestionStateLabel(question.state)}`,
    domain: question.domain,
    sourceRefs,
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
    supports: orderedSignals.filter((signal) => signal.polarity === "support").map(signalItem),
    pressures: orderedSignals.filter((signal) => signal.polarity === "risk" || signal.polarity === "mixed").map(signalItem),
    // "unknown" polarity belongs with neutral context, not nowhere. Filtering
    // for "neutral" alone silently dropped every signal the spine declined to
    // polarize, including the single-signer Safe-compatible authority reading,
    // so a token whose only derived control concern was that authority
    // produced a brief that never mentioned it. Context is the honest home:
    // the reader sees it without ARGUS asserting a polarity it did not derive.
    context: orderedSignals
      .filter((signal) => (signal.polarity === "neutral" || signal.polarity === "unknown")
        // The score chapter already explains these bands. Repeating them under
        // "Other useful context" adds no new fact and crowds out actual context.
        && signal.ruleId !== "project-strength-band-summary")
      .map(signalItem),
    questions,
  };
}
