import { useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type {
  DecisionLens,
  DecisionLensId,
  DerivedIntelligenceSignal,
  IntelligenceDomain,
  IntelligenceDomainCoverage,
  IntelligenceMeasurement,
  IntelligenceQuestion,
  IntelligenceSpineSnapshot,
} from "../intelligence/types";
import { usdCompact } from "../lib/format";
import {
  isPublicMeasurement,
  publicEvidenceLabel,
  publicMeasurementTitle,
  publicQuestionStateLabel,
  publicSignalCopy,
} from "../lib/intelligencePresentation";

const LENS_ORDER: DecisionLensId[] = [
  "investment",
  "alpha_research",
  "counterparty",
  "general_diligence",
];

const LENS_FALLBACK: Record<DecisionLensId, Pick<DecisionLens, "label" | "question" | "domainPriority">> = {
  investment: {
    label: "Investment",
    question: "What supports or weakens a capital allocation decision?",
    domainPriority: ["control", "security", "treasury", "supply", "economics", "liquidity", "team", "legal", "market"],
  },
  alpha_research: {
    label: "Alpha research",
    question: "Which measured pressures and changes matter to the current setup?",
    domainPriority: ["supply", "liquidity", "market", "economics", "chronology", "product"],
  },
  counterparty: {
    label: "Counterparty",
    question: "What supports or weakens trust in this subject as a counterparty?",
    domainPriority: ["identity", "legal", "control", "security", "team", "operations", "treasury", "product"],
  },
  general_diligence: {
    label: "General diligence",
    question: "What does this derived frozen-evidence subset establish?",
    domainPriority: ["identity", "product", "team", "market", "liquidity", "supply", "economics", "funding", "treasury", "governance", "control", "security", "legal", "chronology"],
  },
};

const DOMAIN_ORDER: IntelligenceDomain[] = [
  "identity",
  "career",
  "product",
  "team",
  "operations",
  "track_record",
  "portfolio",
  "fund_scale",
  "relationships",
  "reputation",
  "market",
  "liquidity",
  "supply",
  "economics",
  "funding",
  "treasury",
  "governance",
  "control",
  "security",
  "legal",
  "chronology",
];

const PROJECT_DOMAIN_ORDER: IntelligenceDomain[] = [
  "identity", "product", "team", "market", "liquidity", "supply", "economics",
  "funding", "treasury", "governance", "control", "security", "legal", "chronology",
];

const ENTITY_DOMAIN_ORDER: IntelligenceDomain[] = [
  "identity", "career", "team", "product", "operations", "track_record", "portfolio",
  "fund_scale", "funding", "relationships", "reputation", "governance", "control",
  "security", "legal", "chronology",
];

const SEVERITY_RANK: Record<DerivedIntelligenceSignal["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  context: 3,
};

const COVERAGE_TONE: Record<IntelligenceDomainCoverage["state"], string> = {
  measured: "tint-pass",
  reported: "tint-signal",
  partial: "tint-caution",
  unresolved: "tint-caution",
  unavailable: "tint-avoid",
  not_collected: "tint-caution",
  not_applicable: "tint-neutral",
};

const OPEN_QUESTION_STATES = new Set<IntelligenceQuestion["state"]>([
  "reported",
  "partial",
  "unresolved",
  "unavailable",
  "not_collected",
]);

const THESIS_BLOCKING_QUESTION_STATES = new Set<IntelligenceQuestion["state"]>([
  "unresolved",
  "unavailable",
  "not_collected",
]);

function words(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cleanSentence(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
}

function safeExternalSource(value?: string): string | null {
  if (!value) return null;
  try {
    const source = new URL(value.trim());
    if (
      (source.protocol !== "https:" && source.protocol !== "http:")
      || !source.hostname
      || source.username
      || source.password
    ) return null;
    return source.href;
  } catch {
    return null;
  }
}

function timestampLabel(value: string | null): string {
  if (!value) return "Not recorded";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed).replace("24:", "00:") + " UTC";
}

function numberLabel(value: number, maximumFractionDigits = 2): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits })
    : "Unavailable";
}

function measurementValue(measurement: IntelligenceMeasurement): string {
  if (measurement.valueType === "date") return measurement.value;
  if (measurement.valueType === "text") {
    if (measurement.value === "true") return "Yes";
    if (measurement.value === "false") return "No";
    return measurement.value.includes("_") ? words(measurement.value) : measurement.value;
  }
  if (measurement.unit === "usd") return usdCompact(measurement.value);
  if (measurement.unit === "percent") return `${numberLabel(measurement.value)}%`;
  if (measurement.unit === "ratio") return `${numberLabel(measurement.value)}x`;
  if (measurement.unit === "days") return `${numberLabel(measurement.value)} days`;
  if (measurement.unit === "months") return `${numberLabel(measurement.value)} months`;
  return numberLabel(measurement.value);
}

function measurementWindowLabel(measurement: IntelligenceMeasurement): string | null {
  const window = measurement.window;
  if (!window) return null;
  const parts: string[] = [];
  if (window.kind === "trailing" && window.days) parts.push(`Trailing ${window.days} day window`);
  else if (window.kind === "scheduled") parts.push("Scheduled event");
  else if (window.kind === "historical") parts.push(window.days ? `${window.days} day historical window` : "Historical window");
  else parts.push("Instant observation");
  if (window.start) parts.push(`starts ${timestampLabel(window.start)}`);
  if (window.end) parts.push(`ends ${timestampLabel(window.end)}`);
  if (window.asOf) parts.push(`as of ${timestampLabel(window.asOf)}`);
  return parts.join(" · ");
}

