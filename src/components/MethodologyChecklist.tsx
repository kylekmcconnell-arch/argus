import { useId, useState } from "react";
import {
  isAdverseFinding,
  NEVER_WAIVE_CHECK_IDS,
  summarizeChecks,
  type ScanCheck,
  type CheckStatus,
} from "../lib/scanChecklist";

// Transparent scan methodology: successful execution coverage and evidence
// outcomes are separate. Collapsed by default so this reads as a trust footer.
const META: Record<CheckStatus, { color: string; glyph: string; label: string }> = {
  confirmed: { color: "var(--color-pass)", glyph: "✓", label: "finished" },
  finding: { color: "var(--color-caution)", glyph: "▲", label: "needs attention" },
  "checked-empty": { color: "var(--color-ink-faint)", glyph: "○", label: "nothing found" },
  "not-applicable": { color: "var(--color-ink-faint)", glyph: "⊘", label: "not needed" },
  unknown: { color: "var(--color-ink-faint)", glyph: "?", label: "still open" },
  unavailable: { color: "var(--color-caution)", glyph: "⚠", label: "source unavailable" },
  stale: { color: "var(--color-caution)", glyph: "◷", label: "out of date" },
};

const CORE_TOKEN_CHECK_IDS = new Set([
  "contract-safety",
  "buy-sell-simulation",
  "holder-distribution",
  "wallet-clustering",
  "operator-funding-trace",
  "market-intelligence",
]);

function plainCheckLabel(value: string): string {
  return value
    .replace(/\s*\((?:evm|solana)\)\s*/gi, " ")
    .replace(/deployer trail/gi, "Who deployed the contract")
    .replace(/bytecode fingerprint/gi, "Copied contract code")
    .replace(/wallet clustering/gi, "Connected holder wallets")
    .replace(/operator funding trace/gi, "Where the deployer’s funds came from")
    .replace(/github forensics/gi, "Code history")
    .replace(/trust graph reconciliation/gi, "Known connections")
    .replace(/\s+/g, " ")
    .trim();
}

function plainCheckNote(value: string): string {
  return value
    .replace(/redeployed-rug clone check;\s*completion outcome not recorded/gi, "We could not finish checking whether this contract copies code from a known scam.")
    .replace(/completion outcome not recorded/gi, "This check did not finish.")
    .replace(/provider unavailable/gi, "The data source did not respond.")
    .replace(/corroborated/gi, "confirmed by more than one source")
    .replace(/canonical/gi, "official")
    .replace(/no elevated concentration surfaced/gi, "no unusual wallet concentration found");
}

export function MethodologyChecklist({ checks, id }: { checks: ScanCheck[]; id?: string }) {
  const [open, setOpen] = useState(false);
  const baseId = useId();
  const buttonId = `${baseId}-trigger`;
  const panelId = `${baseId}-panel`;
  if (!checks.length) return null;

  const coverage = summarizeChecks(checks);
  const grouped = [
    {
      label: "Required safety checks",
      description: "These checks must finish before the report is ready.",
      checks: checks.filter((check) => check.checkId && NEVER_WAIVE_CHECK_IDS.has(check.checkId)),
    },
    {
      label: "Main risk checks",
      description: "Contract, market, holder, and team checks.",
      checks: checks.filter((check) => check.checkId && CORE_TOKEN_CHECK_IDS.has(check.checkId)),
    },
    {
      label: "Extra research",
      description: "Useful context that does not block the report.",
      checks: checks.filter((check) =>
        !check.checkId
        || (!NEVER_WAIVE_CHECK_IDS.has(check.checkId) && !CORE_TOKEN_CHECK_IDS.has(check.checkId))),
    },
  ].filter((group) => group.checks.length > 0);
  const openRequired = grouped[0]?.label === "Required safety checks"
    ? grouped[0].checks.filter((check) => ["unknown", "unavailable", "stale"].includes(check.status)).length
    : 0;

  return (
    <section id={id} className="scroll-mt-20 panel" aria-labelledby={buttonId}>
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>
        <span className="eyebrow">What we checked</span>
        <span className="text-[12.5px] text-ink-dim">
          {coverage.successful}/{coverage.inScope} checks finished
          {coverage.unknownOrFailed ? ` · ${coverage.unknownOrFailed} still open` : ""}
          {openRequired ? ` · ${openRequired} required` : ""}
          {coverage.findings ? ` · ${coverage.findings} need attention` : ""}
          {coverage.notApplicable ? ` · ${coverage.notApplicable} not needed` : ""}
        </span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto shrink-0 transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div id={panelId} role="region" aria-labelledby={buttonId} className="border-t border-line/60 px-2 py-1.5">
          {grouped.map((group, groupIndex) => (
            <section
              key={group.label}
              className={groupIndex ? "border-t border-line/60 py-2.5" : "py-2"}
              aria-label={group.label}
            >
              <div className="flex flex-wrap items-baseline gap-x-2 px-2 pb-1">
                <h3 className="text-[12px] font-semibold text-ink">{group.label}</h3>
                <p className="text-[10.5px] text-ink-faint">{group.description}</p>
              </div>
              <ul className="m-0 list-none p-0" aria-label={`${group.label} outcomes`}>
                {group.checks.map((check, index) => {
                  // A neutral assessment null is recorded as a substantive "finding" so
                  // it can cover its axis, but it must not read as an adverse discovery.
                  // Render it as a completed-null outcome, not an amber caution.
                  const meta = check.status === "finding" && !isAdverseFinding(check)
                    ? META["checked-empty"]
                    : META[check.status];
                  return (
                    <li key={`${check.label}-${index}`} className="flex items-start gap-2.5 rounded-lg px-2 py-1.5">
                      <span aria-hidden="true" className="mono mt-0.5 w-3.5 shrink-0 text-center text-[12.5px]" style={{ color: meta.color }}>{meta.glyph}</span>
                      <span className="min-w-0 flex-1">
                        <span className="text-[12.5px] text-ink">{plainCheckLabel(check.label)}</span>
                        {check.note && <span className="ml-2 text-[11px] text-ink-faint">{plainCheckNote(check.note)}</span>}
                      </span>
                      <span className="chip tint-var shrink-0" style={{ ["--tint" as string]: meta.color }}>{meta.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          <p className="px-2 py-1.5 text-[11px] leading-snug text-ink-faint">
            Finished means a data source answered, even when it found nothing. Still open means the check did not finish.
          </p>
        </div>
      )}
    </section>
  );
}
