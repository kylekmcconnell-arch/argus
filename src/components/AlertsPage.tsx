import { useEffect, useState } from "react";

// The alerts feed: everything manual sweeps have flagged — on-chain drift on
// watched tokens and new connections to flagged subjects in the shared graph.
// Nothing lands here automatically: alerts only exist when someone pressed
// "Sweep now" on the Watchlist.
type Alert = { ref: string; subject?: string; label?: string; type?: "drift" | "ring"; detail?: string; at?: number; ts?: string };

const TYPE_META: Record<string, { label: string; color: string }> = {
  drift: { label: "on-chain drift", color: "var(--color-caution)" },
  ring: { label: "flagged connection", color: "var(--color-avoid)" },
};

const ago = (a: Alert) => {
  const ms = a.at ?? (a.ts ? Date.parse(a.ts) : 0);
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 3600000);
  if (d < 1) return "just now";
  if (d < 24) return `${d}h ago`;
  return `${Math.floor(d / 24)}d ago`;
};

export function AlertsPage({ onOpen }: { onOpen: (ref: string) => void }) {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  useEffect(() => {
    fetch("/api/alerts").then((r) => r.json()).then((d) => setAlerts(d?.alerts ?? [])).catch(() => setAlerts([]));
  }, []);

  const dismiss = (ref: string) => {
    void fetch(`/api/alerts?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => { /* offline */ });
    setAlerts((a) => (a ?? []).filter((x) => x.ref !== ref));
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Alerts</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        What sweeps have flagged: verdict flips and liquidity drains on watched tokens, and watched subjects newly
        connecting to flagged actors in the shared graph. Sweeps run only when you press Sweep now on the Watchlist —
        nothing monitors in the background.
      </p>

      <div className="mt-6 space-y-2">
        {alerts == null && <div className="text-[12.5px] text-ink-faint">loading…</div>}
        {alerts != null && alerts.length === 0 && (
          <div className="rounded-xl border border-dashed border-line-2 bg-panel/50 p-10 text-center text-[13.5px] text-ink-faint">
            No alerts. Watch subjects, then run a sweep from the Watchlist.
          </div>
        )}
        {(alerts ?? []).map((a) => {
          const m = TYPE_META[a.type ?? ""] ?? TYPE_META.drift;
          return (
            <div key={a.ref} className="flex items-start gap-3 rounded-xl border bg-panel px-4 py-3" style={{ borderColor: `${m.color}55` }}>
              <span className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-wide" style={{ color: m.color, background: `${m.color}14` }}>
                {m.label}
              </span>
              <div className="min-w-0 flex-1">
                <button onClick={() => a.subject && onOpen(a.subject)} className="mono text-[13px] font-medium text-ink underline-offset-2 hover:text-signal-dim hover:underline">
                  {a.label ?? a.subject}
                </button>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-dim">{a.detail}</p>
              </div>
              <span className="mono shrink-0 text-[10px] text-ink-faint">{ago(a)}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={() => dismiss(a.ref)}
                title="Dismiss this alert"
                className="mono shrink-0 cursor-pointer rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-faint transition hover:border-avoid hover:text-avoid"
              >
                ×
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
