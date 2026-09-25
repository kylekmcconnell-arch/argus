import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  formatBalance,
  pillLabel,
  pillTone,
  relativeTime,
  sortProviders,
  uptimeStrip,
  type PillTone,
  type SentinelProviderView,
  type SentinelStatusPayload,
} from "../lib/providerSentinelView";

// Owner-only live API status. Reads the sentinel's stored state; "Run check
// now" triggers the same run the 15-minute cron performs.

const TONE_COLOR: Record<PillTone, string> = {
  green: "var(--color-pass)",
  amber: "var(--color-caution)",
  red: "var(--color-avoid)",
  grey: "var(--color-ink-faint)",
};

function Pill({ tone, label }: { tone: PillTone; label: string }) {
  return (
    <span className="chip tint-var shrink-0" style={{ "--tint": TONE_COLOR[tone] } as CSSProperties}>
      {label}
    </span>
  );
}

function UptimeStrip({ provider, now }: { provider: SentinelProviderView; now: Date }) {
  const slots = uptimeStrip(provider.history, now);
  return (
    <div className="flex h-3 w-full gap-px" aria-label={`24 hour history for ${provider.label}`} role="img">
      {slots.map((tone, index) => (
        <span
          key={index}
          className="h-full flex-1 rounded-[1px]"
          style={{ background: tone ? TONE_COLOR[tone] : "var(--color-line)", opacity: tone === "grey" ? 0.5 : 1 }}
        />
      ))}
    </div>
  );
}

function ProviderCard({ provider, now }: { provider: SentinelProviderView; now: Date }) {
  const current = provider.current;
  const tone = pillTone(current);
  const balance = formatBalance(current?.balance);
  const failing = current && (current.status === "down" || current.status === "degraded" || current.lowCredit);
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: TONE_COLOR[tone] }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">{provider.label}</span>
        {provider.optional && <span className="chip chip-sm">optional</span>}
        {provider.costly && <span className="chip chip-sm" title={provider.costNote}>paid probe</span>}
        <Pill tone={tone} label={pillLabel(current)} />
      </div>
      {current && (
        <p className={`mt-1 text-[12.5px] leading-relaxed ${failing ? "text-ink" : "text-ink-dim"}`}>
          {current.status === "ok" && !current.lowCredit ? current.detail : current.advice}
        </p>
      )}
      {current && failing && current.detail && (
        <p className="mono mt-0.5 break-words text-[11px] text-ink-faint">{current.detail}</p>
      )}
      {!current && <p className="mt-1 text-[12.5px] text-ink-faint">No sentinel check stored yet.</p>}
      <div className="mono mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-ink-faint sm:grid-cols-4">
        <span>latency {current?.latencyMs != null ? `${current.latencyMs} ms` : "–"}</span>
        <span>checked {relativeTime(current?.checkedAt, now)}</span>
        <span>last ok {relativeTime(current?.lastOkAt, now)}</span>
        <span>24h uptime {provider.uptime24h != null ? `${Math.round(provider.uptime24h * 1000) / 10}%` : "–"}</span>
      </div>
      {balance && (
        <p className={`mono mt-1 text-[11px] ${current?.lowCredit ? "text-caution" : "text-ink-dim"}`}>
          {current?.lowCredit ? "Low: " : ""}{balance}
        </p>
      )}
      <div className="mt-2">
        <UptimeStrip provider={provider} now={now} />
      </div>
    </div>
  );
}

type StatusFetch =
  | { kind: "ok"; data: SentinelStatusPayload }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

async function fetchStatus(signal?: AbortSignal): Promise<StatusFetch> {
  try {
    const response = await fetch("/api/provider-status", { signal });
    const body = await response.json().catch(() => null) as (SentinelStatusPayload & { message?: string; error?: string }) | null;
    if (!response.ok || !body?.available) {
      return { kind: "error", message: body?.message ?? body?.error ?? `Status unavailable (HTTP ${response.status}).` };
    }
    return { kind: "ok", data: body };
  } catch (cause) {
    return (cause as Error)?.name === "AbortError" ? { kind: "aborted" } : { kind: "error", message: "Status could not be loaded." };
  }
}

