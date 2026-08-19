// Grounded search: the ultimate decoupled discovery path. Instead of paying a
// frontier model (Sonnet) to run web searches AND read whole pages into its
// context (the dominant audit cost), split the job across the right-cost tool
// for each step:
//   1. a cheap model turns the task into Google queries,
//   2. Serper returns ranked results (title/url/snippet) at ~$1/1000,
//   3. publicWeb fetches the top pages,
//   4. a cheap model (Haiku by default) extracts the structured JSON answer.
// Same string|null contract as grokSearch/claudeWebSearch, so callers are
// unchanged; returns null when unavailable or empty. Callers decide whether
// policy permits another provider.
import { env, providerFallbacksEnabled } from "../config";
import { addClaudeUsage, addGrokUsage, addOpenRouterUsage, recordSerper } from "../cost";
import { cacheGet, cacheSet } from "../cache";
import { fetchPublicText } from "../publicWeb";

const ANTHROPIC = "https://api.anthropic.com/v1/messages";
const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const SERPER = "https://google.serper.dev/search";
const XAI_CHAT = "https://api.x.ai/v1/chat/completions";
const GROK_EXTRACT_MODEL = () => env("ARGUS_GROK_MODEL") || "grok-4-fast";
const CLAUDE_EXTRACT_MODEL = () => env("ARGUS_EXTRACT_MODEL") || "claude-haiku-4-5";

// Route the cheap extractor through OpenRouter (any OpenAI-compatible model)
// only when an OpenRouter key is present AND the configured extract model is an
// OpenRouter slug (provider/model form, e.g. "google/gemini-2.5-flash-lite"). A
// bare Anthropic id like "claude-haiku-4-5" keeps the native Anthropic path, so
// this stays dormant until deliberately configured - same pattern as Serper.
function openRouterExtractModel(): string | null {
  if (!providerFallbacksEnabled()) return null;
  const model = env("ARGUS_EXTRACT_MODEL");
  return env("OPENROUTER_API_KEY") && model && model.includes("/") ? model : null;
}

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
interface SerperSearchOutcome {
  results: SerperResult[];
  status: "succeeded" | "failed";
  detail?: string;
}

// Google's practical q ceiling. Oversized bodies 400 as invalid_request.
const MAX_SERPER_QUERY_CHARS = 2048;

/**
 * Turn a candidate Serper `q` into a Google-legal query, or null to skip.
 * Twitter-style q that still has useful terms (quoted phrase, founder/CEO/team
 * words) is rewritten to ordinary Google syntax — quoted phrases stay, @handle
 * becomes "@handle" next to residual words. Handle-only / operator-only q is
 * skipped so we do not spend a credit on site:x.com/@handle junk. Never log `q`.
 */
