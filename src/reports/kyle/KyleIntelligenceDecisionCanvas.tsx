import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  CheckCircle,
  ClockCounterClockwise,
  Eye,
  MagnifyingGlassPlus,
  Question,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import type { CompositionRow } from "../../components/ScoreComposition";
import { DecisionLensSelector } from "../../components/InvestigatorBrief";
import type { DecisionLensId } from "../../intelligence/types";
import type { TokenDecisionBoundary } from "../../lib/decisionBoundary";
import type { DecisionDiscovery, VerdictArgument } from "../../lib/reportInsights";
import "./kyle-intelligence-report.css";

export interface KyleDecisionItem {
  label: string;
  detail?: string | undefined;
}

export interface KyleSecondaryScore {
  label: string;
  score: number | null;
  verdictLabel: string;
  context?: string | undefined;
}

export interface KyleIntelligenceDecisionCanvasProps {
  subjectName?: string | undefined;
  subjectSummary?: string | null | undefined;
  reportSummary?: string | null | undefined;
  verdictLabel: string;
  score: number | null;
  scoreLabel: string;
  scoreContext?: string | undefined;
  scoreIsProvisional?: boolean | undefined;
  favorable: boolean;
  argument?: VerdictArgument | undefined;
  discovery?: DecisionDiscovery | null | undefined;
  decisionBoundary?: TokenDecisionBoundary | null | undefined;
  decisionBoundaryEvidenceHref?: `#${string}` | undefined;
  decisionLensId?: DecisionLensId | undefined;
  onDecisionLensChange?: ((lensId: DecisionLensId) => void) | undefined;
  supports: KyleDecisionItem[];
  concerns: KyleDecisionItem[];
  context?: KyleDecisionItem[];
  nextSteps: KyleDecisionItem[];
  verified: KyleDecisionItem[];
  coveragePercent: number;
  successful: number;
  applicable: number;
  capturedAt?: string | undefined;
  evidenceHref: `#${string}`;
  methodologyHref: `#${string}`;
  challengeAnchorId?: string | null;
  checkScopeLabel: string;
  composition?: CompositionRow[];
  secondaryScore?: KyleSecondaryScore | null | undefined;
}

type ReportDepth = "brief" | "analysis" | "evidence";

const DEPTHS: Array<{ id: ReportDepth; label: string; detail: string }> = [
  { id: "brief", label: "Brief", detail: "Five-minute decision" },
  { id: "analysis", label: "Analysis", detail: "Full investigation" },
  { id: "evidence", label: "Evidence room", detail: "Sources and method" },
];

