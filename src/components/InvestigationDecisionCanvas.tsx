import { ArrowRight, ClockCounterClockwise, Database } from "@phosphor-icons/react";
import {
  ReportCanvasNarrativeSection,
  type ReportCanvasTone,
  type ReportCanvasNarrativeItem,
} from "./ReportCanvasPrimitives";
import { publicCheckLabel } from "../lib/plainLanguage";
import { requestChallenge } from "../lib/challenge";
import type { VerdictArgument } from "../lib/reportInsights";
import type { DecisionLensId } from "../intelligence/types";
import { DecisionLensSelector, VerdictArgumentBlock } from "./InvestigatorBrief";
import { ScoreRing } from "./ScoreRing";

export interface DecisionCanvasItem {
  label: string;
  detail?: string | undefined;
}

function plainDecisionText(value: string): string {
  return publicCheckLabel(value)
    .trim()
    .replace(/^Resolve deployer trail$/i, "Who created the token")
    .replace(/^Resolve bytecode fingerprint$/i, "Copied contract code")
    .replace(/^Check deployer trail$/i, "Who created the token")
    .replace(/^Check bytecode fingerprint$/i, "Copied contract code")
    .replace(/^Resolve wallet clustering$/i, "Connected holder wallets")
    .replace(/^Resolve operator\s*\/\s*funding trace$/i, "Where the token creator’s funds came from")
    .replace(/^Resolve holder distribution$/i, "Large holder distribution")
    .replace(/^Corroborated on CoinGecko/i, "Listed on CoinGecko")
    .replace(/\bWallet clustering\b/gi, "Connected holder wallets")
    .replace(/\bSell simulation passed \(buy ([\d.]+)% \/ sell ([\d.]+)%\)\./gi, "Buying and selling worked in the test ($1% buy fee / $2% sell fee).")
    .replace(/\bBuy\s*\/\s*sell simulation\b/gi, "Buy and sell test")
    .replace(/\bHolder distribution\b/gi, "Large holders")
    .replace(/\bContract safety\b/gi, "Contract controls")
    .replace(/\bmint authority active\s*·\s*owner active\b/gi, "more tokens can be created · contract owner still has control")
    .replace(/\bMint authority is live:\s*supply can be minted\.\s*/gi, "More tokens can still be created. ")
    .replace(/\bOn a token with real centralized-exchange listings this is typically a governed emissions\/ops mechanism, not a rug setup\.\s*/gi, "For a token listed on major exchanges, this may be part of normal operations rather than a scam. ")
    .replace(/\bConfirm the controller\./gi, "Check who controls this power.")
    .replace(/\bLiquidity does not appear locked or burned\./gi, "Trading funds are not locked away, so they could still be removed.")
    .replace(/\bcentralized markets\b/gi, "centralized exchange listings")
    .replace(/holder rows analyzed/gi, "holder wallets checked")
    .replace(/no elevated concentration surfaced/gi, "no unusual wallet concentration found")
    .replace(/redeployed-rug clone check;\s*completion outcome not recorded/gi, "We could not finish checking whether the contract copies code from a known scam.")
    .replace(/completion outcome not recorded/gi, "This check did not finish.")
    .replace(/\s+/g, " ")
    .trim();
}

/* The case grid, in the storytelling voice: two open columns under mono
   colored headers, hairline rows with a dash marker. This is written for a
   human deciding, not a machine parsing. Items in the pushable column carry
   "Question this finding", which opens the ask console seeded
   with that exact concern. */