export function sanitizeSerperQuery(q: string): string | null {
  const original = q.trim();
  if (!original) return null;
  if (original.length > MAX_SERPER_QUERY_CHARS) return null;
  if ((original.match(/"/g)?.length ?? 0) % 2 === 1) return null;

  const unquoted = original.replace(/"[^"]*"/g, " ");
  const twitterStyle = /\b(?:from|filter|min_faves|min_retweets|min_replies):/i.test(original)
    || /\bsite:(?:www\.)?(?:twitter|x)\.com\b/i.test(original)
    || /@[A-Za-z0-9_]+/.test(unquoted)
    || /^"@[A-Za-z0-9_]{1,30}"$/.test(original);
  if (!twitterStyle) {
    if (/^@/.test(original) && !original.startsWith('"')) return null;
    if (/^(?:OR|AND)\b|\b(?:OR|AND)$/i.test(original)) return null;
    if (/(?:^|\s)(?:site|filetype):\s*(?:$|[)"']|\b(?:OR|AND)\b)/i.test(original)) return null;
    const residual = original
      .replace(/\b(?:site|filetype|intitle|inurl|intext|ext):[^\s]*/gi, " ")
      .replace(/\b(?:OR|AND|NOT)\b/gi, " ")
      .replace(/[()"+-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!residual && !/\b(?:site|filetype):[^\s]+/i.test(original)) return null;
    return original;
  }

  const quoted: string[] = [];
  let rest = original.replace(/"([^"]*)"/g, (_, phrase: string) => {
    const inner = phrase.trim();
    if (inner) quoted.push(`"${inner}"`);
    return " ";
  });

  const handles: string[] = [];
  const addHandle = (raw: string) => {
    const handle = raw.replace(/^@/, "");
    if (!handle) return;
    if (!handles.some((existing) => existing.toLowerCase() === handle.toLowerCase())) handles.push(handle);
  };

  rest = rest.replace(/\bfrom:@?([A-Za-z0-9_]{1,30})\b/gi, (_, handle: string) => {
    addHandle(handle);
    return " ";
  });
  rest = rest.replace(/\bsite:(?:www\.)?(?:twitter|x)\.com\/@?([A-Za-z0-9_]{1,30})(?:\/\S*)?/gi, (_, handle: string) => {
    addHandle(handle);
    return " ";
  });
  rest = rest.replace(/\bsite:(?:www\.)?(?:twitter|x)\.com\b/gi, " ");
  rest = rest.replace(/\b(?:filter|min_faves|min_retweets|min_replies):[^\s]*/gi, " ");
  rest = rest.replace(/(^|[^\w])@([A-Za-z0-9_]{1,30})/g, (_match, pre: string, handle: string) => {
    addHandle(handle);
    return `${pre} `;
  });
  rest = rest.replace(/\b(?:www\.)?(?:twitter|x)\.com\b/gi, " ");
  rest = rest.replace(/[()]/g, " ").replace(/\s+/g, " ").trim();

  const usefulQuoted = quoted.filter((phrase) => !/^"@[A-Za-z0-9_]{1,30}"$/.test(phrase));
  for (const phrase of quoted) {
    const only = phrase.match(/^"@([A-Za-z0-9_]{1,30})"$/);
    if (only) addHandle(only[1]);
  }

  const parts = [...usefulQuoted];
  if (rest) {
    parts.push(rest);
    for (const handle of handles) {
      const already = usefulQuoted.some((phrase) => phrase.toLowerCase().includes(`@${handle.toLowerCase()}`));
      if (!already) parts.push(`"@${handle}"`);
    }
  }
  const s = parts.join(" ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (/^@/.test(s) && !s.startsWith('"')) return null;
  if (/^(?:OR|AND)\b|\b(?:OR|AND)$/i.test(s)) return null;
  if (/(?:^|\s)(?:site|filetype):\s*(?:$|[)"']|\b(?:OR|AND)\b)/i.test(s)) return null;

  const residual = s
    .replace(/\b(?:site|filetype|intitle|inurl|intext|ext):[^\s]*/gi, " ")
    .replace(/\b(?:OR|AND|NOT)\b/gi, " ")
    .replace(/[()"+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!residual && !/\b(?:site|filetype):[^\s]+/i.test(s)) return null;
  return s;
}

function sanitizeQueryList(queries: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const chars = q.trim().length;
    const s = sanitizeSerperQuery(q);
    if (!s) {
      if (chars) console.warn("[serper-search] skipped invalid query", { queryChars: chars });
      continue;
    }
    const key = s.toLowerCase().replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/** Last-resort queries from the user string itself. No invented role phrases. */
function fallbackQueriesFromUser(user: string): string[] {
  const candidates: string[] = [];
  for (const m of user.matchAll(/"([^"]{2,80})"/g)) candidates.push(`"${m[1]}"`);
  // Bare @handle is not a Google q. Quoted phrases and real domains still run.
  for (const m of user.matchAll(/\b((?:[a-z0-9-]+\.)+[a-z]{2,24})\b/gi)) {
    const host = m[1].replace(/^www\./i, "").toLowerCase();
    if (/^(?:x\.com|twitter\.com|t\.co|github\.com|linkedin\.com|youtube\.com|youtu\.be|google\.com|facebook\.com|instagram\.com)$/i.test(host)) continue;
    candidates.push(`site:${host}`);
  }
  return sanitizeQueryList(candidates);
}


function isSerperProviderOutage(detail?: string): boolean {
  if (!detail) return true;
  if (detail.includes("invalid_request")) return false;
  return true;
}

function safeSerperFailure(status: number, raw: string): string {
  let message = "";
  try {
    const parsed = asRec(JSON.parse(raw.slice(0, 2_000)));
    message = [parsed.message, parsed.error].find((value): value is string => typeof value === "string") ?? "";
  } catch {
    message = raw.slice(0, 500);
  }
  const normalized = message.toLowerCase();
  const reason = /unauthor|api[ _-]?key|credential/.test(normalized)
    ? "unauthorized"
    : /credit|quota|rate limit|usage limit/.test(normalized)
      ? "credits_or_quota"
      : /query|parameter|request body|invalid request/.test(normalized)
        ? "invalid_request"
        : "rejected";
  return `http_${status}:${reason}`;
}

function asRec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

async function serperSearch(query: string, key: string): Promise<SerperSearchOutcome> {
  try {
    const res = await fetch(SERPER, {
      method: "POST",
      headers: { "X-API-KEY": key, "content-type": "application/json" },
      body: JSON.stringify({ q: query, num: 10 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = safeSerperFailure(res.status, await res.text().catch(() => ""));
      // Keep the provider's rejection observable without logging the search
      // query, response body, or credential. The stable reason is sufficient
      // to distinguish a retryable outage from configuration attention.
      console.warn("[serper-search] request rejected", { status: res.status, reason: detail.split(":")[1], queryChars: query.length });
      return { results: [], status: "failed", detail };
    }
    const d = asRec(await res.json());
    const organic = Array.isArray(d.organic) ? d.organic.map(asRec) : [];
    return {
      status: "succeeded",
      results: organic
        .map((o) => ({
          title: typeof o.title === "string" ? o.title : "",
          url: typeof o.link === "string" ? o.link : "",
          snippet: typeof o.snippet === "string" ? o.snippet : "",
        }))
        .filter((r) => /^https?:\/\//.test(r.url)),
    };
  } catch (error) {
    const detail = error instanceof Error && error.name === "TimeoutError"
      ? "timeout_15000ms"
      : "transport_or_parse_error";
    return { results: [], status: "failed", detail };
  }
}

// One plain xAI chat-completions call. Default cheap extractor: Grok is
// fast and already metered on the same key as the rest of ARGUS.
async function callGrokExtract(system: string, user: string, maxTokens: number, op: string): Promise<string | null> {
  const key = env("XAI_API_KEY");
  if (!key) return null;
  const model = GROK_EXTRACT_MODEL();
  let res: Response;
  try {
    res = await fetch(XAI_CHAT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    addGrokUsage(undefined, 0, op, "failed", error instanceof Error && error.name === "TimeoutError" ? "timeout_60000ms" : "transport_error");
    return null;
  }
  if (!res.ok) {
    addGrokUsage(undefined, 0, op, "failed", `http_${res.status}`);
    return null;
  }
  const d = asRec(await res.json().catch(() => ({})));
  const usage = asRec(d.usage);
  const choices = Array.isArray(d.choices) ? d.choices.map(asRec) : [];
  const message = choices.length ? asRec(choices[0].message) : {};
  const text = typeof message.content === "string"
    ? message.content
    : message.content && typeof message.content === "object"
      ? JSON.stringify(message.content)
      : "";
  addGrokUsage(
    {
      input_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      output_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
    },
    0,
    op,
    text ? "succeeded" : "partial",
    text ? undefined : "empty_output",
  );
  return text || null;
}

// One plain OpenAI-compatible call through OpenRouter. ZDR is enforced
// (data_collection: deny) because due-diligence prompts carry real-people PII,
// and usage.include asks OpenRouter to return the actual charged cost so the
// ledger matches the invoice rather than a guessed per-token rate.
async function callOpenRouter(system: string, user: string, maxTokens: number, op: string, model: string): Promise<string | null> {
  const key = env("OPENROUTER_API_KEY");
  if (!key) return null;
  let res: Response;
  try {
    res = await fetch(OPENROUTER, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "X-Title": "ARGUS due-diligence" },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        provider: { data_collection: "deny" },
        usage: { include: true },
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    addOpenRouterUsage(undefined, op, "failed", model, error instanceof Error && error.name === "TimeoutError" ? "timeout_60000ms" : "transport_error");
    return null;
  }
  if (!res.ok) {
    addOpenRouterUsage(undefined, op, "failed", model, `http_${res.status}`);
    return null;
  }
  const d = asRec(await res.json().catch(() => ({})));
  const usage = asRec(d.usage);
  const choices = Array.isArray(d.choices) ? d.choices.map(asRec) : [];
  const message = choices.length ? asRec(choices[0].message) : {};
  const text = typeof message.content === "string" ? message.content : "";
  addOpenRouterUsage(
    {
      prompt_tokens: typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : 0,
      completion_tokens: typeof usage.completion_tokens === "number" ? usage.completion_tokens : 0,
      ...(typeof usage.cost === "number" ? { cost: usage.cost } : {}),
    },
    op,
    text ? "succeeded" : "partial",
    model,
    text ? undefined : "empty_output",
  );
  return text || null;
}

// Cheap extractor. Grok is primary. OpenRouter / Anthropic run only when
// ARGUS_PROVIDER_FALLBACKS is on (and Grok is unset or already failed).
async function callExtractModel(system: string, user: string, maxTokens: number, op: string): Promise<string | null> {
  if (env("XAI_API_KEY")) {
    const grok = await callGrokExtract(system, user, maxTokens, op);
    if (grok || !providerFallbacksEnabled()) return grok;
  }
  const orModel = openRouterExtractModel();
  if (orModel) {
    const routed = await callOpenRouter(system, user, maxTokens, op, orModel);
    if (routed || !env("ANTHROPIC_API_KEY")) return routed;
  } else if (!providerFallbacksEnabled()) {
    return null;
  }
  const key = env("ANTHROPIC_API_KEY");
  if (!key) return null;
  const model = CLAUDE_EXTRACT_MODEL();
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
    "You turn a research task into effective Google search queries. Output ONLY a JSON array of query strings. Use ordinary Google syntax: quoted phrases, site:example.com, names. Never emit a query that starts with @handle, Twitter-only operators (from:, filter:, min_faves), or site:twitter.com/@handle.",
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

/** True when grounded search can actually run (Serper + some extractor). */
export function groundedSearchProvisioned(): boolean {
  return Boolean(env("SERPER_API_KEY") && (env("XAI_API_KEY") || openRouterExtractModel() || (providerFallbacksEnabled() && env("ANTHROPIC_API_KEY"))));
}

export async function groundedSearch(
  system: string,
  user: string,
  opts?: {
    cacheKey?: string;
    bypassCache?: boolean;
    queries?: readonly string[];
    /** Called only when every physical search attempt failed, never for a valid empty result. */
    onProviderUnavailable?: () => void;
  },
): Promise<string | null> {
  const serperKey = env("SERPER_API_KEY");
  // Needs Serper plus an extractor. Grok is the default; OpenRouter / Anthropic
  // are fallback-only.
  if (!serperKey || (!env("XAI_API_KEY") && !openRouterExtractModel() && !(providerFallbacksEnabled() && env("ANTHROPIC_API_KEY")))) return null;
  const cacheKey = opts?.cacheKey ? `gs:${opts.cacheKey}` : undefined;
  if (cacheKey && !opts?.bypassCache) {
    const hit = await cacheGet(cacheKey);
    if (hit) return hit;
  }

  // High-value collectors can supply exact deterministic queries. This avoids
  // asking a model to rediscover obvious search syntax such as an official
  // company's own funding announcements, while retaining the same Serper,
  // source-fetch, and grounded extraction boundaries.
  // Caller-supplied queries win. If the model invents nothing, still search
  // obvious subject tokens from the user string — never a hardcoded role phrase.
  let raw: readonly string[];
  if (opts?.queries) {
    raw = opts.queries;
  } else {
    const generated = await generateQueries(system, user);
    raw = generated.length ? generated : fallbackQueriesFromUser(user);
  }
  const queries = sanitizeQueryList(raw).slice(0, 5);
  if (!queries.length) return null;

  const searched = await Promise.all(queries.map((q) => serperSearch(q, serperKey)));
  const succeeded = searched.filter((outcome) => outcome.status === "succeeded");
  const failed = searched.filter((outcome) => outcome.status === "failed");
  if (succeeded.length) {
    recordSerper(
      succeeded.length,
      "succeeded",
      succeeded.every((outcome) => outcome.results.length === 0) ? "no_results" : undefined,
    );
  }
  if (failed.length) {
    recordSerper(
      failed.length,
      "failed",
      [...new Set(failed.flatMap((outcome) => outcome.detail ? [outcome.detail] : []))].join(","),
    );
  }
  // invalid_request is a bad q, not a missing key or empty wallet.
  if (failed.some((outcome) => isSerperProviderOutage(outcome.detail)) && succeeded.length === 0) {
    opts?.onProviderUnavailable?.();
  }
  const results = dedupeByUrl(searched.flatMap((outcome) => outcome.results)).slice(0, MAX_RESULTS);
  if (!results.length) return null;

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
  // Searches that SUCCEEDED and then lost the extract model are not an empty
  // result: the lane collected sources and could not read them. Reporting the
  // same bare null as a genuine empty left the caller unable to recover, and
  // an extract outage silently reproduced the mechanically empty people
  // report this lane exists to prevent.
  if (answer === null) opts?.onProviderUnavailable?.();
  if (answer && cacheKey && !opts?.bypassCache) void cacheSet(cacheKey, answer);
  return answer;
}
