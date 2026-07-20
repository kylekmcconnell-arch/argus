// Grounded search: the ultimate decoupled discovery path. Instead of paying a
// frontier model (Sonnet) to run web searches AND read whole pages into its
// context (the dominant audit cost), split the job across the right-cost tool
// for each step:
//   1. a cheap model turns the task into Google queries,
//   2. Serper returns ranked results (title/url/snippet) at ~$1/1000,
//   3. publicWeb fetches the top pages,
//   4. a cheap model (Haiku by default) extracts the structured JSON answer.
// Same string|null contract as grokSearch/claudeWebSearch, so callers are
// unchanged; returns null when unavailable or empty so a dispatcher can fall
// back to the adaptive Claude web_search, then Grok.
import { env } from "../config";
import { addClaudeUsage, recordSerper } from "../cost";
import { cacheGet, cacheSet } from "../cache";
import { fetchPublicText } from "../publicWeb";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const SERPER = "https://google.serper.dev/search";
const EXTRACT_MODEL = () => env("ARGUS_EXTRACT_MODEL") || "claude-haiku-4-5";

const MAX_RESULTS = 12;
// Page fetches dominate grounded latency. A high-connectivity subject fans out
// to many generalWebSearch calls, so each must stay fast or collection blows the
// time budget and the analyst never runs (observed: @Uniswap timed out at 525s).
// Snippets already carry most facts; a few full pages are the ceiling, each on a
// hard timeout so one slow origin can't stall the whole call.
const MAX_PAGES = 4;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_PAGE_CHARS = 4_000;

interface SerperResult { title: string; url: string; snippet: string }

function asRec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

async function serperSearch(query: string, key: string): Promise<SerperResult[]> {
  try {
    const res = await fetch(SERPER, {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({ q: query, num: 8 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const d = asRec(await res.json());
    const organic = Array.isArray(d.organic) ? d.organic.map(asRec) : [];
    return organic
      .map((o) => ({
        title: typeof o.title === "string" ? o.title : "",
        url: typeof o.link === "string" ? o.link : "",
        snippet: typeof o.snippet === "string" ? o.snippet : "",
      }))
      .filter((r) => /^https?:\/\//.test(r.url));
  } catch {
    return [];
  }
}

// One plain Claude call (no server tools) on the cheap extraction model. Used
// for query generation and for the final structured extraction.
async function callExtractModel(system: string, user: string, maxTokens: number, op: string): Promise<string | null> {
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const model = EXTRACT_MODEL();
  let res: Response;
  try {
    res = await fetch(ANTHROPIC, {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    addClaudeUsage(undefined, op, "failed", error instanceof Error && error.name === "TimeoutError" ? "timeout_60000ms" : "transport_error", model);
    return null;
  }
  if (!res.ok) {
    addClaudeUsage(undefined, op, "failed", `http_${res.status}`, model);
    return null;
  }
  const d = asRec(await res.json().catch(() => ({})));
  const usage = asRec(d.usage);
  const text = (Array.isArray(d.content) ? d.content.map(asRec) : [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n");
  addClaudeUsage(
    { input_tokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0, output_tokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0 },
    op,
    text ? "succeeded" : "partial",
    text ? undefined : "empty_output",
    model,
  );
  return text || null;
}

async function generateQueries(system: string, user: string): Promise<string[]> {
  const text = await callExtractModel(
    "You turn a research task into effective Google search queries. Output ONLY a JSON array of query strings.",
    `A due-diligence collector needs to answer this task with web evidence.\n\nTASK SYSTEM: ${system}\n\nTASK REQUEST: ${user}\n\nOutput 3 to 5 precise Google search queries that will surface the exact pages needed (names, companies, filings, press). Return ONLY a compact JSON array, e.g. ["query one","query two"].`,
    400,
    "grounded-queries",
  );
  if (!text) return [];
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr: unknown = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function dedupeByUrl(results: SerperResult[]): SerperResult[] {
  const seen = new Set<string>();
  const out: SerperResult[] = [];
  for (const r of results) {
    const k = r.url.replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export async function groundedSearch(system: string, user: string, opts?: { cacheKey?: string; bypassCache?: boolean }): Promise<string | null> {
  const serperKey = env("SERPER_API_KEY");
  if (!serperKey || !env("ANTHROPIC_API_KEY")) return null; // not provisioned -> caller falls back
  const cacheKey = opts?.cacheKey ? `gs:${opts.cacheKey}` : undefined;
  if (cacheKey && !opts?.bypassCache) {
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;
  }

  const queries = await generateQueries(system, user);
  if (!queries.length) return null;

  const searched = await Promise.all(queries.map((q) => serperSearch(q, serperKey)));
  recordSerper(queries.length);
  const results = dedupeByUrl(searched.flat()).slice(0, MAX_RESULTS);
  if (!results.length) return null; // Serper found nothing -> fall back to adaptive search

  const fetchWithTimeout = async (url: string): Promise<{ url: string; text: string } | null> => {
    try {
      const doc = await Promise.race([
        fetchPublicText(url),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), FETCH_TIMEOUT_MS)),
      ]);
      return doc && doc.status === "ok" ? { url, text: doc.text.slice(0, MAX_PAGE_CHARS) } : null;
    } catch {
      return null;
    }
  };
  const fetched = await Promise.all(results.slice(0, MAX_PAGES).map((r) => fetchWithTimeout(r.url)));

  const resultsBlock = results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join("\n\n");
  const pagesBlock = fetched.filter((p): p is { url: string; text: string } => Boolean(p))
    .map((p) => `SOURCE ${p.url}\n${p.text}`).join("\n\n---\n\n");
  const context = `=== SEARCH RESULTS ===\n${resultsBlock}\n\n=== FETCHED PAGE EXCERPTS ===\n${pagesBlock || "(none fetched successfully)"}`;

  const wrapSystem =
    "You are given Google search results and fetched page excerpts for a due-diligence research task. " +
    "Answer ONLY from what these sources actually support; cite their exact URLs as the source of each item; omit anything the sources do not back. Do not use prior knowledge as evidence. " +
    "Follow the task's output contract exactly.\n\n" +
    "TASK INSTRUCTIONS:\n" + system;
  const answer = await callExtractModel(wrapSystem, `${user}\n\n${context}`, 3_000, "grounded-extract");
  if (answer && cacheKey && !opts?.bypassCache) void cacheSet(cacheKey, answer);
  return answer;
}