function CaseColumn({ id, title, tone, items, emptyCopy, pushNote, challengeAnchorId }: {
  id?: string;
  title: string;
  tone: ReportCanvasTone;
  items: DecisionCanvasItem[];
  emptyCopy: string;
  pushNote?: boolean;
  challengeAnchorId?: string | null;
}) {
  const headerColor = tone === "pass" ? "var(--color-pass)"
    : tone === "caution" ? "var(--color-caution)"
      : tone === "avoid" ? "var(--color-avoid)"
        : tone === "signal" ? "var(--color-signal)"
          : "var(--color-ink-faint)";
  const pushable = Boolean(pushNote && challengeAnchorId);
  const visibleItems = items.slice(0, 3);
  const additionalItems = items.slice(3);

  const renderItem = (item: DecisionCanvasItem, index: number, keyPrefix: string) => {
    const label = plainDecisionText(item.label);
    return (
      <li key={`${keyPrefix}-${index}`} className="border-b border-line/60 py-3 pl-5 text-[15px] leading-relaxed text-ink" style={{ position: "relative" }}>
        <span aria-hidden="true" className="absolute left-0 top-3" style={{ color: headerColor }}>–</span>
        {label}
        {item.detail && <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-faint">{plainDecisionText(item.detail)}</span>}
        {pushable && (
          <button
            type="button"
            onClick={() => requestChallenge(label, challengeAnchorId!)}
            className="mono mt-1.5 block cursor-pointer text-[10px] font-medium uppercase tracking-[0.12em] text-caution opacity-80 transition hover:opacity-100"
          >
            Question this finding ›
          </button>
        )}
      </li>
    );
  };

  return (
    <section id={id} className="min-w-0 scroll-mt-28">
      <h3
        className="mono border-b border-line pb-2.5 text-[11px] font-medium uppercase tracking-[0.16em]"
        style={{ color: headerColor }}
      >
        {title}
        {pushable && <span className="text-ink-faint"> · open to question</span>}
      </h3>
      {items.length ? (
        <>
          <ul aria-label={title}>
            {visibleItems.map((item, index) => renderItem(item, index, title))}
          </ul>
          {additionalItems.length > 0 && (
            <details className="decision-evidence-more group border-b border-line/60">
              <summary className="mono flex min-h-11 cursor-pointer list-none items-center gap-2 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-signal-lift [&::-webkit-details-marker]:hidden">
                <span>Review {additionalItems.length} more evidence {additionalItems.length === 1 ? "point" : "points"}</span>
                <span aria-hidden="true" className="text-[9px] transition-transform group-open:rotate-180">▾</span>
              </summary>
              <ul aria-label={`Additional ${title.toLowerCase()}`}>
                {additionalItems.map((item, index) => renderItem(item, index, `${title}-additional`))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
    </section>
  );
}

function narrativeItems(prefix: string, items: DecisionCanvasItem[], href?: `#${string}`): ReportCanvasNarrativeItem[] {
  return items.map((item, index) => ({
    id: `${prefix}-${index}`,
    title: plainDecisionText(item.label),
    ...(item.detail ? { detail: plainDecisionText(item.detail) } : {}),
    ...(href ? { href } : {}),
  }));
}

function DecisionLedgerList({
  title,
  items,
  href,
  emptyCopy,
  limit = 5,
}: {
  title: string;
  items: DecisionCanvasItem[];
  href: `#${string}`;
  emptyCopy: string;
  limit?: number;
}) {
  const visible = items.slice(0, limit);
  const remaining = Math.max(0, items.length - visible.length);

  return (
    <section className="border-t border-line/60 py-4 first:border-t-0 first:pt-0" aria-label={title}>
      <div className="flex items-center gap-2">
        <h3 className="eyebrow text-ink-dim">{title}</h3>
        <span className="mono ml-auto text-[11px] text-ink-faint">{items.length}</span>
      </div>
      {visible.length ? (
        <ul className="mt-2 divide-y divide-line/50">
          {visible.map((item, index) => (
            <li key={`${title}-${index}`}>
              <a href={href} className="group flex items-start gap-2 py-2.5 text-[12.5px] leading-snug text-ink-dim hover:text-ink">
                <span className="min-w-0 flex-1">
                  <span className="block font-medium text-ink">{plainDecisionText(item.label)}</span>
                  {item.detail && <span className="mt-0.5 block text-[11.5px] text-ink-faint">{plainDecisionText(item.detail)}</span>}
                </span>
                <ArrowRight aria-hidden="true" size={13} weight="bold" className="mt-0.5 shrink-0 text-ink-faint transition group-hover:text-signal-lift" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink-faint">{emptyCopy}</p>
      )}
      {remaining > 0 && (
        <a href={href} className="mono mt-2 inline-flex text-[10.5px] uppercase tracking-[0.08em] text-signal-lift hover:underline">
          Review {remaining} more
        </a>
      )}
    </section>
  );
}

export function InvestigationDecisionCanvas({
  verdictLabel,
  score,
  scoreIsProvisional = false,
  favorable,
  verdictTone,
  supports,
  concerns,
  context = [],
  nextSteps,
  verified,
  coveragePercent,
  successful,
  applicable,
  capturedAt,
  argument,
  decisionLensId,
  onDecisionLensChange,
  evidenceHref = "#token-evidence",
  methodologyHref = "#token-methodology",
  challengeAnchorId = null,
  checkScopeLabel = "Required report checks",
}: {
  verdictLabel: string;
  /** Saved ARGUS risk score. Null means the scoring contract withheld it. */
  score: number | null;
  /** Marks a saved score that readers may inspect while required checks remain open. */
  scoreIsProvisional?: boolean;
  favorable: boolean;
  verdictTone: ReportCanvasTone;
  argument?: VerdictArgument | undefined;
  decisionLensId?: DecisionLensId | undefined;
  onDecisionLensChange?: ((lensId: DecisionLensId) => void) | undefined;
  supports: DecisionCanvasItem[];
  concerns: DecisionCanvasItem[];
  context?: DecisionCanvasItem[];
  nextSteps: DecisionCanvasItem[];
  verified: DecisionCanvasItem[];
  coveragePercent: number;
  successful: number;
  applicable: number;
  capturedAt?: string | undefined;
  evidenceHref?: `#${string}`;
  methodologyHref?: `#${string}`;
  /** Anchor id of the ask console; null hides the per-item challenge push. */
  challengeAnchorId?: string | null;
  /** Public name for the exact check set behind successful/applicable. */
  checkScopeLabel?: string;
}) {
  const verdictItems = favorable ? supports : concerns;
  const countervailingItems = favorable ? concerns : supports;
  const verdictClass = verdictTone === "pass"
    ? "text-pass"
    : verdictTone === "avoid"
      ? "text-avoid"
        : verdictTone === "caution"
          ? "text-caution"
          : "text-ink";
  const verdictColor = verdictTone === "pass"
    ? "var(--color-pass)"
    : verdictTone === "avoid"
      ? "var(--color-avoid)"
      : verdictTone === "caution"
        ? "var(--color-caution)"
        : "var(--color-ink)";

  return (
    <section id="report-summary" data-canonical-decision-brief="true" className="story-chapter report-section mt-6 scroll-mt-28">
      <header className="report-section-heading decision-brief-heading">
        <div>
          <p className="eyebrow text-signal-lift">01 · Decision brief</p>
          <h2 className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">What this report means</h2>
          <p className="story-chapter-description mt-2 max-w-2xl leading-relaxed text-ink-dim">
            The strongest evidence, the main risks, and what to check next.
          </p>
        </div>
        <div
          className="decision-score-lockup shrink-0"
          data-report-score="prominent"
          aria-label={score == null ? "ARGUS risk score withheld" : `ARGUS risk score ${score} out of 100`}
        >
          <p className="mono text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {score != null && scoreIsProvisional ? "Early risk score" : "ARGUS risk score"}
          </p>
          <ScoreRing
            score={score}
            verdict={verdictLabel}
            color={verdictColor}
            size={120}
            bands={score != null}
          />
          <div className="decision-score-copy">
            <p className={`mono text-[11px] font-semibold uppercase tracking-[0.1em] ${verdictClass}`}>{verdictLabel}</p>
            {score == null && (
              <p className="mono mt-1 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink">Score withheld</p>
            )}
            <p className="mono mt-1 text-[10px] uppercase tracking-[0.1em] text-ink-faint">
              {score != null && scoreIsProvisional
                ? `${successful}/${applicable} ${checkScopeLabel.toLowerCase()} complete · provisional`
                : applicable === 0
                  ? "No checks saved"
                  : `${successful}/${applicable} ${checkScopeLabel.toLowerCase()} complete`}
            </p>
          </div>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        {argument && (
          <div className="border-b border-line/70 px-5 py-4">
            {decisionLensId && onDecisionLensChange && (
              <DecisionLensSelector value={decisionLensId} onChange={onDecisionLensChange} />
            )}
            <VerdictArgumentBlock argument={argument} />
          </div>
        )}
        <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="px-5 py-5">
            <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
              <CaseColumn
                title={favorable ? "What supports this result" : "Main concerns"}
                tone={favorable ? verdictTone : "avoid"}
                items={verdictItems}
                emptyCopy={favorable
                  ? "No sourced support is recorded yet. Read the open questions before using this result."
                  : "No recorded risk explains this result. Read the evidence before relying on it."}
                pushNote={!favorable}
                challengeAnchorId={challengeAnchorId}
              />
              <CaseColumn
                id="report-risks"
                title={favorable ? "Main concerns" : "What looks credible"}
                tone={favorable ? "caution" : "pass"}
                items={countervailingItems}
                emptyCopy={favorable
                  ? "No risk or major unanswered question is recorded in this saved report."
                  : "ARGUS did not confirm a positive finding in this saved report."}
                pushNote={favorable}
                challengeAnchorId={challengeAnchorId}
              />
            </div>
            {context.length > 0 && (
              <div className="mt-6">
                <ReportCanvasNarrativeSection
                  id="report-important-context"
                  title="Other useful context"
                  description="Facts worth knowing that do not raise or lower the result on their own."
                  tone="neutral"
                  items={narrativeItems("context", context, evidenceHref)}
                  emptyCopy=""
                />
              </div>
            )}
          </div>

          <aside className="border-t border-line/60 bg-panel-2/20 px-4 py-5 lg:border-l lg:border-t-0" aria-label={checkScopeLabel}>
            <section aria-label="Checks finished">
              <div className="flex items-center gap-2">
                <Database size={17} weight="duotone" aria-hidden="true" className="text-signal-lift" />
                <h3 className="eyebrow text-ink-dim">{checkScopeLabel}</h3>
                <span className="mono ml-auto text-[13.5px] font-semibold text-ink">{applicable === 0 ? "Not available" : `${coveragePercent}%`}</span>
              </div>
              {applicable > 0 && (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Checks finished" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveragePercent}>
                  <div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(0, Math.min(100, coveragePercent))}%` }} />
                </div>
              )}
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                {applicable === 0
                  ? "No check results were saved."
                  : `${successful} finished, ${Math.max(0, applicable - successful)} open.`}
              </p>
            </section>

            <div className="mt-4 border-t border-line/60 pt-4">
              <DecisionLedgerList
                title="Research and follow-up"
                items={nextSteps}
                href={methodologyHref}
                emptyCopy={applicable === 0 ? "No required check results were saved." : "No checks remain open."}
                limit={4}
              />
              <DecisionLedgerList
                title="Finished checks"
                items={verified}
                href={evidenceHref}
                emptyCopy="No check has finished yet."
                limit={4}
              />
            </div>

            {capturedAt && (
              <div className="flex items-start gap-2 border-t border-line/60 pt-4 text-[11px] leading-snug text-ink-faint">
                <ClockCounterClockwise size={15} weight="duotone" aria-hidden="true" className="mt-0.5 shrink-0" />
                <span>Saved {capturedAt}.</span>
              </div>
            )}
          </aside>
        </div>
      </div>
    </section>
  );
}
