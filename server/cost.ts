// Per-audit provider ledger: EVERY external call an audit makes (paid or free),
// recorded with its op, call count, and estimated dollar cost, then attached to
// the dossier so the report library can show a full A-to-Z cost breakdown.
//
// Prices are public list rates (estimates, labeled as such in the UI):
//   grok-4-fast   $0.20/M in · $0.50/M out · live search ~$25/1K sources
//   claude sonnet $3/M in · $15/M out
//   twitterapi.io ~$0.0002/request
//   PDL           ~$0.10 per person match
//   helius        ~$0.0001/call (credit plans)
// Free/keyless calls (dexscreener, goplus, github, wayback, memory.lol, site
// fetches) are recorded at $0 so the breakdown shows the whole pipeline.
//
// Each audit owns an async-local ledger. Serverless instances can overlap
// requests, so module-global mutable totals would mix provider spend between
// investigations and, eventually, organizations.

import { AsyncLocalStorage } from "node:async_hooks";

const PRICE = {
  grokIn: 0.2 / 1e6,
  grokOut: 0.5 / 1e6,
  grokSource: 25 / 1000,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  claudeWebSearch: 10 / 1000,
  haikuIn: 1 / 1e6,
  haikuOut: 5 / 1e6,
  serperQuery: 1 / 1000,
  twitterapiCall: 0.0002,
  pdlMatch: 0.1,
  heliusCall: 0.0001,
};
const EST_SOURCES_PER_SEARCH = 5;

export interface LedgerLine {
  provider: string;
  op: string;
  /** Total provider attempts, including retries and failed responses. */
  calls: number;
  succeeded: number;
  partial: number;
  failed: number;
  cached: number;
  status: ProviderUsageStatus;
  usd: number;
  meta?: string;
}

export type ProviderUsageStatus = "succeeded" | "partial" | "failed" | "cached";

interface CostState {
  ledger: Map<string, LedgerLine>;
  grok: { in: number; out: number; calls: number; sources: number };
  claude: { in: number; out: number; calls: number };
}

const createState = (): CostState => ({
  ledger: new Map(),
  grok: { in: 0, out: 0, calls: 0, sources: 0 },
  claude: { in: 0, out: 0, calls: 0 },
});

const auditCostState = new AsyncLocalStorage<CostState>();
let fallbackState = createState();

const currentState = (): CostState => auditCostState.getStore() ?? fallbackState;

/** Run one complete investigation with an isolated provider-spend ledger. */
export function withCostLedger<T>(work: () => T): T {
  return auditCostState.run(createState(), work);
}

export function resetCost(): void {
  const state = auditCostState.getStore();
  if (state) {
    state.ledger.clear();
    state.grok = { in: 0, out: 0, calls: 0, sources: 0 };
    state.claude = { in: 0, out: 0, calls: 0 };
  } else {
    fallbackState = createState();
  }
}

const statusCounts = (status: ProviderUsageStatus) => ({
  succeeded: status === "succeeded" ? 1 : 0,
  partial: status === "partial" ? 1 : 0,
  failed: status === "failed" ? 1 : 0,
  cached: status === "cached" ? 1 : 0,
});

const aggregateStatus = (line: Pick<LedgerLine, "calls" | "succeeded" | "failed" | "cached">): ProviderUsageStatus => {
  if (line.succeeded === line.calls) return "succeeded";
  if (line.failed === line.calls) return "failed";
  if (line.cached === line.calls) return "cached";
  return "partial";
};

function mergeMeta(current: string | undefined, next: string | undefined): string | undefined {
  const clean = next?.trim();
  if (!clean || current?.includes(clean)) return current;
  return [current, clean].filter(Boolean).join(" · ").slice(0, 500);
}

// Generic: count one provider attempt (usd may be 0 for free providers - still
// recorded, the point is the full picture). Existing adapters default to a
// succeeded attempt; retrying/paid adapters pass their observed outcome.
export function recordCall(
  provider: string,
  op: string,
  usd = 0,
  meta?: string,
  status: ProviderUsageStatus = "succeeded",
): void {
  const { ledger } = currentState();
  const key = `${provider}|${op}`;
  const cur = ledger.get(key);
  if (cur) {
    cur.calls += 1;
    cur.succeeded += status === "succeeded" ? 1 : 0;
    cur.partial += status === "partial" ? 1 : 0;
    cur.failed += status === "failed" ? 1 : 0;
    cur.cached += status === "cached" ? 1 : 0;
    cur.status = aggregateStatus(cur);
    cur.usd += usd;
    cur.meta = mergeMeta(cur.meta, meta);
  } else {
    const counts = statusCounts(status);
    ledger.set(key, { provider, op, calls: 1, ...counts, status, usd, ...(meta ? { meta } : {}) });
  }
}

export function recordTwitterapi(op: string, status: ProviderUsageStatus = "succeeded", meta?: string): void {
  recordCall("twitterapi", op, PRICE.twitterapiCall, meta, status);
}

/** Grok spend so far in this audit's ledger, in USD. Lets a runaway subject be
 * stopped mid-run instead of discovered on the invoice. */
export function grokSpendUsd(): number {
  const { grok } = currentState();
  return grok.in * PRICE.grokIn + grok.out * PRICE.grokOut + grok.sources * PRICE.grokSource;
}

