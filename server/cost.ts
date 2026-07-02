// Per-audit provider spend, accumulated across one collector run and attached
// to the dossier (so the report library can show what each audit actually
// cost). Estimates from public list prices; sources are xAI's live-search
// billing unit (~$25/1K) — when the API doesn't report a source count we
// estimate ~5 per search invocation.
//
// One module-level accumulator is safe here: a serverless instance handles one
// audit request at a time, and runAudit resets it at the top of every run.

const PRICE = {
  grokIn: 0.2 / 1e6,   // grok-4-fast $/token in
  grokOut: 0.5 / 1e6,  // grok-4-fast $/token out
  grokSource: 25 / 1000, // live search $/source
  claudeIn: 3 / 1e6,   // sonnet-class $/token in
  claudeOut: 15 / 1e6, // sonnet-class $/token out
};
const EST_SOURCES_PER_SEARCH = 5;

interface Acc {
  grokIn: number; grokOut: number; grokCalls: number; sources: number; sourcesEstimated: boolean;
  claudeIn: number; claudeOut: number; claudeCalls: number;
}
const fresh = (): Acc => ({ grokIn: 0, grokOut: 0, grokCalls: 0, sources: 0, sourcesEstimated: false, claudeIn: 0, claudeOut: 0, claudeCalls: 0 });
let acc = fresh();

export function resetCost(): void {
  acc = fresh();
}

export function addGrokUsage(u: { input_tokens?: number; output_tokens?: number; num_sources_used?: number } | undefined, toolCalls?: number): void {
  acc.grokCalls += 1;
  acc.grokIn += u?.input_tokens ?? 0;
  acc.grokOut += u?.output_tokens ?? 0;
  if (typeof u?.num_sources_used === "number") {
    acc.sources += u.num_sources_used;
  } else if (toolCalls && toolCalls > 0) {
    acc.sources += toolCalls * EST_SOURCES_PER_SEARCH;
    acc.sourcesEstimated = true;
  }
}

export function addClaudeUsage(u: { input_tokens?: number; output_tokens?: number } | undefined): void {
  acc.claudeCalls += 1;
  acc.claudeIn += u?.input_tokens ?? 0;
  acc.claudeOut += u?.output_tokens ?? 0;
}

export interface AuditCost {
  usd: number;         // total, rounded to cents
  grokUsd: number;
  claudeUsd: number;
  grokCalls: number;
  claudeCalls: number;
  sources: number;     // live-search sources billed (or estimated)
  estimated: boolean;  // true when any component is an estimate (it always is, a little)
}

export function getCost(): AuditCost {
  const grokUsd = acc.grokIn * PRICE.grokIn + acc.grokOut * PRICE.grokOut + acc.sources * PRICE.grokSource;
  const claudeUsd = acc.claudeIn * PRICE.claudeIn + acc.claudeOut * PRICE.claudeOut;
  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    usd: round(grokUsd + claudeUsd),
    grokUsd: round(grokUsd),
    claudeUsd: round(claudeUsd),
    grokCalls: acc.grokCalls,
    claudeCalls: acc.claudeCalls,
    sources: acc.sources,
    estimated: true,
  };
}
