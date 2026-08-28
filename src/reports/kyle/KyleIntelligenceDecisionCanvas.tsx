import { useId, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";
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
import { compositionRowColor, type CompositionRow } from "../../components/ScoreComposition";
import { ScoreRing } from "../../components/ScoreRing";
import type { DecisionLensId } from "../../intelligence/types";
import type { TokenDecisionBoundary } from "../../lib/decisionBoundary";
import type { DecisionDiscovery, VerdictArgument } from "../../lib/reportInsights";
import { neutralizeProductCopy } from "../../lib/productLanguage";
import "./kyle-intelligence-report.css";

export interface KyleDecisionItem {
  label: string;
  detail?: string | undefined;
  impactAxis?: string | undefined;
  impact?: string | undefined;
}

export interface KyleSecondaryScore {
  label: string;
  score: number | null;
  verdictLabel: string;
  context?: string | undefined;
  composition?: CompositionRow[] | undefined;
  scoreIsProvisional?: boolean | undefined;
  successful?: number | undefined;
  applicable?: number | undefined;
  checkScopeLabel?: string | undefined;
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

function evidenceBand(row: CompositionRow): "Strong" | "Moderate" | "Limited" | "Unresolved" | "Not applicable" | "Deferred" {
  if (row.applicability === "not_applicable") return "Not applicable";
  if (row.applicability === "deferred") return "Deferred";
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
  nextSteps: KyleDecisionItem[],
): string {
  const strongest = [...rows]
    .filter((row) => row.weight > 0 && (row.supportCount ?? 0) > 0)
    .sort((left, right) => {
      const supportDifference = (right.supportCount ?? 0) - (left.supportCount ?? 0);
      if (supportDifference !== 0) return supportDifference;
      return (right.score / right.weight) - (left.score / left.weight);
    })[0];
  const lead = strongest ? `${strongest.label} leads the evidence.` : "The available evidence establishes a starting position.";
  if (favorable && unresolvedCount === 0 && adverseCount === 0) return `${lead} No decision-critical gap is recorded.`;
  if (adverseCount > 0) return `${lead} ${adverseCount} scored counter-${adverseCount === 1 ? "signal requires" : "signals require"} review.`;
  const unresolvedText = nextSteps.map((item) => `${item.label} ${item.detail ?? ""}`).join(" ").toLowerCase();
  const unresolvedEvidence = /audit|security|governance|treasury|control/.test(unresolvedText)
    ? "independent security and governance evidence"
    : /team|founder|leadership|identity|operator|advisor/.test(unresolvedText)
      ? "independent team and identity confirmation"
      : /product|service|roadmap|build|execution/.test(unresolvedText)
        ? "independent product evidence"
        : /usage|customer|activity|revenue|traction|adoption|market/.test(unresolvedText)
          ? "independent usage and market evidence"
          : "some decision-critical evidence";
  if (strongest) {
    const strongestLabel = strongest.label.replace(/\s*&\s*/g, " and ");
    return `${strongestLabel} is the strongest verified part of the case. The available public record still lacks ${unresolvedEvidence}.`;
  }
  return `The available evidence establishes a starting position. The available public record still lacks ${unresolvedEvidence}.`;
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

function verificationImpact(
  item: KyleDecisionItem,
  rows: CompositionRow[],
): string | null {
  if (item.impact) return item.impact;
  if (!item.impactAxis) return null;
  const row = rows.find((candidate) => candidate.axis === item.impactAxis);
  if (!row || row.applicability !== undefined || row.weight <= row.score) return null;
  const openPoints = Math.max(1, Math.round(row.weight - row.score));
  return `Decision impact: this question is tied to ${row.label}, where ${openPoints} ${openPoints === 1 ? "point remains" : "points remain"} open.`;
}

function VerifyNextStrip({
  items,
  rows,
  href,
}: {
  items: KyleDecisionItem[];
  rows: CompositionRow[];
  href: `#${string}`;
}) {
  if (items.length === 0) return null;
  return (
    <section className="kyle-verify-next" aria-labelledby="kyle-verify-next-title">
      <header>
        <p className="kyle-overline mono">VERIFY NEXT</p>
        <h3 id="kyle-verify-next-title">The evidence most likely to change the decision.</h3>
      </header>
      <ol>
        {items.slice(0, 2).map((item, index) => {
          const impact = verificationImpact(item, rows);
          return (
            <li key={`verify-next-${index}`}>
              <span className="kyle-verify-index mono">0{index + 1}</span>
              <div>
                <strong>{sentence(item.label)}</strong>
                {item.detail && <p>{sentence(item.detail)}</p>}
                {impact ? <small>{impact}</small> : null}
              </div>
              <a href={href} aria-label={`Open evidence question: ${executiveText(item.label)}`}>
                Open question <ArrowRight size={13} weight="bold" />
              </a>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function scoreRingSegments(rows: CompositionRow[], size: number) {
  const stroke = size >= 200 ? 5.5 : 4;
  const radius = size / 2 - (size >= 200 ? 8 : 6);
  const circumference = 2 * Math.PI * radius;
  const pieceGap = rows.length > 1 ? 2.75 : 0;
  let cursor = 0;
  const segments = rows.flatMap((row) => {
    const remaining = 100 - cursor;
    if (remaining <= 0) return [];
    const length = Math.min(Math.max(0, row.score), remaining);
    if (length <= 0) return [];
    const from = cursor;
    const to = cursor + length;
    cursor = to;
    const start = (from / 100) * circumference;
    const raw = ((to - from) / 100) * circumference;
    const inset = raw > pieceGap * 2 ? pieceGap : 0;
    return [{
      row,
      color: compositionRowColor(row),
      strokeDasharray: `${Math.max(0, raw - inset)} ${circumference}`,
      strokeDashoffset: -(start + inset / 2),
    }];
  });
  return { segments, stroke, radius };
}

function AnimatedVerdictScore({
  kind,
  label,
  score,
  verdictLabel,
  rows,
  scoreIsProvisional = false,
  successful,
  applicable,
  checkScopeLabel,
  context,
  size,
}: {
  kind: "primary" | "secondary";
  label: string;
  score: number | null;
  verdictLabel: string;
  rows: CompositionRow[];
  scoreIsProvisional?: boolean;
  successful?: number;
  applicable?: number;
  checkScopeLabel?: string;
  context?: string | undefined;
  size: number;
}) {
  const buildRows = rows.filter((row) => row.score > 0);
  const applicableWeight = buildRows.reduce((sum, row) => sum + Math.max(0, row.weight), 0) || 100;
  const hasExcludedAxis = rows.some((row) => row.applicability !== undefined);
  const ringRows = hasExcludedAxis && applicableWeight < 100
    ? buildRows.map((row) => ({
        ...row,
        score: (row.score / applicableWeight) * 100,
        weight: (row.weight / applicableWeight) * 100,
      }))
    : buildRows;
  const tone = scoreTone(score);
  const ringColor = tone === "positive"
    ? "var(--kyle-editorial-green)"
    : tone === "negative"
      ? "var(--kyle-editorial-red)"
      : tone === "caution"
        ? "var(--kyle-editorial-amber)"
        : "var(--color-ink-faint)";
  const checksCopy = typeof applicable === "number"
    ? applicable === 0
      ? "No checks saved"
      : `${successful ?? 0}/${applicable} ${(checkScopeLabel ?? "checks").toLowerCase()} complete${scoreIsProvisional ? " · provisional" : ""}`
    : null;
  const [explainedAxis, setExplainedAxis] = useState<string | null>(null);
  const explanationId = useId();
  const explainedRow = buildRows.find((row) => row.axis === explainedAxis) ?? null;
  const { segments, stroke, radius } = scoreRingSegments(ringRows, size);
  const clearPointerExplanation = (event: MouseEvent<SVGCircleElement>) => {
    if (document.activeElement !== event.currentTarget) setExplainedAxis(null);
  };
  const handleSegmentKey = (event: KeyboardEvent<SVGCircleElement>) => {
    if (event.key !== "Escape") return;
    setExplainedAxis(null);
    event.currentTarget.blur();
  };

  return (
    <article
      className={`kyle-verdict-score kyle-score-ring-card kyle-score-ring-card--${kind} kyle-tone-${tone}`}
      data-score-kind={kind}
      aria-label={score == null ? `${label} withheld` : `${label} ${score} out of 100`}
    >
      <p className="kyle-score-ring-label mono">{label}</p>
      <div
        className="kyle-interactive-score-ring"
        data-active-axis={explainedRow?.axis}
        style={{ width: size }}
      >
        <div className="kyle-score-ring-base">
          <ScoreRing
            score={score}
            verdict={verdictLabel}
            color={ringColor}
            size={size}
            bands={score != null}
            composition={ringRows}
            fallbackLabel={label}
          >
            <div className="kyle-score-status">
              <p className="kyle-verdict-word score-ring-verdict mono">{score == null ? "Not measured" : verdictLabel}</p>
              {context && <p className="kyle-score-context">{context}</p>}
              {checksCopy && <p className="kyle-check-state mono">{checksCopy}</p>}
            </div>
          </ScoreRing>
        </div>
        {segments.length > 0 && (
          <svg
            width={size}
            height={size}
            className="kyle-score-ring-hit-layer"
            aria-label="Score composition. Explore each arc for its dimension and contribution."
            role="group"
          >
            {explainedRow && segments.filter(({ row }) => row.axis === explainedRow.axis).map((segment) => (
              <circle
                key={`active-${segment.row.axis}`}
                data-score-ring-piece-active={segment.row.axis}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth={stroke + 2.5}
                strokeLinecap="butt"
                strokeDasharray={segment.strokeDasharray}
                strokeDashoffset={segment.strokeDashoffset}
                aria-hidden="true"
              />
            ))}
            {segments.map((segment) => {
              const { row } = segment;
              const isExplained = explainedRow?.axis === row.axis;
              const evidence = [
                (row.supportCount ?? 0) > 0 ? `${row.supportCount} supporting ${row.supportCount === 1 ? "source" : "sources"}` : "",
                (row.counterCount ?? 0) > 0 ? `${row.counterCount} counter-${row.counterCount === 1 ? "signal" : "signals"}` : "",
                (row.questionCount ?? 0) > 0 ? `${row.questionCount} open ${row.questionCount === 1 ? "question" : "questions"}` : "",
              ].filter(Boolean).join(", ");
              const accessibleLabel = `${row.label}: ${row.score} of ${row.weight} available points. ${row.rationale}${evidence ? ` ${evidence}.` : ""}`;
              return (
                <circle
                  key={`hit-${row.axis}`}
                  data-score-ring-piece-hit={row.axis}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(18, stroke + 12)}
                  strokeLinecap="butt"
                  strokeDasharray={segment.strokeDasharray}
                  strokeDashoffset={segment.strokeDashoffset}
                  role="button"
                  tabIndex={0}
                  aria-label={accessibleLabel}
                  aria-pressed={isExplained}
                  aria-describedby={isExplained ? explanationId : undefined}
                  focusable="true"
                  onMouseEnter={() => setExplainedAxis(row.axis)}
                  onMouseLeave={clearPointerExplanation}
                  onFocus={() => setExplainedAxis(row.axis)}
                  onBlur={() => setExplainedAxis(null)}
                  onClick={() => setExplainedAxis(row.axis)}
                  onKeyDown={handleSegmentKey}
                />
              );
            })}
          </svg>
        )}
        {explainedRow && (
          <div
            id={explanationId}
            className="score-ring-explanation"
            data-score-ring-explanation={explainedRow.axis}
            role="tooltip"
          >
            <span className="score-ring-explanation-kicker mono">Score dimension</span>
            <span className="score-ring-explanation-label">{explainedRow.label}</span>
            <span className="score-ring-explanation-points mono">{explainedRow.score} of {explainedRow.weight} points</span>
            <span className="score-ring-explanation-rationale">{explainedRow.rationale}</span>
          </div>
        )}
      </div>
    </article>
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
  const summary = sentence(neutralizeProductCopy(subjectSummary ?? ""));
  const headline = verdictHeadline(composition, favorable, adverseCount, unresolvedCount, nextSteps);
  const coverage = coverageLabel(coveragePercent);

  const sortedComposition = useMemo(() => [...composition].sort((left, right) => right.weight - left.weight), [composition]);
  const totalPossible = composition.reduce((sum, row) => sum + row.weight, 0);

  return (
    <section id="report-summary" className="kyle-intelligence-report scroll-mt-28" data-kyle-intelligence-report="true">
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
        <div className={`kyle-verdict-visual${secondaryScore ? " kyle-verdict-visual--dual" : ""}`}>
          <AnimatedVerdictScore
            kind="primary"
            label={scoreLabel}
            score={score}
            verdictLabel={verdictLabel}
            rows={composition}
            scoreIsProvisional={scoreIsProvisional}
            successful={successful}
            applicable={applicable}
            checkScopeLabel={checkScopeLabel}
            context={scoreContext}
            size={252}
          />
          {secondaryScore && (
            <AnimatedVerdictScore
              kind="secondary"
              label={secondaryScore.label}
              score={secondaryScore.score}
              verdictLabel={secondaryScore.verdictLabel}
              rows={secondaryScore.composition ?? []}
              scoreIsProvisional={secondaryScore.scoreIsProvisional}
              successful={secondaryScore.successful}
              applicable={secondaryScore.applicable}
              checkScopeLabel={secondaryScore.checkScopeLabel}
              context={secondaryScore.context}
              size={208}
            />
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
            const excluded = row.applicability !== undefined;
            const open = Math.max(0, row.weight - row.score);
            return (
              <details key={row.axis} className="kyle-composition-row">
                <summary>
                  <span className={`kyle-evidence-dot kyle-tone-${evidenceTone(band)}`} />
                  <span className="kyle-composition-name">
                    <strong>{row.label}</strong>
                    <small>{band} evidence</small>
                  </span>
                  <span className="kyle-composition-points mono">{excluded ? <strong>N/A</strong> : <><strong>{Math.round(row.score)}</strong> / {row.weight}</>}</span>
                  <span className="kyle-composition-open mono">{excluded ? "not scored" : open > 0 ? `${Math.round(open)} ${Math.round(open) === 1 ? "pt" : "pts"} not earned` : "fully earned"}</span>
                  <ArrowDown size={15} weight="bold" aria-hidden="true" />
                </summary>
                <div className="kyle-composition-detail">
                  <ClaimLabel type={band === "Strong" || excluded ? "FACT" : "INFERENCE"} strength={band} />
                  <p>{sentence(row.rationale) || "No public rationale was saved for this dimension."}</p>
                  <div>
                    <span className="mono">{row.supportCount ?? 0} supporting source{row.supportCount === 1 ? "" : "s"}</span>
                    {(row.counterCount ?? 0) > 0 && <span className="mono kyle-text-negative">{row.counterCount} counter-signal{row.counterCount === 1 ? "" : "s"}</span>}
                    {(row.questionCount ?? 0) > 0 && <span className="mono kyle-text-unresolved">{row.questionCount} open question{row.questionCount === 1 ? "" : "s"}</span>}
                    {!excluded && <a href={row.evidenceHref ?? evidenceHref}>View evidence <ArrowRight size={13} weight="bold" /></a>}
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
          <h2 id="kyle-argus-brief-title">What matters before you decide.</h2>
          <p>The strongest case for it, the reason to hesitate, and the evidence that could change the verdict.</p>
        </div>
        <div className="kyle-brief-grid">
          <BriefColumn title="Why we’re cautious" subtitle="DECISION PRESSURE" items={concerns} tone="caution" empty="No decision-changing concern was recorded." href={evidenceHref} />
          <BriefColumn title="Why this may still be credible" subtitle="COUNTERWEIGHT" items={supports} tone="positive" empty="No positive counterweight was recorded." href={evidenceHref} />
        </div>
        <VerifyNextStrip items={nextSteps} rows={sortedComposition} href={methodologyHref} />
      </section>

      <section className="kyle-argus-take" aria-labelledby="kyle-argus-take-title">
        <div className="kyle-section-intro">
          <p className="kyle-overline mono">04 · THE ARGUS TAKE</p>
          <h2 id="kyle-argus-take-title">The bottom line.</h2>
          <p>The clearest reading of what is established, where the case is strongest, and what still deserves scrutiny.</p>
        </div>
        <p className="kyle-take-thesis">{thesis}</p>
        <div className="kyle-take-grid">
          <article>
            <span className="mono">EVIDENCE BASE</span>
            <h3>{sentence(strongestSupport?.label) || "No leading support was recorded."}</h3>
            {strongestSupport?.detail && <p>{sentence(strongestSupport.detail)}</p>}
          </article>
          <article>
            <span className="mono">THE RESERVATION</span>
            <h3>{sentence(mainConcern?.label) || "No decision-changing concern was recorded."}</h3>
            {mainConcern?.detail && <p>{sentence(mainConcern.detail)}</p>}
          </article>
          {topNextStep && (
            <article className="kyle-take-next">
              <span className="mono">WHAT TO VERIFY NEXT</span>
              <h3>{sentence(topNextStep.label)}</h3>
              {topNextStep.detail && <p>{sentence(topNextStep.detail)}</p>}
            </article>
          )}
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
          <a className="kyle-primary-report-link" href="#composition">Continue through the full report</a>
          <a href={evidenceHref}>Enter evidence room <ArrowRight size={14} weight="bold" /></a>
        </div>
      </footer>
    </section>
  );
}