export function ApiStatusPage() {
  const [data, setData] = useState<SentinelStatusPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<false | "free" | "all">(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  const apply = useCallback((outcome: StatusFetch) => {
    if (outcome.kind === "aborted") return;
    if (outcome.kind === "error") {
      setError(outcome.message);
      return;
    }
    setError(null);
    setData(outcome.data);
    setNow(new Date());
  }, []);
  const load = useCallback(() => fetchStatus().then(apply), [apply]);

  useEffect(() => {
    const controller = new AbortController();
    fetchStatus(controller.signal).then(apply);
    const timer = window.setInterval(() => void fetchStatus().then(apply), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [apply]);

  const runNow = async (includeCostly: boolean) => {
    setRunning(includeCostly ? "all" : "free");
    setRunNote(null);
    try {
      const response = await fetch(`/api/provider-sentinel${includeCostly ? "?costly=1" : ""}`, { method: "POST" });
      const body = await response.json().catch(() => null) as { summary?: { skipped?: string[] }; alerts?: unknown[]; email?: string; errors?: string[]; error?: string } | null;
      if (!response.ok) {
        setRunNote(`Check failed: ${body?.error ?? `HTTP ${response.status}`}`);
      } else {
        const skipped = body?.summary?.skipped?.length ?? 0;
        const alerts = body?.alerts?.length ?? 0;
        const parts = [
          "Check complete",
          skipped ? `${skipped} paid ${skipped === 1 ? "probe" : "probes"} not due` : "",
          alerts ? `${alerts} ${alerts === 1 ? "alert" : "alerts"} (${body?.email ?? "none"})` : "",
          body?.errors?.length ? `${body.errors.length} storage ${body.errors.length === 1 ? "issue" : "issues"}` : "",
        ].filter(Boolean);
        setRunNote(parts.join(" · "));
      }
      await load();
    } catch {
      setRunNote("Check could not be started.");
    } finally {
      setRunning(false);
    }
  };

  const providers = data ? sortProviders(data.providers) : [];
  const configured = providers.filter((provider) => provider.current?.status !== "not_configured");
  const notConfigured = providers.filter((provider) => provider.current?.status === "not_configured");

  return (
    <div className="workspace-frame">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="display-sm text-[24px] text-ink">API status</h1>
          <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
            Live key, credit and quota checks for every provider, run every 15 minutes. Paid probes run every 6 hours.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-primary" disabled={running !== false} onClick={() => void runNow(false)}>
            {running === "free" ? "Checking…" : "Run check now"}
          </button>
          <button type="button" className="btn-secondary" disabled={running !== false} onClick={() => void runNow(true)} title="Also runs probes that consume a small amount of provider credit">
            {running === "all" ? "Checking…" : "Include paid probes"}
          </button>
        </div>
      </div>
      {runNote && <p className="mono mt-2 text-[11.5px] text-ink-dim" role="status">{runNote}</p>}

      {error && (
        <div className="panel mt-5 px-4 py-3" role="alert">
          <p className="text-[13.5px] font-medium text-ink">API status could not be loaded</p>
          <p className="mt-1 text-[12.5px] text-ink-dim">{error}</p>
        </div>
      )}
      {!data && !error && <div className="panel mt-5 px-4 py-6 text-center text-[12.5px] text-ink-faint">loading API status…</div>}

      {data && (
        <>
          <div className="panel mt-5 grid grid-cols-2 gap-px overflow-hidden bg-line/60 sm:grid-cols-5" aria-label="API status summary">
            <div className="stat-tile rounded-none">
              <span className="stat-label">ok</span>
              <span className="stat-value" style={{ color: TONE_COLOR.green }}>{data.summary.ok}</span>
            </div>
            <div className="stat-tile rounded-none">
              <span className="stat-label">down</span>
              <span className="stat-value" style={{ color: data.summary.down ? TONE_COLOR.red : undefined }}>{data.summary.down}</span>
            </div>
            <div className="stat-tile rounded-none">
              <span className="stat-label">degraded</span>
              <span className="stat-value" style={{ color: data.summary.degraded ? TONE_COLOR.amber : undefined }}>{data.summary.degraded}</span>
            </div>
            <div className="stat-tile rounded-none">
              <span className="stat-label">low credit</span>
              <span className="stat-value" style={{ color: data.summary.lowCredit ? TONE_COLOR.amber : undefined }}>{data.summary.lowCredit}</span>
            </div>
            <div className="stat-tile col-span-2 rounded-none sm:col-span-1">
              <span className="stat-label">last run</span>
              <span className="stat-value text-[15px]">{relativeTime(data.lastRun?.finishedAt, now)}</span>
            </div>
          </div>
          <p className="mono mt-2 text-[11px] text-ink-faint">
            Low-credit alert below ${data.thresholds.lowUsd} or {data.thresholds.lowQuotaPct}% of quota
            {data.lastRun ? ` · last run ${data.lastRun.trigger}, email ${data.lastRun.emailStatus}` : " · no run stored yet"}
          </p>

          <section className="mt-5" aria-labelledby="api-status-configured">
            <h2 id="api-status-configured" className="eyebrow mb-2">Providers</h2>
            <div className="panel divide-y divide-line/60 overflow-hidden">
              {configured.map((provider) => <ProviderCard key={provider.provider} provider={provider} now={now} />)}
              {!configured.length && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">No provider checks stored yet. Run a check.</div>}
            </div>
          </section>

          {notConfigured.length > 0 && (
            <details className="panel mt-5 overflow-hidden">
              <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
                Not configured
                <span className="mono ml-2 text-[11px] font-normal text-ink-faint">{notConfigured.length}</span>
              </summary>
              <div className="divide-y divide-line/60 border-t border-line/60">
                {notConfigured.map((provider) => (
                  <div key={provider.provider} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                    <span className="min-w-0 flex-1 text-[12.5px] text-ink-dim">{provider.label}</span>
                    <span className="mono break-all text-[11px] text-ink-faint">{provider.envVars.join(", ")}</span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
