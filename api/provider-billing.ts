// Server-to-server provider account telemetry for the OENBOT operations view.
// This endpoint is deliberately read-only: it reports exact upstream USD
// figures where available and never turns quotas, credits, or plan prices into
// estimated money.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { PROVIDER_CATALOG, type ProviderCatalogEntry } from "../src/lib/providerCatalog.js";

export const config = { maxDuration: 15 };

export type ProviderBillingState =
  | "live"
  | "needs_admin_key"
  | "needs_management_key"
  | "needs_project_id"
  | "configured_no_usage_api"
  | "not_configured"
  | "error";

export type ProviderBillingScope = "account" | "api_key" | "project" | "quota" | "configuration";

export interface ProviderQuota {
  used?: number;
  limit?: number;
  remaining?: number;
  period?: string;
  resetAt?: string;
}

export interface ProviderBillingRow {
  id: string;
  state: ProviderBillingState;
  scope: ProviderBillingScope;
  detail: string;
  checkedAt?: string;
  currency?: string;
  spentMonthUsd?: number;
  balanceUsd?: number;
  totalPurchasedUsd?: number;
  quota?: ProviderQuota;
  plan?: string;
}

export interface ProviderBillingPayload {
  available: boolean;
  mode: "provider_account_billing";
  updatedAt: string;
  summary: {
    liveConnectors: number;
    providerAccounts: number;
    unresolvedAccounts: number;
    exactSpendMonthUsd: number | null;
    exactBalanceUsd: number | null;
  };
  providers: ProviderBillingRow[];
}

type JsonRecord = Record<string, unknown>;
type Fetcher = typeof fetch;

const CACHE_TTL_MS = 60_000;
let cached: { expiresAt: number; payload: ProviderBillingPayload } | null = null;

const BILLING_PROVIDERS = PROVIDER_CATALOG.filter(
  (provider) => provider.lifecycle === "active" && provider.tier !== "keyless" && (provider.env?.length ?? 0) > 0,
);

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function finiteNonNegative(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : undefined;
}

function isoDate(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function credentialConfigured(provider: ProviderCatalogEntry): boolean {
  const primary = provider.env ?? [];
  const alternatives = provider.alternativeEnv ?? [];
  const primaryConfigured = provider.id === "supabase"
    ? primary.some((key) => !!process.env[key]) || alternatives.some((key) => !!process.env[key])
    : primary.every((key) => !!process.env[key]);
  return primaryConfigured && (provider.alsoEnv ?? []).every((key) => !!process.env[key]);
}

function providerKey(provider: ProviderCatalogEntry): string {
  return (provider.env ?? []).map((name) => process.env[name]).find(Boolean) ?? "";
}

function fixedRow(
  provider: ProviderCatalogEntry,
  state: ProviderBillingState,
  scope: ProviderBillingScope,
  detail: string,
): ProviderBillingRow {
  return { id: provider.id, state, scope, detail };
}

async function getJson(
  url: string,
  init: RequestInit,
  fetcher: Fetcher,
): Promise<{ ok: true; body: unknown } | { ok: false; status?: number }> {
  try {
    const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(6_000) });
    if (!response.ok) return { ok: false, status: response.status };
    return { ok: true, body: await response.json() as unknown };
  } catch {
    return { ok: false };
  }
}

export function parseMonidBalance(body: unknown, checkedAt: string): ProviderBillingRow | null {
  const root = record(body);
  const balanceObject = record(root.balance);
  const balance = finiteNonNegative(balanceObject.value ?? root.balance);
  const currency = cleanText(balanceObject.currency ?? root.currency)?.toUpperCase();
  if (balance === undefined || currency !== "USD") return null;
  const heldObject = record(root.held);
  const held = finiteNonNegative(heldObject.value ?? root.held);
  return {
    id: "monid",
    state: "live",
    scope: "account",
    detail: held && held > 0
      ? "Provider-reported USD wallet balance. A separate held amount exists and is not netted from this figure."
      : "Provider-reported USD wallet balance.",
    checkedAt,
    currency: "USD",
    balanceUsd: balance,
  };
}