function reducedMotion(): boolean {
  return typeof window === "undefined"
    || typeof window.matchMedia !== "function"
    || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function sentence(value: string | null | undefined): string {
  const clean = executiveText(value);
  if (!clean) return "";
  return /[.!?]$/.test(clean) ? clean : `${clean}.`;
}

function executiveText(value: string | null | undefined): string {
  const clean = (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\bReturn each event\b.*$/i, "")
    .replace(/\bReturn exact\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  const researchPrompt = clean.search(/(?:^|[.!]\s+)(?:Which|What|Who|Where|When|How)\b[^?]*\?/i);
  const editorial = researchPrompt > 24 ? clean.slice(0, researchPrompt).trim() : clean;
  return editorial
    .replace(/\bcurrent in provider record\b/gi, "a current role signal was found")
    .replace(/\blimited source support\b/gi, "evidence remains limited")
    .replace(/\bresponsible legal entity is source-backed\b/gi, "the legal entity tied to the project is source-backed")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/\.{2,}$/g, ".")
    .trim();
}

function evidenceBand(row: CompositionRow): "Strong" | "Moderate" | "Limited" | "Unresolved" {
  const ratio = row.weight > 0 ? row.score / row.weight : 0;
  if (row.questionCount && row.score === 0) return "Unresolved";
  if (ratio >= 0.72 && (row.supportCount ?? 0) > 0) return "Strong";
  if (ratio >= 0.45) return "Moderate";
  return "Limited";
}

function evidenceTone(band: ReturnType<typeof evidenceBand>): string {
  if (band === "Strong") return "positive";
  if (band === "Moderate") return "neutral";
  return "unresolved";
}

function scoreTone(score: number | null): "positive" | "caution" | "negative" | "unknown" {
  if (score == null) return "unknown";
  if (score >= 70) return "positive";
  if (score >= 40) return "caution";
  return "negative";
}

function coverageLabel(value: number): string {
  if (value >= 85) return "Strong";
  if (value >= 60) return "Moderate";
  return "Limited";
}

function cleanName(value: string | undefined): string {
  return (value ?? "ARGUS subject").replace(/[.\s]+$/, "").trim() || "ARGUS subject";
}

function verdictHeadline(
  rows: CompositionRow[],
  favorable: boolean,
  adverseCount: number,
  unresolvedCount: number,
): string {
  const strongest = [...rows]
    .filter((row) => row.weight > 0 && row.score / row.weight >= 0.65)
    .sort((left, right) => (right.score / right.weight) - (left.score / left.weight))[0];
  const lead = strongest ? `${strongest.label} leads the evidence.` : "The available evidence establishes a starting position.";
  if (favorable && unresolvedCount === 0 && adverseCount === 0) return `${lead} No decision-critical gap is recorded.`;
  if (adverseCount > 0) return `${lead} ${adverseCount} scored counter-${adverseCount === 1 ? "signal requires" : "signals require"} review.`;
  return `${lead} Independent evidence remains incomplete.`;
}

function ClaimLabel({ type, strength }: { type: "FACT" | "SIGNAL" | "INFERENCE"; strength: string }) {
  return <p className="kyle-claim-label mono">{type} · {strength.toUpperCase()} EVIDENCE</p>;
}

function BriefColumn({
  title,
  subtitle,
  items,
  tone,
  empty,
  href,
}: {
  title: string;
  subtitle: string;
  items: KyleDecisionItem[];
  tone: "positive" | "caution" | "unresolved";
  empty: string;
  href: `#${string}`;
}) {
  return (
    <section className={`kyle-brief-column kyle-tone-${tone}`}>
      <p className="kyle-brief-kicker mono">{subtitle}</p>
      <h3>{title}</h3>
      {items.length ? (
        <ol>
          {items.slice(0, 3).map((item, index) => (
            <li key={`${title}-${index}`}>
              <a href={href}>
                <span className="kyle-brief-index mono">0{index + 1}</span>
                <span>
                  <strong>{sentence(item.label)}</strong>
                  {item.detail && <small>{sentence(item.detail)}</small>}
                </span>
              </a>
            </li>
          ))}
        </ol>
      ) : (
        <p className="kyle-brief-empty">{empty}</p>
      )}
    </section>
  );
}

function AnimatedVerdictScore({
  score,
  verdictLabel,
  rows,
  scoreIsProvisional,
  successful,
  applicable,
  checkScopeLabel,
}: {
  score: number | null;
  verdictLabel: string;
  rows: CompositionRow[];
  scoreIsProvisional: boolean;
  successful: number;
  applicable: number;
  checkScopeLabel: string;
}) {
  const buildRows = rows.filter((row) => row.score > 0);
  const buildRowCount = buildRows.length;
  const [activeCount, setActiveCount] = useState(() => reducedMotion() ? buildRows.length : 0);

  useEffect(() => {
    if (reducedMotion() || buildRowCount === 0) return;
    const timers = Array.from({ length: buildRowCount }, (_, index) => window.setTimeout(() => setActiveCount(index + 1), 420 + index * 520));
    return () => timers.forEach(window.clearTimeout);
  }, [buildRowCount]);

  const builtPoints = buildRows.slice(0, activeCount).reduce((sum, row) => sum + row.score, 0);
  const displayedScore = score == null ? null : activeCount >= buildRows.length ? score : Math.min(score, Math.round(builtPoints));
  const activeRow = activeCount > 0 && activeCount <= buildRows.length ? buildRows[activeCount - 1] : null;
  const circumference = 2 * Math.PI * 74;
  const progress = displayedScore == null ? 0 : Math.max(0, Math.min(100, displayedScore));
  const tone = scoreTone(score);

  return (
    <div className={`kyle-verdict-score kyle-tone-${tone}`} aria-label={score == null ? "Score withheld" : `${score} out of 100`}>
      <div className="kyle-score-ring">
        <svg viewBox="0 0 168 168" role="img" aria-hidden="true">
          <circle className="kyle-score-ring-track" cx="84" cy="84" r="74" />
          <circle
            className="kyle-score-ring-progress"
            cx="84"
            cy="84"
            r="74"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress / 100)}
          />
        </svg>
        <div className="kyle-score-ring-copy">
          <strong>{displayedScore ?? "N/A"}</strong>
          <span>{score == null ? "withheld" : "of 100"}</span>
        </div>
      </div>
      <div className="kyle-score-status">
        <p className="kyle-verdict-word mono">{verdictLabel}</p>
        <p className="kyle-score-build mono" aria-live="polite">
          {activeRow ? <><span>Adding {activeRow.label}</span><strong>+{Math.round(activeRow.score)} pts</strong></> : <span>Evidence-built verdict</span>}
        </p>
        <p className="kyle-check-state mono">
          {applicable === 0
            ? "No checks saved"
            : `${successful}/${applicable} ${checkScopeLabel.toLowerCase()} complete${scoreIsProvisional ? " · provisional" : ""}`}
        </p>
      </div>
    </div>
  );
}

