import { useEffect, useState } from "react";
import { arkhamProviderEnabled } from "../lib/providerCapabilities";
import type { EvidenceCategory, ProviderKind, ProviderLifecycle } from "../lib/providerCatalog";

// Public-facing evidence catalog first, with provider operations kept secondary.
// Credential presence and recent request outcomes remain separate truth states.
type LedgerPurchase = {
  purchasedAt: string;
  usd: number;
  credits: number;
  pack: string;
  expiresAt: string;
  active?: boolean;
};
type Provider = {
  id?: string;
  label: string;
  powers: string;
  limits?: string;
  source: string;
  tier: string;
  kind?: ProviderKind;
  lifecycle?: ProviderLifecycle;
  category?: EvidenceCategory;
  availableWithoutCredential?: boolean;
  configured: boolean;
  usage?: string;
  disabled?: boolean;
  purchases?: LedgerPurchase[];
};
type SerperCredits = {
  configured: boolean;
  remaining: number | null;
  remainingSource: "serper" | "estimated" | "unavailable";
  remainingEstimate: number | null;
  usedSinceLatestPurchase: number | null;
  dashboardUrl: string;
  purchases: LedgerPurchase[];
  error?: string;
};
const SERPER_LABEL = "Serper (grounded search)";
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
export type ProviderUsageFeed = {
  available: boolean;
  events: UsageEvent[];
  window: { limit: number; eventCount: number };
  totals: { eventCount: number; calls: number; usd: number };
};

export type ProviderPageData = { providers: Provider[]; keyless: Provider[]; note?: string };

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
  "Serper (grounded search)": ["serper", "groundedsearch"],
  "Helius (Solana)": ["helius"],
  GitHub: ["github"],
  "People Data Labs": ["peopledatalabs", "pdl"],
  "Reddit OAuth": ["reddit"],
  Supabase: ["supabase"],
  CoinGecko: ["coingecko"],
  Crunchbase: ["crunchbase"],
  "Etherscan (multichain)": ["etherscan"],
  Arkham: ["arkham"],
  Bitquery: ["bitquery"],
  DexScreener: ["dexscreener"],
  GoPlus: ["goplus"],
  "honeypot.is": ["honeypotis", "honeypot"],
  RugCheck: ["rugcheck"],
  DeFiLlama: ["defillama"],
  "Monid and Akta": ["monid", "akta"],
  GMGN: ["gmgn"],
  Snapshot: ["snapshot"],
  "Google News": ["googlenews", "news"],
  CourtListener: ["courtlistener"],
  "OFAC and OpenSanctions": ["ofac", "opensanctions", "sanctions"],
  URLhaus: ["urlhaus"],
  GeckoTerminal: ["geckoterminal"],
  "Web archives": ["wayback", "archiveorg", "arquivo"],
  "Farcaster / Warpcast": ["farcaster", "warpcast"],
  "memory.lol": ["memorylol"],
  Telegram: ["telegram"],
  "web3.bio / ENS / Bonfida": ["web3bio", "ens", "bonfida"],
  RDAP: ["rdap"],
  "SEC EDGAR": ["secedgar", "sec"],
};

