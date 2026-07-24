import { ArrowRight, ClockCounterClockwise, Database } from "@phosphor-icons/react";
import {
  ReportCanvasNarrativeSection,
  type ReportCanvasTone,
  type ReportCanvasNarrativeItem,
} from "./ReportCanvasPrimitives";

export interface DecisionCanvasItem {
  label: string;
  detail?: string | undefined;
}

function plainDecisionText(value: string): string {
  return value
    .replace(/\s*\((?:evm|solana)\)\s*/gi, " ")
    .trim()
    .replace(/^Resolve deployer trail$/i, "Who deployed the contract")
    .replace(/^Resolve bytecode fingerprint$/i, "Copied contract code")
    .replace(/^Resolve wallet clustering$/i, "Connected holder wallets")
    .replace(/^Resolve operator\s*\/\s*funding trace$/i, "Where the deployer’s funds came from")
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
  favorable,
  verdictTone,
  supports,
  concerns,
  nextSteps,
  verified,
  openQuestions,
  coveragePercent,
  successful,
  applicable,
  capturedAt,
  evidenceHref = "#token-evidence",
  methodologyHref = "#token-methodology",
}: {
  verdictLabel: string;
  favorable: boolean;
  verdictTone: ReportCanvasTone;
  supports: DecisionCanvasItem[];
  concerns: DecisionCanvasItem[];
  nextSteps: DecisionCanvasItem[];
  verified: DecisionCanvasItem[];
  openQuestions: DecisionCanvasItem[];
  coveragePercent: number;
  successful: number;
  applicable: number;
  capturedAt?: string | undefined;
  evidenceHref?: `#${string}`;
  methodologyHref?: `#${string}`;
}) {
  const verdictItems = favorable ? supports : concerns;
  const countervailingItems = favorable ? concerns : supports;

  return (
    <section id="report-summary" className="report-section mt-6 scroll-mt-28">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">01 · Result</p>
          <h2 className="mt-1 text-[20px] font-semibold tracking-tight text-ink">Why this result</h2>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
            The strongest evidence, the main concerns, and what still needs checking.
          </p>
        </div>
        <div className="shrink-0 text-left sm:text-right">
          <p className="mono text-[22px] font-semibold tabular-nums text-ink">{coveragePercent}%</p>
          <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{successful}/{applicable} checks</p>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="grid lg:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="px-5">
            <ReportCanvasNarrativeSection
              title={favorable ? "What supports this result" : "Main concerns"}
              description={favorable
                ? "The strongest facts and checks behind the result."
                : "The risks and failed checks behind the result."}
              tone={verdictTone}
              items={narrativeItems("verdict", verdictItems, evidenceHref)}
              emptyCopy={favorable
                ? "No sourced support is recorded yet. Read the open questions before using this result."
                : "No recorded risk explains this result. Read the evidence before relying on it."}
            />
            <ReportCanvasNarrativeSection
              id="report-risks"
              title={favorable ? "Main concerns" : "What looks credible"}
              description={favorable
                ? "Risks and open questions that could change the result."
                : "Positive evidence that gives the result context."}
              tone={favorable ? "caution" : "pass"}
              items={narrativeItems("counterweight", countervailingItems, evidenceHref)}
              emptyCopy={favorable
                ? "No risk or major unanswered question is recorded in this saved report."
                : "No sourced positive finding is recorded in this saved report."}
            />
          </div>

          <aside className="border-t border-line/60 bg-panel-2/20 px-4 py-5 lg:border-l lg:border-t-0" aria-label="Scan progress">
            <section aria-label="Checks finished">
              <div className="flex items-center gap-2">
                <Database size={17} weight="duotone" aria-hidden="true" className="text-signal-lift" />
                <h3 className="eyebrow text-ink-dim">Scan progress</h3>
                <span className="mono ml-auto text-[13.5px] font-semibold text-ink">{coveragePercent}%</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Checks finished" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coveragePercent}>
                <div className="h-full rounded-full bg-signal" style={{ width: `${Math.max(0, Math.min(100, coveragePercent))}%` }} />
              </div>
              <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                {successful} finished, {openQuestions.length} open.
              </p>
            </section>

            <div className="mt-4 border-t border-line/60 pt-4">
              <DecisionLedgerList
                title="Check next"
                items={nextSteps}
                href={methodologyHref}
                emptyCopy="All checks finished."
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