export function KyleIntelligenceDecisionCanvas({
  subjectName,
  subjectSummary,
  reportSummary,
  verdictLabel,
  score,
  scoreLabel,
  scoreContext,
  scoreIsProvisional = false,
  favorable,
  argument,
  discovery,
  decisionBoundary,
  decisionBoundaryEvidenceHref,
  decisionLensId,
  onDecisionLensChange,
  supports,
  concerns,
  context = [],
  nextSteps,
  verified,
  coveragePercent,
  successful,
  applicable,
  capturedAt,
  evidenceHref,
  methodologyHref,
  challengeAnchorId,
  checkScopeLabel,
  composition = [],
  secondaryScore,
}: KyleIntelligenceDecisionCanvasProps) {
  const [depth, setDepth] = useState<ReportDepth>("brief");
  const name = cleanName(subjectName);
  const unresolvedCount = Math.max(
    composition.reduce((sum, row) => sum + (row.questionCount ?? 0), 0),
    nextSteps.length,
  );
  const adverseCount = composition.reduce((sum, row) => sum + (row.counterCount ?? 0), 0);
  const sourceCount = composition.reduce((sum, row) => sum + (row.supportCount ?? 0), 0);
  const mainConcern = concerns[0];
  const strongestSupport = supports[0] ?? verified[0];
  const topNextStep = nextSteps[0];
  const thesis = sentence(reportSummary) || sentence(argument?.againstLine) || sentence(mainConcern?.label) || "ARGUS assembled the available evidence into a decision-ready view.";
  const summary = sentence(subjectSummary);
  const headline = verdictHeadline(composition, favorable, adverseCount, unresolvedCount);
  const coverage = coverageLabel(coveragePercent);

  useEffect(() => {
    const previous = document.documentElement.dataset.kyleReportDepth;
    document.documentElement.dataset.kyleReportDepth = depth;
    return () => {
      if (previous) document.documentElement.dataset.kyleReportDepth = previous;
      else delete document.documentElement.dataset.kyleReportDepth;
    };
  }, [depth]);

  useEffect(() => {
    const revealForAnchor = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
      const href = target?.getAttribute("href") ?? "";
      if (/evidence|method|ledger|source|frozen/i.test(href)) setDepth("evidence");
      else if (/people|identity|product|social|market|relationship|risk|question|composition/i.test(href)) setDepth("analysis");
    };
    document.addEventListener("click", revealForAnchor, true);
    return () => document.removeEventListener("click", revealForAnchor, true);
  }, []);

  const sortedComposition = useMemo(() => [...composition].sort((left, right) => right.weight - left.weight), [composition]);
  const totalPossible = composition.reduce((sum, row) => sum + row.weight, 0);

  return (
    <section id="report-summary" className="kyle-intelligence-report scroll-mt-28" data-kyle-intelligence-report="true">
      <nav className="kyle-depth-switcher" aria-label="Report depth">
        <div>
          <p className="mono">READING DEPTH</p>
          <span>One frozen report. Choose how far to go.</span>
        </div>
        <div className="kyle-depth-options" role="group" aria-label="Choose report depth">
          {DEPTHS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={depth === option.id}
              onClick={() => setDepth(option.id)}
              title={option.detail}
            >
              {option.label}
            </button>
          ))}
        </div>
      </nav>

      <header className="kyle-verdict-hero">
        <div className="kyle-verdict-copy">
          <p className="kyle-overline mono">01 · VERDICT</p>
          <p className="kyle-investigation-meta mono">{scoreLabel} {capturedAt ? `· SAVED ${capturedAt}` : "· CURRENT REPORT"}</p>
          <h2>{name}</h2>
          <p className="kyle-verdict-headline">{headline}</p>
          <p className="kyle-verdict-thesis">{thesis}</p>
          <div className="kyle-verdict-facts">
            <div>
              <span className="mono">STRONGEST EVIDENCE</span>
              <strong>{sentence(strongestSupport?.label) || "No leading support was recorded."}</strong>
            </div>
            <div>
              <span className="mono">MAIN LIMITATION</span>
              <strong>{sentence(mainConcern?.label) || "No governing limitation was recorded."}</strong>
            </div>
            <div>
              <span className="mono">HIGHEST-VALUE NEXT CHECK</span>
              <strong>{sentence(topNextStep?.label) || "No required check remains open."}</strong>
            </div>
          </div>
        </div>
        <div className="kyle-verdict-visual">
          <AnimatedVerdictScore
            score={score}
            verdictLabel={verdictLabel}
            rows={composition}
            scoreIsProvisional={scoreIsProvisional}
            successful={successful}
            applicable={applicable}
            checkScopeLabel={checkScopeLabel}
          />
          {secondaryScore && (
            <div className="kyle-secondary-score">
              <span className="mono">{secondaryScore.label}</span>
              <strong>{secondaryScore.score ?? "N/A"}<small>{secondaryScore.score == null ? "" : "/100"}</small></strong>
              <em>{secondaryScore.verdictLabel}</em>
              {secondaryScore.context && <p>{secondaryScore.context}</p>}
            </div>
          )}
        </div>
      </header>

      <section className="kyle-knowledge-state" aria-label="What ARGUS knows">
        <div className="kyle-knowledge-item kyle-tone-positive">
          <CheckCircle size={20} weight="duotone" aria-hidden="true" />
          <span><strong>{sourceCount}</strong><small>source-backed score inputs</small></span>
        </div>
        <div className={`kyle-knowledge-item kyle-tone-${adverseCount > 0 ? "negative" : "neutral"}`}>
          <WarningCircle size={20} weight="duotone" aria-hidden="true" />
          <span><strong>{adverseCount}</strong><small>{adverseCount === 1 ? "scored counter-signal" : "scored counter-signals"}</small></span>
        </div>
        <div className="kyle-knowledge-item kyle-tone-unresolved">
          <Question size={20} weight="duotone" aria-hidden="true" />
          <span><strong>{unresolvedCount}</strong><small>unresolved evidence questions</small></span>
        </div>
        <div className="kyle-knowledge-item kyle-tone-neutral">
          <Eye size={20} weight="duotone" aria-hidden="true" />
          <span><strong>{coverage}</strong><small>evidence coverage · {coveragePercent}%</small></span>
        </div>
      </section>

      <section id="composition" className="kyle-score-explanation scroll-mt-28" aria-labelledby="kyle-score-explanation-title">
        <div className="kyle-section-intro">
          <p className="kyle-overline mono">02 · WHY {score ?? verdictLabel}</p>
          <h2 id="kyle-score-explanation-title">The verdict, constructed from evidence.</h2>
          <p>Each dimension shows what it contributed, what remained available, and how strong the supporting record is.</p>
        </div>
        <div className="kyle-composition-ledger">
          <div className="kyle-composition-summary mono">
            <span>{score == null ? "Score withheld" : `${score} points earned`}</span>
            <span>{totalPossible || 100} possible</span>
          </div>
          {sortedComposition.length ? sortedComposition.map((row) => {
            const band = evidenceBand(row);
            const open = Math.max(0, row.weight - row.score);
            return (
              <details key={row.axis} className="kyle-composition-row">
                <summary>
                  <span className={`kyle-evidence-dot kyle-tone-${evidenceTone(band)}`} />
                  <span className="kyle-composition-name">
                    <strong>{row.label}</strong>
                    <small>{band} evidence</small>
                  </span>
                  <span className="kyle-composition-points mono"><strong>{Math.round(row.score)}</strong> / {row.weight}</span>
                  <span className="kyle-composition-open mono">{open > 0 ? `${Math.round(open)} pts not earned` : "fully earned"}</span>
                  <ArrowDown size={15} weight="bold" aria-hidden="true" />
                </summary>
                <div className="kyle-composition-detail">
                  <ClaimLabel type={band === "Strong" ? "FACT" : "INFERENCE"} strength={band} />
                  <p>{sentence(row.rationale) || "No public rationale was saved for this dimension."}</p>
                  <div>
                    <span className="mono">{row.supportCount ?? 0} supporting source{row.supportCount === 1 ? "" : "s"}</span>
                    {(row.counterCount ?? 0) > 0 && <span className="mono kyle-text-negative">{row.counterCount} counter-signal{row.counterCount === 1 ? "" : "s"}</span>}
                    {(row.questionCount ?? 0) > 0 && <span className="mono kyle-text-unresolved">{row.questionCount} open question{row.questionCount === 1 ? "" : "s"}</span>}
                    <a href={row.evidenceHref ?? evidenceHref}>View evidence <ArrowRight size={13} weight="bold" /></a>
                  </div>
                </div>
              </details>
            );
          }) : (
            <p className="kyle-empty-ledger">This saved report does not contain a score composition.</p>
          )}
        </div>
      </section>

      <section id="decision-brief" className="kyle-argus-brief scroll-mt-28" aria-labelledby="kyle-argus-brief-title">
        <div className="kyle-section-intro">
          <p className="kyle-overline mono">03 · ARGUS BRIEF</p>
          <h2 id="kyle-argus-brief-title">The decision, without the research-engine language.</h2>
          <p>Three views of the same frozen evidence: the limitation, the counterweight, and the evidence most likely to change the result.</p>
        </div>
        <div className="kyle-brief-grid">
          <BriefColumn title="Why we’re cautious" subtitle="DECISION PRESSURE" items={concerns} tone="caution" empty="No decision-changing concern was recorded." href={evidenceHref} />
          <BriefColumn title="Why this may still be credible" subtitle="COUNTERWEIGHT" items={supports} tone="positive" empty="No positive counterweight was recorded." href={evidenceHref} />
          <BriefColumn title="What could change the verdict" subtitle="EXPECTED DECISION VALUE" items={nextSteps} tone="unresolved" empty="No required question remains open." href={methodologyHref} />
        </div>
      </section>

      <section className="kyle-argus-take" aria-labelledby="kyle-argus-take-title">
        <div className="kyle-section-intro">
          <p className="kyle-overline mono">04 · THE ARGUS TAKE</p>
          <h2 id="kyle-argus-take-title">What the evidence means.</h2>
          <p>Concise analytical justification—not private model reasoning and not a transcript of the research prompts.</p>
        </div>
        {decisionLensId && onDecisionLensChange && (
          <div className="kyle-decision-lens">
            <DecisionLensSelector value={decisionLensId} onChange={onDecisionLensChange} />
          </div>
        )}
        <div className="kyle-evidence-ladder">
          <article>
            <span className="mono">FACT</span>
            <h3>Observed</h3>
            <p>{sentence(strongestSupport?.label) || "No leading fact was recorded."}</p>
            {strongestSupport?.detail && <small>{sentence(strongestSupport.detail)}</small>}
          </article>
          <ArrowDown size={17} aria-hidden="true" />
          <article>
            <span className="mono">SIGNAL</span>
            <h3>Interpretation</h3>
            <p>{sentence(argument?.forLine) || thesis}</p>
          </article>
          <ArrowDown size={17} aria-hidden="true" />
          <article>
            <span className="mono">INFERENCE</span>
            <h3>Implication</h3>
            <p>{sentence(argument?.againstLine) || sentence(mainConcern?.label) || "No decision-changing implication was recorded."}</p>
          </article>
          <ArrowDown size={17} aria-hidden="true" />
          <article className="kyle-ladder-final">
            <span className="mono">FALSIFIABLE</span>
            <h3>What would change our mind?</h3>
            <p>{sentence(argument?.moveLine) || sentence(topNextStep?.label) || "No required check remains open."}</p>
          </article>
        </div>
        {context.length > 0 && (
          <details className="kyle-context-disclosure">
            <summary>Review additional decision context <span className="mono">{context.length}</span></summary>
            <ul>{context.slice(0, 6).map((item, index) => <li key={`context-${index}`}><strong>{sentence(item.label)}</strong>{item.detail && <span>{sentence(item.detail)}</span>}</li>)}</ul>
          </details>
        )}
      </section>

      {discovery && (
        <section className="kyle-beneath-headlines" aria-labelledby="kyle-beneath-headlines-title">
          <div>
            <p className="kyle-overline mono">BENEATH THE HEADLINES</p>
            <h2 id="kyle-beneath-headlines-title">ARGUS found a source-backed pattern worth seeing.</h2>
          </div>
          <div className="kyle-beneath-headlines-body">
            <ClaimLabel type="SIGNAL" strength="Moderate" />
            <h3>{sentence(discovery.headline)}</h3>
            <p>{sentence(discovery.consequence)}</p>
            {discovery.path && discovery.path.length > 1 && (
              <p className="kyle-discovery-path mono">{discovery.path.map(executiveText).join(" → ")}</p>
            )}
            <dl>
              <div><dt>What would change this interpretation</dt><dd>{sentence(discovery.reversalCondition)}</dd></div>
            </dl>
            <a href={discovery.evidenceHref}>Open the proof <ArrowRight size={14} weight="bold" /></a>
          </div>
        </section>
      )}

      {decisionBoundary && decisionBoundaryEvidenceHref && (
        <section className="kyle-decision-lock" aria-labelledby="kyle-decision-lock-title">
          <div>
            <p className="kyle-overline mono">DECISION LOCK</p>
            <h2 id="kyle-decision-lock-title">What controls this result.</h2>
            <p>{sentence(decisionBoundary.controllingFact)}</p>
          </div>
          <dl>
            <div><dt>Current boundary</dt><dd>{sentence(decisionBoundary.boundary)}</dd></div>
            <div><dt>What will not change it</dt><dd>{sentence(decisionBoundary.willNotChange)}</dd></div>
            <div><dt>What would unlock it</dt><dd>{sentence(decisionBoundary.unlockCondition)}</dd></div>
          </dl>
          <a href={decisionBoundaryEvidenceHref}>Open governing evidence <ArrowRight size={14} weight="bold" /></a>
        </section>
      )}

      <section className="kyle-counter-thesis" aria-labelledby="kyle-counter-thesis-title">
        <ShieldCheck size={26} weight="duotone" aria-hidden="true" />
        <div>
          <p className="kyle-overline mono">ARGUS CHALLENGES ITS OWN VIEW</p>
          <h2 id="kyle-counter-thesis-title">The strongest case against the current thesis.</h2>
          <dl>
            <div><dt>Strongest counter-signal</dt><dd>{sentence(favorable ? mainConcern?.label : strongestSupport?.label) || "No counter-signal was recorded."}</dd></div>
            <div><dt>Why it has not changed the verdict</dt><dd>{sentence(favorable ? argument?.againstLine : argument?.forLine) || "Its evidentiary weight is already reflected in the score."}</dd></div>
            <div><dt>What would make it material</dt><dd>{sentence(argument?.moveLine) || sentence(topNextStep?.label) || "New source-backed evidence would be required."}</dd></div>
          </dl>
          {challengeAnchorId && <a href={`#${challengeAnchorId}`}>Challenge the thesis <MagnifyingGlassPlus size={15} weight="bold" /></a>}
        </div>
      </section>

      <section className="kyle-watch-next" aria-labelledby="kyle-watch-next-title">
        <div className="kyle-section-intro">
          <p className="kyle-overline mono">05 · WHAT HAPPENS NEXT</p>
          <h2 id="kyle-watch-next-title">What ARGUS is watching.</h2>
          <p>The unresolved items with the highest current decision value. No prediction is shown unless the saved evidence supports one.</p>
        </div>
        {nextSteps.length ? (
          <ol>
            {nextSteps.slice(0, 3).map((item, index) => (
              <li key={`watch-${index}`}>
                <span className="mono">WATCH {String(index + 1).padStart(2, "0")}</span>
                <h3>{sentence(item.label)}</h3>
                {item.detail && <p>{sentence(item.detail)}</p>}
                <a href={methodologyHref}>Open the underlying question <ArrowRight size={13} weight="bold" /></a>
              </li>
            ))}
          </ol>
        ) : (
          <div className="kyle-quiet-state">
            <CheckCircle size={23} weight="duotone" aria-hidden="true" />
            <div><strong>No required question remains open.</strong><p>A new scan would show whether the current thesis still holds.</p></div>
          </div>
        )}
      </section>

      <section className="kyle-company-snapshot" aria-labelledby="kyle-company-snapshot-title">
        <div>
          <p className="kyle-overline mono">COMPANY SNAPSHOT</p>
          <h2 id="kyle-company-snapshot-title">What {name} actually does.</h2>
          <p>{summary || "No source-backed product description was saved with this report."}</p>
        </div>
        <div className="kyle-frozen-report">
          <ClockCounterClockwise size={20} weight="duotone" aria-hidden="true" />
          <span><strong>Frozen report</strong><small>{capturedAt ? `Evidence reflects the source state saved ${capturedAt}.` : "Evidence reflects the source state saved with this report."}</small></span>
        </div>
      </section>

      <footer className="kyle-evidence-room-gateway">
        <div>
          <p className="kyle-overline mono">THE FORENSIC RECORD REMAINS INTACT</p>
          <h2>Every source, identity, score component, and unresolved question is still available.</h2>
          <p>{scoreContext || "Open the full record to inspect the evidence behind this result."}</p>
        </div>
        <div>
          <button type="button" onClick={() => setDepth("analysis")}>Open full analysis</button>
          <a href={evidenceHref} onClick={() => setDepth("evidence")}>Enter evidence room <ArrowRight size={14} weight="bold" /></a>
        </div>
      </footer>
    </section>
  );
}
