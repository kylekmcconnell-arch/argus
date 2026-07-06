// A private/incognito checkbox for a search bar. When checked, the search runs and
// shows its result but leaves NO trace: not persisted, not logged, not added to
// the public trust graph, and never shown in the sidebar, tickers, or Dossiers.
// The (i) explains it on hover/focus. (Slated to become a premium option.)
export function PrivateToggle({ on, onToggle, className = "" }: { on: boolean; onToggle: (v: boolean) => void; className?: string }) {
  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={on}
        onClick={() => onToggle(!on)}
        className="flex items-center gap-1.5 text-[12.5px] transition"
        style={{ color: on ? "var(--color-ink)" : "var(--color-ink-dim)" }}
      >
        <span
          className="flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border transition"
          style={on
            ? { background: "var(--color-signal)", borderColor: "var(--color-signal)" }
            : { borderColor: "var(--color-line-2)" }}
        >
          {on && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--color-void)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12l5 5L20 6" />
            </svg>
          )}
        </span>
        Private
      </button>

      <span className="group/info relative flex items-center">
        <span
          tabIndex={0}
          role="img"
          aria-label="What is a private search?"
          className="flex cursor-help items-center justify-center rounded-full outline-none transition"
          style={{ color: "var(--color-ink-faint)" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 16v-4" />
            <path d="M12 8h.01" />
          </svg>
        </span>
        <span
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-50 w-[236px] -translate-x-1/2 rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed opacity-0 transition-opacity duration-150 group-hover/info:opacity-100 group-focus-within/info:opacity-100"
          style={{ borderColor: "var(--color-line-2)", background: "var(--color-panel)", color: "var(--color-ink-dim)", boxShadow: "0 8px 24px rgba(0,0,0,.35)" }}
        >
          A private search runs the same audit but <span style={{ color: "var(--color-ink)" }}>won't show in or add to the public trust graph</span> — no tickers, no recent audits, no shared record. <span style={{ color: "var(--color-ink-faint)" }}>A premium option.</span>
        </span>
      </span>
    </div>
  );
}
