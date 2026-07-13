import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  canonicalBasicFactComparisonValue,
  type BasicFact,
  type BasicFactLead,
  type BasicFactPredicate,
  type BasicFactQuestionLedgerEntry,
} from "../../src/data/evidence";
import { ANALYST_MODEL, env } from "../config";
import { cacheGet, cacheSet } from "../cache";
import { addClaudeUsage, recordCall } from "../cost";
import { fetchPublicText, type PublicTextDocument, type PublicTextResult } from "../publicWeb";
import { grokSearch } from "./x";
import type { Adapter, AdapterRunResult, CollectContext } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PRIMARY_SEARCH_USES_PER_BATCH = 3;
const REPAIR_SEARCH_USES = 4;
const MAX_LEADS = 28;
const MAX_SOURCES = 32;
const DISCOVERY_TIMEOUT_MS = 50_000;
const RESEARCH_CACHE_VERSION = "v4";
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

const PREDICATES = new Set<BasicFactPredicate>([
  "official_identity",
  "current_role",
  "prior_role",
  "education",
  "founder",
  "executive",
  "founded",
  "launched",
  "exit",
  "track_record",
  "official_token",
  "public_security",
  "funding",
  "investor",
  "product",
  "network",
  "legal_entity",
  "legal_regulatory_event",
  "governance",
  "control",
  "conflict_of_interest",
  "tokenomics",
  "vesting",
  "treasury",
  "audit",
  "repository",
  "traction",
]);

const CRITICAL_PREDICATES = new Set<BasicFactPredicate>([
  "official_identity", "current_role", "product", "founder", "executive",
  "track_record", "official_token",
]);

/**
 * Reserve one model-ordered lead from each due-diligence category before the
 * remaining slots are filled in model order. A broad response often starts
 * with a long founder or investor roster; a plain `slice(0, MAX_LEADS)` would
 * then discard later token, security, and traction disclosures entirely.
 *
 * There are fewer categories than MAX_LEADS, so a response that covers every
 * category still retains room for additional atomic people, products, or
 * investors from the model's original ordering.
 */
const LEAD_COVERAGE_CATEGORIES: readonly (readonly BasicFactPredicate[])[] = [
  ["official_identity"],
  ["current_role", "prior_role"],
  ["education"],
  ["founder"],
  ["executive"],
  ["product"],
  ["exit", "track_record"],
  ["legal_entity"],
  ["official_token"],
  ["public_security"],
  ["tokenomics"],
  ["vesting"],
  ["treasury"],
  ["audit"],
  ["traction"],
  ["governance"],
  ["control", "conflict_of_interest"],
  ["legal_regulatory_event"],
  ["repository"],
  ["funding", "investor"],
  ["network"],
  ["founded", "launched"],
];

function selectBasicFactLeads(leads: readonly BasicFactLead[]): BasicFactLead[] {
  if (leads.length <= MAX_LEADS) return leads.slice();

  const selected = new Set<number>();
  for (const predicates of LEAD_COVERAGE_CATEGORIES) {
    const index = leads.findIndex((lead, leadIndex) =>
      !selected.has(leadIndex) && predicates.includes(lead.predicate));
    if (index >= 0) selected.add(index);
  }
  for (let index = 0; index < leads.length && selected.size < MAX_LEADS; index += 1) {
    selected.add(index);
  }

  // Filtering by original index keeps the model's ordering stable while the
  // selected set guarantees later categories cannot be starved by early rows.
  return leads.filter((_lead, index) => selected.has(index)).slice(0, MAX_LEADS);
}

type DiscoveryProvider = BasicFactLead["provider"];
type RequestFn = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type BasicFactsResearchAudience = "person" | "project" | "investor";
export type BasicFactsResearchBatch = "identity" | "track_record" | "structure_risk" | "repair";

export interface BasicFactsResearchQuestion {
  id: string;
  audience: BasicFactsResearchAudience;
  batch: Exclude<BasicFactsResearchBatch, "repair">;
  predicate: BasicFactPredicate;
  question: string;
  critical: boolean;
}

export type BasicFactsDiscoveryState = "succeeded" | "partial" | "completed_empty" | "failed" | "skipped";

export interface BasicFactsDiscoveryResult {
  provider: DiscoveryProvider | "none" | "test";
  state: BasicFactsDiscoveryState;
  leads: BasicFactLead[];
  attempts: number;
  completedBatches: number;
  failedBatches: number;
  batchStates?: Partial<Record<BasicFactsResearchBatch, BasicFactsDiscoveryState>>;
  detail?: string;
}

interface QuestionTemplate {
  batch: Exclude<BasicFactsResearchBatch, "repair">;
  predicate: BasicFactPredicate;
  question: string;
  critical?: boolean;
}

const PROJECT_QUESTIONS: readonly QuestionTemplate[] = [
  { batch: "identity", predicate: "official_identity", question: "What exact project or company does this account represent?", critical: true },
  { batch: "identity", predicate: "founder", question: "Who founded or co-founded the project? Return one person per answer.", critical: true },
  { batch: "identity", predicate: "executive", question: "Who currently leads or operates the project? Return one person and role per answer.", critical: true },
  { batch: "identity", predicate: "founded", question: "When was the project founded?" },
  { batch: "track_record", predicate: "product", question: "What live products or services does the project provide?", critical: true },
  { batch: "track_record", predicate: "launched", question: "When did its product, protocol, or mainnet launch?", critical: true },
  { batch: "track_record", predicate: "official_token", question: "What is the project's official crypto token, if any?", critical: true },
  { batch: "track_record", predicate: "public_security", question: "Does the organization have a publicly traded equity or debt security distinct from any crypto token?" },
  { batch: "track_record", predicate: "network", question: "Which blockchain networks or chains does it run on?", critical: true },
  { batch: "track_record", predicate: "funding", question: "What source-backed funding rounds or amounts has it raised?", critical: true },
  { batch: "track_record", predicate: "investor", question: "Which named investors or backers are source-backed? Return one per answer." },
  { batch: "track_record", predicate: "repository", question: "Where is the official source code maintained?", critical: true },
  { batch: "track_record", predicate: "traction", question: "What concrete, dated usage, revenue, volume, users, fees, TVL, or adoption metrics are public?", critical: true },
  { batch: "structure_risk", predicate: "legal_entity", question: "Which legal entity is responsible for the project?", critical: true },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events are publicly documented, who are they attributed to, and what is each event's current stated status?" },
  { batch: "structure_risk", predicate: "governance", question: "What formal governance process is documented?", critical: true },
  { batch: "structure_risk", predicate: "control", question: "Who has practical control through ownership, boards, voting power, admin keys, multisigs, or treasury authority?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit related-party arrangements or conflicts of interest are disclosed?" },
  { batch: "structure_risk", predicate: "tokenomics", question: "What token allocation or supply disclosures are published?" },
  { batch: "structure_risk", predicate: "vesting", question: "What vesting, lockup, or unlock schedule is published?" },
  { batch: "structure_risk", predicate: "treasury", question: "What treasury assets, reports, wallets, or controls are disclosed?" },
  { batch: "structure_risk", predicate: "audit", question: "Which independent security audits or reviews are published?", critical: true },
];

