// A private/incognito toggle for a search bar. When on, the search runs and shows
// its result but leaves NO trace: not persisted, not logged, not added to the
// trust graph, and never shown in the sidebar, tickers, or Dossiers.
export function PrivateToggle({ on, onToggle, className = "" }: { on: boolean; onToggle: (v: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!on)}
      aria-pressed={on}
      title={on
        ? "Private search: this audit won't be saved, logged, graphed, or shown anywhere. Click to make it normal."
        : "Private search: run it without saving it to the trust graph, tickers, recent audits, or Dossiers."}
      className={`mono inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] transition ${className}`}
      style={on
        ? { borderColor: "var(--color-signal)", color: "var(--color-signal)", background: "color-mix(in oklab, var(--color-signal) 12%, transparent)" }
        : { borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
    >
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 7.5-1.3" />
        </svg>
      )}
      Private
    </button>
  );
}
