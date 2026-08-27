import type { NoticedSignal, VerdictArgument } from "../lib/reportInsights";
import { plainLanguageSummary } from "../lib/plainLanguage";

const SEVERITY_COLOR: Record<NoticedSignal["severity"], string> = {
  alert: "var(--color-avoid)",
  watch: "var(--color-caution)",
  note: "var(--color-ink-faint)",
};

/**
 * The "Argus noticed" rail: the few stats that should never hide inside a
 * grid, stated as findings. Renders nothing when no rule fired.
 */
export function NoticedRail({ signals, max = 3 }: { signals: NoticedSignal[]; max?: number }) {
  const top = signals.slice(0, max);
  if (top.length === 0) return null;
  return (
    <div data-testid="noticed-rail">
      <div className="eyebrow">Argus noticed</div>
      <div className="mt-1.5 space-y-1.5">
        {top.map((signal) => (
          <p key={signal.id} className="flex items-start gap-2 text-[12.5px] leading-relaxed">
            <span
              aria-hidden
              className="mt-[6px] inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ background: SEVERITY_COLOR[signal.severity] }}
            />
            <span className="min-w-0">
              <strong className="font-semibold text-ink">{plainLanguageSummary(signal.headline)}.</strong>{" "}
              <span className="text-ink-dim">{plainLanguageSummary(signal.detail)}</span>
              {signal.anchor && (
                <>
                  {" "}
                  <a href={signal.anchor} className="link-ext text-[11px]">View</a>
                </>
              )}
            </span>
          </p>
        ))}
      </div>
    </div>
  );
}

/** The hero's three-line argument: for, against, and what would change it. */
export function VerdictArgumentBlock({ argument }: { argument: VerdictArgument }) {
  const rows = [
    argument.forLine ? { label: "Strongest evidence", text: argument.forLine, tone: "support" } : null,
    argument.againstLine ? { label: "Main risk", text: argument.againstLine, tone: "concern" } : null,
    { label: "What to check next", text: argument.moveLine, tone: "change" },
  ].filter((row): row is { label: string; text: string; tone: string } => row !== null);
  return (
    <dl className="decision-argument-grid mt-3 grid gap-2 md:grid-cols-3" data-testid="verdict-argument">
      {rows.map((row) => (
        <div key={row.label} className={`decision-argument-card decision-argument-${row.tone}`}>
          <dt className="mono text-[10px] font-medium uppercase tracking-[0.13em]">{row.label}</dt>
          <dd className="mt-2 min-w-0 text-[12.5px] leading-relaxed text-ink-dim">{plainLanguageSummary(row.text)}</dd>
        </div>
      ))}
    </dl>
  );
}