type ProviderHealth = {
  label: "Last check passed" | "Last check partial" | "Last check failed" | "Access set up" | "No key required" | "Optional source off" | "Not connected" | "Not active" | "Paused";
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
  if (provider.disabled) {
    return {
      label: "Paused",
      tone: "tint-neutral",
      context: "This optional provider is disabled and does not affect report readiness.",
    };
  }
  if (provider.lifecycle === "retired" || provider.lifecycle === "reserved") {
    return {
      label: "Not active",
      tone: "tint-neutral",
      context: provider.lifecycle === "retired" ? "Retired from current reports." : "Reserved for future work and not used in current reports.",
    };
  }
  if (provider.availableWithoutCredential && !provider.configured) {
    return { label: "No key required", tone: "tint-neutral", context: "The free route works. No paid credential is configured." };
  }
  if (provider.tier !== "keyless" && !provider.configured) {
    return provider.tier === "optional"
      ? { label: "Optional source off", tone: "tint-neutral", context: "This optional source is not available in this deployment." }
      : { label: "Not connected", tone: "tint-avoid", context: "A required credential is not configured." };
  }
  if (latest?.status === "succeeded") {
    return { label: "Last check passed", tone: "tint-pass", context: `Latest request in this activity window succeeded ${eventTime(latest.createdAt)}.` };
  }
  if (latest?.status === "cached") {
    return {
      label: provider.tier === "keyless" ? "No key required" : "Access set up",
      tone: provider.tier === "keyless" ? "tint-neutral" : "tint-signal",
      context: `Latest result in this activity window was served from cache ${eventTime(latest.createdAt)}; no provider request occurred.`,
    };
  }
  if (latest?.status === "partial") {
    return { label: "Last check partial", tone: "tint-caution", context: `Latest request in this activity window was partial ${eventTime(latest.createdAt)}.` };
  }
  if (latest?.status === "failed") {
    return { label: "Last check failed", tone: "tint-avoid", context: `Latest request in this activity window failed ${eventTime(latest.createdAt)}. This does not prove a continuing outage.` };
  }
  if (provider.tier === "keyless") {
    return { label: "No key required", tone: "tint-neutral", context: "Availability is checked when an investigation runs." };
  }
  if (provider.configured) {
    return { label: "Access set up", tone: "tint-signal", context: "Credential present; no request appears in the latest activity window." };
  }
  return { label: "Not connected", tone: "tint-avoid", context: "A required credential is not configured." };
}