export function parseOpenRouterKey(body: unknown, checkedAt: string): ProviderBillingRow | null {
  const data = record(record(body).data ?? body);
  const spentMonthUsd = finiteNonNegative(data.usage_monthly);
  if (spentMonthUsd === undefined) return null;
  const limit = finiteNonNegative(data.limit);
  const remaining = finiteNonNegative(data.limit_remaining);
  return {
    id: "openrouter",
    state: "live",
    scope: "api_key",
    detail: "Provider-reported monthly USD usage for this API key. Account credit balance requires an OpenRouter management key.",
    checkedAt,
    currency: "USD",
    spentMonthUsd,
    ...(limit === undefined && remaining === undefined ? {} : { quota: { limit, remaining, period: "api_key_limit" } }),
  };
}

export function parseGithubQuota(body: unknown, checkedAt: string): ProviderBillingRow | null {
  const root = record(body);
  const core = record(record(root.resources).core ?? root.rate);
  const limit = finiteNonNegative(core.limit);
  const remaining = finiteNonNegative(core.remaining);
  if (limit === undefined || remaining === undefined) return null;
  return {
    id: "github",
    state: "configured_no_usage_api",
    scope: "quota",
    detail: "GitHub reports request quota, not account spend or balance.",
    checkedAt,
    quota: { used: Math.max(0, limit - remaining), limit, remaining, period: "rate_limit_window", resetAt: isoDate(core.reset) },
  };
}

export function parseTwitterQuota(body: unknown, checkedAt: string): ProviderBillingRow {
  const data = record(record(body).data ?? body);
  const remaining = finiteNonNegative(data.recharge_credits);
  return {
    id: "twitterapi",
    state: "configured_no_usage_api",
    scope: "quota",
    detail: "twitterapi.io reports provider credits, not USD spend or balance.",
    checkedAt,
    ...(remaining === undefined ? {} : { quota: { remaining, period: "provider_credits" } }),
  };
}

export function parseCoinGeckoQuota(body: unknown, checkedAt: string): ProviderBillingRow {
  const data = record(record(body).data ?? body);
  const limit = finiteNonNegative(data.monthly_call_credit ?? data.monthly_call_credits);
  const used = finiteNonNegative(data.current_total_monthly_calls ?? data.current_monthly_calls);
  const remaining = limit === undefined ? undefined : Math.max(0, limit - (used ?? 0));
  return {
    id: "coingecko",
    state: "configured_no_usage_api",
    scope: "quota",
    detail: "CoinGecko reports plan and call quota, not exact USD spend or balance.",
    checkedAt,
    ...(cleanText(data.plan) ? { plan: cleanText(data.plan) } : {}),
    ...(limit === undefined && used === undefined ? {} : {
      quota: { limit, used, remaining, period: "month", resetAt: isoDate(data.next_billing_date ?? data.reset_at) },
    }),
  };
}