const PERSON_QUESTIONS: readonly QuestionTemplate[] = [
  { batch: "identity", predicate: "official_identity", question: "What is this person's source-backed public identity?", critical: true },
  { batch: "identity", predicate: "current_role", question: "What roles does this person currently hold? Return one role and organization per answer.", critical: true },
  { batch: "identity", predicate: "prior_role", question: "What material prior roles did this person hold? Return one role and organization per answer." },
  { batch: "identity", predicate: "education", question: "What education or credentials are explicitly documented? Return one institution or credential per answer." },
  { batch: "identity", predicate: "founder", question: "Which companies or projects did this person found or co-found? Return one venture per answer." },
  { batch: "identity", predicate: "executive", question: "Which executive roles are source-backed? Return one role and organization per answer." },
  { batch: "track_record", predicate: "founded", question: "When were the person's principal ventures founded? Return one dated venture per answer." },
  { batch: "track_record", predicate: "product", question: "What products or protocols did this person materially build or lead? Return one per answer." },
  { batch: "track_record", predicate: "exit", question: "What acquisitions, IPOs, sales, shutdowns, or other venture exits are source-backed? Return one event per answer." },
  { batch: "track_record", predicate: "track_record", question: "What concrete operating or investment outcomes establish this person's track record? Return one measurable outcome per answer." },
  { batch: "structure_risk", predicate: "official_token", question: "Which crypto token is officially tied to a venture this person controls, if any? Do not report public-company stock here." },
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded equity or debt security is tied to a company this person controls, if any? Do not report a crypto token here." },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events explicitly name this person, and what is each event's stated status? Never transfer a company-only event to the person." },
  { batch: "structure_risk", predicate: "governance", question: "What formal governance roles does this person hold?" },
  { batch: "structure_risk", predicate: "control", question: "What ownership, voting, board, admin-key, multisig, or treasury control is explicitly attributed to this person?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit conflicts of interest or related-party arrangements are attributed to this person?" },
];

const INVESTOR_QUESTIONS: readonly QuestionTemplate[] = [
  { batch: "identity", predicate: "official_identity", question: "What is this investor's source-backed public identity?", critical: true },
  { batch: "identity", predicate: "current_role", question: "What investment role and firm does this person currently hold?", critical: true },
  { batch: "identity", predicate: "prior_role", question: "What material prior investing or operating roles did this person hold?" },
  { batch: "identity", predicate: "education", question: "What education or professional credentials are explicitly documented?" },
  { batch: "identity", predicate: "founder", question: "Which companies, funds, or projects did this person found or co-found? Return one per answer." },
  { batch: "identity", predicate: "executive", question: "Which material operating or executive roles are source-backed? Return one role and organization per answer." },
  { batch: "track_record", predicate: "investor", question: "Which investments are explicitly attributed to this person rather than merely to an affiliated fund? Return one per answer.", critical: true },
  { batch: "track_record", predicate: "funding", question: "Which rounds did this person or their currently affiliated fund publicly lead or join? Return one per answer." },
  { batch: "track_record", predicate: "founded", question: "When were the person's principal companies, funds, or projects founded?" },
  { batch: "track_record", predicate: "product", question: "What products, protocols, or investment platforms did this person materially build or lead?" },
  { batch: "track_record", predicate: "exit", question: "Which portfolio exits or realized outcomes are source-backed and correctly attributed?" },
  { batch: "track_record", predicate: "track_record", question: "What concrete fund, portfolio, or operating outcomes establish this investor's track record?", critical: true },
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded security is directly relevant to this investor or controlled company, if any?" },
  { batch: "structure_risk", predicate: "official_token", question: "Which official crypto token is directly tied to a venture this investor controls, if any? Do not treat a stock ticker as a token." },
  { batch: "structure_risk", predicate: "legal_entity", question: "Which legal entity employs the investor or manages the disclosed fund?" },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events explicitly name this investor or their firm, with exact attribution and current stated status?" },
  { batch: "structure_risk", predicate: "governance", question: "What formal board, governance, or voting roles are documented?" },
  { batch: "structure_risk", predicate: "control", question: "What ownership, board, voting, or investment-committee control is explicitly documented?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit related-party arrangements or conflicts of interest are disclosed?" },
];

const FOUNDER_REPAIR_PREDICATES = new Set<BasicFactPredicate>(
  PERSON_QUESTIONS.map((question) => question.predicate),
);
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
  discover?: (
    ctx: CollectContext,
    questions: readonly BasicFactsResearchQuestion[],
  ) => Promise<BasicFactLead[] | BasicFactsDiscoveryResult | null>;
  repair?: (
    ctx: CollectContext,
    questions: readonly BasicFactsResearchQuestion[],
  ) => Promise<BasicFactLead[] | BasicFactsDiscoveryResult | null>;
  fetchSource?: (url: string) => Promise<PublicTextResult>;
}

function researchAudience(ctx: CollectContext): BasicFactsResearchAudience {
  if (ctx.evidence.roles.some((role) => String(role) === "PROJECT")) return "project";
  if (ctx.evidence.roles.some((role) => String(role) === "INVESTOR")) return "investor";
  return "person";
}

