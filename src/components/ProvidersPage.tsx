import { useEffect, useState } from "react";

// Peace-of-mind view for Kyle + Enigma: which API keys are plugged in, what each
// powers, where to top up, and live usage where the provider exposes it. Keyed
// and keyless sources render as identical rows so the whole stack reads uniformly.
type Provider = { label: string; powers: string; source: string; tier: string; configured: boolean; usage?: string };
type UsageEvent = {
  id: string;
  reportVersionId: string;
  provider: string;
  operation: string;
  calls: number;
  usd: number;
  status: "succeeded" | "failed" | "partial" | "cached" | string;
  meta?: string;
  createdAt: string;
  actor: string;
  report?: { kind: string; ref: string; label: string; version: number };
};
type UsageFeed = {
  available: boolean;
  events: UsageEvent[];
  window: { limit: number; eventCount: number };
  totals: { eventCount: number; calls: number; usd: number };
};

const TIER_LABEL: Record<string, string> = { paid: "key", optional: "optional", infra: "infra", keyless: "keyless" };

function dotColor(p: Provider): string {
  if (p.tier === "keyless") return "var(--color-pass)";
  if (p.configured) return "var(--color-pass)";
  return p.tier === "optional" ? "var(--color-ink-faint)" : "var(--color-avoid)";
}
function statusFor(p: Provider): { text: string; color: string } {
  if (p.tier === "keyless") return { text: "always on", color: "var(--color-pass)" };
  if (p.configured) return { text: "configured", color: "var(--color-pass)" };
  return p.tier === "optional"
    ? { text: "unset", color: "var(--color-ink-faint)" }
    : { text: "MISSING", color: "var(--color-avoid)" };
}