function measurementCaptureLabel(
  measurement: IntelligenceMeasurement,
  sourceIndex: ReadonlyMap<string, IntelligenceSpineSnapshot["sources"][number]>,
): string {
  const windowLabel = measurementWindowLabel(measurement);
  if (windowLabel) return windowLabel;
  const timestamps = uniqueText(measurement.sourceRefs
    .map((sourceRef) => sourceIndex.get(sourceRef)?.capturedAt ?? "")
    .filter(Boolean))
    .sort((left, right) => Date.parse(left) - Date.parse(right) || left.localeCompare(right));
  if (timestamps.length === 0) return "Capture time not recorded";
  if (timestamps.length === 1) return `Captured ${timestampLabel(timestamps[0])}`;
  return `Source window ${timestampLabel(timestamps[0])} to ${timestampLabel(timestamps.at(-1) ?? timestamps[0])}`;
}

function receiptValue(value: number, unit: "percent" | "ratio" | "days"): string {
  if (unit === "percent") return `${numberLabel(value)}%`;
  if (unit === "ratio") return `${numberLabel(value)}x`;
  return `${numberLabel(value)} days`;
}

function uniqueById<T extends { id: string }>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function uniqueText(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const cleaned = item.replace(/\s+/g, " ").trim();
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    output.push(cleaned);
  }
  return output;
}

function sourceArtifactKey(source: IntelligenceSpineSnapshot["sources"][number]): string {
  if (source.contentHashes?.length) {
    return `hash:${[...source.contentHashes].sort((left, right) => left.localeCompare(right)).join("+")}`;
  }
  return source.sourceUrl ? `url:${source.sourceUrl.trim().toLowerCase()}` : `ref:${source.id}`;
}

function normalizedLenses(snapshot: IntelligenceSpineSnapshot): DecisionLens[] {
  const provided = new Map(snapshot.lenses.map((lens) => [lens.id, lens]));
  return LENS_ORDER.map((id) => {
    const stored = provided.get(id);
    const fallback = LENS_FALLBACK[id];
    return {
      id,
      label: stored?.label.trim() || fallback.label,
      question: stored?.question.trim() || fallback.question,
      domainPriority: stored?.domainPriority?.length
        ? [...new Set(stored.domainPriority)].filter((domain) => DOMAIN_ORDER.includes(domain))
        : [...fallback.domainPriority],
      signalIds: [...new Set(stored?.signalIds ?? snapshot.signals
        .filter((signal) => signal.lenses.includes(id))
        .map((signal) => signal.id))],
      unresolvedQuestionIds: [...new Set(stored?.unresolvedQuestionIds ?? [])],
      changeConditions: uniqueText(stored?.changeConditions ?? []),
    };
  });
}

function signalEmphasized(signal: DerivedIntelligenceSignal, lens: DecisionLens): boolean {
  return lens.signalIds.includes(signal.id) || signal.lenses.includes(lens.id);
}

function orderedSignals(signals: readonly DerivedIntelligenceSignal[], lens: DecisionLens): DerivedIntelligenceSignal[] {
  const explicitRank = new Map(lens.signalIds.map((id, index) => [id, index]));
  const originalRank = new Map(signals.map((signal, index) => [signal.id, index]));
  return [...signals].sort((left, right) => {
    const leftExplicit = explicitRank.get(left.id);
    const rightExplicit = explicitRank.get(right.id);
    if (leftExplicit != null || rightExplicit != null) {
      if (leftExplicit == null) return 1;
      if (rightExplicit == null) return -1;
      if (leftExplicit !== rightExplicit) return leftExplicit - rightExplicit;
    }
    const leftEmphasized = signalEmphasized(left, lens);
    const rightEmphasized = signalEmphasized(right, lens);
    if (leftEmphasized !== rightEmphasized) return leftEmphasized ? -1 : 1;
    if (SEVERITY_RANK[left.severity] !== SEVERITY_RANK[right.severity]) {
      return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity];
    }
    return (originalRank.get(left.id) ?? 0) - (originalRank.get(right.id) ?? 0);
  });
}