/** Stable, role-aware questions asked of search models. Models only discover leads. */
export function basicFactsResearchQuestions(ctx: CollectContext): BasicFactsResearchQuestion[] {
  const audience = researchAudience(ctx);
  const templates = audience === "project"
    ? PROJECT_QUESTIONS
    : audience === "investor"
      ? INVESTOR_QUESTIONS
      : PERSON_QUESTIONS;
  const founderSubject = ctx.evidence.roles.some((role) => String(role) === "FOUNDER");
  return templates.map((template) => ({
    id: `${audience}.${template.predicate}`,
    audience,
    batch: template.batch,
    predicate: template.predicate,
    question: template.question,
    critical: Boolean(
      template.critical
      || (audience !== "project" && founderSubject && FOUNDER_REPAIR_PREDICATES.has(template.predicate)),
    ),
  }));
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
  if (/[;\n]/.test(value)) return false;
  // A role title such as "Chair and CEO at Coinbase" is one relationship,
  // even though it contains two titles. Other predicates retain the strict
  // conjunction guard so a model cannot combine people, ventures, or tokens.
  if (/\s(?:and|&)\s/i.test(value) && predicate !== "current_role" && predicate !== "prior_role") return false;
  // Commas almost always indicate a model-combined roster for people/backers.
  if (["founder", "executive", "investor"].includes(predicate) && value.includes(",")) return false;
  return true;
}

/** Parse discovery JSON. Every row remains explicitly non-governing. */
export function parseBasicFactLeads(
  text: string,
  expectedSubject?: string,
  provider: DiscoveryProvider = "claude-web-search",
  questions: readonly BasicFactsResearchQuestion[] = [],
): BasicFactLead[] | null {
  const payload = parsePayload(text);
  if (!payload || !Array.isArray(payload.facts)) return null;
  const leads: BasicFactLead[] = [];
  const seen = new Set<string>();
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const questionsByPredicate = new Map<BasicFactPredicate, BasicFactsResearchQuestion[]>();
  for (const question of questions) {
    questionsByPredicate.set(question.predicate, [
      ...(questionsByPredicate.get(question.predicate) ?? []),
      question,
    ]);
  }
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
    const suppliedQuestionId = clean(row.question_id ?? row.questionId, 100);
    const suppliedQuestion = suppliedQuestionId ? questionById.get(suppliedQuestionId) : undefined;
    if (questions.length && suppliedQuestionId && !suppliedQuestion) continue;
    if (questions.length && !(questionsByPredicate.get(predicate)?.length)) continue;
    if (suppliedQuestion && suppliedQuestion.predicate !== predicate) continue;
    const inferredQuestion = suppliedQuestion
      ?? (questionsByPredicate.get(predicate)?.length === 1 ? questionsByPredicate.get(predicate)?.[0] : undefined);
    const qualifier = clean(row.qualifier, 120);
    const eventStatus = clean(row.event_status ?? row.eventStatus, 160);
    const attributedEntity = clean(row.attributed_entity ?? row.attributedEntity, 200);
    if (predicate === "legal_regulatory_event" && (!eventStatus || !attributedEntity)) continue;
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
      ...(inferredQuestion ? { questionId: inferredQuestion.id } : {}),
      ...(eventStatus ? { eventStatus } : {}),
      ...(attributedEntity ? { attributedEntity } : {}),
      excerpt,
      sourceUrl,
      ...(sourceTitle ? { sourceTitle } : {}),
      ...(candidateUrls.length ? { candidateUrls } : {}),
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider,
    });
  }
  return selectBasicFactLeads(leads);
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

function discoveryPrompt(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
  phase: "primary" | "repair" = "primary",
): string {
  const profile = ctx.evidence.profile;
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const questionLedger = questions.map((question, index) =>
    `${index + 1}. [${question.id}] (${question.predicate}${question.critical ? ", decision-critical" : ""}) ${question.question}`,
  ).join("\n");
  return [
    `${phase === "repair" ? "Repair the remaining verified-evidence gaps" : "Research foundational due-diligence facts"} for ${subjectName(ctx)} (${ctx.handle}).`,
    `Research audience: ${audience}. Answer only the targeted questions below; do not pad the response with adjacent facts.`,
    profile.website ? `Known official website: ${profile.website}` : "",
    profile.bio ? `Profile bio: ${profile.bio.slice(0, 800)}` : "",
    "Targeted question ledger:",
    questionLedger,
    "Prefer official first-party pages and primary documents, then reputable independent reporting.",
    "An official counterparty page may support a role, investment, acquisition, or other relationship when it explicitly names both sides. Still return the exact page and passage so ARGUS can verify it.",
    "Return one atomic value per row. Never combine multiple founders, people, investors, tokens, networks, or products in one value.",
    "Set question_id to the exact bracketed question ID. The predicate must match that question.",
    "Each exact_excerpt must be a verbatim one-to-three sentence passage that itself explicitly contains the subject identity, the claimed value, and language proving the predicate.",
    "For traction facts, copy the source's exact as-of date or reporting period into qualifier, preferably an explicit date phrase, only when that phrase appears in exact_excerpt. Never infer, normalize, or invent a date. Omit qualifier when the source does not state a period.",
    "Keep an official crypto token separate from a publicly traded equity or debt security. Never put stock in official_token and never put a crypto token in public_security.",
    "For legal_regulatory_event, include attributed_entity and event_status only when the exact excerpt states them. Never attribute a company-only event to a founder or employee.",
    "Keep formal governance, practical control, and explicit conflicts of interest separate. Do not infer control or a conflict from a job title alone.",
    "For candidate_urls, include up to three additional public pages that explicitly state the same atomic fact. Prefer the project's official site, docs, governance forum, or primary documents, then independent reporting. Do not repeat source_url.",
    "Do not infer. A search answer is only a lead; ARGUS will fetch and verify every URL independently.",
    "Return JSON only in this exact shape:",
    `{"facts":[{"question_id":"${questions[0]?.id ?? `${audience}.official_identity`}","subject":"...","predicate":"${questions.map((question) => question.predicate).join("|")}","value":"one atomic value","qualifier":"optional verbatim role, metric label, or traction as-of/reporting period present in exact_excerpt","event_status":"optional, exact source wording","attributed_entity":"optional, exact source wording","exact_excerpt":"verbatim source passage","source_url":"https://...","source_title":"...","candidate_urls":["https://..."]}]}`,
  ].filter(Boolean).join("\n");
}

function responseText(response: ClaudeResponse): string {
  return (response.content ?? [])
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function claudeRequestBody(
  prompt: string,
  assistantContent?: ClaudeContentBlock[],
  maxSearchUses = PRIMARY_SEARCH_USES_PER_BATCH,
): Record<string, unknown> {
  return {
    model: ANALYST_MODEL,
    max_tokens: 3_000,
    system: "You are ARGUS's basic-facts research scout. Search broadly, cite precisely, and return only the requested JSON. Never treat your own answer as verified evidence.",
    messages: assistantContent
      ? [{ role: "user", content: prompt }, { role: "assistant", content: assistantContent }]
      : [{ role: "user", content: prompt }],
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxSearchUses }],
  };
}

