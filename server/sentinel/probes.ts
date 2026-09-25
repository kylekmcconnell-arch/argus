// Live provider probes for the API sentinel.
//
// Each probe makes the cheapest real, authenticated request that proves the
// configured credential works. Where a provider offers an account, key-info,
// model-list or rate-limit endpoint, that is used and costs nothing. Where no
// free check exists the probe is marked `costly` and runs on a slower schedule
// (SENTINEL_COSTLY_INTERVAL_HOURS, default 6); its `costNote` states what one
// check consumes. docs/PROVIDER-SENTINEL.md mirrors this table.
//
// Probes never log, store, or return a credential. Provider text is reduced to
// a short sanitized message before it reaches `detail`.
import {
  parseCoinGeckoQuota,
  parseGithubQuota,
  parseMonidBalance,
  parseOpenRouterKey,
  parseTwitterQuota,
} from "../../api/provider-billing.js";
import { parseSerperRemaining } from "../../api/serper-credits.js";
import {
  classifyBodyError,
  classifyError,
  classifyHttp,
  isLowCredit,
  providerMessage,
  sanitizeMessage,
  type Classification,
  type Thresholds,
} from "./classify.js";
import type { ProbeResult, SentinelBalance, SentinelReason, SentinelStatus } from "./types.js";

export const PROBE_TIMEOUT_MS = 8_000;
/** twitterapi.io prices its credits at 100,000 per USD. */
export const TWITTERAPI_CREDITS_PER_USD = 100_000;

type Env = Record<string, string | undefined>;
type Fetcher = typeof fetch;

export interface ProbeContext {
  env: Env;
  fetcher: Fetcher;
  timeoutMs: number;
  /** Credential values in scope, used only to scrub them from provider text. */
  secrets: string[];
}

export interface ProbeOutcome {
  status: SentinelStatus;
  reason?: SentinelReason;
  detail: string;
  httpStatus?: number;
  latencyMs: number | null;
  balance?: SentinelBalance;
}

export interface ProbeDefinition {
  id: string;
  label: string;
  /** Env vars that must all be set (first one is named in fix advice). */
  env: string[];
  /** Any one of these satisfies the credential requirement instead of `env`. */
  anyEnv?: string[];
  optional?: boolean;
  costly: boolean;
  /** What one check consumes, in plain words. */
  costNote: string;
  /** The endpoint called, for documentation and the dashboard. */
  endpoint: string;
  /** Where an owner fixes this provider's key or billing. */
  console: string;
  run(ctx: ProbeContext): Promise<ProbeOutcome>;
}

// ---------------------------------------------------------------- transport

type HttpResult =
  | { kind: "response"; status: number; text: string; headers: Headers; latencyMs: number }
  | { kind: "error"; error: unknown; latencyMs: number };

