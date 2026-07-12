import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";

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
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/alerts", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { alerts?: Alert[]; message?: string };
        if (!response.ok || !Array.isArray(body.alerts)) {
          throw new Error(body.message || "ARGUS could not reach alert storage.");
        }
        return body.alerts;
      })
      .then(setAlerts)
      .catch((error) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "The alerts feed is unavailable.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const dismiss = (ref: string) => {
    void fetch(`/api/alerts?ref=${encodeURIComponent(ref)}`, { method: "DELETE" }).catch(() => { /* offline */ });
    setAlerts((a) => (a ?? []).filter((x) => x.ref !== ref));
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="display-sm text-[24px] text-ink">Alerts</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        What sweeps have flagged: verdict flips and liquidity drains on watched tokens, and watched subjects newly
        connecting to flagged actors in the shared graph. Sweeps run only when you press Sweep now on the Watchlist —
        nothing monitors in the background.
      </p>

      <div className="mt-6 space-y-2">
        {alerts == null && !loadError && <div className="text-[12.5px] text-ink-faint">loading alerts…</div>}
        {loadError && (
          <div className="panel px-4 py-4" role="alert">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[13.5px] font-medium text-ink">Alerts could not be loaded</p>
                <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-ink-dim">
                  {loadError} This is a data-access failure, not confirmation that there are no alerts.
                </p>
              </div>
              <button
                onClick={() => {
                  setAlerts(null);
                  setLoadError("");
                  setReloadKey((key) => key + 1);
                }}
                className="btn-chip tint-signal"
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {alerts != null && !loadError && alerts.length === 0 && (
          <div className="empty-state">
            No alerts. Watch subjects, then run a sweep from the Watchlist.
          </div>
        )}
        {(alerts ?? []).map((a) => {
          const m = TYPE_META[a.type ?? ""] ?? TYPE_META.drift;
          return (
            <div key={a.ref} className="finding flex flex-wrap items-start gap-3 px-4 py-3" style={{ "--tint": m.color } as React.CSSProperties}>
              <span className="chip tint-var mt-0.5 shrink-0" style={{ "--tint": m.color } as React.CSSProperties}>
                {m.label}
              </span>
              <div className="min-w-[180px] flex-1">
                {a.subject ? (
                  <button onClick={() => onOpen(a.subject!)} className="mono text-[13.5px] font-medium text-ink underline-offset-2 hover:text-signal-lift hover:underline">
                    {a.label ?? a.subject}
                  </button>
                ) : (
                  <span className="mono text-[13.5px] font-medium text-ink">{a.label ?? "Unknown subject"}</span>
                )}
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-dim">{a.detail}</p>
              </div>
              <span className="mono shrink-0 text-[11px] text-ink-faint">{ago(a)}</span>
              <button
                onClick={() => dismiss(a.ref)}
                title="Dismiss this alert"
                aria-label={`Dismiss alert for ${a.label ?? a.subject ?? "unknown subject"}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line text-ink-faint transition hover:border-avoid hover:text-avoid"
              >
                <X size={13} weight="bold" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