async function callClaudeSearch(
  prompt: string,
  request: RequestFn,
  assistantContent?: ClaudeContentBlock[],
  maxSearchUses = PRIMARY_SEARCH_USES_PER_BATCH,
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
      body: JSON.stringify(claudeRequestBody(prompt, assistantContent, maxSearchUses)),
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

interface BatchDiscoveryResult {
  batch: BasicFactsResearchBatch;
  state: Exclude<BasicFactsDiscoveryState, "skipped">;
  leads: BasicFactLead[];
  attempts: number;
  detail?: string;
}

function aggregateDiscovery(
  provider: DiscoveryProvider,
  batches: readonly BatchDiscoveryResult[],
): BasicFactsDiscoveryResult {
  const leads = selectBasicFactLeads(batches.flatMap((batch) => batch.leads));
  const failedBatches = batches.filter((batch) => batch.state === "failed" || batch.state === "partial").length;
  const completedBatches = batches.filter((batch) => batch.state === "succeeded" || batch.state === "completed_empty").length;
  const state: BasicFactsDiscoveryState = failedBatches
    ? (leads.length || completedBatches ? "partial" : "failed")
    : leads.length
      ? "succeeded"
      : "completed_empty";
  return {
    provider,
    state,
    leads,
    attempts: batches.reduce((sum, batch) => sum + batch.attempts, 0),
    completedBatches,
    failedBatches,
    batchStates: Object.fromEntries(batches.map((batch) => [batch.batch, batch.state])),
    detail: batches.map((batch) => batch.detail).filter(Boolean).join("; ") || undefined,
  };
}

function questionsByBatch(
  questions: readonly BasicFactsResearchQuestion[],
): Array<[Exclude<BasicFactsResearchBatch, "repair">, BasicFactsResearchQuestion[]]> {
  const batches: Array<Exclude<BasicFactsResearchBatch, "repair">> = ["identity", "track_record", "structure_risk"];
  return batches.flatMap((batch): Array<[Exclude<BasicFactsResearchBatch, "repair">, BasicFactsResearchQuestion[]]> => {
    const selected = questions.filter((question) => question.batch === batch);
    return selected.length ? [[batch, selected]] : [];
  });
}

/** Claude hosted search discovery with an attributable state per targeted batch. */
export async function discoverBasicFactLeadsDetailed(
  ctx: CollectContext,
  dependencies: BasicFactsDiscoveryDependencies = {},
  questions: readonly BasicFactsResearchQuestion[] = basicFactsResearchQuestions(ctx),
  phase: "primary" | "repair" = "primary",
): Promise<BasicFactsDiscoveryResult> {
  if (!env("ANTHROPIC_API_KEY") && !dependencies.request) {
    return { provider: "claude-web-search", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "Claude search is not configured" };
  }
  const canonicalSubject = subjectName(ctx);
  const cacheRead = dependencies.cacheRead ?? ((key: string) => cacheGet(key, { operation: "basic-facts-hit", meta: "24h Claude web-search cache" }));
  const cacheWrite = dependencies.cacheWrite ?? cacheSet;
  const request = dependencies.request ?? fetch;
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const grouped = questionsByBatch(questions);
  const batches = await Promise.all(grouped.map(async ([batch, batchQuestions]): Promise<BatchDiscoveryResult> => {
    const questionFingerprint = createHash("sha256")
      .update(batchQuestions.map((question) => question.id).sort().join("|"))
      .digest("hex").slice(0, 12);
    const cacheKey = `basic-facts:${RESEARCH_CACHE_VERSION}:claude:${audience}:${phase}:${batch}:${questionFingerprint}:${ctx.handle.toLowerCase()}:${canonicalSubject.toLowerCase()}:${ctx.evidence.profile.website ?? ""}`;
    const cached = await cacheRead(cacheKey);
    if (cached) {
      const parsed = parseBasicFactLeads(cached, canonicalSubject, "claude-web-search", batchQuestions);
      if (parsed) return {
        batch,
        state: parsed.length ? "succeeded" : "completed_empty",
        leads: parsed,
        attempts: 0,
        detail: `${batch}:cache_${parsed.length ? "hit" : "empty"}`,
      };
    }

    const prompt = discoveryPrompt(ctx, batchQuestions, phase);
    const maxSearchUses = phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH;
    let attempts = 1;
    let response = await callClaudeSearch(prompt, request, undefined, maxSearchUses);
    if (!response) return { batch, state: "failed", leads: [], attempts, detail: `${batch}:request_failed` };
    if (response.stop_reason === "pause_turn" && response.content?.length) {
      attempts += 1;
      response = await callClaudeSearch(prompt, request, response.content, maxSearchUses);
      if (!response) return { batch, state: "failed", leads: [], attempts, detail: `${batch}:continuation_failed` };
    }
    const text = responseText(response);
    if (!text) return { batch, state: "partial", leads: [], attempts, detail: `${batch}:empty_output` };
    const parsed = parseBasicFactLeads(text, canonicalSubject, "claude-web-search", batchQuestions);
    if (!parsed) return { batch, state: "partial", leads: [], attempts, detail: `${batch}:invalid_json` };
    void cacheWrite(cacheKey, text);
    return {
      batch,
      state: parsed.length ? "succeeded" : "completed_empty",
      leads: parsed,
      attempts,
      detail: `${batch}:${parsed.length ? `${parsed.length}_leads` : "completed_empty"}`,
    };
  }));
  return aggregateDiscovery("claude-web-search", batches);
}

/** Backward-compatible lead-only wrapper used by focused adapter tests. */
export async function discoverBasicFactLeads(
  ctx: CollectContext,
  dependencies: BasicFactsDiscoveryDependencies = {},
  questions: readonly BasicFactsResearchQuestion[] = basicFactsResearchQuestions(ctx),
): Promise<BasicFactLead[] | null> {
  const result = await discoverBasicFactLeadsDetailed(ctx, dependencies, questions);
  return result.state === "failed" || result.state === "skipped" ? null : result.leads;
}

async function discoverGrokQuestions(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
  phase: "primary" | "repair",
): Promise<BasicFactsDiscoveryResult> {
  if (!env("XAI_API_KEY")) {
    return { provider: "grok", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "Grok search is not configured" };
  }
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const grouped = questionsByBatch(questions);
  const batches = await Promise.all(grouped.map(async ([batch, batchQuestions]): Promise<BatchDiscoveryResult> => {
    const fingerprint = createHash("sha256")
      .update(batchQuestions.map((question) => question.id).sort().join("|"))
      .digest("hex").slice(0, 12);
    const text = await grokSearch(
      "You are ARGUS's basic-facts research scout. Use live web search. Return only the requested JSON. Every answer remains an unverified lead until ARGUS fetches and verifies the exact source passage.",
      discoveryPrompt(ctx, batchQuestions, phase),
      {
        maxToolCalls: phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH,
        cacheKey: `basic-facts:${RESEARCH_CACHE_VERSION}:grok:${audience}:${phase}:${batch}:${fingerprint}:${ctx.handle.toLowerCase()}:${subjectName(ctx).toLowerCase()}`,
      },
    );
    if (!text) return { batch, state: "failed", leads: [], attempts: 1, detail: `${batch}:request_failed` };
    const parsed = parseBasicFactLeads(text, subjectName(ctx), "grok", batchQuestions);
    if (!parsed) return { batch, state: "partial", leads: [], attempts: 1, detail: `${batch}:invalid_json` };
    return {
      batch,
      state: parsed.length ? "succeeded" : "completed_empty",
      leads: parsed,
      attempts: 1,
      detail: `${batch}:${parsed.length ? `${parsed.length}_leads` : "completed_empty"}`,
    };
  }));
  return aggregateDiscovery("grok", batches);
}

async function discoverPrimary(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
): Promise<BasicFactsDiscoveryResult> {
  if (env("ANTHROPIC_API_KEY")) return discoverBasicFactLeadsDetailed(ctx, {}, questions, "primary");
  return discoverGrokQuestions(ctx, questions, "primary");
}

async function discoverRepair(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
  primaryProvider: BasicFactsDiscoveryResult["provider"],
): Promise<BasicFactsDiscoveryResult> {
  if (!questions.length) {
    return { provider: "none", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "no critical gaps" };
  }
  // Prefer a genuinely independent second search provider, then make a
  // targeted second pass with the configured provider if only one is present.
  if (primaryProvider === "claude-web-search" && env("XAI_API_KEY")) {
    return discoverGrokQuestions(ctx, questions, "repair");
  }
  if (primaryProvider === "grok" && env("ANTHROPIC_API_KEY")) {
    return discoverBasicFactLeadsDetailed(ctx, {}, questions, "repair");
  }
  if (env("ANTHROPIC_API_KEY")) return discoverBasicFactLeadsDetailed(ctx, {}, questions, "repair");
  if (env("XAI_API_KEY")) return discoverGrokQuestions(ctx, questions, "repair");
  return { provider: "none", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "no repair search provider configured" };
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
  official_identity: /\b(?:official|known as|operated by|developed by|is (?:a|an|the)|project|organization|protocol|foundation|company|person|entrepreneur|investor)\b/i,
  current_role: /\b(?:currently|serves as|works as|is (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|current role)\b/i,
  prior_role: /\b(?:formerly|previously|prior to|served as|was (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|prior role)\b/i,
  education: /\b(?:graduated|degree|studied|attended|education|university|college|school|bachelor|master(?:'s)?|mba|phd|doctorate)\b/i,
  founder: /\b(?:co[- ]?founders?|founders?|co[- ]?founded|founded(?:\s+by)?)\b/i,
  executive: /\b(?:chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|executive|director|head of|lead)\b/i,
  founded: /\b(?:founded|established|formed|incorporated)\b/i,
  launched: /\b(?:launched|went live|debuted|released|introduced)\b/i,
  exit: /\b(?:acquired|acquisition|bought by|sold to|sale of|exited|exit|ipo|public offering|shut down|closed)\b/i,
  track_record: /\b(?:track record|outcome|returned|return|revenue|users?|volume|assets under management|aum|portfolio|built|grew|scaled|founded|invested)\b/i,
  official_token: /\b(?:official token|governance token|native token|utility token|token|ticker|symbol)\b/i,
  public_security: /\b(?:publicly traded|listed (?:on|company)|stock|shares?|equity|debt security|bond|nasdaq|nyse|ticker symbol|initial public offering|ipo)\b/i,
  funding: /\b(?:raised|raises|funding|financing|fundraise|round|capital)\b/i,
  investor: /\b(?:invested|investment|investor|backed|backing|led the round|participated in)\b/i,
  product: /\b(?:product|platform|protocol|service|aggregator|exchange|marketplace|wallet|application|app)\b/i,
  network: /\b(?:blockchain|network|chain|mainnet|built on|deployed on|runs on|(?:on|for)\s+(?:the\s+)?(?:ethereum|solana|polygon|arbitrum|optimism|avalanche|base|bnb(?:\s+chain)?|bitcoin|cosmos|sui|aptos|near|tron|ton|polkadot|cardano))\b/i,
  legal_entity: /\b(?:legal entity|company|corporation|incorporated|foundation|limited|ltd\.?|inc\.?|llc|labs)\b/i,
  legal_regulatory_event: /\b(?:lawsuit|litigation|sued|complaint|settlement|settled|judgment|investigation|enforcement|regulator|regulatory|sec|cftc|doj|ftc|charges?|indictment|dismissed|pending|resolved)\b/i,
  governance: /\b(?:governance|governed|dao|proposal|vote|voting|council|multisig|multi-sig)\b/i,
  control: /\b(?:controls?|ownership|owner|voting power|board seat|director|admin keys?|multisig|multi-sig|signatory|treasury authority)\b/i,
  conflict_of_interest: /\b(?:conflict of interest|related[- ]party|self[- ]dealing|financial interest|disclosed interest|recusal|recused)\b/i,
  tokenomics: /\b(?:tokenomics|token allocation|token distribution|allocation|distribution|emissions?|circulating supply|total supply|max(?:imum)? supply)\b/i,
  vesting: /\b(?:vesting|vested|unlock(?:s|ed|ing)?|cliff|lockup|lock-up|release schedule)\b/i,
  treasury: /\b(?:treasury|reserves?|treasury wallet|treasury report|multisig|multi-sig)\b/i,
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

const REGULATORY_HOSTS = [
  "sec.gov",
  "justice.gov",
  "cftc.gov",
  "ftc.gov",
  "finra.org",
  "fca.org.uk",
  "esma.europa.eu",
] as const;

const regulatorySourceSupports = (host: string, predicate: BasicFactPredicate): boolean =>
  ["legal_regulatory_event", "public_security", "legal_entity"].includes(predicate)
  && sameOfficialDomain(host, REGULATORY_HOSTS);

const exactEntityKey = (value: string): string => looseTokens(value).join(" ");

const attributionScopeFor = (
  attributedEntity: string,
  aliases: readonly string[],
): "direct_subject" | "related_entity" => {
  const attributedKey = exactEntityKey(attributedEntity);
  return attributedKey && aliases.some((alias) => exactEntityKey(alias) === attributedKey)
    ? "direct_subject"
    : "related_entity";
};

function factId(
  subjectKey: string,
  predicate: BasicFactPredicate,
  value: string,
  legalIdentity = "",
): string {
  const normalizedValue = canonicalBasicFactComparisonValue(predicate, searchable(value));
  const identity = `${subjectKey.toLowerCase()}::${predicate}::${normalizedValue}${legalIdentity ? `::${legalIdentity}` : ""}`;
  return `basic_v1_${createHash("sha256").update(identity).digest("hex")}`;
}

/** Promote one lead only when a short passage in the safely fetched artifact
 * independently contains the subject, atomic value, and predicate language. */
export function verifyBasicFactLead(
  lead: BasicFactLead,
  document: PublicTextDocument,
  aliases: readonly string[],
  subjectKey = lead.subject,
  officialHosts: readonly string[] = [],
  officialCounterpartyHosts: readonly string[] = [],
): BasicFact | null {
  const page = documentText(document);
  if (!isAtomicValue(lead.predicate, lead.value)) return null;
  if (lead.predicate === "legal_regulatory_event" && (!lead.eventStatus || !lead.attributedEntity)) return null;
  const excerpt = supportingSourcePassage(page, lead, aliases);
  if (!excerpt) return null;
  const official = sameOfficialDomain(document.host, officialHosts);
  const counterpartyPredicate = new Set<BasicFactPredicate>([
    "current_role", "prior_role", "founder", "executive", "founded", "product",
    "exit", "track_record", "funding", "investor", "legal_entity", "governance",
  ]).has(lead.predicate);
  const officialCounterparty = !official
    && counterpartyPredicate
    && sameOfficialDomain(document.host, officialCounterpartyHosts);
  const regulatory = !official && !officialCounterparty
    && regulatorySourceSupports(document.host, lead.predicate);
  const supportedQualifier = lead.qualifier && looseContainsPhrase(excerpt, lead.qualifier)
    ? lead.qualifier
    : undefined;
  const supportedEventStatus = lead.eventStatus && looseContainsPhrase(excerpt, lead.eventStatus)
    ? lead.eventStatus
    : undefined;
  const supportedAttributedEntity = lead.attributedEntity && looseContainsPhrase(excerpt, lead.attributedEntity)
    ? lead.attributedEntity
    : undefined;
  if (lead.predicate === "legal_regulatory_event" && (!supportedEventStatus || !supportedAttributedEntity)) return null;
  const attributionScope = supportedAttributedEntity
    ? attributionScopeFor(supportedAttributedEntity, aliases)
    : undefined;
  const legalIdentity = lead.predicate === "legal_regulatory_event"
    ? `${searchable(supportedAttributedEntity!)}::${searchable(supportedEventStatus!)}`
    : "";
  return {
    factId: factId(subjectKey, lead.predicate, lead.value, legalIdentity),
    subjectKey,
    predicate: lead.predicate,
    value: lead.value,
    normalizedValue: canonicalBasicFactComparisonValue(lead.predicate, searchable(lead.value)),
    status: official || officialCounterparty || regulatory ? "verified" : "lead",
    critical: CRITICAL_PREDICATES.has(lead.predicate),
    sources: [{
      url: document.url,
      ...(lead.sourceTitle ? { title: lead.sourceTitle } : {}),
      sourceClass: official
        ? "official_subject"
        : officialCounterparty
          ? "official_counterparty"
          : regulatory
            ? "regulatory_or_onchain"
            : "independent_press",
      relation: "supports",
      excerpt,
      contentHash: document.contentHash,
      capturedAt: document.capturedAt,
      provider: "public-web",
      artifactVerified: true,
    }],
    ...(supportedQualifier ? { qualifier: supportedQualifier } : {}),
    ...(lead.questionId ? { questionId: lead.questionId } : {}),
    ...(supportedEventStatus ? { eventStatus: supportedEventStatus } : {}),
    ...(supportedAttributedEntity ? { attributedEntity: supportedAttributedEntity } : {}),
    ...(attributionScope ? { attributionScope } : {}),
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
    discoveryProvider: lead.provider,
  };
}

const MULTI_VALUE_PREDICATES = new Set<BasicFactPredicate>([
  "current_role", "prior_role", "education", "founder", "executive", "founded",
  "launched", "exit", "track_record", "product", "funding", "investor", "governance",
  "public_security", "legal_entity", "legal_regulatory_event", "control", "conflict_of_interest",
  "tokenomics", "vesting", "treasury",
  "audit", "repository", "traction",
]);

function resolveBasicFactCandidates(candidates: BasicFact[]): BasicFact[] {
  const grouped = new Map<string, BasicFact[]>();
  for (const candidate of candidates) {
    const legalIdentity = candidate.predicate === "legal_regulatory_event"
      ? `::${searchable(candidate.attributedEntity ?? "")}::${searchable(candidate.eventStatus ?? "")}`
      : "";
    const key = `${candidate.predicate}::${candidate.normalizedValue}${legalIdentity}`;
    const rows = grouped.get(key) ?? [];
    rows.push(candidate);
    grouped.set(key, rows);
  }
  const resolved: BasicFact[] = [...grouped.values()].flatMap((rows): BasicFact[] => {
    const sources = [...new Map(rows.flatMap((row) => row.sources).map((source) => [source.url, source])).values()];
    const official = sources.some((source) =>
      source.sourceClass === "official_subject"
      || source.sourceClass === "official_counterparty"
      || source.sourceClass === "regulatory_or_onchain");
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

  // Two exact sources can describe the same attributed event at different
  // procedural stages. Without a source publication-date ordering guarantee,
  // neither status governs: retain both facts and mark the event conflicted.
  const legalEvents = new Map<string, BasicFact[]>();
  for (const fact of resolved.filter((candidate) => candidate.predicate === "legal_regulatory_event")) {
    const key = `${fact.normalizedValue}::${searchable(fact.attributedEntity ?? "")}`;
    legalEvents.set(key, [...(legalEvents.get(key) ?? []), fact]);
  }
  for (const rows of legalEvents.values()) {
    const statuses = new Set(rows.map((fact) => searchable(fact.eventStatus ?? "")).filter(Boolean));
    if (statuses.size > 1) rows.forEach((fact) => { fact.status = "conflicted"; });
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
  officialCounterpartyHosts: readonly string[] = [],
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
    try {
      const host = new URL(sourceUrl).hostname;
      official = sameOfficialDomain(host, officialHosts) || sameOfficialDomain(host, officialCounterpartyHosts);
    } catch { /* already sanitized */ }
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

function normalizeDiscoveryOutput(
  output: BasicFactLead[] | BasicFactsDiscoveryResult | null,
): BasicFactsDiscoveryResult {
  if (output && !Array.isArray(output)) return { ...output, leads: selectBasicFactLeads(output.leads) };
  if (output === null) {
    return { provider: "test", state: "failed", leads: [], attempts: 1, completedBatches: 0, failedBatches: 1 };
  }
  const leads = selectBasicFactLeads(output);
  return {
    provider: "test",
    state: leads.length ? "succeeded" : "completed_empty",
    leads,
    attempts: 1,
    completedBatches: 1,
    failedBatches: 0,
  };
}

function mergeLeads(
  primary: readonly BasicFactLead[],
  repair: readonly BasicFactLead[],
): BasicFactLead[] {
  const seen = new Set<string>();
  const merged = [...repair, ...primary].filter((lead) => {
    const key = `${lead.predicate}::${searchable(lead.value)}::${lead.sourceUrl}::${searchable(lead.excerpt)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // Repair answers target still-open decision gaps, so they receive first
  // priority if the combined model response exceeds the bounded lead budget.
  return selectBasicFactLeads(merged);
}

function verifiedCounterpartyHosts(ctx: CollectContext): string[] {
  return [...new Set(ctx.evidence.ventures.flatMap((venture): string[] => {
    if (
      venture.artifact_verified !== true
      || venture.evidence_origin === "model_lead"
      || !venture.domain?.trim()
    ) return [];
    const candidate = venture.domain.includes("://") ? venture.domain : `https://${venture.domain}`;
    const safe = safeCandidateUrl(candidate);
    if (!safe) return [];
    try { return [new URL(safe).hostname]; } catch { return []; }
  }))];
}

function deterministicQuestionAnswerRefs(
  ctx: CollectContext,
  question: BasicFactsResearchQuestion,
  facts: readonly BasicFact[],
): string[] {
  const refs = facts
    .filter((fact) =>
      (fact.status === "verified" || fact.status === "corroborated")
      && (fact.questionId === question.id || fact.predicate === question.predicate)
      && !(
        question.audience === "person"
        && fact.predicate === "legal_regulatory_event"
        && fact.attributionScope !== "direct_subject"
      ))
    .map((fact) => fact.factId);
  const add = (ref: string) => { if (!refs.includes(ref)) refs.push(ref); };

  if (
    question.predicate === "official_identity"
    && ctx.evidence.profile.profile_collection_state === "resolved"
    && (ctx.evidence.profile.resolved_name?.trim() || ctx.evidence.profile.display_name.trim())
  ) add(`profile:${ctx.evidence.profile.profile_provider ?? "provider"}:${ctx.handle.toLowerCase()}`);
  if (question.predicate === "official_token" && ctx.evidence.projectToken?.verified) {
    add(`project-token:${ctx.evidence.projectToken.coingeckoId}`);
  }

  const verifiedTeam = (ctx.evidence.webTeam ?? []).filter((member) =>
    member.artifact_verified === true && member.evidence_origin !== "model_lead");
  if (question.audience === "project" && question.predicate === "founder") {
    verifiedTeam.filter((member) => /\b(?:co[- ]?)?founder\b/i.test(member.role))
      .forEach((member) => add(`team:${personKey(member.name)}:founder`));
  }
  if (question.audience === "project" && question.predicate === "executive") {
    verifiedTeam.filter((member) => PREDICATE_PATTERNS.executive.test(member.role))
      .forEach((member) => add(`team:${personKey(member.name)}:executive`));
  }

  const ventures = ctx.evidence.ventures.filter((venture) =>
    venture.artifact_verified === true && venture.evidence_origin !== "model_lead");
  if (question.predicate === "current_role") {
    ventures.filter((venture) =>
      venture.outcome === "Active" && /\b(?:present|current|now|ongoing)\b/i.test(venture.period))
      .forEach((venture) => add(`venture:${searchable(venture.project_name)}:current_role`));
  }
  if (question.predicate === "founder") {
    ventures.filter((venture) => /\b(?:co[- ]?)?founder\b/i.test(venture.role))
      .forEach((venture) => add(`venture:${searchable(venture.project_name)}:founder`));
  }
  if (question.predicate === "investor") {
    ventures.filter((venture) => /\b(?:investor|partner|principal|venture|capital|\bgp\b)\b/i.test(venture.role))
      .forEach((venture) => add(`venture:${searchable(venture.project_name)}:investor`));
  }
  if (question.predicate === "track_record") {
    ventures.filter((venture) => [
      "IPO", "Acquisition", "Acquihire", "OrderlyWindDown", "Failure",
      "SilentShutdown", "Rug", "Exploit",
    ].includes(String(venture.outcome)))
      .forEach((venture) => add(`venture:${searchable(venture.project_name)}:${searchable(String(venture.outcome))}`));
  }
  if (question.predicate === "exit") {
    ventures.filter((venture) => ["IPO", "Acquisition", "Acquihire"].includes(String(venture.outcome)))
      .forEach((venture) => add(`venture:${searchable(venture.project_name)}:${searchable(String(venture.outcome))}`));
  }
  return refs;
}

function questionLedger(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
  facts: readonly BasicFact[],
  primary: BasicFactsDiscoveryResult,
  repair: BasicFactsDiscoveryResult,
  repairQuestionIds: ReadonlySet<string>,
): BasicFactQuestionLedgerEntry[] {
  return questions.map((question) => {
    const answerRefs = deterministicQuestionAnswerRefs(ctx, question, facts);
    const providerRuns: BasicFactQuestionLedgerEntry["providerRuns"] = [{
      phase: "primary",
      provider: primary.provider,
      state: primary.batchStates?.[question.batch] ?? primary.state,
    }];
    if (repairQuestionIds.has(question.id)) {
      providerRuns.push({
        phase: "repair",
        provider: repair.provider,
        state: repair.batchStates?.[question.batch] ?? repair.batchStates?.repair ?? repair.state,
      });
    }
    return {
      questionId: question.id,
      audience: question.audience,
      batch: question.batch,
      predicate: question.predicate,
      question: question.question,
      critical: question.critical,
      status: answerRefs.length ? "answered" : "unanswered",
      answerRefs,
      providerRuns,
    };
  });
}

/** Discover role-aware basic facts, verify sources, then repair only critical gaps. */
export async function collectBasicFacts(
  ctx: CollectContext,
  dependencies: BasicFactsCollectorDependencies = {},
): Promise<AdapterRunResult> {
  const questions = basicFactsResearchQuestions(ctx);
  const discover = dependencies.discover ?? discoverPrimary;
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

  const primary = normalizeDiscoveryOutput(await discover(ctx, questions));
  const primaryLeads = selectBasicFactLeads(primary.leads);
  ctx.evidence.basicFactLeads = primaryLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = [];

  const aliases = subjectAliases(ctx);
  const officialHosts = [ctx.evidence.profile.website]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try { return [new URL(value).hostname]; } catch { return []; }
    });
  const officialCounterpartyHosts = verifiedCounterpartyHosts(ctx);
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

  const verifyLeads = async (leads: readonly BasicFactLead[], sourceLimit: number): Promise<BasicFact[]> => {
    const variants = verificationLeadVariants(ctx, leads, officialHosts, officialCounterpartyHosts);
    // Give every selected lead one verification attempt before spending the
    // remaining budget on corroboration, so early multi-source rosters cannot
    // starve later decision-critical categories.
    const primarySources = leads.flatMap((lead): string[] => {
      const sourceUrl = safeCandidateUrl(lead.sourceUrl);
      return sourceUrl ? [sourceUrl] : [];
    });
    const allowedSources = new Set([...new Set([
      ...primarySources,
      ...variants.map(({ lead }) => lead.sourceUrl),
    ])].slice(0, sourceLimit));
    return (await Promise.all(variants
      .filter(({ lead }) => allowedSources.has(lead.sourceUrl))
      .map(async ({ lead }) => {
        const result = await fetchOnce(lead.sourceUrl);
        return result.status === "ok"
          ? verifyBasicFactLead(lead, result, aliases, ctx.handle, officialHosts, officialCounterpartyHosts)
          : null;
      })))
      .filter((fact): fact is BasicFact => fact !== null);
  };

  const primaryVerified = await verifyLeads(primaryLeads, MAX_SOURCES);
  const primaryFacts = resolveBasicFactCandidates(primaryVerified);
  const missingCritical = questions.filter((question) =>
    question.critical && deterministicQuestionAnswerRefs(ctx, question, primaryFacts).length === 0);
  let repair: BasicFactsDiscoveryResult = {
    provider: "none",
    state: "skipped",
    leads: [],
    attempts: 0,
    completedBatches: 0,
    failedBatches: 0,
    detail: missingCritical.length ? "repair provider not configured" : "no critical gaps",
  };
  if (missingCritical.length && (dependencies.repair || !dependencies.discover)) {
    const output = dependencies.repair
      ? await dependencies.repair(ctx, missingCritical)
      : await discoverRepair(ctx, missingCritical, primary.provider);
    repair = normalizeDiscoveryOutput(output);
  }
  const repairLeads = selectBasicFactLeads(repair.leads);
  const repairVerified = await verifyLeads(repairLeads, Math.min(12, MAX_SOURCES));
  const allLeads = mergeLeads(primaryLeads, repairLeads);
  const verified = [...primaryVerified, ...repairVerified];
  ctx.evidence.basicFactLeads = allLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = resolveBasicFactCandidates(verified);
  const repairQuestionIds = new Set(missingCritical.map((question) => question.id));
  ctx.evidence.basicFactQuestionLedger = questionLedger(
    ctx,
    questions,
    ctx.evidence.basicFacts,
    primary,
    repair,
    repairQuestionIds,
  );

  const sourceVerifiedLeadCount = new Set(verified.map((fact) =>
    `${fact.predicate}::${fact.normalizedValue}`)).size;
  const unansweredCritical = ctx.evidence.basicFactQuestionLedger
    .filter((entry) => entry.critical && entry.status === "unanswered").length;
  ctx.emit({
    phase: "P0 · Intake",
    label: ctx.evidence.basicFacts.length ? "Basic facts verified" : "Basic facts need review",
    detail: `${sourceVerifiedLeadCount}/${allLeads.length} leads matched subject, value, and predicate language in fetched source text; ${ctx.evidence.basicFacts.length} met the first-party or two-source publication threshold; ${unansweredCritical} critical question${unansweredCritical === 1 ? "" : "s"} remain open.`,
    source: "public-web",
    tone: ctx.evidence.basicFacts.length ? "good" : "warn",
  });
  const attempts = primary.attempts + repair.attempts;
  const providerDetail = `primary ${primary.provider}:${primary.state}; repair ${repair.provider}:${repair.state}`;
  if (!allLeads.length) {
    const completedEmpty = primary.state === "completed_empty"
      && (repair.state === "completed_empty" || repair.state === "skipped");
    if (completedEmpty) {
      return {
        state: "partial",
        detail: `search completed with no source-linked basic-fact candidates · ${providerDetail}`,
        attempts,
        ...(researchAudience(ctx) === "project" ? { explicitEmptyChecks: ["project-transparency"] as const } : {}),
      };
    }
    return {
      state: primary.state === "failed" && ["failed", "skipped"].includes(repair.state) ? "failed" : "partial",
      detail: `basic-facts discovery produced no usable leads · ${providerDetail}`,
      attempts,
    };
  }
  return ctx.evidence.basicFacts.length
    ? { state: "executed", detail: `${ctx.evidence.basicFacts.length} verified · ${allLeads.length} leads · ${unansweredCritical} critical gaps · ${providerDetail}`, attempts }
    : { state: "partial", detail: `${allLeads.length} leads · 0 passed source verification · ${unansweredCritical} critical gaps · ${providerDetail}`, attempts };
}

export const basicFactsAdapter: Adapter = {
  id: "basic-facts",
  label: "Basic facts research",
  available: () => Boolean(env("ANTHROPIC_API_KEY") || env("XAI_API_KEY")),
  run: collectBasicFacts,
};