function ProviderRow({ p }: { p: Provider }) {
  const status = statusFor(p);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
      <span className="flex items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dotColor(p) }} />
        <span className="text-[13.5px] font-medium text-ink">{p.label}</span>
        <span className="mono rounded border border-line px-1 py-0.5 text-[9px] uppercase tracking-wide text-ink-faint">{TIER_LABEL[p.tier] ?? p.tier}</span>
      </span>
      <span className="min-w-0 flex-1 text-[12px] text-ink-dim">{p.powers}</span>
      <span className="flex items-center gap-2">
        {p.usage && <span className="mono text-[10.5px] text-signal-dim">{p.usage}</span>}
        <span className="mono text-[11px]" style={{ color: status.color }}>{status.text}</span>
        <a href={`https://${p.source.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="mono text-[10.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline">{p.source} ↗</a>
      </span>
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = {
  succeeded: "var(--color-pass)",
  cached: "var(--color-signal)",
  partial: "var(--color-caution)",
  failed: "var(--color-avoid)",
};

function shortOperation(operation: string): string {
  return operation.replace(/^panel:/, "").replace(/[-_]+/g, " ");
}

function eventTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatUsd(value: number): string {
  if (!(value > 0)) return "$0";
  if (value < 0.0001) return `$${value.toFixed(8)}`;
  if (value < 1) return `$${value.toFixed(6)}`;
  return `$${value.toFixed(4)}`;
}

function eventCost(event: UsageEvent): string {
  if (event.usd > 0) return formatUsd(event.usd);
  const meta = event.meta?.toLowerCase() ?? "";
  if (meta.includes("subscription") || meta.includes("keyed") || meta.includes("plan-priced")) return "plan-priced";
  if (meta.includes("keyless")) return "keyless";
  return "$0 estimated";
}

export function ProvidersPage() {
  const [data, setData] = useState<{ providers: Provider[]; keyless: Provider[]; note?: string } | null>(null);
  const [usage, setUsage] = useState<UsageFeed | null>(null);
  const [usageError, setUsageError] = useState("");
  useEffect(() => {
    fetch("/api/keys-status").then((r) => r.json()).then(setData).catch(() => setData({ providers: [], keyless: [] }));
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/provider-usage?limit=40", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Partial<UsageFeed> & { message?: string };
        if (!response.ok || !Array.isArray(body.events) || !body.window || !body.totals) {
          throw new Error(body.message || "Provider usage is unavailable.");
        }
        return body as UsageFeed;
      })
      .then((feed) => {
        setUsage(feed);
        setUsageError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setUsageError(error instanceof Error ? error.message : "Provider usage is unavailable.");
      });
    return () => controller.abort();
  }, []);

  const providers = data?.providers ?? [];
  const keyless = data?.keyless ?? [];
  const missing = providers.filter((p) => !p.configured && p.tier !== "optional");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Providers &amp; keys</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        What ARGUS is plugged into. Shows configured or not (never a secret), what each key powers, where to top up,
        and live usage where the provider exposes it.
      </p>
      {missing.length > 0 && (
        <div className="mt-4 rounded-lg border border-caution/40 bg-caution/5 px-3 py-2 text-[12.5px] text-caution">
          {missing.length} required provider{missing.length === 1 ? "" : "s"} not configured: {missing.map((m) => m.label).join(", ")}.
        </div>
      )}

      <div className="mt-5 divide-y divide-line/60 overflow-hidden rounded-xl border border-line bg-panel">
        {/* keyed / optional / infra — the ones with a key to manage */}
        {providers.map((p) => <ProviderRow key={p.label} p={p} />)}

        {!data && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">loading provider status…</div>}

        {/* the bar: one labeled divider, then keyless sources as identical rows */}
        {keyless.length > 0 && (
          <div className="flex items-center gap-2 bg-void/40 px-4 py-2">
            <span className="text-[10px] uppercase tracking-[0.18em] text-ink-faint">Keyless · always on, no key required</span>
            <span className="mono ml-auto text-[10.5px] text-ink-faint">{keyless.length} sources</span>
          </div>
        )}
        {keyless.map((p) => <ProviderRow key={p.label} p={p} />)}
      </div>

      <section className="mt-6" aria-labelledby="provider-usage-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="provider-usage-title" className="text-[16px] font-medium text-ink">Immutable usage trail</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-ink-dim">
              Each recorded report-bound provider request becomes an immutable event. Transport retries reuse that event; fresh panel runs append against the exact report version.
            </p>
          </div>
          {usage && (
            <div className="mono flex flex-wrap items-center gap-1.5 text-[10.5px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5">all recorded history</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.eventCount} {usage.totals.eventCount === 1 ? "event" : "events"}</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.calls} calls</span>
              <span className="rounded border border-line px-1.5 py-0.5">{formatUsd(usage.totals.usd)} estimated</span>
            </div>
          )}
        </div>

        <div className="mt-3 overflow-hidden rounded-xl border border-line bg-panel">
          {!usage && !usageError && (
            <div className="px-4 py-6 text-center text-[12px] text-ink-faint">loading immutable provider events…</div>
          )}
          {usageError && (
            <div className="border-caution/30 bg-caution/5 px-4 py-3 text-[12px] text-caution" role="alert">{usageError}</div>
          )}
          {usage && usage.events.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-ink-faint">No report-bound provider events have been recorded yet.</div>
          )}
          {usage && usage.events.length > 0 && (
            <div className="border-b border-line/60 bg-void/30 px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-ink-faint">
              Latest {usage.window.eventCount} of {usage.totals.eventCount} recorded events
            </div>
          )}
          {usage?.events.map((event) => (
            <div key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line/60 px-4 py-3 last:border-0">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[event.status] ?? "var(--color-ink-faint)" }} />
              <span className="min-w-[150px] flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-ink">{event.provider}</span>
                  <span className="mono rounded border border-line px-1 py-0.5 text-[9px] text-ink-faint">{shortOperation(event.operation)}</span>
                  <span className="mono text-[9.5px]" style={{ color: STATUS_COLOR[event.status] ?? "var(--color-ink-faint)" }}>{event.status}</span>
                </span>
                <span className="mt-0.5 block text-[10.5px] text-ink-faint">
                  {event.report ? `${event.report.label} · ${event.report.kind} snapshot v${event.report.version}` : "exact report version"}
                  {` · ${event.actor}`}
                </span>
                {event.meta && <span className="mt-0.5 block truncate text-[10px] text-ink-faint" title={event.meta}>{event.meta}</span>}
              </span>
              <span className="mono shrink-0 text-right text-[10.5px] text-ink-faint">
                <span className="block">×{event.calls} · {eventCost(event)}</span>
                <time dateTime={event.createdAt} className="mt-0.5 block text-[9.5px]">{eventTime(event.createdAt)}</time>
              </span>
            </div>
          ))}
        </div>
      </section>

      {data?.note && <p className="mt-5 text-[11.5px] leading-relaxed text-ink-faint">{data.note}</p>}
    </div>
  );
}
