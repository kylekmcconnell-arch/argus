import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type {
  BasicFact,
  BasicFactLead,
  BasicFactPredicate,
} from "../../src/data/evidence";
import { ANALYST_MODEL, env } from "../config";
import { cacheGet, cacheSet } from "../cache";
import { addClaudeUsage, recordCall } from "../cost";
import { fetchPublicText, type PublicTextDocument, type PublicTextResult } from "../publicWeb";
import { grokSearch } from "./x";
import type { Adapter, AdapterRunResult, CollectContext } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MAX_SEARCH_USES = 4;
const MAX_LEADS = 16;
const MAX_SOURCES = 24;
const DISCOVERY_TIMEOUT_MS = 50_000;
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

const PREDICATES = new Set<BasicFactPredicate>([
  "founder",
  "executive",
  "founded",
  "launched",
  "official_token",
  "funding",
  "investor",
  "product",
  "network",
  "legal_entity",
  "official_identity",
  "governance",
  "audit",
  "repository",
  "traction",
]);

const CRITICAL_PREDICATES = new Set<BasicFactPredicate>([
  "official_identity", "product", "founder", "executive", "official_token",
]);

type DiscoveryProvider = BasicFactLead["provider"];
type RequestFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
type ClaudeContentBlock = {
  type?: string;
  text?: string;
  [key: string]: unknown;
};
type ClaudeResponse = {
  content?: ClaudeContentBlock[];
  stop_reason?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    server_tool_use?: { web_search_requests?: number };
  };
};

export interface BasicFactsDiscoveryDependencies {
  request?: RequestFn;
  cacheRead?: (key: string) => Promise<string | null>;
  cacheWrite?: (key: string, value: string) => Promise<void>;
}

export interface BasicFactsCollectorDependencies {
  discover?: (ctx: CollectContext) => Promise<BasicFactLead[] | null>;
  fetchSource?: (url: string) => Promise<PublicTextResult>;
}

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const normalize = (value: string): string => value
  .normalize("NFKC")
  .replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201C\u201D]/g, '"')
  .replace(/\s+/g, " ")
  .trim();