function ProviderRow({
  provider,
  latest,
  serperCredits,
  serperCreditsLoading,
  serperCreditsError,
  onCheckSerperCredits,
}: {
  provider: Provider;
  latest?: UsageEvent;
  serperCredits?: SerperCredits | null;
  serperCreditsLoading?: boolean;
  serperCreditsError?: string;
  onCheckSerperCredits?: () => void;
}) {
  const health = providerHealth(provider, latest);
  const isSerper = provider.label === SERPER_LABEL && !!onCheckSerperCredits;
  const lastPurchase = latestLedgerPurchase(provider.purchases);
  return (
    <div
      onClick={isSerper ? (event) => {
        if ((event.target as HTMLElement).closest("a, button")) return;
        onCheckSerperCredits?.();
      } : undefined}
    >
    <div className="grid gap-2 px-4 py-3 md:grid-cols-[minmax(150px,0.8fr)_minmax(220px,1.3fr)_minmax(200px,0.9fr)] md:gap-4">
      <div className="min-w-0">
        <span className="text-[13.5px] font-medium text-ink">{provider.label}</span>
        <span className="chip chip-sm ml-2">{TIER_LABEL[provider.tier] ?? provider.tier}</span>
      </div>
      <div>
        <p className="text-[12.5px] leading-relaxed text-ink-dim">{provider.powers}</p>
        {provider.limits && (
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
            <span className="font-medium text-ink-dim">Limit:</span> {provider.limits}
          </p>
        )}
      </div>
      <div className="min-w-0 md:text-right">
        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <span className={`chip ${health.tone}`}>{health.label}</span>
          <a href={`https://${provider.source.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">{provider.source}</a>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">{health.context}</p>
        {provider.usage && <p className="mono mt-1 text-[11px] text-signal-lift">{provider.usage}</p>}
        {lastPurchase && (
          <p className="mono mt-1 text-[11px] text-ink-faint">
            Last top-up {formatLedgerDate(lastPurchase.purchasedAt)} · {formatPackUsd(lastPurchase.usd)} / {formatCreditCount(lastPurchase.credits)} credits
          </p>
        )}
        {isSerper && (
          <button type="button" className="mt-1 text-[11px] text-signal-lift underline-offset-2 hover:underline" onClick={() => onCheckSerperCredits?.()}>
            {serperCreditsLoading ? "Checking credits…" : "Check credits"}
          </button>
        )}
      </div>
    </div>
    {isSerper && (serperCreditsLoading || serperCreditsError || serperCredits) && (
      <div className="border-t border-line/40 bg-void/20 px-4 py-3">
        {serperCreditsLoading && <p className="text-[12.5px] text-ink-faint">Checking credits…</p>}
        {serperCreditsError && <p className="text-[12.5px] text-caution" role="alert">{serperCreditsError}</p>}
        {serperCredits && !serperCreditsLoading && (
          <>
            <p className="text-[12.5px] text-ink">
              {serperCredits.remaining !== null
                ? `Remaining: ${formatCreditCount(serperCredits.remaining)}`
                : serperCredits.remainingEstimate !== null
                  ? `Remaining estimate: ${formatCreditCount(serperCredits.remainingEstimate)}`
                  : "Remaining credits unavailable"}
            </p>
            <p className="mt-0.5 text-[11px] text-ink-faint">
              Source: {serperCredits.remainingSource}
              {serperCredits.usedSinceLatestPurchase !== null
                ? ` · ${formatCreditCount(serperCredits.usedSinceLatestPurchase)} used since latest purchase`
                : ""}
            </p>
            <p className="eyebrow mt-2">Purchase history</p>
            {serperCredits.purchases.map((purchase) => (
              <p key={`${purchase.purchasedAt}-${purchase.pack}`} className="mt-1 text-[12.5px] text-ink-dim">
                {formatLedgerDate(purchase.purchasedAt)} · {purchase.pack} · {formatPackUsd(purchase.usd)} / {formatCreditCount(purchase.credits)} credits
                {" · expires "}{formatLedgerDate(purchase.expiresAt)}
                {purchase.active ? " · active" : " · expired"}
              </p>
            ))}
            <a href={serperCredits.dashboardUrl || "https://serper.dev/dashboard"} target="_blank" rel="noreferrer" className="link-ext mono mt-2 inline-block text-[11px]">
              serper.dev/dashboard
            </a>
          </>
        )}
      </div>
    )}
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

function formatLedgerDate(value: string): string {
  const day = value.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const [year, month, date] = day.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    });
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Cancun" });
}

function formatCreditCount(value: number): string {
  return value.toLocaleString("en-US");
}

function formatPackUsd(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function latestLedgerPurchase(purchases?: LedgerPurchase[]): LedgerPurchase | undefined {
  if (!purchases?.length) return undefined;
  return purchases.slice().sort((a, b) => Date.parse(b.purchasedAt) - Date.parse(a.purchasedAt))[0];
}

function eventCost(event: UsageEvent): string {
  if (event.usd > 0) return formatUsd(event.usd);
  const meta = event.meta?.toLowerCase() ?? "";
  if (meta.includes("subscription") || meta.includes("keyed") || meta.includes("plan-priced")) return "plan-priced";
  if (meta.includes("keyless")) return "keyless";
  return "cost not recorded";
}

export function ProvidersPage({ previewData, previewUsage }: { previewData?: ProviderPageData; previewUsage?: ProviderUsageFeed } = {}) {
  const arkhamEnabled = arkhamProviderEnabled();
  const [data, setData] = useState<ProviderPageData | null>(previewData ?? null);
  const [dataError, setDataError] = useState("");
  const [usage, setUsage] = useState<ProviderUsageFeed | null>(previewUsage ?? null);
  const [usageError, setUsageError] = useState("");
  const [serperCredits, setSerperCredits] = useState<SerperCredits | null>(null);
  const [serperCreditsLoading, setSerperCreditsLoading] = useState(false);
  const [serperCreditsError, setSerperCreditsError] = useState("");
  const checkSerperCredits = () => {
    setSerperCreditsLoading(true);
    setSerperCreditsError("");
    fetch("/api/serper-credits")
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Partial<SerperCredits> & { message?: string };
        if (!response.ok || !Array.isArray(body.purchases)) {
          throw new Error(body.message || body.error || "Serper credits are unavailable.");
        }
        return body as SerperCredits;
      })
      .then((next) => {
        setSerperCredits(next);
        setSerperCreditsError("");
      })
      .catch((error) => {
        setSerperCreditsError(error instanceof Error ? error.message : "Serper credits are unavailable.");
      })
      .finally(() => setSerperCreditsLoading(false));
  };
  useEffect(() => {
    if (previewData) return;
    const controller = new AbortController();
    fetch("/api/keys-status", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as { providers?: Provider[]; keyless?: Provider[]; note?: string; message?: string };
        if (!response.ok || !Array.isArray(body.providers) || !Array.isArray(body.keyless)) {
          throw new Error(body.message || "Provider configuration is unavailable.");
        }
        return { providers: body.providers, keyless: body.keyless, note: body.note } as ProviderPageData;
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
  }, [previewData]);
  useEffect(() => {
    if (previewUsage) return;
    const controller = new AbortController();
    fetch("/api/provider-usage?limit=40", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as Partial<ProviderUsageFeed> & { message?: string };
        if (!response.ok || !Array.isArray(body.events) || !body.window || !body.totals) {
          throw new Error(body.message || "Provider usage is unavailable.");
        }
        return body as ProviderUsageFeed;
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
  }, [previewUsage]);

  const providers = (data?.providers ?? []).map((provider) =>
    provider.label === "Arkham" && !arkhamEnabled
      ? { ...provider, disabled: true }
      : provider);
  const keyless = data?.keyless ?? [];
  const allProviders = [...providers, ...keyless];
  const evidenceSources = allProviders.filter((provider) => (provider.kind ?? "evidence") === "evidence" && (provider.lifecycle ?? "active") === "active");
  const supportingProviders = allProviders.filter((provider) => !evidenceSources.includes(provider));
  const missing = evidenceSources.filter((provider) => !provider.disabled && !provider.configured && !provider.availableWithoutCredential && provider.tier === "paid");
  const availableSources = evidenceSources.filter((provider) => !provider.disabled && (provider.configured || provider.availableWithoutCredential || provider.tier === "keyless"));
  const categories = [...new Set(evidenceSources.map((provider) => provider.category ?? "Evidence catalog"))];
  const evidenceHealth = evidenceSources.map((provider) => providerHealth(provider, usage ? latestProviderEvent(provider, usage.events) : undefined));
  const attention = evidenceHealth.filter((status) => status.label === "Last check failed" || status.label === "Last check partial").length;

  return (
    <div className="workspace-frame">
      <h1 className="display-sm text-[24px] text-ink">Evidence sources</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        See where ARGUS gets outside facts, what each source can establish, and where its evidence stops. Models and product infrastructure are listed separately because they are not evidence.
      </p>
      {data && (
        <div className="panel mt-5 grid grid-cols-2 gap-px overflow-hidden bg-line/60 sm:grid-cols-4" aria-label="Evidence source summary">
          <div className="stat-tile rounded-none">
            <span className="stat-label">evidence sources</span>
            <span className="stat-value">{evidenceSources.length}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">coverage areas</span>
            <span className="stat-value">{categories.length}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">available here</span>
            <span className="stat-value">{availableSources.length}/{evidenceSources.length}</span>
          </div>
          <div className="stat-tile rounded-none">
            <span className="stat-label">recent check issues</span>
            <span className={`stat-value ${attention > 0 ? "text-caution" : "text-ink"}`}>
              {usage ? attention : "…"}
            </span>
          </div>
        </div>
      )}
      {dataError && (
        <div className="panel mt-5 px-4 py-3" role="alert">
          <p className="text-[13.5px] font-medium text-ink">Evidence catalog could not be loaded</p>
          <p className="mt-1 text-[12.5px] text-ink-dim">{dataError} This does not mean that ARGUS has no sources.</p>
        </div>
      )}
      {missing.length > 0 && (
        <div className="tint-caution mt-4 rounded-lg border px-3 py-2 text-[12.5px]">
          {missing.length} credential-required source{missing.length === 1 ? " is" : "s are"} not available in this deployment: {missing.map((m) => m.label).join(", ")}.
        </div>
      )}

      {!data && !dataError && <div className="panel mt-5 px-4 py-6 text-center text-[12.5px] text-ink-faint">loading evidence catalog…</div>}

      {categories.map((category) => {
        const rows = evidenceSources.filter((provider) => (provider.category ?? "Evidence catalog") === category);
        return (
          <section key={category} className="mt-5" aria-labelledby={`source-category-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id={`source-category-${category.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`} className="eyebrow">{category}</h2>
              <span className="mono text-[11px] text-ink-faint">{rows.length} {rows.length === 1 ? "source" : "sources"}</span>
            </div>
            <div className="panel divide-y divide-line/60 overflow-hidden">
              {rows.map((provider) => (
                <ProviderRow
                  key={provider.label}
                  provider={provider}
                  latest={usage ? latestProviderEvent(provider, usage.events) : undefined}
                  serperCredits={serperCredits}
                  serperCreditsLoading={serperCreditsLoading}
                  serperCreditsError={serperCreditsError}
                  onCheckSerperCredits={checkSerperCredits}
                />
              ))}
            </div>
          </section>
        );
      })}

      {supportingProviders.length > 0 && (
        <details className="panel mt-5 overflow-hidden">
          <summary className="cursor-pointer px-4 py-3 text-[13px] font-medium text-ink">
            Models, infrastructure, and inactive integrations
            <span className="mono ml-2 text-[11px] font-normal text-ink-faint">{supportingProviders.length} listed separately</span>
          </summary>
          <p className="border-t border-line/60 bg-void/30 px-4 py-3 text-[12.5px] leading-relaxed text-ink-dim">
            These services help ARGUS reason, save work, or preserve old configuration. They are not counted as outside evidence sources.
          </p>
          <div className="divide-y divide-line/60">
            {supportingProviders.map((provider) => (
              <ProviderRow
                key={provider.label}
                provider={provider}
                latest={usage ? latestProviderEvent(provider, usage.events) : undefined}
                serperCredits={serperCredits}
                serperCreditsLoading={serperCreditsLoading}
                serperCreditsError={serperCreditsError}
                onCheckSerperCredits={checkSerperCredits}
              />
            ))}
          </div>
        </details>
      )}

      {usageError && data && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-caution" role="status">
          Recent source activity could not be refreshed. Credential presence above is still known, but current availability is not.
        </p>
      )}

      <section className="mt-6" aria-labelledby="provider-usage-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="provider-usage-title" className="text-[15px] font-medium text-ink">Recent saved-report activity</h2>
            <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
              Saved reports record which providers ran, the recorded outcome, and any cost estimate the ledger has. The list below is a limited recent window; account totals can cover more history.
            </p>
          </div>
          {usage && (
            <div className="mono flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint">
              <span className="rounded border border-line px-1.5 py-0.5">account ledger totals</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.eventCount} {usage.totals.eventCount === 1 ? "event" : "events"}</span>
              <span className="rounded border border-line px-1.5 py-0.5">{usage.totals.calls} calls</span>
              <span className="rounded border border-line px-1.5 py-0.5">{formatUsd(usage.totals.usd)} estimated</span>
            </div>
          )}
        </div>

        <div className="panel mt-3 overflow-hidden">
          {!usage && !usageError && (
            <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">loading source activity…</div>
          )}
          {usageError && (
            <div className="tint-caution px-4 py-3 text-[12.5px]" role="alert">{usageError}</div>
          )}
          {usage && usage.events.length === 0 && (
            <div className="px-4 py-6 text-center text-[12.5px] text-ink-faint">No saved source activity yet.</div>
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
                  {event.report ? `${event.report.label} · ${event.report.kind} saved report v${event.report.version}` : "saved report"}
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