function openQuestions(questions: readonly IntelligenceQuestion[], lens: DecisionLens): IntelligenceQuestion[] {
  const explicitRank = new Map(lens.unresolvedQuestionIds.map((id, index) => [id, index]));
  const materialityRank: Record<IntelligenceQuestion["materiality"], number> = {
    critical: 0,
    important: 1,
    context: 2,
  };
  return uniqueById(questions)
    .filter((question) => OPEN_QUESTION_STATES.has(question.state))
    .sort((left, right) => {
      const leftRank = explicitRank.get(left.id);
      const rightRank = explicitRank.get(right.id);
      if (leftRank != null || rightRank != null) {
        if (leftRank == null) return 1;
        if (rightRank == null) return -1;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return materialityRank[left.materiality] - materialityRank[right.materiality];
    });
}

function usableSignal(signal: DerivedIntelligenceSignal): boolean {
  return signal.kind !== "coverage_gap"
    && (signal.polarity === "support" || signal.polarity === "risk" || signal.polarity === "mixed");
}

function primaryArchetype(snapshot: IntelligenceSpineSnapshot): string {
  if (snapshot.rulesetVersion === "argus-entity-point-in-time-v1") {
    const labels: Record<NonNullable<IntelligenceSpineSnapshot["subject"]["entityKind"]>, string> = {
      project: "Project intelligence",
      person: "Person intelligence",
      individual_investor: "Investor intelligence",
      investment_firm: "Fund intelligence",
      operating_company: "Company intelligence",
    };
    return snapshot.subject.entityKind ? labels[snapshot.subject.entityKind] : "Entity intelligence";
  }
  const assessment = snapshot.subject.archetypes;
  if (assessment.primary) return words(assessment.primary);
  if (assessment.state === "generic") return "Generic protocol";
  return "Archetype unresolved";
}

function thesisText(
  support: DerivedIntelligenceSignal | undefined,
  pressure: DerivedIntelligenceSignal | undefined,
  lens: DecisionLens,
): string {
  if (support && pressure) {
    return `${cleanSentence(support.headline)} is the strongest support. ${cleanSentence(pressure.headline)} is the strongest pressure.`;
  }
  if (support) {
    return `${cleanSentence(support.headline)} is the strongest support. The saved evidence did not establish a pressure finding for the ${lens.label.toLowerCase()} view. That does not mean no risk exists.`;
  }
  if (pressure) {
    return `${cleanSentence(pressure.headline)} is the strongest pressure. The saved evidence did not establish a supporting finding for the ${lens.label.toLowerCase()} view. That does not mean no support exists.`;
  }
  return `The saved evidence does not support a conclusion for the ${lens.label.toLowerCase()} view yet. That does not mean the subject is safe or unsafe.`;
}

function scenarioCondition(signal: DerivedIntelligenceSignal | undefined): string | null {
  const condition = signal?.changeCondition?.replace(/\s+/g, " ").trim();
  return condition || null;
}

function SummaryCard({
  label,
  signal,
  emptyCopy,
  tone,
}: {
  label: string;
  signal?: DerivedIntelligenceSignal;
  emptyCopy: string;
  tone: string;
}) {
  const copy = signal ? publicSignalCopy(signal) : null;

  return (
    <section className={`panel-inset p-3.5 ${tone}`} aria-label={label}>
      <p className="eyebrow">{label}</p>
      {copy ? (
        <>
          <h4 className="mt-1.5 text-[13.5px] font-semibold leading-snug text-ink">{copy.headline}</h4>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{copy.finding}</p>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{copy.whyItMatters}</p>
        </>
      ) : (
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
    </section>
  );
}

export function PointInTimeIntelligencePanel({
  snapshot,
  thesisEligible = true,
  governingVerdict = null,
  selectedLensId: controlledLensId,
  onSelectedLensChange,
}: {
  snapshot: IntelligenceSpineSnapshot;
  /** False when the parent report withheld a final decision state. */
  thesisEligible?: boolean;
  /** Final parent verdict. This derived layer is always subordinate to it. */
  governingVerdict?: string | null;
  /** Optional shared report lens. When supplied, the short answer and atlas stay synchronized. */
  selectedLensId?: DecisionLensId;
  onSelectedLensChange?: (lensId: DecisionLensId) => void;
}) {
  const generatedId = useId();
  const panelId = `${generatedId}-point-intelligence-panel`;
  const tabRefs = useRef<Partial<Record<DecisionLensId, HTMLButtonElement | null>>>({});
  const lenses = useMemo(() => normalizedLenses(snapshot), [snapshot]);
  const signals = useMemo(() => uniqueById(snapshot.signals), [snapshot.signals]);
  const [internalLensId, setInternalLensId] = useState<DecisionLensId>("investment");
  const selectedLensId = controlledLensId ?? internalLensId;

  const selectedLens = lenses.find((lens) => lens.id === selectedLensId) ?? lenses[0];
  if (!selectedLens) return null;

  const sortedSignals = orderedSignals(signals, selectedLens);
  const emphasizedUsableSignals = sortedSignals.filter((signal) =>
    signalEmphasized(signal, selectedLens) && usableSignal(signal));
  const strongestSupport = emphasizedUsableSignals.find((signal) => signal.polarity === "support");
  const strongestPressure = emphasizedUsableSignals.find((signal) =>
    signal.polarity === "risk" || signal.polarity === "mixed");
  const questions = openQuestions(snapshot.questions, selectedLens);
  const thesisPriorityDomains = new Set(selectedLens.domainPriority.slice(0, 3));
  const criticalDecisionGaps = questions.filter((question) =>
    question.materiality === "critical"
    && THESIS_BLOCKING_QUESTION_STATES.has(question.state)
    && thesisPriorityDomains.has(question.domain),
  );
  const allQuestions = uniqueById(snapshot.questions).sort((left, right) => {
    const leftOpen = OPEN_QUESTION_STATES.has(left.state);
    const rightOpen = OPEN_QUESTION_STATES.has(right.state);
    if (leftOpen !== rightOpen) return leftOpen ? -1 : 1;
    const materialityRank: Record<IntelligenceQuestion["materiality"], number> = { critical: 0, important: 1, context: 2 };
    return materialityRank[left.materiality] - materialityRank[right.materiality]
      || DOMAIN_ORDER.indexOf(left.domain) - DOMAIN_ORDER.indexOf(right.domain)
      || left.id.localeCompare(right.id);
  });
  const normalizedGoverningVerdict = governingVerdict?.trim().toUpperCase() ?? null;
  const governingVerdictWithholdsThesis = normalizedGoverningVerdict != null
    && ["AVOID", "FAIL", "UNVERIFIABLE_IDENTITY", "INCOMPLETE"].includes(normalizedGoverningVerdict);
  const hasUsableThesis = thesisEligible
    && !governingVerdictWithholdsThesis
    && criticalDecisionGaps.length === 0
    && emphasizedUsableSignals.length > 0;
  const derivedThesis = thesisText(strongestSupport, strongestPressure, selectedLens);
  const thesis = !thesisEligible
    ? "This report does not have enough completed evidence to publish a conclusion. The findings and open questions remain available below."
    : governingVerdictWithholdsThesis
      ? `The report result is ${normalizedGoverningVerdict}. The evidence summary below explains that result and cannot replace it.`
      : criticalDecisionGaps.length > 0
        ? `ARGUS cannot publish a conclusion for the ${selectedLens.label.toLowerCase()} view because ${criticalDecisionGaps.length === 1 ? "one critical question has not been answered" : `${criticalDecisionGaps.length} critical questions have not been answered`}. Missing evidence is not treated as a favorable result.`
      : normalizedGoverningVerdict && normalizedGoverningVerdict !== "PASS"
        ? `This report is ${normalizedGoverningVerdict}. ${derivedThesis}`
        : derivedThesis;
  const measurementIndex = new Map(snapshot.measurements.map((measurement) => [measurement.id, measurement]));
  const sourceIndex = new Map(snapshot.sources.map((source) => [source.id, source]));
  const activeChangeConditions = new Set(selectedLens.changeConditions.map((condition) => condition.toLowerCase()));
  const changeConditions = uniqueText([
    ...selectedLens.changeConditions,
    ...lenses.flatMap((lens) => lens.changeConditions),
    ...sortedSignals.map((signal) => signal.changeCondition),
  ]);
  const coverageIndex = new Map(snapshot.coverage.map((record) => [record.domain, record]));
  const priorityDomains = selectedLens.domainPriority;
  const priorityIndex = new Map(priorityDomains.map((domain, index) => [domain, index]));
  const coverageDomains = snapshot.rulesetVersion === "argus-entity-point-in-time-v1"
    ? ENTITY_DOMAIN_ORDER
    : uniqueText([
      ...PROJECT_DOMAIN_ORDER,
      ...snapshot.coverage.map((record) => record.domain),
    ]) as IntelligenceDomain[];
  const orderedDomains = [...coverageDomains].sort((left, right) => {
    const leftPriority = priorityIndex.get(left);
    const rightPriority = priorityIndex.get(right);
    if (leftPriority != null || rightPriority != null) {
      if (leftPriority == null) return 1;
      if (rightPriority == null) return -1;
      return leftPriority - rightPriority;
    }
    return DOMAIN_ORDER.indexOf(left) - DOMAIN_ORDER.indexOf(right);
  });
  const orderedMeasurements = [...snapshot.measurements].sort((left, right) => {
    const leftPriority = priorityIndex.get(left.domain);
    const rightPriority = priorityIndex.get(right.domain);
    if (leftPriority != null || rightPriority != null) {
      if (leftPriority == null) return 1;
      if (rightPriority == null) return -1;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
    }
    return DOMAIN_ORDER.indexOf(left.domain) - DOMAIN_ORDER.indexOf(right.domain)
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id);
  });
  const priorityMeasurements = orderedMeasurements.filter(isPublicMeasurement).slice(0, 12);
  const chronologyMeasurements = snapshot.measurements
    .filter((measurement) => measurement.valueType === "date")
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.value));
      const rightTime = Date.parse(String(right.value));
      const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
      const safeRight = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
      return safeLeft - safeRight || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
    });
  const captureSummary = snapshot.captureWindow.earliest === snapshot.captureWindow.latest
    ? timestampLabel(snapshot.captureWindow.latest)
    : `${timestampLabel(snapshot.captureWindow.earliest)} to ${timestampLabel(snapshot.captureWindow.latest)}`;
  const unboundedSourceCount = snapshot.sources.filter((source) =>
    !source.capturedAt || !Number.isFinite(Date.parse(source.capturedAt)),
  ).length;
  const uniqueArtifactCount = new Set(snapshot.sources.map(sourceArtifactKey)).size;
  const lineageOriginCount = new Set(snapshot.sources.map((source) => source.provider)).size;

  const selectLens = (lensId: DecisionLensId) => {
    if (onSelectedLensChange) onSelectedLensChange(lensId);
    else setInternalLensId(lensId);
    tabRefs.current[lensId]?.focus();
  };

  const moveLens = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (index + 1) % lenses.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (index - 1 + lenses.length) % lenses.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = lenses.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const nextLens = lenses[nextIndex];
    if (nextLens) selectLens(nextLens.id);
  };

  const recheckCondition = hasUsableThesis
    ? selectedLens.changeConditions[0] ?? scenarioCondition(strongestPressure) ?? null
    : null;
  const evidenceNeeded = criticalDecisionGaps[0]?.prompt ?? questions[0]?.prompt ?? null;

  return (
    <section id="decision-intelligence" className="report-section mt-6 scroll-mt-28" aria-labelledby={`${panelId}-title`}>
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Report interpretation</p>
          <h2 id={`${panelId}-title`} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            What the evidence says
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            A plain-language reading of the evidence saved with this report for <span className="font-medium text-ink">{snapshot.subject.label}</span>. Choose a view to bring the most relevant facts forward. The underlying evidence and report result do not change.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <span className="chip tint-signal">{primaryArchetype(snapshot)}</span>
          {snapshot.subject.forms.map((form) => (
            <span key={form.form} className="chip">{words(form.form)}</span>
          ))}
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="border-b border-line/70 px-4 py-3 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip tint-neutral">Saved report</span>
            <span className="mono ml-auto text-[10.5px] text-ink-faint">Evidence through {timestampLabel(snapshot.captureWindow.latest)}</span>
          </div>
          <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint">
            This section uses only evidence captured with this report. It does not refresh in the background or change the ARGUS score.
          </p>
          <details className="mt-2 text-[10.5px] text-ink-faint">
            <summary className="cursor-pointer font-medium text-ink-dim">Methodology details</summary>
            <p className="mt-1 mono">Schema v{snapshot.schemaVersion} · {snapshot.rulesetVersion} · score impact: none</p>
          </details>
        </div>

        <div className="border-b border-line/70 px-4 py-3 sm:px-5">
          <div role="tablist" aria-label="Decision lens" className="scrollbar-none flex gap-1 overflow-x-auto">
            {lenses.map((lens, index) => {
              const selected = lens.id === selectedLens.id;
              const tabId = `${generatedId}-lens-${lens.id}`;
              return (
                <button
                  key={lens.id}
                  ref={(node) => { tabRefs.current[lens.id] = node; }}
                  id={tabId}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-controls={panelId}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => selectLens(lens.id)}
                  onKeyDown={(event) => moveLens(event, index)}
                  className={`min-h-11 shrink-0 rounded-md px-3 text-[12.5px] font-medium transition ${selected ? "bg-signal/10 text-signal-lift" : "text-ink-dim hover:bg-panel-2 hover:text-ink"}`}
                >
                  {lens.label}
                </button>
              );
            })}
          </div>
        </div>

        <div id={panelId} role="tabpanel" aria-labelledby={`${generatedId}-lens-${selectedLens.id}`} className="px-4 py-5 sm:px-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.6fr)]">
            <section className={`panel-inset p-4 ${hasUsableThesis ? "tint-signal" : "tint-caution"}`} aria-label="Current report conclusion">
              <div className="flex flex-wrap items-center gap-2">
                <p className="eyebrow">{hasUsableThesis ? "Current read" : "Conclusion limited"}</p>
                <span className="ml-auto text-[11px] text-ink-faint">{selectedLens.label} view</span>
              </div>
              <p className="mt-2 text-[15px] font-semibold leading-relaxed text-ink">{thesis}</p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{selectedLens.question}</p>
              {!hasUsableThesis && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-caution">
                  {thesisEligible
                    ? governingVerdictWithholdsThesis
                      ? "The report result remains authoritative. The material below explains it and does not create a second verdict."
                      : criticalDecisionGaps.length > 0
                        ? `${criticalDecisionGaps.length} critical question${criticalDecisionGaps.length === 1 ? " is" : "s are"} still open. ARGUS will not fill that gap with an assumption.`
                        : "The saved evidence does not yet support a clear conclusion in this view."
                    : "The investigation has not completed enough decision-critical work to publish a conclusion."}
                </p>
              )}
            </section>

            <section className="panel-inset p-4" aria-label="Capture window">
              <p className="eyebrow">Evidence dates</p>
              <p className="mono mt-2 text-[12px] leading-relaxed text-ink">{captureSummary}</p>
              <dl className="mt-3 grid grid-cols-4 gap-2 text-center">
                <div>
                  <dt className="text-[10.5px] text-ink-faint">Artifacts</dt>
                  <dd data-stat="unique-artifacts" className="mono mt-1 text-[14px] font-semibold text-ink">{uniqueArtifactCount}</dd>
                </div>
                <div>
                  <dt className="text-[10.5px] text-ink-faint">Source groups</dt>
                  <dd data-stat="lineage-origins" className="mono mt-1 text-[14px] font-semibold text-ink">{lineageOriginCount}</dd>
                </div>
                <div>
                  <dt className="text-[10.5px] text-ink-faint">Facts</dt>
                  <dd className="mono mt-1 text-[14px] font-semibold text-ink">{snapshot.measurements.length}</dd>
                </div>
                <div>
                  <dt className="text-[10.5px] text-ink-faint">Findings</dt>
                  <dd className="mono mt-1 text-[14px] font-semibold text-ink">{signals.length}</dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                {snapshot.captureWindow.latest
                  ? `This report uses ${snapshot.sources.length} saved source reference${snapshot.sources.length === 1 ? "" : "s"}. Events after the latest date are not included.${unboundedSourceCount > 0 ? ` ${unboundedSourceCount} source reference${unboundedSourceCount === 1 ? " has" : "s have"} no recorded capture time.` : ""}`
                  : "The saved sources do not include valid capture times, so this report has no reliable date boundary."}
              </p>
            </section>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            <SummaryCard
              label="Strongest support"
              signal={strongestSupport}
              emptyCopy="No usable support signal is tagged to this lens."
              tone="tint-pass"
            />
            <SummaryCard
              label="Strongest pressure"
              signal={strongestPressure}
              emptyCopy="No usable risk or mixed signal is tagged to this lens."
              tone="tint-avoid"
            />
            <section className="panel-inset p-3.5 tint-caution" aria-label="Open questions">
              <div className="flex items-center gap-2">
                <p className="eyebrow">Open questions</p>
                <span className="mono ml-auto text-[11px] text-ink-faint">{questions.length}</span>
              </div>
              {questions.length ? (
                <ol className="mt-2 space-y-2">
                  {questions.slice(0, 3).map((question) => (
                    <li key={question.id} className="text-[12px] leading-relaxed text-ink-dim">
                      <span className="font-medium text-ink">{question.prompt}</span>
                      <span className="mt-0.5 block text-[10.5px] text-ink-faint">
                        {words(question.materiality)} · {publicQuestionStateLabel(question.state)} · {words(question.domain)}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
                  No open question is recorded for this view.
                </p>
              )}
              {questions.length > 3 && (
                <p className="mt-2 text-[10.5px] text-ink-faint">{questions.length - 3} more remain in the frozen question ledger.</p>
              )}
            </section>
          </div>

          <section className="mt-5" aria-labelledby={`${panelId}-atlas-title`}>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <p className="eyebrow text-signal-lift">Key evidence</p>
                <h3 id={`${panelId}-atlas-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">Numbers that shape the report</h3>
              </div>
              <p className="ml-auto max-w-xl text-right text-[11px] leading-relaxed text-ink-faint">
                The most relevant saved facts appear first. Missing information is never shown as zero.
              </p>
            </div>

            {priorityMeasurements.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="priority-measurements">
                {priorityMeasurements.map((measurement) => (
                  <article key={measurement.id} data-measurement-id={measurement.id} className="panel-inset p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="eyebrow">{words(measurement.domain)}</span>
                      <span className="chip ml-auto">{publicEvidenceLabel(measurement.evidenceState)}</span>
                    </div>
                    <p className="mono mt-3 text-[18px] font-semibold tracking-tight text-ink">{measurementValue(measurement)}</p>
                    <h4 className="mt-1 text-[12px] font-medium leading-snug text-ink-dim">{publicMeasurementTitle(measurement)}</h4>
                    <p className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
                      {measurementCaptureLabel(measurement, sourceIndex)}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="panel-inset mt-3 px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
                No typed measurement is stored in this snapshot.
              </p>
            )}

            {chronologyMeasurements.length > 0 && (
              <div className="panel-inset mt-3 overflow-hidden" aria-label="Frozen event chronology">
                <div className="border-b border-line/60 px-4 py-3">
                  <p className="eyebrow">Frozen event chronology</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">Dates are provider or artifact observations. They are not reconstructed founding claims unless the cited measurement says so.</p>
                </div>
                <ol className="grid gap-px bg-line/50 md:grid-cols-2">
                  {chronologyMeasurements.map((measurement) => (
                    <li key={measurement.id} className="bg-panel px-4 py-3">
                      <p className="mono text-[11.5px] text-ink">{timestampLabel(String(measurement.value))}</p>
                      <p className="mt-1 text-[11.5px] leading-snug text-ink-dim">{measurement.label}</p>
                      <p className="mt-1 text-[10px] text-ink-faint">{words(measurement.evidenceState)} · {words(measurement.domain)}</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <details className="panel-inset mt-3 overflow-hidden" data-testid="complete-measurement-ledger">
              <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-medium text-ink hover:bg-panel-2/60">
                Technical measurement details · {orderedMeasurements.length} records
              </summary>
              <ol className="border-t border-line/60">
                {orderedMeasurements.map((measurement) => {
                  const measurementSources = measurement.sourceRefs.map((id) => sourceIndex.get(id)).filter(Boolean);
                  return (
                    <li key={measurement.id} className="border-b border-line/50 px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="chip">{words(measurement.domain)}</span>
                        <span className="chip">{words(measurement.evidenceState)}</span>
                        <span className="mono ml-auto text-[10px] text-ink-faint">{measurement.id}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <p className="text-[12.5px] font-medium text-ink">{measurement.label}</p>
                        <p className="mono text-[12px] text-signal-lift">{measurementValue(measurement)}</p>
                      </div>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">{measurementCaptureLabel(measurement, sourceIndex)}</p>
                      {measurementSources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-faint">
                          {measurementSources.map((source) => {
                            if (!source) return null;
                            const href = safeExternalSource(source.sourceUrl);
                            return href ? (
                              <a key={source.id} href={href} target="_blank" rel="noopener noreferrer" className="link-ext">{source.title}</a>
                            ) : <span key={source.id}>{source.title}</span>;
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </details>

            <details className="panel-inset mt-3 overflow-hidden" data-testid="complete-source-ledger">
              <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-medium text-ink hover:bg-panel-2/60">
                Source details · {snapshot.sources.length} reference{snapshot.sources.length === 1 ? "" : "s"} · {uniqueArtifactCount} unique document{uniqueArtifactCount === 1 ? "" : "s"}
              </summary>
              <ol className="border-t border-line/60">
                {snapshot.sources.map((source) => {
                  const href = safeExternalSource(source.sourceUrl);
                  return (
                    <li key={source.id} className="border-b border-line/50 px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="chip">{words(source.evidenceState)}</span>
                        <span className="chip">{words(source.sourceClass)}</span>
                        <span className="mono ml-auto text-[10px] text-ink-faint">{source.id}</span>
                      </div>
                      <h4 className="mt-2 text-[12.5px] font-medium leading-snug text-ink">
                        {href ? <a href={href} target="_blank" rel="noopener noreferrer" className="link-ext">{source.title}</a> : source.title}
                      </h4>
                      <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                        {source.provider} · ARGUS observed {source.capturedAt ? timestampLabel(source.capturedAt) : "time not recorded"}{source.providerUpdatedAt ? ` · provider updated ${timestampLabel(source.providerUpdatedAt)}` : ""} · {source.inputPath}
                      </p>
                      {source.excerpt && <p className="mt-2 text-[11.5px] leading-relaxed text-ink-dim">{source.excerpt}</p>}
                      {source.contentHashes && source.contentHashes.length > 0 && (
                        <p className="mono mt-2 break-all text-[9.5px] text-ink-faint">Content hash {source.contentHashes.join(", ")}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </details>
          </section>

          <section className="mt-5" aria-labelledby={`${panelId}-cases-title`}>
            <div>
              <p className="eyebrow text-signal-lift">What to do next</p>
              <h3 id={`${panelId}-cases-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">
                When to refresh this report
              </h3>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-3">
              <article className="panel-inset p-3.5 tint-signal">
                <p className="eyebrow">Refresh the report when</p>
                {recheckCondition ? (
                  <>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink">{recheckCondition}</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">A new report may strengthen, weaken, or leave the conclusion unchanged.</p>
                  </>
                ) : (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">No specific refresh trigger is supported by the saved evidence.</p>
                )}
              </article>
              <article className="panel-inset p-3.5 tint-signal">
                <p className="eyebrow">What this report says now</p>
                <p className="mt-2 text-[12px] leading-relaxed text-ink">{thesis}</p>
                <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">This conclusion uses only evidence saved with this report.</p>
              </article>
              <article className="panel-inset p-3.5 tint-caution">
                <p className="eyebrow">Verify next</p>
                {evidenceNeeded ? (
                  <>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink">{evidenceNeeded}</p>
                    <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">Until a reliable source answers this, it remains an open question.</p>
                  </>
                ) : (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink-faint">No decision-critical follow-up is recorded for this view.</p>
                )}
              </article>
            </div>
          </section>

          <section className="mt-5" aria-labelledby={`${panelId}-signals-title`}>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <p className="eyebrow text-signal-lift">Findings and open questions</p>
                <h3 id={`${panelId}-signals-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">What ARGUS found</h3>
              </div>
              <p className="ml-auto max-w-xl text-right text-[11px] leading-relaxed text-ink-faint">
                All {signals.length} findings remain available. Changing the view only changes their order.
              </p>
            </div>
            {sortedSignals.length ? (
              <ol className="mt-3 grid gap-2" data-testid="complete-signal-set">
                {sortedSignals.map((signal) => {
                  const emphasized = signalEmphasized(signal, selectedLens);
                  const sources = signal.sourceRefs.map((id) => sourceIndex.get(id)).filter(Boolean);
                  const copy = publicSignalCopy(signal);
                  return (
                    <li key={signal.id} data-signal-id={signal.id} className={`panel-inset p-3.5 ${copy.tone}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="chip">{copy.status}</span>
                        <span className="text-[11px] text-ink-faint">{copy.priority} · {words(signal.domain)}</span>
                        {emphasized && <span className="ml-auto text-[11px] font-medium text-signal-lift">Prioritized for {selectedLens.label.toLowerCase()}</span>}
                      </div>
                      <h4 className="mt-2 text-[13.5px] font-semibold leading-snug text-ink">{copy.headline}</h4>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{copy.finding}</p>
                      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint"><span className="font-medium text-ink-dim">Why it matters:</span> {copy.whyItMatters}</p>
                      {signal.changeCondition && (
                        <p className="mt-2 text-[11.5px] leading-relaxed text-ink-faint"><span className="font-medium text-ink-dim">What would change this:</span> {signal.changeCondition}</p>
                      )}

                      <details className="mt-3 border-t border-line/60 pt-2 text-[10.5px] text-ink-faint">
                        <summary className="cursor-pointer font-medium text-ink-dim">Technical and source details</summary>
                        <p className="mono mt-2">Rule {signal.ruleId} v{signal.ruleVersion} · {words(signal.kind)} · {words(signal.evidenceState)}</p>
                      {signal.arithmetic && signal.arithmetic.length > 0 && (
                        <div className="mt-3" aria-label={`Arithmetic receipts for ${signal.headline}`}>
                          <p className="eyebrow">Arithmetic receipts</p>
                          <div className="mt-2 grid gap-2 sm:grid-cols-2">
                            {signal.arithmetic.map((receipt, index) => (
                              <div key={`${signal.id}-receipt-${index}`} className="rounded-md border border-line/70 bg-panel/45 px-3 py-2">
                                <p className="mono break-words text-[11.5px] text-ink">
                                  {receipt.expression} = {receiptValue(receipt.value, receipt.unit)}
                                </p>
                                <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                                  Inputs: {receipt.inputMeasurementIds.map((measurementId) => {
                                    const measurement = measurementIndex.get(measurementId);
                                    return measurement
                                      ? `${measurement.label} ${measurementValue(measurement)}`
                                      : `${measurementId} not found`;
                                  }).join(", ")}
                                </p>
                                {receipt.temporal && (
                                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink-faint">
                                    Time basis: {words(receipt.temporal.state)} · maximum input skew {numberLabel(receipt.temporal.maxInputSkewHours)} hours · {receipt.temporal.inputAsOf.map((input) => `${input.measurementId} at ${timestampLabel(input.asOf)}`).join(", ")}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {sources.length > 0 && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink-faint">
                          <span>{sources.length} source reference{sources.length === 1 ? "" : "s"}</span>
                          {sources.map((source) => {
                            if (!source) return null;
                            const href = safeExternalSource(source.sourceUrl);
                            return href ? (
                              <a key={source.id} href={href} target="_blank" rel="noopener noreferrer" className="link-ext">
                                {source.title}
                              </a>
                            ) : <span key={source.id}>{source.title}</span>;
                          })}
                        </div>
                      )}
                      </details>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <p className="panel-inset mt-3 px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
                No derived signal is stored in this snapshot. Coverage records remain visible below.
              </p>
            )}
          </section>

          <section className="mt-5" aria-labelledby={`${panelId}-questions-title`}>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <p className="eyebrow text-signal-lift">Question ledger</p>
                <h3 id={`${panelId}-questions-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">Every tracked diligence question</h3>
              </div>
              <p className="ml-auto max-w-xl text-right text-[11px] leading-relaxed text-ink-faint">
                A related metric never answers a different question. Each state and basis comes from the frozen collection record.
              </p>
            </div>
            <details className="panel-inset mt-3 overflow-hidden" data-testid="complete-question-ledger">
              <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-medium text-ink hover:bg-panel-2/60">
                Open full ledger · {allQuestions.length} questions · {questions.length} open
              </summary>
              <ol className="border-t border-line/60">
                {allQuestions.map((question) => {
                  const sources = question.sourceRefs.map((id) => sourceIndex.get(id)).filter(Boolean);
                  return (
                    <li key={question.id} className="border-b border-line/50 px-4 py-3 last:border-b-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${OPEN_QUESTION_STATES.has(question.state) ? "tint-caution" : "tint-pass"}`}>{words(question.state)}</span>
                        <span className="chip">{words(question.materiality)}</span>
                        <span className="chip">{words(question.domain)}</span>
                        <span className="mono ml-auto text-[10px] text-ink-faint">{question.id}</span>
                      </div>
                      <h4 className="mt-2 text-[13px] font-semibold leading-snug text-ink">{question.prompt}</h4>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">{question.basis}</p>
                      <p className="mono mt-2 text-[10px] text-ink-faint">{question.answerRefs.length} answer refs · {question.sourceRefs.length} source refs</p>
                      {sources.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-ink-faint">
                          {sources.map((source) => {
                            if (!source) return null;
                            const href = safeExternalSource(source.sourceUrl);
                            return href ? (
                              <a key={source.id} href={href} target="_blank" rel="noopener noreferrer" className="link-ext">{source.title}</a>
                            ) : <span key={source.id}>{source.title}</span>;
                          })}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </details>
          </section>

          <section className="mt-5" aria-labelledby={`${panelId}-changes-title`}>
            <p className="eyebrow text-signal-lift">Change conditions</p>
            <h3 id={`${panelId}-changes-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">What would change this read</h3>
            {changeConditions.length ? (
              <ol className="mt-3 grid gap-2 md:grid-cols-2">
                {changeConditions.map((condition, index) => (
                  <li key={`${condition}-${index}`} className="panel-inset flex items-start gap-3 px-3 py-2.5 text-[12px] leading-relaxed text-ink-dim">
                    <span className="mono mt-0.5 shrink-0 text-[10.5px] text-ink-faint">{String(index + 1).padStart(2, "0")}</span>
                    <span className="min-w-0 flex-1">{condition}</span>
                    {activeChangeConditions.has(condition.toLowerCase()) && <span className="chip tint-signal shrink-0">Lens priority</span>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="panel-inset mt-3 px-4 py-3 text-[12px] leading-relaxed text-ink-faint">
                No explicit change condition is stored. Do not infer one from absent coverage.
              </p>
            )}
          </section>

          <section className="mt-5" aria-labelledby={`${panelId}-coverage-title`}>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <p className="eyebrow text-signal-lift">Coverage</p>
                <h3 id={`${panelId}-coverage-title`} className="mt-1 text-[17px] font-semibold tracking-tight text-ink">Domain coverage map</h3>
              </div>
              <p className="ml-auto max-w-xl text-right text-[11px] leading-relaxed text-ink-faint">
                Coverage records what was measured or asked. It is not confidence that the subject is safe.
              </p>
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2" aria-label="Domain coverage map">
              {orderedDomains.map((domain) => {
                const record = coverageIndex.get(domain) ?? {
                  domain,
                  state: "not_collected" as const,
                  measurementIds: [],
                  questionIds: [],
                  detail: "No domain coverage record exists in this snapshot.",
                };
                const priority = priorityIndex.has(domain);
                return (
                  <article key={domain} data-coverage-domain={domain} className={`panel-inset p-3 ${COVERAGE_TONE[record.state]}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h4 className="text-[12.5px] font-semibold text-ink">{words(domain)}</h4>
                      <span className="chip ml-auto">{words(record.state)}</span>
                      {priority && <span className="chip tint-signal">Lens priority</span>}
                    </div>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-dim">{record.detail}</p>
                    <p className="mono mt-2 text-[10px] text-ink-faint">
                      {record.measurementIds.length} measures · {record.questionIds.length} questions
                    </p>
                  </article>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