export function addGrokUsage(
  u: { input_tokens?: number; output_tokens?: number; num_sources_used?: number } | undefined,
  toolCalls?: number,
  op = "live-search",
  status: ProviderUsageStatus = "succeeded",
  outcomeMeta?: string,
): void {
  const { grok } = currentState();
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  // xAI bills live search PER SOURCE. It reports num_sources_used: 0 even when
  // it reports several tool calls on the same response, so trusting that zero
  // booked whole audits at $0.00 while the invoice charged dollars. Never
  // report less than the tool calls imply: a ledger that under-reports is worse
  // than no ledger, because it silently disables every budget built on it.
  const reportedSources = typeof u?.num_sources_used === "number" ? u.num_sources_used : 0;
  const impliedSources = (toolCalls ?? 0) * EST_SOURCES_PER_SEARCH;
  const sources = Math.max(reportedSources, impliedSources);
  grok.calls += 1;
  grok.in += tin;
  grok.out += tout;
  grok.sources += sources;
  recordCall(
    "grok",
    op,
    tin * PRICE.grokIn + tout * PRICE.grokOut + sources * PRICE.grokSource,
    [`${tin + tout} tok · ~${sources} sources`, outcomeMeta].filter(Boolean).join(" · "),
    status,
  );
}

export function addClaudeUsage(
  u: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  } | undefined,
  op = "analysis",
  status: ProviderUsageStatus = "succeeded",
  outcomeMeta?: string,
  model?: string,
): void {
  const { claude } = currentState();
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  // Prompt-cache tokens bill at their own rates (writes 1.25x input, reads
  // 0.1x input) and arrive in separate usage fields; folding them in at the
  // wrong rate would drift the ledger from the invoice in either direction.
  const cacheWrites = u?.cache_creation_input_tokens ?? 0;
  const cacheReads = u?.cache_read_input_tokens ?? 0;
  const webSearches = u?.server_tool_use?.web_search_requests ?? 0;
  // Haiku bills 3x cheaper on input than Sonnet; price the call by its model so
  // the ledger reflects the decoupled discovery pipeline honestly.
  const haiku = typeof model === "string" && /haiku/i.test(model);
  const inPrice = haiku ? PRICE.haikuIn : PRICE.claudeIn;
  const outPrice = haiku ? PRICE.haikuOut : PRICE.claudeOut;
  claude.calls += 1;
  claude.in += tin + cacheWrites + cacheReads;
  claude.out += tout;
  recordCall(
    "claude",
    op,
    tin * inPrice + cacheWrites * inPrice * 1.25 + cacheReads * inPrice * 0.1 + tout * outPrice + webSearches * PRICE.claudeWebSearch,
    [
      `${tin + tout} tok`,
      cacheReads || cacheWrites ? `cache r${cacheReads}/w${cacheWrites}` : "",
      haiku ? "haiku" : "",
      webSearches ? `${webSearches} web searches` : "",
      outcomeMeta,
    ].filter(Boolean).join(" · "),
    status,
  );
}

/** Book an OpenRouter (OpenAI-compatible) call. OpenRouter returns the ACTUAL
 * charged cost in usage.cost (USD) when the request sets usage.include, so book
 * that directly - the ledger matches the invoice instead of a guessed per-token
 * rate (which no per-model price table could keep current across 400+ models). */
export function addOpenRouterUsage(
  usage: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined,
  op: string,
  status: ProviderUsageStatus = "succeeded",
  model?: string,
  outcomeMeta?: string,
): void {
  const usd = typeof usage?.cost === "number" && usage.cost >= 0 ? usage.cost : 0;
  const tin = usage?.prompt_tokens ?? 0;
  const tout = usage?.completion_tokens ?? 0;
  recordCall(
    "openrouter",
    op,
    usd,
    [`${tin + tout} tok`, model, outcomeMeta].filter(Boolean).join(" · "),
    status,
  );
}

/** Book a Serper (Google SERP) query batch. Cheap, flat per-query. */
export function recordSerper(queries: number, status: ProviderUsageStatus = "succeeded", outcomeMeta?: string): void {
  recordCall("serper", "search", Math.max(0, queries) * PRICE.serperQuery, [`${queries} quer${queries === 1 ? "y" : "ies"}`, outcomeMeta].filter(Boolean).join(" · "), status);
}

export function recordPdlMatch(
  matched: boolean,
  status: ProviderUsageStatus = "succeeded",
  meta?: string,
): void {
  recordCall(
    "peopledatalabs",
    "person/enrich",
    matched && status !== "failed" ? PRICE.pdlMatch : 0,
    meta ?? (status === "succeeded" ? (matched ? "per-match est" : "no match (free)") : undefined),
    status,
  );
}

export function recordHelius(op: string, status: ProviderUsageStatus = "succeeded", meta?: string): void {
  recordCall("helius", op, PRICE.heliusCall, meta, status);
}

export interface AuditCost {
  /** Collector-owned schema marker; distinguishes an observed empty ledger from a missing client field. */
  schemaVersion: 1;
  usd: number;
  grokUsd: number;
  claudeUsd: number;
  grokCalls: number;
  claudeCalls: number;
  sources: number;
  estimated: boolean;
  // the A-to-Z breakdown: every provider call this audit made, priciest first
  calls: LedgerLine[];
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function getCost(): AuditCost {
  const { ledger, grok, claude } = currentState();
  const lines = [...ledger.values()]
    .map((l) => ({ ...l, usd: round4(l.usd) }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
    schemaVersion: 1,
    usd: round2(total),
    grokUsd: round2(grokUsd),
    claudeUsd: round2(claudeUsd),
    grokCalls: grok.calls,
    claudeCalls: claude.calls,
    sources: grok.sources,
    estimated: true,
    calls: lines,
  };
}