async function request(ctx: ProbeContext, url: string, init: RequestInit = {}): Promise<HttpResult> {
  const started = Date.now();
  try {
    const response = await ctx.fetcher(url, {
      ...init,
      headers: { accept: "application/json", "user-agent": "argus-provider-sentinel", ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
    // Bounded read: status probes never need more than a few hundred KB.
    const text = (await response.text()).slice(0, 262_144);
    return { kind: "response", status: response.status, text, headers: response.headers, latencyMs: Date.now() - started };
  } catch (error) {
    return { kind: "error", error, latencyMs: Date.now() - started };
  }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown; } catch { return undefined; }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function num(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function fromClassification(c: Classification, detail: string, http: HttpResult, balance?: SentinelBalance): ProbeOutcome {
  return {
    status: c.status,
    ...(c.reason ? { reason: c.reason } : {}),
    detail,
    ...(http.kind === "response" ? { httpStatus: http.status } : {}),
    latencyMs: http.latencyMs,
    ...(balance ? { balance } : {}),
  };
}

/** Standard handling for transport errors and non-2xx answers. */
function failure(ctx: ProbeContext, http: HttpResult): ProbeOutcome {
  if (http.kind === "error") {
    const c = classifyError(http.error);
    const detail = c.reason === "timeout"
      ? `No answer within ${Math.round(ctx.timeoutMs / 1000)}s`
      : `Request failed: ${sanitizeMessage(http.error instanceof Error ? http.error.message : String(http.error), ctx.secrets, 100)}`;
    return fromClassification(c, detail, http);
  }
  const message = sanitizeMessage(providerMessage(http.text), ctx.secrets);
  const c = classifyHttp(http.status, http.text.slice(0, 4096));
  return fromClassification(c, `HTTP ${http.status}${message ? `: ${message}` : ""}`, http);
}

function ok(http: HttpResult, detail: string, balance?: SentinelBalance): ProbeOutcome {
  return fromClassification({ status: "ok" }, detail, http, balance);
}

function unexpected(http: HttpResult, detail: string): ProbeOutcome {
  return fromClassification({ status: "degraded", reason: "unexpected_response" }, detail, http);
}

function isSuccess(http: HttpResult): http is Extract<HttpResult, { kind: "response" }> {
  return http.kind === "response" && http.status >= 200 && http.status < 300;
}

const key = (ctx: ProbeContext, name: string): string => ctx.env[name]?.trim() ?? "";

// -------------------------------------------------------------------- probes

const EVM_PROBE_ADDRESS = "0x000000000000000000000000000000000000dEaD";
const WSOL = "So11111111111111111111111111111111111111112";

export const PROBES: readonly ProbeDefinition[] = [
  {
    id: "xai",
    label: "Grok (xAI)",
    env: ["XAI_API_KEY"],
    costly: false,
    costNote: "Free: key-introspection endpoint.",
    endpoint: "GET https://api.x.ai/v1/api-key",
    console: "https://console.x.ai",
    async run(ctx) {
      const http = await request(ctx, "https://api.x.ai/v1/api-key", { headers: { authorization: `Bearer ${key(ctx, "XAI_API_KEY")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      if (body.team_blocked === true) return fromClassification({ status: "down", reason: "out_of_credits" }, "HTTP 200: xAI team is blocked (usually billing or spending limit)", http);
      if (body.api_key_blocked === true || body.api_key_disabled === true) {
        return fromClassification({ status: "down", reason: "auth_invalid" }, "HTTP 200: key is blocked or disabled", http);
      }
      return ok(http, "Key accepted");
    },
  },
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    env: ["ANTHROPIC_API_KEY"],
    optional: true,
    costly: false,
    costNote: "Free: model list. Cannot see credit balance (needs an admin key); exhausted credit only surfaces on paid calls.",
    endpoint: "GET https://api.anthropic.com/v1/models?limit=1",
    console: "https://console.anthropic.com/settings/billing",
    async run(ctx) {
      const http = await request(ctx, "https://api.anthropic.com/v1/models?limit=1", {
        headers: { "x-api-key": key(ctx, "ANTHROPIC_API_KEY"), "anthropic-version": "2023-06-01" },
      });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted (model list)");
    },
  },
  {
    id: "twitterapi",
    label: "twitterapi.io",
    env: ["TWITTERAPI_KEY"],
    costly: false,
    costNote: "Free: account info endpoint.",
    endpoint: "GET https://api.twitterapi.io/oapi/my/info",
    console: "https://twitterapi.io/dashboard",
    async run(ctx) {
      const http = await request(ctx, "https://api.twitterapi.io/oapi/my/info", { headers: { "X-API-Key": key(ctx, "TWITTERAPI_KEY") } });
      if (!isSuccess(http)) return failure(ctx, http);
      const row = parseTwitterQuota(parseJson(http.text), new Date().toISOString());
      const credits = row.quota?.remaining;
      if (credits === undefined) return unexpected(http, "HTTP 200 but no credit figure in the response");
      if (credits <= 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "No credits remaining", http, { credits: 0, usd: 0, label: "credits" });
      const usd = credits / TWITTERAPI_CREDITS_PER_USD;
      return ok(http, `Key accepted · ${Math.round(credits).toLocaleString("en-US")} credits`, { credits, usd, label: "credits (≈USD at 100k/USD)" });
    },
  },
  {
    id: "serper",
    label: "Serper (grounded search)",
    env: ["SERPER_API_KEY"],
    costly: true,
    costNote: "Tries the account endpoint first (free when available); otherwise one 1-result search = 1 Serper credit (~$0.001).",
    endpoint: "GET https://google.serper.dev/account, fallback POST https://google.serper.dev/search",
    console: "https://serper.dev/dashboard",
    async run(ctx) {
      const apiKey = key(ctx, "SERPER_API_KEY");
      const account = await request(ctx, "https://google.serper.dev/account", { headers: { "X-API-KEY": apiKey } });
      if (isSuccess(account)) {
        const remaining = parseSerperRemaining(parseJson(account.text));
        if (remaining !== null) {
          if (remaining <= 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "No credits remaining", account, { credits: 0 });
          return ok(account, `Key accepted · ${remaining.toLocaleString("en-US")} credits`, { credits: remaining, label: "credits" });
        }
      }
      if (account.kind === "response" && [401, 402, 403].includes(account.status)) return failure(ctx, account);
      const search = await request(ctx, "https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": apiKey, "content-type": "application/json" },
        body: JSON.stringify({ q: "coingecko", num: 1 }),
      });
      if (!isSuccess(search)) return failure(ctx, search);
      return ok(search, "Key accepted (1-credit search)");
    },
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    env: ["OPENROUTER_API_KEY"],
    optional: true,
    costly: false,
    costNote: "Free: key info endpoint.",
    endpoint: "GET https://openrouter.ai/api/v1/key",
    console: "https://openrouter.ai/settings/credits",
    async run(ctx) {
      const http = await request(ctx, "https://openrouter.ai/api/v1/key", { headers: { authorization: `Bearer ${key(ctx, "OPENROUTER_API_KEY")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      const row = parseOpenRouterKey(parseJson(http.text), new Date().toISOString());
      if (!row) return unexpected(http, "HTTP 200 but an unrecognised key-info shape");
      const limit = row.quota?.limit;
      const remaining = row.quota?.remaining;
      if (limit !== undefined && remaining !== undefined) {
        if (remaining <= 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "Key spend limit reached", http, { usd: 0, quota: { limit, remaining } });
        return ok(http, `Key accepted · $${remaining.toFixed(2)} of $${limit.toFixed(2)} key limit left`, { usd: remaining, quota: { limit, remaining, period: "key limit (USD)" }, label: "key limit remaining" });
      }
      return ok(http, `Key accepted · $${(row.spentMonthUsd ?? 0).toFixed(2)} used this month (no key limit)`);
    },
  },
  {
    id: "helius",
    label: "Helius (Solana)",
    env: ["HELIUS_API_KEY"],
    costly: false,
    costNote: "1 Helius plan credit per check (getHealth RPC; ~2.9k credits/month at 15-min cadence). No per-call USD.",
    endpoint: "POST https://mainnet.helius-rpc.com/?api-key=… {getHealth}",
    console: "https://dashboard.helius.dev",
    async run(ctx) {
      const http = await request(ctx, `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key(ctx, "HELIUS_API_KEY"))}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      });
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      if (body.result === "ok") return ok(http, "Key accepted · RPC healthy");
      if (body.error) {
        const message = sanitizeMessage(providerMessage(http.text), ctx.secrets);
        return fromClassification({ status: "degraded", reason: "provider_error_5xx" }, `RPC error: ${message || "node unhealthy"}`, http);
      }
      return unexpected(http, "HTTP 200 but no getHealth result");
    },
  },
  {
    id: "etherscan",
    label: "Etherscan (multichain)",
    env: ["ETHERSCAN_API_KEY"],
    costly: false,
    costNote: "Free: one balance read (counts toward the daily call allowance, no credits).",
    endpoint: "GET https://api.etherscan.io/v2/api?chainid=1&module=account&action=balance",
    console: "https://etherscan.io/myapikey",
    async run(ctx) {
      const query = new URLSearchParams({ chainid: "1", module: "account", action: "balance", address: EVM_PROBE_ADDRESS, tag: "latest", apikey: key(ctx, "ETHERSCAN_API_KEY") });
      const http = await request(ctx, `https://api.etherscan.io/v2/api?${query}`);
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      if (body.status === "1") return ok(http, "Key accepted");
      const message = sanitizeMessage(`${typeof body.message === "string" ? body.message : ""} ${typeof body.result === "string" ? body.result : ""}`, ctx.secrets);
      return fromClassification(classifyBodyError(message), `HTTP 200: ${message || "status 0"}`, http);
    },
  },
  {
    id: "arkham",
    label: "Arkham",
    env: ["ARKHAM_API_KEY"],
    costly: true,
    costNote: "One address-intelligence lookup against the Arkham API allowance; Arkham exposes no free key-info endpoint.",
    endpoint: "GET https://api.arkm.com/intelligence/address/0x…dEaD",
    console: "https://intel.arkm.com/api",
    async run(ctx) {
      const http = await request(ctx, `https://api.arkm.com/intelligence/address/${EVM_PROBE_ADDRESS}`, { headers: { "API-Key": key(ctx, "ARKHAM_API_KEY") } });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted");
    },
  },
  {
    id: "pdl",
    label: "People Data Labs",
    env: ["PDL_API_KEY"],
    costly: false,
    costNote: "Free: an enrich call for a reserved non-existent email returns 404, and PDL bills only 200 matches.",
    endpoint: "GET https://api.peopledatalabs.com/v5/person/enrich?email=…@example.invalid",
    console: "https://dashboard.peopledatalabs.com",
    async run(ctx) {
      const query = new URLSearchParams({ email: "argus-sentinel-probe@example.invalid", min_likelihood: "10" });
      const http = await request(ctx, `https://api.peopledatalabs.com/v5/person/enrich?${query}`, { headers: { "X-Api-Key": key(ctx, "PDL_API_KEY") } });
      if (http.kind === "response" && (http.status === 404 || http.status === 200)) {
        const remaining = num(http.headers.get("x-totallimit-remaining"));
        const balance = remaining === undefined ? undefined : { credits: remaining, label: "enrichment credits" };
        if (remaining === 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "No enrichment credits remaining", http, balance);
        return ok(http, remaining === undefined ? "Key accepted" : `Key accepted · ${remaining.toLocaleString("en-US")} credits`, balance);
      }
      return failure(ctx, http);
    },
  },
  {
    id: "github",
    label: "GitHub",
    env: ["GITHUB_TOKEN"],
    costly: false,
    costNote: "Free: /rate_limit does not count against the quota.",
    endpoint: "GET https://api.github.com/rate_limit",
    console: "https://github.com/settings/tokens",
    async run(ctx) {
      const http = await request(ctx, "https://api.github.com/rate_limit", {
        headers: { authorization: `Bearer ${key(ctx, "GITHUB_TOKEN")}`, accept: "application/vnd.github+json" },
      });
      if (!isSuccess(http)) return failure(ctx, http);
      const row = parseGithubQuota(parseJson(http.text), new Date().toISOString());
      if (!row?.quota) return unexpected(http, "HTTP 200 but no rate-limit figures");
      const { limit, remaining, resetAt } = row.quota;
      if (remaining === 0) return fromClassification({ status: "degraded", reason: "rate_limited" }, "Hourly request quota exhausted", http, { quota: { limit, remaining, resetAt, period: "hour" } });
      return ok(http, `Token accepted · ${remaining}/${limit} requests left this hour`, { quota: { limit, remaining, resetAt, period: "hour" }, label: "hourly requests" });
    },
  },
  {
    id: "coingecko",
    label: "CoinGecko",
    env: ["COINGECKO_API_KEY"],
    costly: false,
    costNote: "Free: /key usage endpoint (not counted as a call credit).",
    endpoint: "GET https://pro-api.coingecko.com/api/v3/key",
    console: "https://www.coingecko.com/en/developers/dashboard",
    async run(ctx) {
      const http = await request(ctx, "https://pro-api.coingecko.com/api/v3/key", { headers: { "x-cg-pro-api-key": key(ctx, "COINGECKO_API_KEY") } });
      if (!isSuccess(http)) return failure(ctx, http);
      const row = parseCoinGeckoQuota(parseJson(http.text), new Date().toISOString());
      const quota = row.quota;
      if (!quota || quota.limit === undefined) return ok(http, `Key accepted${row.plan ? ` · ${row.plan}` : ""}`);
      if (quota.remaining === 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "Monthly call credits used up", http, { quota: { ...quota } });
      return ok(http, `Key accepted${row.plan ? ` · ${row.plan}` : ""} · ${(quota.remaining ?? 0).toLocaleString("en-US")} of ${quota.limit.toLocaleString("en-US")} monthly calls left`, {
        quota: { limit: quota.limit, remaining: quota.remaining, resetAt: quota.resetAt, period: "month" }, label: "monthly calls",
      });
    },
  },
  {
    id: "cryptorank",
    label: "CryptoRank",
    env: ["CRYPTORANK_API_KEY"],
    costly: true,
    costNote: "One /currencies lookup = 1 CryptoRank plan credit (included in the plan's monthly credits).",
    endpoint: "GET https://api.cryptorank.io/v2/currencies?symbol=BTC&limit=1",
    console: "https://cryptorank.io/public-api/dashboard",
    async run(ctx) {
      const http = await request(ctx, "https://api.cryptorank.io/v2/currencies?symbol=BTC&limit=1", { headers: { "X-Api-Key": key(ctx, "CRYPTORANK_API_KEY") } });
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      if (body.data === undefined) return unexpected(http, "HTTP 200 without a data envelope");
      return ok(http, "Key accepted");
    },
  },
  {
    id: "gmgn",
    label: "GMGN",
    env: ["GMGN_API_KEY"],
    costly: true,
    costNote: "One token-info read. GMGN publishes no per-call price, so it is treated as metered.",
    endpoint: "GET https://openapi.gmgn.ai/v1/token/info?chain=sol&address=wSOL",
    console: "https://gmgn.ai/ai",
    async run(ctx) {
      const query = new URLSearchParams({ chain: "sol", address: WSOL, timestamp: String(Math.floor(Date.now() / 1000)), client_id: crypto.randomUUID() });
      const http = await request(ctx, `https://openapi.gmgn.ai/v1/token/info?${query}`, { headers: { "X-APIKEY": key(ctx, "GMGN_API_KEY") } });
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      if (body.code !== undefined && num(body.code) !== 0) {
        const message = sanitizeMessage(providerMessage(http.text), ctx.secrets);
        return fromClassification(classifyBodyError(message), `HTTP 200, code ${String(body.code)}${message ? `: ${message}` : ""}`, http);
      }
      return ok(http, "Key accepted");
    },
  },
  {
    id: "fomoscan",
    label: "FomoScan",
    env: ["FOMOSCAN_API_KEY"],
    costly: false,
    costNote: "Free: /v2/me costs 0 compute units.",
    endpoint: "GET https://api.fomoscan.sh/v2/me",
    console: "https://partner.fomoscan.sh",
    async run(ctx) {
      const http = await request(ctx, "https://api.fomoscan.sh/v2/me", { headers: { authorization: `Bearer ${key(ctx, "FOMOSCAN_API_KEY")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      const body = record(parseJson(http.text));
      const usage = record(body.usage);
      const unmetered = record(body.entitlement).unmetered === true;
      const remaining = num(usage.unitsRemaining);
      const additional = num(usage.additionalUnits) ?? 0;
      if (unmetered) return ok(http, "Key accepted · unmetered plan");
      if (remaining === undefined) return ok(http, "Key accepted");
      const total = remaining + additional;
      if (total <= 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "No compute units remaining", http, { credits: 0, label: "compute units" });
      return ok(http, `Key accepted · ${total.toLocaleString("en-US")} compute units left`, { credits: total, label: "compute units" });
    },
  },
  {
    id: "monid",
    label: "Monid",
    env: ["MONID_API_KEY"],
    costly: false,
    costNote: "Free: wallet balance endpoint.",
    endpoint: "GET https://api.monid.ai/v1/wallet/balance",
    console: "https://monid.ai",
    async run(ctx) {
      const http = await request(ctx, "https://api.monid.ai/v1/wallet/balance", { headers: { authorization: `Bearer ${key(ctx, "MONID_API_KEY")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      const row = parseMonidBalance(parseJson(http.text), new Date().toISOString());
      if (!row || row.balanceUsd === undefined) return unexpected(http, "HTTP 200 but an unrecognised balance shape");
      if (row.balanceUsd <= 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "Wallet balance is $0", http, { usd: 0, label: "wallet balance" });
      return ok(http, `Key accepted · $${row.balanceUsd.toFixed(2)} wallet balance`, { usd: row.balanceUsd, label: "wallet balance" });
    },
  },
  {
    id: "supabase",
    label: "Supabase (service role)",
    env: ["SUPABASE_URL"],
    anyEnv: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"],
    costly: false,
    costNote: "Free: one-row read from argus_members.",
    endpoint: "GET {SUPABASE_URL}/rest/v1/argus_members?limit=1",
    console: "https://supabase.com/dashboard/project/_/settings/api-keys",
    async run(ctx) {
      const url = key(ctx, "SUPABASE_URL").replace(/\/$/, "");
      const serviceKey = key(ctx, "SUPABASE_SECRET_KEY") || key(ctx, "SUPABASE_SERVICE_ROLE_KEY") || key(ctx, "SUPABASE_SERVICE_KEY");
      const headers: Record<string, string> = { apikey: serviceKey };
      if (!serviceKey.startsWith("sb_secret_")) headers.authorization = `Bearer ${serviceKey}`;
      const http = await request(ctx, `${url}/rest/v1/argus_members?select=user_id&limit=1`, { headers });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Service key accepted");
    },
  },
  {
    id: "resend",
    label: "Resend (email)",
    env: ["RESEND_API_KEY"],
    optional: true,
    costly: false,
    costNote: "Free: domain list (a send-only key answering 'restricted' still proves the key is valid).",
    endpoint: "GET https://api.resend.com/domains",
    console: "https://resend.com/api-keys",
    async run(ctx) {
      const http = await request(ctx, "https://api.resend.com/domains", { headers: { authorization: `Bearer ${key(ctx, "RESEND_API_KEY")}` } });
      if (http.kind === "response" && http.status === 401 && /restricted/i.test(http.text)) return ok(http, "Send-only key accepted");
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted");
    },
  },
  // ---------------------------------------------------------- optional lanes
  {
    id: "companies-house",
    label: "Companies House",
    env: ["COMPANIES_HOUSE_API_KEY"],
    optional: true,
    costly: false,
    costNote: "Free API (rate-limited).",
    endpoint: "GET https://api.company-information.service.gov.uk/search/companies?q=argus&items_per_page=1",
    console: "https://developer.company-information.service.gov.uk",
    async run(ctx) {
      const basic = Buffer.from(`${key(ctx, "COMPANIES_HOUSE_API_KEY")}:`).toString("base64");
      const http = await request(ctx, "https://api.company-information.service.gov.uk/search/companies?q=argus&items_per_page=1", { headers: { authorization: `Basic ${basic}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted");
    },
  },
  {
    id: "openalex",
    label: "OpenAlex",
    env: ["OPENALEX_API_KEY"],
    optional: true,
    costly: false,
    costNote: "Free: one-row works query within the daily allowance.",
    endpoint: "GET https://api.openalex.org/works?per_page=1",
    console: "https://openalex.org",
    async run(ctx) {
      const http = await request(ctx, `https://api.openalex.org/works?per_page=1&api_key=${encodeURIComponent(key(ctx, "OPENALEX_API_KEY"))}`);
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted");
    },
  },
  {
    id: "courtlistener",
    label: "CourtListener",
    env: ["COURTLISTENER_API_TOKEN"],
    optional: true,
    costly: false,
    costNote: "Free: one-row courts listing.",
    endpoint: "GET https://www.courtlistener.com/api/rest/v4/courts/?page_size=1",
    console: "https://www.courtlistener.com/profile/api/",
    async run(ctx) {
      const http = await request(ctx, "https://www.courtlistener.com/api/rest/v4/courts/?page_size=1", { headers: { authorization: `Token ${key(ctx, "COURTLISTENER_API_TOKEN")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Token accepted");
    },
  },
  {
    id: "opencorporates",
    label: "OpenCorporates",
    env: ["OPENCORPORATES_API_TOKEN"],
    optional: true,
    costly: false,
    costNote: "Free: account_status endpoint.",
    endpoint: "GET https://api.opencorporates.com/v0.4/account_status",
    console: "https://opencorporates.com/users/account",
    async run(ctx) {
      const http = await request(ctx, `https://api.opencorporates.com/v0.4/account_status?api_token=${encodeURIComponent(key(ctx, "OPENCORPORATES_API_TOKEN"))}`);
      if (!isSuccess(http)) return failure(ctx, http);
      const status = record(record(record(parseJson(http.text)).results).account_status);
      const remaining = num(record(status.calls_remaining).this_month);
      if (remaining === 0) return fromClassification({ status: "down", reason: "out_of_credits" }, "Monthly calls used up", http, { credits: 0, label: "monthly calls" });
      return ok(http, remaining === undefined ? "Token accepted" : `Token accepted · ${remaining.toLocaleString("en-US")} calls left this month`,
        remaining === undefined ? undefined : { credits: remaining, label: "monthly calls" });
    },
  },
  {
    id: "safebrowsing",
    label: "Google Safe Browsing",
    env: ["GOOGLE_SAFE_BROWSING_KEY"],
    optional: true,
    costly: false,
    costNote: "Free: one-URL lookup (Safe Browsing API has no per-call charge).",
    endpoint: "POST https://safebrowsing.googleapis.com/v4/threatMatches:find",
    console: "https://console.cloud.google.com/apis/credentials",
    async run(ctx) {
      const http = await request(ctx, `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key(ctx, "GOOGLE_SAFE_BROWSING_KEY"))}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client: { clientId: "argus-sentinel", clientVersion: "1" },
          threatInfo: { threatTypes: ["MALWARE"], platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url: "https://example.com/" }] },
        }),
      });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Key accepted");
    },
  },
  {
    id: "x-api",
    label: "Official X API v2",
    env: ["X_API_BEARER"],
    optional: true,
    costly: true,
    costNote: "One user lookup; on pay-per-use X API plans each read is billed.",
    endpoint: "GET https://api.x.com/2/users/by/username/XDevelopers",
    console: "https://developer.x.com/en/portal/dashboard",
    async run(ctx) {
      const http = await request(ctx, "https://api.x.com/2/users/by/username/XDevelopers", { headers: { authorization: `Bearer ${key(ctx, "X_API_BEARER")}` } });
      if (!isSuccess(http)) return failure(ctx, http);
      return ok(http, "Bearer accepted");
    },
  },
];

// ------------------------------------------------------------------- runner

export function probeConfigured(def: ProbeDefinition, env: Env): boolean {
  const all = def.env.every((name) => Boolean(env[name]?.trim()));
  const any = !def.anyEnv || def.anyEnv.some((name) => Boolean(env[name]?.trim()));
  return all && any;
}

function probeSecrets(def: ProbeDefinition, env: Env): string[] {
  return [...def.env, ...(def.anyEnv ?? [])].map((name) => env[name]?.trim() ?? "").filter(Boolean);
}

export interface RunProbesOptions {
  env?: Env;
  fetcher?: Fetcher;
  timeoutMs?: number;
  thresholds: Thresholds;
  /** Return false to skip (not run) a configured probe this pass, e.g. a costly probe that is not due. */
  shouldRun?: (def: ProbeDefinition) => boolean;
  now?: () => Date;
}

export interface RunProbesResult {
  results: ProbeResult[];
  /** Configured probes deliberately not run this pass (schedule or disabled). */
  skipped: string[];
}

/** Run every probe in parallel. Never throws; a probe that throws is reported as unexpected_response. */
export async function runProbes(options: RunProbesOptions): Promise<RunProbesResult> {
  const env = options.env ?? process.env;
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;
  const now = options.now ?? (() => new Date());
  const disabled = new Set((env.SENTINEL_DISABLED_PROBES ?? "").split(",").map((item) => item.trim()).filter(Boolean));
  const skipped: string[] = [];

  const settled = await Promise.all(PROBES.map(async (def): Promise<ProbeResult | null> => {
    const base = { provider: def.id, label: def.label, costly: def.costly, optional: Boolean(def.optional) };
    if (!probeConfigured(def, env)) {
      const missing = [...def.env.filter((name) => !env[name]?.trim()), ...(def.anyEnv && !def.anyEnv.some((name) => env[name]?.trim()) ? [def.anyEnv.join(" or ")] : [])];
      return { ...base, status: "not_configured", reason: "missing_key", detail: `${missing.join(", ")} not set`, latencyMs: null, lowCredit: false, checkedAt: now().toISOString() };
    }
    if (disabled.has(def.id) || (options.shouldRun && !options.shouldRun(def))) {
      skipped.push(def.id);
      return null;
    }
    const ctx: ProbeContext = { env, fetcher, timeoutMs, secrets: probeSecrets(def, env) };
    let outcome: ProbeOutcome;
    try {
      outcome = await def.run(ctx);
    } catch (error) {
      outcome = { status: "degraded", reason: "unexpected_response", detail: `Probe error: ${sanitizeMessage(error instanceof Error ? error.message : String(error), ctx.secrets, 100)}`, latencyMs: null };
    }
    const lowCredit = outcome.status === "ok" && isLowCredit(outcome.balance, options.thresholds);
    return {
      ...base,
      status: outcome.status,
      ...(outcome.reason ? { reason: outcome.reason } : {}),
      detail: sanitizeMessage(outcome.detail, ctx.secrets, 200),
      latencyMs: outcome.latencyMs,
      ...(outcome.httpStatus !== undefined ? { httpStatus: outcome.httpStatus } : {}),
      ...(outcome.balance ? { balance: outcome.balance } : {}),
      lowCredit,
      checkedAt: now().toISOString(),
    };
  }));
  return { results: settled.filter((row): row is ProbeResult => row !== null), skipped };
}

export function probeById(id: string): ProbeDefinition | undefined {
  return PROBES.find((def) => def.id === id);
}