const searchable = (value: string): string => normalize(value)
  .toLowerCase()
  .replace(/[^a-z0-9@$.'-]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const looseTokens = (value: string): string[] => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .match(/[\p{L}\p{N}]+/gu) ?? [];

const looseContainsPhrase = (text: string, phrase: string): boolean => {
  const haystack = ` ${looseTokens(text).join(" ")} `;
  const needle = looseTokens(phrase).join(" ");
  return !!needle && haystack.includes(` ${needle} `);
};

function safeCandidateUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || url.username
      || url.password
      || !host
      || isIP(host)
      || host === "localhost"
      || host.endsWith(".localhost")
      || host.endsWith(".local")
      || host.endsWith(".internal")
      || [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key))
    ) return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function parsePayload(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? text.match(/\{[\s\S]*\}/)?.[0];
  if (!candidate) return null;
  try {
    const parsed = JSON.parse(candidate) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isAtomicValue(predicate: BasicFactPredicate, value: string): boolean {
  if (/[;\n]|\s(?:and|&)\s/i.test(value)) return false;
  // Commas almost always indicate a model-combined roster for people/backers.
  if (["founder", "executive", "investor"].includes(predicate) && value.includes(",")) return false;
  return true;
}

/** Parse discovery JSON. Every row remains explicitly non-governing. */
export function parseBasicFactLeads(
  text: string,
  expectedSubject?: string,
  provider: DiscoveryProvider = "claude-web-search",
): BasicFactLead[] | null {
  const payload = parsePayload(text);
  if (!payload || !Array.isArray(payload.facts)) return null;
  const leads: BasicFactLead[] = [];
  const seen = new Set<string>();
  for (const raw of payload.facts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const predicate = clean(row.predicate, 40) as BasicFactPredicate | undefined;
    const subject = clean(expectedSubject ?? row.subject, 160);
    const value = clean(row.value, 240);
    const excerpt = clean(row.exact_excerpt ?? row.excerpt, 1_200);
    const sourceUrl = safeCandidateUrl(row.source_url ?? row.sourceUrl);
    if (!predicate || !PREDICATES.has(predicate) || !subject || !value || !excerpt || !sourceUrl) continue;
    if (!isAtomicValue(predicate, value)) continue;
    const qualifier = clean(row.qualifier, 120);
    const sourceTitle = clean(row.source_title ?? row.sourceTitle, 240);
    const rawCandidateUrls = row.candidate_urls ?? row.candidateUrls;
    const candidateUrls: string[] = Array.isArray(rawCandidateUrls)
      ? [...new Set(rawCandidateUrls
        .flatMap((candidate): string[] => {
          const safe = safeCandidateUrl(candidate);
          return safe && safe !== sourceUrl ? [safe] : [];
        }))].slice(0, 4)
      : [];
    const key = `${predicate}::${searchable(value)}::${sourceUrl}::${searchable(excerpt)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      subject,
      predicate,
      value,
      ...(qualifier ? { qualifier } : {}),
      excerpt,
      sourceUrl,
      ...(sourceTitle ? { sourceTitle } : {}),
      ...(candidateUrls.length ? { candidateUrls } : {}),
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider,
    });
    if (leads.length >= MAX_LEADS) break;
  }
  return leads;
}

function subjectName(ctx: CollectContext): string {
  return ctx.evidence.profile.resolved_name?.trim()
    || ctx.evidence.profile.display_name.trim()
    || ctx.handle.replace(/^@/, "");
}

function subjectAliases(ctx: CollectContext): string[] {
  const aliases = [
    subjectName(ctx),
    ctx.evidence.profile.display_name,
    ctx.evidence.profile.resolved_name,
    ctx.handle,
    ctx.handle.replace(/^@/, ""),
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(aliases.map((value) => value.trim()))];
}

function discoveryPrompt(ctx: CollectContext): string {
  const profile = ctx.evidence.profile;
  return [
    `Research foundational due-diligence facts for ${subjectName(ctx)} (${ctx.handle}).`,
    profile.website ? `Known official website: ${profile.website}` : "",
    profile.bio ? `Profile bio: ${profile.bio.slice(0, 800)}` : "",
    "Find facts a competent analyst must not miss: official identity, every named founder and executive, founding and launch dates, official token, funding and named investors, core products, network/chain, legal entity, governance, security audits, source repositories, and concrete traction metrics.",
    "Prefer official first-party pages and primary documents, then reputable independent reporting.",
    "Return one atomic value per row. Never combine multiple founders, people, investors, tokens, networks, or products in one value.",
    "Each exact_excerpt must be a verbatim one-to-three sentence passage that itself explicitly contains the subject identity, the claimed value, and language proving the predicate.",
    "For candidate_urls, include up to three additional public pages that explicitly state the same atomic fact. Prefer the project's official site, docs, governance forum, or primary documents, then independent reporting. Do not repeat source_url.",
    "Do not infer. A search answer is only a lead; ARGUS will fetch and verify every URL independently.",
    "Return JSON only in this exact shape:",
    '{"facts":[{"subject":"...","predicate":"founder|executive|founded|launched|official_token|funding|investor|product|network|legal_entity|official_identity|governance|audit|repository|traction","value":"one atomic value","qualifier":"optional exact role or metric label","exact_excerpt":"verbatim source passage","source_url":"https://...","source_title":"...","candidate_urls":["https://..."]}]}',
  ].filter(Boolean).join("\n");
}

function responseText(response: ClaudeResponse): string {
  return (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function claudeRequestBody(prompt: string, assistantContent?: ClaudeContentBlock[]): Record<string, unknown> {
  return {
    model: ANALYST_MODEL,
    max_tokens: 3_000,
    system: "You are ARGUS's basic-facts research scout. Search broadly, cite precisely, and return only the requested JSON. Never treat your own answer as verified evidence.",
    messages: assistantContent
      ? [{ role: "user", content: prompt }, { role: "assistant", content: assistantContent }]
      : [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCH_USES }],
  };
}

async function callClaudeSearch(
  prompt: string,
  request: RequestFn,
  assistantContent?: ClaudeContentBlock[],
): Promise<ClaudeResponse | null> {
  let response: Response;
  try {
    response = await request(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": env("ANTHROPIC_API_KEY") ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(claudeRequestBody(prompt, assistantContent)),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (error) {
    addClaudeUsage(undefined, "basic-facts-search", "failed", error instanceof Error && error.name === "TimeoutError" ? `timeout_${DISCOVERY_TIMEOUT_MS}ms` : "transport_error");
    return null;
  }
  if (!response.ok) {
    addClaudeUsage(undefined, "basic-facts-search", "failed", `http_${response.status}`);
    return null;
  }
  let data: ClaudeResponse;
  try {
    data = await response.json() as ClaudeResponse;
  } catch {
    addClaudeUsage(undefined, "basic-facts-search", "failed", "response_json_error");
    return null;
  }
  const text = responseText(data);
  addClaudeUsage(
    data.usage,
    "basic-facts-search",
    text || data.stop_reason === "pause_turn" ? "succeeded" : "partial",
    text || data.stop_reason === "pause_turn" ? undefined : "empty_output",
  );
  return data;
}

/** Claude hosted search discovery. Returned rows are leads only. */
export async function discoverBasicFactLeads(
  ctx: CollectContext,
  dependencies: BasicFactsDiscoveryDependencies = {},
): Promise<BasicFactLead[] | null> {
  if (!env("ANTHROPIC_API_KEY") && !dependencies.request) return null;
  const canonicalSubject = subjectName(ctx);
  const cacheKey = `basic-facts:v2:${ctx.handle.toLowerCase()}:${canonicalSubject.toLowerCase()}:${ctx.evidence.profile.website ?? ""}`;
  const cacheRead = dependencies.cacheRead ?? ((key: string) => cacheGet(key, { operation: "basic-facts-hit", meta: "24h Claude web-search cache" }));
  const cacheWrite = dependencies.cacheWrite ?? cacheSet;
  const cached = await cacheRead(cacheKey);
  if (cached) return parseBasicFactLeads(cached, canonicalSubject, "claude-web-search");

  const request = dependencies.request ?? fetch;
  const prompt = discoveryPrompt(ctx);
  let response = await callClaudeSearch(prompt, request);
  if (!response) return null;
  if (response.stop_reason === "pause_turn" && response.content?.length) {
    response = await callClaudeSearch(prompt, request, response.content);
    if (!response) return null;
  }
  const text = responseText(response);
  if (!text) return null;
  const parsed = parseBasicFactLeads(text, canonicalSubject, "claude-web-search");
  if (parsed) void cacheWrite(cacheKey, text);
  return parsed;
}

async function discoverWithFallback(ctx: CollectContext): Promise<BasicFactLead[] | null> {
  const claude = await discoverBasicFactLeads(ctx);
  if (claude?.length) return claude;
  if (!env("XAI_API_KEY")) return claude;
  const text = await grokSearch(
    "You are ARGUS's basic-facts research scout. Use live web search. Return only the requested JSON. All output remains an unverified lead.",
    discoveryPrompt(ctx),
    { maxToolCalls: MAX_SEARCH_USES, cacheKey: `basic-facts-grok:v2:${ctx.handle.toLowerCase()}:${subjectName(ctx).toLowerCase()}` },
  );
  return text ? parseBasicFactLeads(text, subjectName(ctx), "grok") : claude;
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return name ? named[name.toLowerCase()] ?? match : match;
  });
}

function documentText(document: PublicTextDocument): string {
  if (!/html|xhtml/i.test(document.contentType)) return normalize(document.text);
  return normalize(decodeHtmlEntities(document.text
    .replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    // Keep block boundaries as sentence boundaries. Without this, a heading,
    // navigation item and unrelated paragraph can collapse into one apparent
    // supporting passage after tags are removed.
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|section|article|li|h[1-6]|tr|td|th|main|header|footer|blockquote)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")));
}

const PREDICATE_PATTERNS: Record<BasicFactPredicate, RegExp> = {
  founder: /\b(?:co[- ]?founders?|founders?|co[- ]?founded|founded(?:\s+by)?)\b/i,
  executive: /\b(?:chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|executive|director|head of|lead)\b/i,
  founded: /\b(?:founded|established|formed|incorporated)\b/i,
  launched: /\b(?:launched|went live|debuted|released|introduced)\b/i,
  official_token: /\b(?:official token|governance token|native token|utility token|token|ticker|symbol)\b/i,
  funding: /\b(?:raised|raises|funding|financing|fundraise|round|capital)\b/i,
  investor: /\b(?:invested|investment|investor|backed|backing|led the round|participated in)\b/i,
  product: /\b(?:product|platform|protocol|service|aggregator|exchange|marketplace|wallet|application|app)\b/i,
  network: /\b(?:blockchain|network|chain|mainnet|built on|deployed on|runs on|(?:on|for)\s+(?:the\s+)?(?:ethereum|solana|polygon|arbitrum|optimism|avalanche|base|bnb(?:\s+chain)?|bitcoin|cosmos|sui|aptos|near|tron|ton|polkadot|cardano))\b/i,
  legal_entity: /\b(?:legal entity|company|corporation|incorporated|foundation|limited|ltd\.?|inc\.?|llc|labs)\b/i,
  official_identity: /\b(?:official|known as|operated by|developed by|is (?:a|an|the)|project|organization|protocol|foundation|company)\b/i,
  governance: /\b(?:governance|governed|dao|proposal|vote|voting|council|multisig|multi-sig)\b/i,
  audit: /\b(?:audit|audited|security review|security assessment|formal verification)\b/i,
  repository: /\b(?:github|source code|codebase|repository|repo|open source|open-source)\b/i,
  traction: /\b(?:users?|customers?|volume|tvl|total value locked|transactions?|revenue|fees|usage|adoption|downloads?|active wallets?)\b/i,
};

function predicateIsSupported(excerpt: string, predicate: BasicFactPredicate): boolean {
  const match = PREDICATE_PATTERNS[predicate].exec(excerpt);
  if (!match) return false;
  const local = excerpt.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45);
  return !/\b(?:not|never|no evidence|didn't|did not|denied|false claim)\b/i.test(local);
}

const MAX_SUPPORT_PASSAGE_CHARS = 720;

interface SourceToken {
  key: string;
  start: number;
  end: number;
}

function sourceTokens(value: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match.index === undefined) continue;
    const key = looseTokens(match[0])[0];
    if (key) tokens.push({ key, start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function phraseTokenStarts(tokens: readonly SourceToken[], phrase: string): number[] {
  const needle = looseTokens(phrase);
  if (!needle.length || needle.length > tokens.length) return [];
  const starts: number[] = [];
  for (let index = 0; index <= tokens.length - needle.length; index += 1) {
    if (needle.every((token, offset) => tokens[index + offset].key === token)) starts.push(index);
  }
  return starts;
}

function exactTokenPassage(page: string, excerpt: string): string | null {
  const pageTokens = sourceTokens(page);
  const excerptTokens = looseTokens(excerpt);
  if (!excerptTokens.length || excerptTokens.length > pageTokens.length) return null;
  for (let index = 0; index <= pageTokens.length - excerptTokens.length; index += 1) {
    if (!excerptTokens.every((token, offset) => pageTokens[index + offset].key === token)) continue;
    return normalize(page.slice(pageTokens[index].start, pageTokens[index + excerptTokens.length - 1].end));
  }
  return null;
}

function sourceSentencePassages(page: string): string[] {
  const sentences = [...page.matchAll(/[^.!?]+(?:[.!?]+|$)/g)].flatMap((match) => {
    if (match.index === undefined || !normalize(match[0])) return [];
    return [{ start: match.index, end: match.index + match[0].length }];
  });
  const passages: string[] = [];
  for (let start = 0; start < sentences.length; start += 1) {
    for (let count = 0; count < 3 && start + count < sentences.length; count += 1) {
      const passage = normalize(page.slice(sentences[start].start, sentences[start + count].end));
      if (passage.length > MAX_SUPPORT_PASSAGE_CHARS) break;
      passages.push(passage);
    }
  }
  return passages;
}

function sourceAnchorPassages(page: string, value: string): string[] {
  const tokens = sourceTokens(page);
  const valueTokens = looseTokens(value);
  if (!valueTokens.length) return [];
  return phraseTokenStarts(tokens, value).map((start) => {
    const from = Math.max(0, start - 28);
    const to = Math.min(tokens.length - 1, start + valueTokens.length - 1 + 28);
    return normalize(page.slice(tokens[from].start, tokens[to].end));
  }).filter((passage) => passage.length <= MAX_SUPPORT_PASSAGE_CHARS);
}

function passageSupportsLead(
  passage: string,
  lead: BasicFactLead,
  aliases: readonly string[],
): boolean {
  return aliases.some((alias) => looseContainsPhrase(passage, alias))
    && looseContainsPhrase(passage, lead.value)
    && predicateIsSupported(passage, lead.predicate);
}

function overlapScore(left: string, right: string): number {
  const leftTokens = new Set(looseTokens(left));
  const rightTokens = looseTokens(right);
  return rightTokens.length
    ? rightTokens.filter((token) => leftTokens.has(token)).length / rightTokens.length
    : 0;
}

/**
 * Return the actual fetched passage that proves a model-suggested fact.
 *
 * Search indexes routinely differ from a fresh page fetch at punctuation, link
 * boundaries, or nearby copy. The model's quote is therefore a locator, never
 * the evidence artifact. Exact and punctuation-insensitive quote matches are
 * preferred; otherwise a short fetched passage must itself contain the subject,
 * atomic value, and predicate language. Distant page-wide co-occurrence fails.
 */
function supportingSourcePassage(
  page: string,
  lead: BasicFactLead,
  aliases: readonly string[],
): string | null {
  const excerpt = normalize(decodeHtmlEntities(lead.excerpt));
  const exact = page.includes(excerpt) ? excerpt : exactTokenPassage(page, excerpt);
  if (exact && passageSupportsLead(exact, lead, aliases)) return exact;

  const candidates = [...new Set([
    ...sourceSentencePassages(page),
    ...sourceAnchorPassages(page, lead.value),
  ])].filter((passage) => passageSupportsLead(passage, lead, aliases));
  if (!candidates.length) return null;
  return candidates.sort((left, right) =>
    overlapScore(right, excerpt) - overlapScore(left, excerpt)
    || left.length - right.length)[0];
}

const normalizedHost = (host: string): string => host
  .toLowerCase()
  .replace(/\.$/, "")
  .replace(/^www\./, "");

/**
 * Count only the configured first-party host, or one of its subdomains, as
 * official. Comparing the last two labels would incorrectly treat unrelated
 * tenants on shared hosts such as github.io or vercel.app as the same site.
 */
const sameOfficialDomain = (host: string, officialHosts: readonly string[]): boolean => {
  const candidate = normalizedHost(host);
  return officialHosts.some((official) => {
    const configured = normalizedHost(official);
    return candidate === configured || candidate.endsWith(`.${configured}`);
  });
};

function factId(subjectKey: string, predicate: BasicFactPredicate, value: string): string {
  return `basic_v1_${createHash("sha256").update(`${subjectKey.toLowerCase()}::${predicate}::${searchable(value)}`).digest("hex")}`;
}

/** Promote one lead only when a short passage in the safely fetched artifact
 * independently contains the subject, atomic value, and predicate language. */
export function verifyBasicFactLead(
  lead: BasicFactLead,
  document: PublicTextDocument,
  aliases: readonly string[],
  subjectKey = lead.subject,
  officialHosts: readonly string[] = [],
): BasicFact | null {
  const page = documentText(document);
  if (!isAtomicValue(lead.predicate, lead.value)) return null;
  const excerpt = supportingSourcePassage(page, lead, aliases);
  if (!excerpt) return null;
  const official = sameOfficialDomain(document.host, officialHosts);
  const supportedQualifier = lead.qualifier && looseContainsPhrase(excerpt, lead.qualifier)
    ? lead.qualifier
    : undefined;
  return {
    factId: factId(subjectKey, lead.predicate, lead.value),
    subjectKey,
    predicate: lead.predicate,
    value: lead.value,
    normalizedValue: searchable(lead.value),
    status: official ? "verified" : "lead",
    critical: CRITICAL_PREDICATES.has(lead.predicate),
    sources: [{
      url: document.url,
      ...(lead.sourceTitle ? { title: lead.sourceTitle } : {}),
      sourceClass: official ? "official_subject" : "independent_press",
      relation: "supports",
      excerpt,
      contentHash: document.contentHash,
      capturedAt: document.capturedAt,
      provider: "public-web",
      artifactVerified: true,
    }],
    ...(supportedQualifier ? { qualifier: supportedQualifier } : {}),
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    discoveryProvider: lead.provider,
  };
}

const MULTI_VALUE_PREDICATES = new Set<BasicFactPredicate>([
  "founder", "executive", "product", "funding", "investor", "governance",
  "audit", "repository", "traction",
]);

function resolveBasicFactCandidates(candidates: BasicFact[]): BasicFact[] {
  const grouped = new Map<string, BasicFact[]>();
  for (const candidate of candidates) {
    const key = `${candidate.predicate}::${candidate.normalizedValue}`;
    const rows = grouped.get(key) ?? [];
    rows.push(candidate);
    grouped.set(key, rows);
  }
  const resolved: BasicFact[] = [...grouped.values()].flatMap((rows): BasicFact[] => {
    const sources = [...new Map(rows.flatMap((row) => row.sources).map((source) => [source.url, source])).values()];
    const official = sources.some((source) => source.sourceClass === "official_subject");
    const independentHosts = new Set(sources
      .filter((source) => source.sourceClass === "independent_press")
      .map((source) => new URL(source.url).hostname.replace(/^www\./, "")));
    if (!official && independentHosts.size < 2) return [];
    return [{
      ...rows[0],
      status: official ? "verified" as const : "corroborated" as const,
      sources,
    }];
  });

  const singletonPredicates = new Set(resolved
    .map((fact) => fact.predicate)
    .filter((predicate) => !MULTI_VALUE_PREDICATES.has(predicate)));
  for (const predicate of singletonPredicates) {
    const values = resolved.filter((fact) => fact.predicate === predicate);
    if (values.length > 1) values.forEach((fact) => { fact.status = "conflicted"; });
  }
  return resolved;
}

interface VerificationLeadVariant {
  lead: BasicFactLead;
  priority: number;
}

const personKey = (value: string): string => looseTokens(value).join(" ");

function teamSourceCandidates(ctx: CollectContext, lead: BasicFactLead): Array<{ url: string; title?: string }> {
  if (lead.predicate !== "founder" && lead.predicate !== "executive") return [];
  return (ctx.evidence.webTeam ?? []).flatMap((member) => {
    if (
      member.artifact_verified !== true
      || member.evidence_origin !== "deterministic"
      || personKey(member.name) !== personKey(lead.value)
      || (lead.predicate === "founder" && !/\bfounder\b|\bco[- ]?founder\b/i.test(member.role))
      || (lead.predicate === "executive" && !PREDICATE_PATTERNS.executive.test(member.role))
    ) return [];
    const url = safeCandidateUrl(member.sourceUrl);
    if (!url) return [];
    const title = clean(member.source, 240);
    return [{ url, ...(title ? { title } : {}) }];
  });
}

function verificationLeadVariants(
  ctx: CollectContext,
  leads: readonly BasicFactLead[],
  officialHosts: readonly string[],
): VerificationLeadVariant[] {
  const variants: VerificationLeadVariant[] = [];
  const seen = new Set<string>();
  const add = (lead: BasicFactLead, value: unknown, title: string | undefined, primary: boolean) => {
    const sourceUrl = safeCandidateUrl(value);
    if (!sourceUrl) return;
    const key = `${lead.predicate}::${personKey(lead.value)}::${sourceUrl}`;
    if (seen.has(key)) return;
    seen.add(key);
    let official = false;
    try { official = sameOfficialDomain(new URL(sourceUrl).hostname, officialHosts); } catch { /* already sanitized */ }
    const variantLead = { ...lead, sourceUrl };
    if (title) variantLead.sourceTitle = title;
    else delete variantLead.sourceTitle;
    variants.push({
      lead: variantLead,
      priority: official ? 0 : primary ? 1 : 2,
    });
  };

  for (const lead of leads) {
    add(lead, lead.sourceUrl, lead.sourceTitle, true);
    for (const sourceUrl of lead.candidateUrls ?? []) add(lead, sourceUrl, undefined, false);
    for (const source of teamSourceCandidates(ctx, lead)) add(lead, source.url, source.title, false);
  }
  return variants.sort((left, right) => left.priority - right.priority);
}

/** Discover broad basic facts, then fail closed while fetching and verifying. */
export async function collectBasicFacts(
  ctx: CollectContext,
  dependencies: BasicFactsCollectorDependencies = {},
): Promise<AdapterRunResult> {
  const discover = dependencies.discover ?? discoverWithFallback;
  const fetchSource = dependencies.fetchSource ?? fetchPublicText;
  if (!dependencies.discover && !env("ANTHROPIC_API_KEY") && !env("XAI_API_KEY")) {
    return { state: "skipped", detail: "basic-facts web research is not configured" };
  }

  ctx.emit({
    phase: "P0 · Intake",
    label: "Basic facts research",
    detail: "Searching for foundational facts, then independently fetching and checking every cited passage…",
    source: env("ANTHROPIC_API_KEY") ? "Claude web search · public source verification" : "Grok web search · public source verification",
    tone: "neutral",
  });

  const leads = await discover(ctx);
  if (!leads) return { state: "failed", detail: "basic-facts discovery failed" };
  ctx.evidence.basicFactLeads = leads.slice(0, MAX_LEADS).map((lead) => ({ ...lead }));
  if (!leads.length) {
    ctx.evidence.basicFacts = [];
    return { state: "partial", detail: "search returned no source-linked basic-fact candidates" };
  }

  const aliases = subjectAliases(ctx);
  const officialHosts = [ctx.evidence.profile.website]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try { return [new URL(value).hostname]; } catch { return []; }
    });
  const sourceByUrl = new Map<string, Promise<PublicTextResult>>();
  const fetchOnce = (url: string): Promise<PublicTextResult> => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const pending = fetchSource(url).then((result) => {
      recordCall(
        "basic-facts-web",
        "source-fetch",
        0,
        result.status === "ok" ? "source_fetched" : result.reason,
        result.status === "ok" ? "succeeded" : "failed",
      );
      return result;
    }).catch((): PublicTextResult => {
      recordCall("basic-facts-web", "source-fetch", 0, "transport_error", "failed");
      return { status: "failed", reason: "transport_error" };
    });
    sourceByUrl.set(key, pending);
    return pending;
  };

  const boundedLeads = leads.slice(0, MAX_LEADS);
  const variants = verificationLeadVariants(ctx, boundedLeads, officialHosts);
  const allowedSources = new Set([...new Set(variants.map(({ lead }) => lead.sourceUrl))].slice(0, MAX_SOURCES));
  const verified = (await Promise.all(variants
    .filter(({ lead }) => allowedSources.has(lead.sourceUrl))
    .map(async ({ lead }) => {
      const result = await fetchOnce(lead.sourceUrl);
      return result.status === "ok" ? verifyBasicFactLead(lead, result, aliases, ctx.handle, officialHosts) : null;
    })))
    .filter((fact): fact is BasicFact => fact !== null);

  ctx.evidence.basicFacts = resolveBasicFactCandidates(verified);
  const sourceVerifiedLeadCount = new Set(verified.map((fact) =>
    `${fact.predicate}::${fact.normalizedValue}`)).size;
  ctx.emit({
    phase: "P0 · Intake",
    label: ctx.evidence.basicFacts.length ? "Basic facts verified" : "Basic facts need review",
    detail: `${sourceVerifiedLeadCount}/${boundedLeads.length} leads matched subject, value, and predicate language in fetched source text; ${ctx.evidence.basicFacts.length} met the first-party or two-source publication threshold.`,
    source: "public-web",
    tone: ctx.evidence.basicFacts.length ? "good" : "warn",
  });
  return ctx.evidence.basicFacts.length
    ? { state: "executed", detail: `${ctx.evidence.basicFacts.length} verified · ${boundedLeads.length} leads` }
    : { state: "partial", detail: `${boundedLeads.length} leads · 0 passed source verification` };
}

export const basicFactsAdapter: Adapter = {
  id: "basic-facts",
  label: "Basic facts research",
  available: () => Boolean(env("ANTHROPIC_API_KEY") || env("XAI_API_KEY")),
  run: collectBasicFacts,
};