async function probe(provider: ProviderCatalogEntry, fetcher: Fetcher): Promise<ProviderBillingRow> {
  if (!credentialConfigured(provider)) {
    return fixedRow(provider, "not_configured", "configuration", "Provider credential is not configured.");
  }
  const key = providerKey(provider);
  const checkedAt = new Date().toISOString();
  let result: Awaited<ReturnType<typeof getJson>>;

  if (provider.id === "monid") {
    result = await getJson("https://api.monid.ai/v1/wallet/balance", { headers: { authorization: `Bearer ${key}` } }, fetcher);
    if (!result.ok) return { ...fixedRow(provider, "error", "account", `Provider balance check failed${result.status ? ` (${result.status})` : ""}.`), checkedAt };
    return parseMonidBalance(result.body, checkedAt)
      ?? { ...fixedRow(provider, "error", "account", "Provider returned an unsupported balance shape or non-USD currency."), checkedAt };
  }

  if (provider.id === "openrouter") {
    result = await getJson("https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key}` } }, fetcher);
    if (!result.ok) return { ...fixedRow(provider, "error", "api_key", `Provider key usage check failed${result.status ? ` (${result.status})` : ""}.`), checkedAt };
    return parseOpenRouterKey(result.body, checkedAt)
      ?? { ...fixedRow(provider, "error", "api_key", "Provider returned an unsupported key-usage shape."), checkedAt };
  }

  if (provider.id === "github") {
    result = await getJson("https://api.github.com/rate_limit", {
      headers: { authorization: `Bearer ${key}`, accept: "application/vnd.github+json", "user-agent": "argus-provider-telemetry" },
    }, fetcher);
    if (!result.ok) return { ...fixedRow(provider, "error", "quota", `Provider quota check failed${result.status ? ` (${result.status})` : ""}.`), checkedAt };
    return parseGithubQuota(result.body, checkedAt)
      ?? { ...fixedRow(provider, "error", "quota", "Provider returned an unsupported quota shape."), checkedAt };
  }

  if (provider.id === "twitterapi") {
    result = await getJson("https://api.twitterapi.io/oapi/my/info", { headers: { "X-API-Key": key } }, fetcher);
    if (!result.ok) return { ...fixedRow(provider, "error", "quota", `Provider credit check failed${result.status ? ` (${result.status})` : ""}.`), checkedAt };
    return parseTwitterQuota(result.body, checkedAt);
  }

  if (provider.id === "coingecko") {
    result = await getJson(
      "https://pro-api.coingecko.com/api/v3/key",
      { headers: { "x-cg-pro-api-key": key } },
      fetcher,
    );
    if (!result.ok) return { ...fixedRow(provider, "error", "quota", `Provider account check failed${result.status ? ` (${result.status})` : ""}.`), checkedAt };
    return parseCoinGeckoQuota(result.body, checkedAt);
  }

  if (provider.id === "claude") {
    return fixedRow(provider, "needs_admin_key", "account", "The configured inference key cannot read Anthropic account usage; an admin key is required.");
  }
  if (provider.id === "grok") {
    return fixedRow(provider, "configured_no_usage_api", "account", "xAI does not expose account billing through the configured inference credential.");
  }
  return fixedRow(provider, "configured_no_usage_api", "configuration", "Credential is configured, but no exact provider billing API is supported.");
}

function bearerToken(req: VercelRequest): string | null {
  const raw = req.headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? /^Bearer\s+(.+)$/i.exec(value.trim())?.[1] ?? null : null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

async function buildPayload(fetcher: Fetcher): Promise<ProviderBillingPayload> {
  const providers = await Promise.all(BILLING_PROVIDERS.map((provider) => probe(provider, fetcher)));
  const configured = BILLING_PROVIDERS.filter(credentialConfigured).length;
  const live = providers.filter((provider) => provider.state === "live");
  const spends = live.map((provider) => provider.spentMonthUsd).filter((value): value is number => value !== undefined);
  const balances = live.map((provider) => provider.balanceUsd).filter((value): value is number => value !== undefined);
  return {
    available: true,
    mode: "provider_account_billing",
    updatedAt: new Date().toISOString(),
    summary: {
      liveConnectors: live.length,
      providerAccounts: configured,
      unresolvedAccounts: Math.max(0, configured - live.length),
      exactSpendMonthUsd: spends.length ? spends.reduce((sum, value) => sum + value, 0) : null,
      exactBalanceUsd: balances.length ? balances.reduce((sum, value) => sum + value, 0) : null,
    },
    providers,
  };
}

export function resetProviderBillingCache(): void {
  cached = null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "GET") {
    res.setHeader("allow", "GET");
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const expected = process.env.ARGUS_BILLING_FEED_TOKEN ?? "";
  const supplied = bearerToken(req) ?? "";
  if (!expected || !supplied || !constantTimeEqual(supplied, expected)) {
    res.setHeader("www-authenticate", 'Bearer realm="ARGUS provider telemetry"');
    res.status(401).json({ error: "authentication_required" });
    return;
  }
  if (cached && cached.expiresAt > Date.now()) {
    res.status(200).json(cached.payload);
    return;
  }
  const payload = await buildPayload(fetch);
  cached = { expiresAt: Date.now() + CACHE_TTL_MS, payload };
  res.status(200).json(payload);
}
