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

const TIER_LABEL: Record<string, string> = {
  paid: "credential",
  optional: "optional",
  infra: "infrastructure",
  keyless: "no key",
};

const PROVIDER_ALIASES: Record<string, string[]> = {
  "Claude (Anthropic)": ["claude", "anthropic", "claudevision"],
  "Grok (xAI)": ["grok", "xai"],
  "twitterapi.io": ["twitterapi", "twitterapiio"],
  "Helius (Solana)": ["helius"],
  GitHub: ["github"],
  "People Data Labs": ["peopledatalabs", "pdl"],
  "Reddit OAuth": ["reddit"],
  Supabase: ["supabase"],
  "CoinGecko Pro": ["coingecko"],
  CryptoRank: ["cryptorank"],
  Crunchbase: ["crunchbase"],
  "Etherscan (multichain)": ["etherscan"],
  Arkham: ["arkham"],
  Bitquery: ["bitquery"],
  DexScreener: ["dexscreener"],
  "GoPlus + honeypot.is": ["goplus", "honeypotis"],
  GeckoTerminal: ["geckoterminal"],
  "Wayback Machine": ["wayback", "archiveorg"],
  "Farcaster / Warpcast": ["farcaster", "warpcast"],
  "memory.lol": ["memorylol"],
  Telegram: ["telegram"],
  "web3.bio / ENS / Bonfida": ["web3bio", "ens", "bonfida"],
  RDAP: ["rdap"],
  "SEC EDGAR": ["secedgar", "sec"],
};

type ProviderHealth = {
  label: "Healthy" | "Degraded" | "Unavailable" | "Configured" | "No key required" | "Not configured";
  tone: string;
  context: string;
};

