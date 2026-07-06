// Per-audit provider ledger: EVERY external call an audit makes — paid or free —
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
// One module-level ledger is safe: a serverless instance handles one audit at a
// time and runAudit resets it at the top of every run.

const PRICE = {
  grokIn: 0.2 / 1e6,
  grokOut: 0.5 / 1e6,
  grokSource: 25 / 1000,
  claudeIn: 3 / 1e6,
  claudeOut: 15 / 1e6,
  twitterapiCall: 0.0002,
  pdlMatch: 0.1,
  heliusCall: 0.0001,
};
const EST_SOURCES_PER_SEARCH = 5;

export interface LedgerLine {
  provider: string;
  op: string;
  calls: number;
  usd: number;
  meta?: string;
}

let ledger = new Map<string, LedgerLine>();
let grok = { in: 0, out: 0, calls: 0, sources: 0 };
let claude = { in: 0, out: 0, calls: 0 };

export function resetCost(): void {
  ledger = new Map();
  grok = { in: 0, out: 0, calls: 0, sources: 0 };
  claude = { in: 0, out: 0, calls: 0 };
}

// Generic: count a provider call (usd may be 0 for free providers — still
// recorded, the point is the full picture).
export function recordCall(provider: string, op: string, usd = 0, meta?: string): void {
  const key = `${provider}|${op}`;
  const cur = ledger.get(key);
  if (cur) {
    cur.calls += 1;
    cur.usd += usd;
    if (meta) cur.meta = meta;
  } else {
    ledger.set(key, { provider, op, calls: 1, usd, meta });
  }
}

export function recordTwitterapi(op: string): void {
  recordCall("twitterapi", op, PRICE.twitterapiCall);
}

export function addGrokUsage(u: { input_tokens?: number; output_tokens?: number; num_sources_used?: number } | undefined, toolCalls?: number, op = "live-search"): void {
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  const sources = typeof u?.num_sources_used === "number" ? u.num_sources_used : (toolCalls ?? 0) * EST_SOURCES_PER_SEARCH;
  grok.calls += 1;
  grok.in += tin;
  grok.out += tout;
  grok.sources += sources;
  recordCall("grok", op, tin * PRICE.grokIn + tout * PRICE.grokOut + sources * PRICE.grokSource, `${tin + tout} tok · ~${sources} sources`);
}

export function addClaudeUsage(u: { input_tokens?: number; output_tokens?: number } | undefined, op = "analysis"): void {
  const tin = u?.input_tokens ?? 0;
  const tout = u?.output_tokens ?? 0;
  claude.calls += 1;
  claude.in += tin;
  claude.out += tout;
  recordCall("claude", op, tin * PRICE.claudeIn + tout * PRICE.claudeOut, `${tin + tout} tok`);
}

export function recordPdlMatch(matched: boolean): void {
  recordCall("peopledatalabs", "person/enrich", matched ? PRICE.pdlMatch : 0, matched ? "per-match est" : "no match (free)");
}

export function recordHelius(op: string): void {
  recordCall("helius", op, PRICE.heliusCall);
}

export interface AuditCost {
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
  const lines = [...ledger.values()]
    .map((l) => ({ ...l, usd: round4(l.usd) }))
    .sort((a, b) => b.usd - a.usd || b.calls - a.calls);
  const grokUsd = lines.filter((l) => l.provider === "grok").reduce((a, l) => a + l.usd, 0);
  const claudeUsd = lines.filter((l) => l.provider === "claude").reduce((a, l) => a + l.usd, 0);
  const total = lines.reduce((a, l) => a + l.usd, 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;
  return {
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