function normalizedProvider(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function latestProviderEvent(provider: Provider, events: UsageEvent[]): UsageEvent | undefined {
  const aliases = PROVIDER_ALIASES[provider.label] ?? [normalizedProvider(provider.label)];
  return events
    .filter((event) => aliases.some((alias) => normalizedProvider(event.provider).includes(alias)))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

function providerHealth(provider: Provider, latest?: UsageEvent): ProviderHealth {
  if (provider.tier !== "keyless" && !provider.configured) {
    return {
      label: "Not configured",
      tone: provider.tier === "optional" ? "tint-neutral" : "tint-avoid",
      context: provider.tier === "optional" ? "Optional enrichment is not active." : "Required coverage is unavailable until this is configured.",
    };
  }
  if (latest?.status === "succeeded") {
    return { label: "Healthy", tone: "tint-pass", context: `Latest visible request succeeded ${eventTime(latest.createdAt)}.` };
  }
  if (latest?.status === "cached") {
    return {
      label: provider.tier === "keyless" ? "No key required" : "Configured",
      tone: provider.tier === "keyless" ? "tint-neutral" : "tint-signal",
      context: `Latest visible result was served from cache ${eventTime(latest.createdAt)}; no provider request occurred.`,
    };
  }
  if (latest?.status === "partial") {
    return { label: "Degraded", tone: "tint-caution", context: `Latest visible request was partial ${eventTime(latest.createdAt)}.` };
  }
  if (latest?.status === "failed") {
    return { label: "Unavailable", tone: "tint-avoid", context: `Latest visible request failed ${eventTime(latest.createdAt)}.` };
  }
  if (provider.tier === "keyless") {
    return { label: "No key required", tone: "tint-neutral", context: "Availability is checked when an investigation runs." };
  }
  if (provider.configured) {
    return { label: "Configured", tone: "tint-signal", context: "Credential present; no request appears in the latest activity window." };
  }
  return { label: "Not configured", tone: "tint-avoid", context: "Required coverage is unavailable until this is configured." };
}

function ProviderRow({ provider, latest }: { provider: Provider; latest?: UsageEvent }) {
  const health = providerHealth(provider, latest);
  return (
    <div className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.3fr)_minmax(200px,0.9fr)] md:gap-4">
      <div className="min-w-0">
        <span className="text-[13.5px] font-medium text-ink">{provider.label}</span>
        <span className="chip chip-sm ml-2">{TIER_LABEL[provider.tier] ?? provider.tier}</span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-ink-dim">{provider.powers}</p>
      <div className="min-w-0 md:text-right">
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`chip ${health.tone}`}>{health.label}</span>
          <a href={`https://${provider.source.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">{provider.source}</a>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{health.context}</p>
        {provider.usage && <p className="mono mt-1 text-[11px] text-signal-lift">{provider.usage}</p>}
      </div>
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
  const [dataError, setDataError] = useState("");
  const [usage, setUsage] = useState<UsageFeed | null>(null);
  const [usageError, setUsageError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/keys-status", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { providers?: Provider[]; keyless?: Provider[]; note?: string; message?: string };
        if (!response.ok || !Array.isArray(body.providers) || !Array.isArray(body.keyless)) {
          throw new Error(body.message || "Provider configuration is unavailable.");
        }
        return { providers: body.providers, keyless: body.keyless, note: body.note };
      })
      .then((next) => {
        setData(next);
        setDataError("");
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setDataError(error instanceof Error ? error.message : "Provider configuration is unavailable.");
      });
    return () => controller.abort();
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
  const allProviders = [...providers, ...keyless];
  const health = allProviders.map((provider) => providerHealth(provider, usage ? latestProviderEvent(provider, usage.events) : undefined));
  const healthy = health.filter((status) => status.label === "Healthy").length;
  const configured = providers.filter((provider) => provider.configured).length;
  const attention = allProviders.filter((provider, index) => {
    const status = health[index];
    return status?.label === "Degraded"
      || status?.label === "Unavailable"
      || (provider.tier !== "optional" && provider.tier !== "keyless" && !provider.configured);
  }).length;

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="display-sm text-[24px] text-ink">Providers &amp; coverage</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        Credential readiness and observed request health across ARGUS. Configured means access is present; Healthy
        means a recorded request succeeded. Secret values are never shown.
      </p>
      {data && (
        <div className="panel mt-5 grid grid-cols-2 gap-px overflow-hidden bg-line/60 sm:grid-cols-4" aria-label="Provider status summary">
          <div className="stat-tile rounded-none">
            <span className="stat-label">sources</span>
            <span className="stat-value">{allProviders.length}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">credentials present</span>
            <span className="stat-value">{configured}/{providers.length}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">recently healthy</span>
            <span className="stat-value text-pass">{usage ? healthy : "…"}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">needs attention</span>
            <span className={`stat-value ${attention > 0 ? "text-caution" : "text-ink"}`}>
              {usage ? attention : missing.length > 0 ? `${missing.length}+` : "…"}
            </span>
          </div>
        </div>
      )}
      {dataError && (
        <div className="panel mt-5 px-4 py-3" role="alert">
          <p className="text-[13.5px] font-medium text-ink">Provider configuration could not be loaded</p>
          <p className="mt-1 text-[12.5px] text-ink-dim">{dataError} This is a status failure, not confirmation that sources are unconfigured.</p>
        </div>
      )}
      {missing.length > 0 && (
        <div className="tint-caution mt-4 rounded-lg border px-3 py-2 text-[12.5px]">
          {missing.length} required provider{missing.length === 1 ? "" : "s"} not configured: {missing.map((m) => m.label).join(", ")}.
        </div>
      )}

      <div className="panel mt-5 divide-y divide-line/60 overflow-hidden">
        {/* keyed / optional / infra — the ones with a key to manage */}
        {providers.map((provider) => (
          <ProviderRow
            key={provider.label}
            provider={provider}
            latest={usage ? latestProviderEvent(provider, usage.events) : undefined}
          />
        ))}

        {!data && !dataError && <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">loading provider status…</div>}

        {/* the bar: one labeled divider, then keyless sources as identical rows */}
        {keyless.length > 0 && (
          <div className="flex items-center gap-2 bg-void/40 px-4 py-2">
            <span className="eyebrow">Sources without credentials</span>
            <span className="mono ml-auto text-[11px] text-ink-faint">{keyless.length} sources</span>
          </div>
        )}
        {keyless.map((provider) => (
          <ProviderRow
            key={provider.label}
            provider={provider}
            latest={usage ? latestProviderEvent(provider, usage.events) : undefined}
          />
        ))}
      </div>

      {usageError && data && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-caution" role="status">
          Request health could not be refreshed. Credential states above are still valid, but should not be read as live provider health.
        </p>
      )}

      <section className="mt-6" aria-labelledby="provider-usage-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="provider-usage-title" className="text-[15px] font-medium text-ink">Immutable usage trail</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
              Each recorded report-bound provider request becomes an immutable event. Transport retries reuse that event; fresh panel runs append against the exact report version.
            </p>
          </div>
          {usage && (
            <div className="mono flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5">all recorded history</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.eventCount} {usage.totals.eventCount === 1 ? "event" : "events"}</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.calls} calls</span>
              <span className="rounded border border-line px-1.5 py-0.5">{formatUsd(usage.totals.usd)} estimated</span>
            </div>
          )}
        </div>

        <div className="panel mt-3 overflow-hidden">
          {!usage && !usageError && (
            <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">loading immutable provider events…</div>
          )}
          {usageError && (
            <div className="tint-caution px-4 py-3 text-[12.5px]" role="alert">{usageError}</div>
          )}
          {usage && usage.events.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">No report-bound provider events have been recorded yet.</div>
          )}
          {usage && usage.events.length > 0 && (
            <div className="eyebrow border-b border-line/60 bg-void/30 px-4 py-2">
              Latest {usage.window.eventCount} of {usage.totals.eventCount} recorded events
            </div>
          )}
          {usage?.events.map((event) => (
            <div key={event.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line/60 px-4 py-3 last:border-0">
              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[event.status] ?? "var(--color-ink-faint)" }} />
              <span className="min-w-[150px] flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[12.5px] font-medium text-ink">{event.provider}</span>
                  <span className="chip chip-sm">{shortOperation(event.operation)}</span>
                  <span className="chip tint-var" style={{ "--tint": STATUS_COLOR[event.status] ?? "var(--color-ink-faint)" } as React.CSSProperties}>{event.status}</span>
                </span>
                <span className="mt-0.5 block text-[11px] text-ink-faint">
                  {event.report ? `${event.report.label} · ${event.report.kind} snapshot v${event.report.version}` : "exact report version"}
                  {` · ${event.actor}`}
                </span>
                {event.meta && <span className="mt-0.5 block truncate text-[11px] text-ink-faint" title={event.meta}>{event.meta}</span>}
              </span>
              <span className="mono shrink-0 text-right text-[11px] text-ink-faint">
                <span className="block">×{event.calls} · {eventCost(event)}</span>
                <time dateTime={event.createdAt} className="mt-0.5 block text-[11px]">{eventTime(event.createdAt)}</time>
              </span>
            </div>
          ))}
        </div>
      </section>

      {data?.note && <p className="mt-5 text-[12.5px] leading-relaxed text-ink-faint">{data.note}</p>}
    </div>
  );
}
