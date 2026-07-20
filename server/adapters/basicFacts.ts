import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  canonicalBasicFactComparisonValue,
  type BasicFact,
  type BasicFactLead,
  type BasicFactPredicate,
  type BasicFactQuestionLedgerEntry,
} from "../../src/data/evidence";
import { supportsExplicitEmptyBasicFact } from "../../src/lib/basicFactQuestions";
import { DISCOVERY_MODEL, env } from "../config";
import { cacheGet, cacheSet } from "../cache";
import { addClaudeUsage, recordCall } from "../cost";
import { fetchPublicTextWithRecovery, type PublicTextDocument, type PublicTextResult } from "../publicWeb";
import { grokSearch } from "./x";
import type { Adapter, AdapterRunResult, CollectContext } from "./types";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const PRIMARY_SEARCH_USES_PER_BATCH = 2;
const REPAIR_SEARCH_USES = 2;
const DISCOVERY_BATCH_CONCURRENCY = 3;
const DISCOVERY_RETRY_DELAY_MS = 350;
const MAX_LEADS = 28;
const MAX_SOURCES = 32;
const MAX_REPAIR_QUESTIONS = 8;
const MAX_REPAIR_PROVIDER_CALLS = 8;
const DISCOVERY_TIMEOUT_MS = 50_000;
const RESEARCH_CACHE_VERSION = "v7";
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
  "track_record", "official_token", "public_security",
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

type DiscoveryProvider = Extract<BasicFactLead["provider"], "claude-web-search" | "grok">;
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
  /**
   * State from a search invocation that targeted exactly one question. A
   * batch-level empty response can never populate this map because one blank
   * multi-question answer does not prove that each question was searched.
   */
  questionStates?: Partial<Record<string, BasicFactsDiscoveryState>>;
  /** Provider override for a question-specific invocation in a mixed repair. */
  questionProviders?: Partial<Record<string, DiscoveryProvider | "none" | "test">>;
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
  { batch: "structure_risk", predicate: "official_token", question: "Which crypto token is officially tied to a venture this person controls, if any? Do not report public-company stock here.", critical: true },
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded equity or debt security is tied to a company this person controls, if any? Do not report a crypto token here.", critical: true },
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
  { batch: "structure_risk", predicate: "public_security", question: "Which publicly traded security is directly relevant to this investor or controlled company, if any?", critical: true },
  { batch: "structure_risk", predicate: "official_token", question: "Which official crypto token is directly tied to a venture this investor controls, if any? Do not treat a stock ticker as a token.", critical: true },
  { batch: "structure_risk", predicate: "legal_entity", question: "Which legal entity employs the investor or manages the disclosed fund?" },
  { batch: "structure_risk", predicate: "legal_regulatory_event", question: "What material legal or regulatory events explicitly name this investor or their firm, with exact attribution and current stated status?" },
  { batch: "structure_risk", predicate: "governance", question: "What formal board, governance, or voting roles are documented?" },
  { batch: "structure_risk", predicate: "control", question: "What ownership, board, voting, or investment-committee control is explicitly documented?" },
  { batch: "structure_risk", predicate: "conflict_of_interest", question: "What explicit related-party arrangements or conflicts of interest are disclosed?" },
];

const FOUNDER_REPAIR_PREDICATES = new Set<BasicFactPredicate>(
  PERSON_QUESTIONS.map((question) => question.predicate),
);

const REPAIR_PRIORITY: Record<BasicFactsResearchAudience, readonly BasicFactPredicate[]> = {
  person: [
    "official_identity", "current_role", "founder", "product",
    "control", "legal_regulatory_event", "official_token", "public_security",
    "track_record", "executive", "governance", "conflict_of_interest",
    "founded", "exit", "prior_role", "education",
  ],
  project: [
    "official_identity", "founder", "executive", "product",
    "official_token", "traction", "audit", "legal_entity",
    "network", "launched", "funding", "repository", "governance",
  ],
  investor: [
    "official_identity", "current_role", "investor", "track_record",
    "founder", "control", "public_security", "official_token",
    "product", "legal_regulatory_event", "funding", "governance",
  ],
};

/** Keep production repair within a fixed call budget while covering each
 * decision domain before lower-value biography enrichment. */
function boundedRepairQuestions(
  questions: readonly BasicFactsResearchQuestion[],
): BasicFactsResearchQuestion[] {
  if (questions.length <= MAX_REPAIR_QUESTIONS) return questions.slice();
  const audience = questions[0]?.audience ?? "person";
  const priorities = REPAIR_PRIORITY[audience];
  const rank = new Map(priorities.map((predicate, index) => [predicate, index]));
  return questions
    .map((question, index) => ({ question, index }))
    .sort((left, right) =>
      (rank.get(left.question.predicate) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(right.question.predicate) ?? Number.MAX_SAFE_INTEGER)
      || left.index - right.index)
    .slice(0, MAX_REPAIR_QUESTIONS)
    .map(({ question }) => question);
}
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

/**
 * Search models often return a useful atomic value in a presentation-friendly
 * order that differs from the source. For example, a source title may say
 * "Coinbase ... Co-Founder and CEO Brian Armstrong" while the model returns
 * "Co-Founder and CEO, Coinbase". Requiring that entire value as one phrase
 * rejects the source even though the same short passage states every material
 * component of the relationship.
 *
 * This fallback stays deliberately bounded. It is available only for
 * predicates whose values have a stable structure, it still requires the
 * subject and predicate in the same short passage, every numeric component
 * must match, and an organization/product anchor must survive the match.
 * Legal-event values remain exact because attribution and procedural status
 * cannot safely be reconstructed from token overlap.
 */
const STRUCTURED_VALUE_PREDICATES = new Set<BasicFactPredicate>([
  "current_role",
  "prior_role",
  "founder",
  "executive",
  "founded",
  "product",
  "exit",
  "track_record",
  "public_security",
]);

const VALUE_STOP_TOKENS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "inc", "into",
  "of", "on", "or", "our", "the", "their", "to", "with",
]);

const ROLE_DESCRIPTOR_TOKENS = new Set([
  "adviser", "advisor", "board", "chair", "chief", "co", "director", "engineer", "executive", "founder",
  "head", "investor", "lead", "manager", "member", "officer", "partner", "president", "principal", "software",
  "ceo", "cfo", "coo", "cto",
]);

const VALUE_DESCRIPTOR_TOKENS: Partial<Record<BasicFactPredicate, ReadonlySet<string>>> = {
  current_role: ROLE_DESCRIPTOR_TOKENS,
  prior_role: ROLE_DESCRIPTOR_TOKENS,
  founder: new Set(["co", "founder"]),
  executive: ROLE_DESCRIPTOR_TOKENS,
  founded: new Set(["co", "established", "formed", "founded", "incorporated"]),
  product: new Set([
    "app", "application", "crypto", "exchange", "marketplace", "platform", "product",
    "protocol", "service", "wallet",
  ]),
  exit: new Set([
    "acquired", "acquisition", "direct", "exit", "ipo", "listing", "nasdaq", "nyse",
    "offering", "public", "sale", "sold",
  ]),
  track_record: new Set([
    "adoption", "aum", "billion", "customer", "download", "fee", "million", "revenue",
    "transaction", "tvl", "user", "volume",
  ]),
  public_security: new Set([
    "bond", "class", "common", "debt", "equity", "ipo", "listed", "nasdaq", "nyse",
    "public", "security", "ticker", "traded",
  ]),
};

const TICKER_EXCLUSIONS = new Set([
  "CEO", "CFO", "COO", "CTO", "INC", "IPO", "LLC", "LTD", "NASDAQ", "NYSE",
]);
const PUBLIC_SECURITY_CORPORATE_MODIFIERS = new Set([
  "company", "corp", "corporation", "global", "group", "holding", "holdings",
]);
const HOST_CONTEXT_STOP_TOKENS = new Set([
  "about", "blog", "co", "com", "docs", "io", "investor", "investors", "ir", "net",
  "news", "org", "press", "relations", "www",
]);

function canonicalValueTokens(value: string): string[] {
  const canonical = value
    .replace(/\bco[-\s]?founders?\b/gi, " founder ")
    .replace(/\bchief executive officer\b/gi, " ceo ")
    .replace(/\bchief financial officer\b/gi, " cfo ")
    .replace(/\bchief operating officer\b/gi, " coo ")
    .replace(/\bchief technology officer\b/gi, " cto ")
    .replace(/\bchair(?:man|woman|person)\b/gi, " chair ")
    .replace(/\bcryptocurrenc(?:y|ies)\b/gi, " crypto ")
    .replace(/\binitial public offering\b/gi, " ipo ")
    .replace(/\b(?:shares?|stocks?)\b/gi, " equity ")
    .replace(/\bassets under management\b/gi, " aum ")
    .replace(/\btotal value locked\b/gi, " tvl ")
    .replace(/\bcustomers?\b/gi, " customer ")
    .replace(/\busers?\b/gi, " user ")
    .replace(/\bfees?\b/gi, " fee ")
    .replace(/\btransactions?\b/gi, " transaction ")
    .replace(/\bdownloads?\b/gi, " download ");
  return [...new Set(looseTokens(canonical).filter((token) => !VALUE_STOP_TOKENS.has(token)))];
}

function primaryTickerCandidate(value: string): string | null {
  const leading = value.match(/^\s*\$?([A-Z][A-Z0-9.-]{1,7})(?=$|[^A-Z0-9])/)?.[1];
  if (leading && !TICKER_EXCLUSIONS.has(leading)) return leading;
  const exchangeLabeled = value.match(/\b(?:NASDAQ|NYSE)\s*:\s*\$?([A-Z][A-Z0-9.-]{1,7})\b/i)?.[1]?.toUpperCase();
  if (exchangeLabeled && !TICKER_EXCLUSIONS.has(exchangeLabeled)) return exchangeLabeled;
  const labeled = value.match(/\b(?:ticker|symbol)\s*[:=]?\s*\$?([A-Z][A-Z0-9.-]{1,7})\b/i)?.[1]?.toUpperCase();
  return labeled && !TICKER_EXCLUSIONS.has(labeled) ? labeled : null;
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A capitalized token is not a ticker merely because it appears near stock
 * copy. Require the fetched sentence to label it as a ticker/symbol, attach it
 * to an exchange notation, or present it in the common issuer `(TICKER)` form. */
function tickerIsExplicitlyIdentified(passage: string, ticker: string): boolean {
  const symbol = escapedPattern(ticker);
  return [
    new RegExp(`\\b(?:ticker|symbol)(?:\\s+symbol)?\\s*(?:is|:|=)?\\s*\\$?${symbol}\\b`, "i"),
    new RegExp(`\\bunder\\s+(?:the\\s+)?(?:ticker(?:\\s+symbol)?\\s+)?\\$?${symbol}\\b`, "i"),
    new RegExp(`\\b(?:nasdaq|nyse)\\s*[:(]\\s*\\$?${symbol}\\b`, "i"),
    new RegExp(`\\(\\s*\\$?${symbol}\\s*\\)\\s+(?:is\\s+)?(?:listed|traded|stock|shares?)\\b`, "i"),
    new RegExp(`\\b(?:stock|shares?)\\s+(?:ticker|symbol)\\s*[:=]?\\s*\\$?${symbol}\\b`, "i"),
  ].some((pattern) => pattern.test(passage));
}

function structuredValueIsSupported(
  passage: string,
  lead: BasicFactLead,
  trustedContextTokens: ReadonlySet<string> = new Set(),
): boolean {
  if (!STRUCTURED_VALUE_PREDICATES.has(lead.predicate)) return false;
  const valueTokens = canonicalValueTokens(lead.value);
  if (!valueTokens.length) return false;
  const passageTokens = new Set(canonicalValueTokens(passage));

  // Quantitative outcomes and dated events are useful only when the fetched
  // passage states the exact numbers the model proposed.
  const numericTokens = valueTokens.filter((token) => /^\d/.test(token));
  if (numericTokens.some((token) => !passageTokens.has(token))) return false;

  if (lead.predicate === "track_record") {
    const metricTokens = new Set([
      "adoption", "aum", "customer", "download", "fee", "revenue", "transaction",
      "tvl", "user", "volume",
    ]);
    const claimedMetrics = valueTokens.filter((token) => metricTokens.has(token));
    if (claimedMetrics.length && !claimedMetrics.some((token) => passageTokens.has(token))) return false;
  }

  const descriptors = VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? new Set<string>();
  const anchors = valueTokens.filter((token) =>
    !descriptors.has(token) && !/^\d/.test(token));
  const anchorIsPresent = (token: string): boolean =>
    passageTokens.has(token) || trustedContextTokens.has(token);

  if (lead.predicate === "public_security") {
    const ticker = primaryTickerCandidate(lead.value);
    if (ticker && !tickerIsExplicitlyIdentified(passage, ticker)) return false;
    if (/\bnasdaq\b/i.test(lead.value) && !/\bnasdaq\b/i.test(passage)) return false;
    if (/\bnyse\b/i.test(lead.value) && !/\bnyse\b/i.test(passage)) return false;
    const nonTickerAnchors = anchors.filter((token) =>
      ticker?.toLowerCase() !== token
      && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token));
    if (nonTickerAnchors.length) {
      if (!nonTickerAnchors.some(anchorIsPresent)) return false;
    }
    // A ticker plus issuer anchor is the structured value. Predicate matching
    // separately requires explicit stock/listing/security language.
    if (ticker) return true;
  }

  if (anchors.length && !anchors.some(anchorIsPresent)) return false;
  const matched = valueTokens.filter((token) =>
    passageTokens.has(token) || (anchors.includes(token) && trustedContextTokens.has(token))).length;
  const required = valueTokens.length <= 3
    ? valueTokens.length
    : Math.ceil(valueTokens.length * 0.7);
  return matched >= required;
}

function trustedHostContextTokens(host: string): ReadonlySet<string> {
  return new Set(canonicalValueTokens(host.replace(/\./g, " "))
    .filter((token) => !HOST_CONTEXT_STOP_TOKENS.has(token)));
}

const MATERIAL_SECURITY_CLAIMS = [
  /\bclass\s+[a-z0-9]+\b/i,
  /\bcommon stock\b/i,
  /\bpreferred stock\b/i,
  /\bconvertible (?:note|debt|bond)\b/i,
  /\bsenior (?:secured |unsecured )?(?:debt|bond|note)\b/i,
  /\bsubordinated (?:debt|bond|note)\b/i,
  /\bsecured (?:debt|bond|note)\b/i,
] as const;

function originalValueToken(value: string, token: string): string | null {
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (looseTokens(match[0])[0] === token) return match[0];
  }
  return null;
}

/**
 * Never freeze a model's unsupported share/debt class. When the passage proves
 * only issuer, ticker, venue, and public listing, publish exactly that narrower
 * classification instead of preserving "Class A common stock" from the lead.
 */
function verifiedPublicSecurityValue(value: string, passage: string): string | null {
  const ticker = primaryTickerCandidate(value);
  if (!ticker || !tickerIsExplicitlyIdentified(passage, ticker)) return null;
  if (/\bnasdaq\b/i.test(value) && !/\bnasdaq\b/i.test(passage)) return null;
  if (/\bnyse\b/i.test(value) && !/\bnyse\b/i.test(passage)) return null;
  const descriptorTokens = VALUE_DESCRIPTOR_TOKENS.public_security ?? new Set<string>();
  const anchors = canonicalValueTokens(value).filter((token) =>
    !descriptorTokens.has(token)
    && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token)
    && !/^\d/.test(token)
    && token !== ticker.toLowerCase());
  const issuerToken = anchors.find((token) => looseContainsPhrase(passage, token));
  if (!issuerToken) return null;
  const issuer = originalValueToken(value, issuerToken);
  if (!issuer) return null;
  const venue = /\bnasdaq\b/i.test(passage)
    ? "NASDAQ"
    : /\bnyse\b/i.test(passage)
      ? "NYSE"
      : null;
  const supportedClass = MATERIAL_SECURITY_CLAIMS
    .map((pattern) => pattern.exec(value)?.[0])
    .find((claim) => claim && looseContainsPhrase(passage, claim));
  return `${ticker} (${issuer}, ${venue ? `${venue}-listed` : "publicly traded"} ${supportedClass ?? "security"})`;
}

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

/** Preserve the raw answer shape separately from filtered lead parsing. */
function rawBasicFactCount(text: string): number | null {
  const payload = parsePayload(text);
  return payload && Array.isArray(payload.facts) ? payload.facts.length : null;
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

function atomicPersonVentureValue(value: string): string | null {
  const candidate = normalize(value);
  if (
    !candidate
    || candidate.length > 120
    || /[()[\]{}/|;]/.test(candidate)
    || /\b(?:also known as|formerly|originally|previously|rebrand(?:ed)?|aka)\b/i.test(candidate)
    || /\b(?:co[- ]?)?founder\s+(?:of|at)\b/i.test(candidate)
    || /\s(?:and|&)\s/i.test(candidate)
  ) return null;
  const tokens = looseTokens(candidate);
  return tokens.length >= 1 && tokens.length <= 8 ? candidate : null;
}

/**
 * Web-search models sometimes answer an asset question with a symbol followed
 * by a prose description, for example `cbBTC (Coinbase Wrapped BTC) · ERC20
 * token ...`. The description is useful as a discovery hint, but treating the
 * entire string as the asset identity makes exact source verification
 * impossible. Reduce only unmistakably delimited symbol shapes; ordinary
 * multi-word token names remain untouched and still have to verify normally.
 */
function canonicalOfficialTokenLeadValue(value: string): string {
  const normalized = normalize(value);
  const symbol = "\\$?[A-Za-z][A-Za-z0-9.-]{1,15}";
  const leading = new RegExp(`^(${symbol})\\s*\\([^)]{2,100}\\)\\s*(?:[·:\\u2013\\u2014]|\\s-\\s|$)`).exec(normalized)?.[1];
  if (leading) return leading;
  const delimited = new RegExp(`^(${symbol})\\s*(?:[·:\\u2013\\u2014]|\\s-\\s)\\s+\\S`).exec(normalized)?.[1];
  if (delimited) return delimited;
  const named = new RegExp(`^[^();]{2,100}\\(\\s*(${symbol})\\s*\\)\\s*(?:[·:\\u2013\\u2014]|\\s-\\s|$)`).exec(normalized)?.[1];
  return named ?? normalized;
}

/**
 * Web-search models answer with the atomic fact plus composed context:
 * "Ethereum (conceived 2013, network launched 30 July 2015)" or "The Merge
 * \u2014 Ethereum's transition from Proof-of-Work". That trailing context is useful
 * discovery colour, but as part of the VALUE it is doubly destructive: the
 * string cannot be located verbatim in fetched source text, and because every
 * source gets its own composed phrasing, two sources stating the same fact
 * never collapse onto one fact key and can never meet the two-source
 * publication threshold. Reduce the value to its locatable core and keep the
 * remainder as qualifier context. Conservative by construction: only a trailing
 * parenthetical, or a trailing dash clause that is plainly a description rather
 * than part of a name, is removed.
 */
function canonicalLeadValueCore(value: string): { value: string; trailing?: string } {
  const normalized = normalize(value);
  // Refuse to strip anything that changes what the value MEANS. A rename
  // ("Aave (originally ETHLend)") means the model merged two entities and the
  // atomic-venture guard must still see it whole. A denial, dispute, hedge, or
  // attribution shift ("Ethereum (he was not a founder; disputed)", "SEC fraud
  // charges (against Terraform Labs, not him personally)") is the opposite of
  // the claim: stripping it would turn a denial into an assertion.
  const MEANING_BEARING = /\b(?:also known as|formerly|originally|previously|rebrand(?:ed)?|aka|f\.?k\.?a\.?|not|never|no longer|denies|denied|disputed|contested|alleged(?:ly)?|unproven|unconfirmed|rumou?red|purported(?:ly)?|claimed|proposed|planned|abandoned|withdrawn|parody|fake|impersonat\w*|different|unrelated|another|against|until|but|however|pleaded|charged|indicted)\b/i;
  if (MEANING_BEARING.test(normalized)) return { value: normalized };
  // Only a trailing parenthetical is reduced. A dash clause is left alone: in a
  // role value ("CEO \u2014 Binance") the text after the dash is the organization,
  // which is the part that makes the role verifiable at all.
  const parenthetical = /^(.*?[^\s(])\s*\(([^()]{2,160})\)$/.exec(normalized);
  if (parenthetical) {
    const base = parenthetical[1].trim();
    if (base.length >= 2 && /[a-z0-9]/i.test(base)) {
      return { value: base, trailing: parenthetical[2].trim() };
    }
  }
  return { value: normalized };
}

/**
 * Hosted search sometimes puts a role after the requested full name. Strip
 * only an unmistakable, delimited role suffix. The fetched source still has
 * to prove the resulting name, so this turns model formatting into a lead and
 * never into identity evidence by itself.
 */
function canonicalOfficialIdentityLeadValue(value: string): string | null {
  const normalized = normalize(value);
  if (/\b(?:alleged|claimed|purported|self[- ]?described|unconfirmed|unverified)\b/i.test(normalized)) return null;
  const nameToken = "[\\p{L}\\p{M}][\\p{L}\\p{M}'’.-]*";
  const role = "(?:co[- ]?)?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|chair(?:man|woman|person)?|partner|principal|entrepreneur|investor";
  const match = new RegExp(
    `^(${nameToken}(?:\\s+${nameToken}){1,5})\\s*(?:,\\s*|:\\s*|[\\u2013\\u2014]\\s*|\\s-\\s+|\\(\\s*)(?=${role}\\b)`,
    "iu",
  ).exec(normalized);
  if (!match?.[1]) return /[,;:()[\]\u2013\u2014]/u.test(normalized) ? null : normalized;
  const candidate = normalize(match[1]);
  return plausiblePersonIdentity(candidate) ? candidate : null;
}

/**
 * A scout may serialize a negative search answer as a fact row (for example,
 * `official_token: "none"`). That row is not affirmative evidence and must
 * never become a token or security lead. In a question-specific search it is
 * equivalent to finding no publishable candidate; only the independently
 * recorded search-completion state may then support a checked-empty outcome.
 */
function isEmptyAssetPlaceholder(predicate: BasicFactPredicate, value: string): boolean {
  if (!supportsExplicitEmptyBasicFact(predicate)) return false;
  const normalized = normalize(value).toLowerCase().replace(/[.!]+$/, "").trim();
  return /^(?:n\/?a|none|no|not applicable|not found|unknown|unavailable)$/.test(normalized)
    || /^(?:no|does not have|has no)\s+(?:known\s+|verified\s+|official\s+|native\s+|governance\s+)?(?:crypto\s+)?(?:token|security|stock|bond)s?$/.test(normalized);
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
    const rawValue = clean(row.value, 240);
    const excerpt = clean(row.exact_excerpt ?? row.excerpt, 1_200);
    const sourceUrl = safeCandidateUrl(row.source_url ?? row.sourceUrl);
    if (!predicate || !PREDICATES.has(predicate) || !subject || !rawValue || !excerpt || !sourceUrl) continue;
    const suppliedQuestionId = clean(row.question_id ?? row.questionId, 100);
    const bespokeValue = predicate === "official_token"
      ? canonicalOfficialTokenLeadValue(rawValue)
      : predicate === "official_identity" && /^(?:person|investor)\./.test(suppliedQuestionId ?? "")
        ? canonicalOfficialIdentityLeadValue(rawValue)
        : undefined;
    const core: { value: string | null; trailing?: string } = bespokeValue === undefined
      ? canonicalLeadValueCore(rawValue)
      : { value: bespokeValue };
    const value = core.value;
    if (!value) continue;
    if (isEmptyAssetPlaceholder(predicate, value)) continue;
    if (!isAtomicValue(predicate, value)) continue;
    const suppliedQuestion = suppliedQuestionId ? questionById.get(suppliedQuestionId) : undefined;
    if (questions.length && suppliedQuestionId && !suppliedQuestion) continue;
    if (questions.length && !(questionsByPredicate.get(predicate)?.length)) continue;
    if (suppliedQuestion && suppliedQuestion.predicate !== predicate) continue;
    const inferredQuestion = suppliedQuestion
      ?? (questionsByPredicate.get(predicate)?.length === 1 ? questionsByPredicate.get(predicate)?.[0] : undefined);
    if (
      predicate === "founder"
      && inferredQuestion
      && inferredQuestion.audience !== "project"
      && !atomicPersonVentureValue(value)
    ) continue;
    const qualifier = clean([clean(row.qualifier, 120), clean(core.trailing, 160)]
      .filter(Boolean).join(" · "), 240);
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

/**
 * A camel-cased handle can expose the missing surname when the public profile
 * uses only a first name, for example Stani + @StaniKulechov. This is a search
 * hint only. It is never written to the profile until fetched source evidence
 * independently verifies the full name.
 */
function handleDerivedPersonName(ctx: CollectContext): string | null {
  if (researchAudience(ctx) === "project") return null;
  const display = normalize(ctx.evidence.profile.display_name);
  if (looseTokens(display).length !== 1 || !/^\p{L}[\p{L}\p{M}'’.-]*$/u.test(display)) return null;
  const handle = ctx.handle.replace(/^@/, "").trim();
  if (!handle.toLocaleLowerCase().startsWith(display.toLocaleLowerCase())) return null;
  const rawSuffix = handle.slice(display.length).replace(/^[_-]+/, "");
  if (!rawSuffix || /\d/u.test(rawSuffix)) return null;
  const suffixParts = rawSuffix.includes("_") || rawSuffix.includes("-")
    ? rawSuffix.split(/[_-]+/u)
    : [rawSuffix];
  if (
    !suffixParts.length
    || suffixParts.length > 3
    || suffixParts.some((part) => !/^\p{L}[\p{L}\p{M}'’]{2,30}$/u.test(part))
  ) return null;
  const genericSuffixes = new Set([
    "aave", "crypto", "dao", "defi", "eth", "ethereum", "labs", "nft",
    "official", "sol", "solana", "web3",
  ]);
  if (suffixParts.some((part) => genericSuffixes.has(part.toLocaleLowerCase()))) return null;
  const suffix = suffixParts
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase()}${part.slice(1)}`)
    .join(" ");
  const candidate = `${display} ${suffix}`;
  return plausiblePersonIdentity(candidate) ? candidate : null;
}

/**
 * A handle-derived full name is never evidence, but it is a safe hypothesis to
 * check against the subject-linked website. Search models sometimes prefer a
 * legal-name registry result and miss an obvious first-party About page. These
 * bounded page candidates still pass through the normal fetch, passage, and
 * first-party verification gates before they can publish anything.
 */
function officialIdentityBootstrapLeads(
  ctx: CollectContext,
): BasicFactLead[] {
  const candidate = handleDerivedPersonName(ctx);
  const rawWebsite = ctx.evidence.profile.website;
  if (!candidate || !rawWebsite) return [];
  let website: URL;
  try { website = new URL(rawWebsite); } catch { return []; }
  if (!/^https?:$/.test(website.protocol) || PATH_TENANTED_HOSTS.has(normalizedHost(website.hostname))) return [];
  const urls = [...new Set([
    new URL("/about", website.origin).toString(),
    new URL("/", website.origin).toString(),
    new URL("/team", website.origin).toString(),
    new URL("/leadership", website.origin).toString(),
  ].map(safeCandidateUrl).filter((value): value is string => Boolean(value)))];
  const [sourceUrl, ...candidateUrls] = urls;
  if (!sourceUrl) return [];
  return [{
    subject: subjectName(ctx),
    predicate: "official_identity",
    value: candidate,
    questionId: `${researchAudience(ctx)}.official_identity`,
    excerpt: candidate,
    sourceUrl,
    sourceTitle: "Official identity page candidate",
    candidateUrls,
    evidence_origin: "deterministic_bootstrap",
    artifact_verified: false,
    provider: "argus-identity-bootstrap",
  }];
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
  const targetedAssetInstruction = questions.length === 1 && questions[0]?.predicate === "public_security"
    ? "This is a question-specific public-security search. Prefer the issuer's investor-relations site or an official regulator filing. Return a row only when the cited passage identifies the issuer plus an explicit ticker, exchange listing, stock, bond, equity, or debt security."
    : questions.length === 1 && questions[0]?.predicate === "official_token"
      ? "This is a question-specific official-token search. Search the official sites and documentation of the subject's verified current ventures. Return a row only for an affirmatively named official crypto token. If the completed search finds no affirmative source-linked token candidate, return {\"facts\":[]}; never serialize none, no token, a public-company stock, or an unlaunched token plan as a fact."
      : "";
  const identitySearchHint = handleDerivedPersonName(ctx);
  let officialSearchHost = "";
  try { officialSearchHost = profile.website ? new URL(profile.website).hostname : ""; } catch { /* invalid profile URL stays a non-authoritative hint */ }
  const targetedIdentityInstruction = questions.length === 1
    && questions[0]?.predicate === "official_identity"
    && audience !== "project"
    ? [
        "This is an identity-bootstrap search. The profile display name may be incomplete.",
        identitySearchHint
          ? `Handle-derived full-name candidate: "${identitySearchHint}". Use it only as a search query and verify it from the cited page.`
          : "Search for the person's exact full public name using the handle, bio, and official website.",
        officialSearchHost && identitySearchHint
          ? `Start with a query equivalent to site:${officialSearchHost} "${identitySearchHint}", then check independent primary or reputable sources.`
          : "",
        "The value must contain only the person's full public name. Do not append a title, role, organization, biography, or second person.",
      ].filter(Boolean).join(" ")
    : "";
  const verifiedVentureContext = verifiedVentureAssetRelationships(ctx)
    .map((relationship) => `${relationship.name} (${relationship.officialScopes.join(", ")})`)
    .join("; ");
  return [
    `${phase === "repair" ? "Repair the remaining verified-evidence gaps" : "Research foundational due-diligence facts"} for ${subjectName(ctx)} (${ctx.handle}).`,
    `Research audience: ${audience}. Answer only the targeted questions below; do not pad the response with adjacent facts.`,
    profile.website ? `Known official website: ${profile.website}` : "",
    profile.bio ? `Profile bio: ${profile.bio.slice(0, 800)}` : "",
    identitySearchHint
      ? `Unverified full-name search hint derived from the public handle: ${identitySearchHint}. Use it to find evidence, never as evidence itself.`
      : "",
    verifiedVentureContext
      ? `Verified current venture relationships (relationship evidence only, not proof of any stock or token): ${verifiedVentureContext}`
      : "",
    "Targeted question ledger:",
    questionLedger,
    targetedAssetInstruction,
    targetedIdentityInstruction,
    "Prefer official first-party pages and primary documents, then reputable independent reporting.",
    "An official counterparty page may support a role, investment, acquisition, or other relationship when it explicitly names both sides. Still return the exact page and passage so ARGUS can verify it.",
    "Return one atomic value per row. Never combine multiple founders, people, investors, tokens, networks, or products in one value.",
    // ARGUS locates the value verbatim in the fetched page, so a composed phrase
    // verifies against nothing and, because each source phrases it differently,
    // also stops two sources corroborating one fact.
    "value must be the shortest phrase that NAMES the thing: an organization, product, token, school, award, or role title. Never a sentence, clause, explanation, date range, or parenthetical. Put dates, amounts, and context in qualifier instead.",
    "Good value: \"Ethereum\". Bad value: \"Ethereum (conceived 2013, network launched 30 July 2015)\". Good value: \"Bitcoin Magazine\". Bad value: \"Bitcoin Magazine, which he co-founded in 2011 before starting Ethereum\". Good value: \"University of Waterloo\". Bad value: \"Attended University of Waterloo before dropping out to work on Ethereum\".",
    "Return a row only when the value literally appears in exact_excerpt as written. If the source states the fact only as prose you cannot reduce to a name, skip the row rather than paraphrasing it.",
    "Set question_id to the exact bracketed question ID. The predicate must match that question.",
    "Each exact_excerpt must be a verbatim one-to-three sentence passage that itself explicitly contains the subject identity, the claimed value, and language proving the predicate.",
    "For traction facts, copy the source's exact as-of date or reporting period into qualifier, preferably an explicit date phrase, only when that phrase appears in exact_excerpt. Never infer, normalize, or invent a date. Omit qualifier when the source does not state a period.",
    "Keep an official crypto token separate from a publicly traded equity or debt security. Never put stock in official_token and never put a crypto token in public_security.",
    "For legal_regulatory_event, include attributed_entity and event_status only when the exact excerpt states them. Never attribute a company-only event to a founder or employee.",
    "Keep formal governance, practical control, and explicit conflicts of interest separate. Do not infer control or a conflict from a job title alone.",
    // ARGUS publishes a fact only from a first-party page or two independent
    // sources. A single-sourced row verifies against its page and then dies at
    // that threshold, so corroborating URLs are required, not optional.
    "For candidate_urls, include every additional page ALREADY IN YOUR SEARCH RESULTS that states the same atomic fact, on a different domain from source_url. Do not run extra searches to find them; corroboration should come from pages you have already seen. Do not repeat source_url.",
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
    model: DISCOVERY_MODEL,
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
  key: string;
  batch: BasicFactsResearchBatch;
  questionIds: string[];
  questionSpecific: boolean;
  state: Exclude<BasicFactsDiscoveryState, "skipped">;
  leads: BasicFactLead[];
  attempts: number;
  detail?: string;
}

interface QuestionSearchGroup {
  key: string;
  batch: Exclude<BasicFactsResearchBatch, "repair">;
  questions: BasicFactsResearchQuestion[];
  questionSpecific: boolean;
}

function aggregateGroupStates(states: readonly BasicFactsDiscoveryState[]): BasicFactsDiscoveryState {
  if (!states.length) return "skipped";
  if (states.every((state) => state === "failed")) return "failed";
  if (states.some((state) => state === "failed" || state === "partial")) return "partial";
  if (states.some((state) => state === "succeeded")) return "succeeded";
  if (states.every((state) => state === "completed_empty")) return "completed_empty";
  return "partial";
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
  const batchStates = Object.fromEntries(
    (["identity", "track_record", "structure_risk"] as const).flatMap((batch) => {
      const states = batches.filter((result) => result.batch === batch).map((result) => result.state);
      return states.length ? [[batch, aggregateGroupStates(states)]] : [];
    }),
  );
  const questionStates = Object.fromEntries(batches.flatMap((batch) =>
    batch.questionSpecific
      ? batch.questionIds.map((questionId) => [questionId, batch.state] as const)
      : []));
  const questionProviders = Object.fromEntries(
    Object.keys(questionStates).map((questionId) => [questionId, provider] as const),
  );
  return {
    provider,
    state,
    leads,
    attempts: batches.reduce((sum, batch) => sum + batch.attempts, 0),
    completedBatches,
    failedBatches,
    batchStates,
    ...(Object.keys(questionStates).length ? { questionStates } : {}),
    ...(Object.keys(questionProviders).length ? { questionProviders } : {}),
    detail: batches.map((batch) => batch.detail).filter(Boolean).join("; ") || undefined,
  };
}

function questionSearchGroups(
  questions: readonly BasicFactsResearchQuestion[],
  phase: "primary" | "repair",
): QuestionSearchGroup[] {
  const batches: Array<Exclude<BasicFactsResearchBatch, "repair">> = ["identity", "track_record", "structure_risk"];
  // A repair pass exists because a broad batch did not produce a verified
  // answer. Give every remaining critical question its own search context so
  // the scout cannot spend the whole response on an easier neighboring fact.
  // Asset questions retain that isolation when explicitly invoked alone
  // because only a question-attributable search may record completed-empty.
  const isolateQuestion = (question: BasicFactsResearchQuestion): boolean =>
    phase === "repair"
    || (supportsExplicitEmptyBasicFact(question.predicate) && questions.length === 1);
  const grouped = batches.flatMap((batch): QuestionSearchGroup[] => {
    const selected = questions.filter((question) =>
      question.batch === batch && !isolateQuestion(question));
    return selected.length ? [{ key: batch, batch, questions: selected, questionSpecific: false }] : [];
  });
  const targeted = questions
    .filter(isolateQuestion)
    .map((question): QuestionSearchGroup => ({
      key: question.id,
      batch: question.batch,
      questions: [question],
      questionSpecific: true,
    }));
  return [...grouped, ...targeted];
}

async function mapDiscoveryGroups<T>(
  groups: readonly QuestionSearchGroup[],
  work: (group: QuestionSearchGroup) => Promise<T>,
): Promise<T[]> {
  if (!groups.length) return [];
  const output = new Array<T>(groups.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(DISCOVERY_BATCH_CONCURRENCY, groups.length) },
    async () => {
      while (cursor < groups.length) {
        const index = cursor;
        cursor += 1;
        output[index] = await work(groups[index]);
      }
    },
  );
  await Promise.all(workers);
  return output;
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
  const grouped = questionSearchGroups(questions, phase);
  let providerHttpCalls = 0;
  let providerCallBudgetExhausted = false;
  const batches = await mapDiscoveryGroups(grouped, async ({ key, batch, questions: batchQuestions, questionSpecific }): Promise<BatchDiscoveryResult> => {
    const group = {
      key,
      batch,
      questionIds: batchQuestions.map((question) => question.id),
      questionSpecific,
    };
    const questionFingerprint = createHash("sha256")
      .update(batchQuestions.map((question) => question.id).sort().join("|"))
      .digest("hex").slice(0, 12);
    const cacheKey = `basic-facts:${RESEARCH_CACHE_VERSION}:claude:${audience}:${phase}:${key}:${questionFingerprint}:${ctx.handle.toLowerCase()}:${canonicalSubject.toLowerCase()}:${ctx.evidence.profile.website ?? ""}`;
    const cached = await cacheRead(cacheKey);
    if (cached) {
      const parsed = parseBasicFactLeads(cached, canonicalSubject, "claude-web-search", batchQuestions);
      const rawFactCount = rawBasicFactCount(cached);
      // A cached empty JSON body does not retain proof that the provider used
      // web search. Re-run a question-specific empty search so checked-empty
      // can never be manufactured from stale text alone.
      if (parsed?.length || (parsed && !questionSpecific)) return {
        ...group,
        state: parsed.length ? "succeeded" : rawFactCount === 0 ? "completed_empty" : "partial",
        leads: parsed,
        attempts: 0,
        detail: `${key}:cache_${parsed.length
          ? "hit"
          : rawFactCount === 0
            ? "explicit_empty"
            : "nonempty_filtered"}`,
      };
    }

    const prompt = discoveryPrompt(ctx, batchQuestions, phase);
    const maxSearchUses = phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH;
    const executeSearch = async (): Promise<{
      search: {
        response: ClaudeResponse;
        webSearchRequests: number;
      } | null;
      attempts: number;
    }> => {
      let attempts = 0;
      const invoke = async (assistantContent?: ClaudeContentBlock[]): Promise<ClaudeResponse | null> => {
        if (phase === "repair" && providerHttpCalls >= MAX_REPAIR_PROVIDER_CALLS) {
          providerCallBudgetExhausted = true;
          return null;
        }
        providerHttpCalls += 1;
        attempts += 1;
        return callClaudeSearch(prompt, request, assistantContent, maxSearchUses);
      };
      let response = await invoke();
      if (!response) return { search: null, attempts };
      let webSearchRequests = response.usage?.server_tool_use?.web_search_requests ?? 0;
      if (response.stop_reason === "pause_turn" && response.content?.length) {
        response = await invoke(response.content);
        if (!response) return { search: null, attempts };
        webSearchRequests += response.usage?.server_tool_use?.web_search_requests ?? 0;
      }
      return { search: { response, webSearchRequests }, attempts };
    };

    const execution = await executeSearch();
    let search = execution.search;
    let attempts = execution.attempts;
    let text = search ? responseText(search.response) : "";
    let parsed = text
      ? parseBasicFactLeads(text, canonicalSubject, "claude-web-search", batchQuestions)
      : null;
    // Hosted search occasionally returns a transient failure or malformed
    // JSON. Retry only that bounded batch once; fetched source verification
    // remains the governing boundary after discovery succeeds.
    if (!search || !text || !parsed) {
      await new Promise((resolve) => setTimeout(resolve, DISCOVERY_RETRY_DELAY_MS));
      const retry = await executeSearch();
      attempts += retry.attempts;
      if (retry.search) {
        search = retry.search;
        text = responseText(retry.search.response);
        parsed = text
          ? parseBasicFactLeads(text, canonicalSubject, "claude-web-search", batchQuestions)
          : null;
      }
    }
    if (!search) return { ...group, state: "failed", leads: [], attempts, detail: `${key}:request_failed_after_retry` };
    if (!text) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:empty_output_after_retry` };
    if (!parsed) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:invalid_json_after_retry` };
    const webSearchRequests = search.webSearchRequests;
    void cacheWrite(cacheKey, text);
    const rawFactCount = rawBasicFactCount(text);
    const explicitEmpty = rawFactCount === 0;
    const attributableEmpty = !parsed.length
      && explicitEmpty
      && (!questionSpecific || webSearchRequests > 0);
    return {
      ...group,
      state: parsed.length ? "succeeded" : attributableEmpty ? "completed_empty" : "partial",
      leads: parsed,
      attempts,
      detail: `${key}:${parsed.length
        ? `${parsed.length}_leads`
        : attributableEmpty
          ? `completed_empty_${webSearchRequests}_searches`
          : rawFactCount !== null && rawFactCount > 0
            ? `partial_${rawFactCount}_raw_facts_filtered`
            : "empty_without_attributable_search"}`,
    };
  });
  const result = aggregateDiscovery("claude-web-search", batches);
  if (providerCallBudgetExhausted) {
    result.detail = [result.detail, `repair provider-call budget exhausted at ${MAX_REPAIR_PROVIDER_CALLS} calls`]
      .filter(Boolean).join("; ");
  }
  return result;
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

export async function discoverGrokBasicFactLeadsDetailed(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
  phase: "primary" | "repair",
  options: { bypassCache?: boolean } = {},
): Promise<BasicFactsDiscoveryResult> {
  if (!env("XAI_API_KEY")) {
    return { provider: "grok", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "Grok search is not configured" };
  }
  const audience = questions[0]?.audience ?? researchAudience(ctx);
  const grouped = questionSearchGroups(questions, phase);
  let providerHttpCalls = 0;
  let providerCallBudgetExhausted = false;
  const claimProviderCall = (): boolean => {
    if (phase !== "repair") return true;
    if (providerHttpCalls >= MAX_REPAIR_PROVIDER_CALLS) {
      providerCallBudgetExhausted = true;
      return false;
    }
    providerHttpCalls += 1;
    return true;
  };
  const batches = await mapDiscoveryGroups(grouped, async ({ key, batch, questions: batchQuestions, questionSpecific }): Promise<BatchDiscoveryResult> => {
    const group = {
      key,
      batch,
      questionIds: batchQuestions.map((question) => question.id),
      questionSpecific,
    };
    const fingerprint = createHash("sha256")
      .update(batchQuestions.map((question) => question.id).sort().join("|"))
      .digest("hex").slice(0, 12);
    let attempts = 0;
    const text = await grokSearch(
      "You are ARGUS's basic-facts research scout. Use live web search. Return only the requested JSON. Every answer remains an unverified lead until ARGUS fetches and verifies the exact source passage.",
      discoveryPrompt(ctx, batchQuestions, phase),
      {
        maxToolCalls: phase === "repair" ? REPAIR_SEARCH_USES : PRIMARY_SEARCH_USES_PER_BATCH,
        cacheKey: `basic-facts:${RESEARCH_CACHE_VERSION}:grok:${audience}:${phase}:${key}:${fingerprint}:${ctx.handle.toLowerCase()}:${subjectName(ctx).toLowerCase()}`,
        bypassCache: options.bypassCache,
        claimProviderCall: () => {
          const claimed = claimProviderCall();
          if (claimed) attempts += 1;
          return claimed;
        },
      },
    );
    if (!text) return { ...group, state: "failed", leads: [], attempts, detail: `${key}:request_failed` };
    const parsed = parseBasicFactLeads(text, subjectName(ctx), "grok", batchQuestions);
    if (!parsed) return { ...group, state: "partial", leads: [], attempts, detail: `${key}:invalid_json` };
    return {
      ...group,
      // grokSearch currently exposes text but not attributable tool-use
      // telemetry. An empty targeted answer therefore stays partial rather
      // than becoming a checked-empty claim.
      state: parsed.length ? "succeeded" : questionSpecific ? "partial" : "completed_empty",
      leads: parsed,
      attempts,
      detail: `${key}:${parsed.length
        ? `${parsed.length}_leads`
        : questionSpecific
          ? "empty_without_attributable_search"
          : "completed_empty"}`,
    };
  });
  const result = aggregateDiscovery("grok", batches);
  if (providerCallBudgetExhausted) {
    result.detail = [result.detail, `repair provider-call budget exhausted at ${MAX_REPAIR_PROVIDER_CALLS} calls`]
      .filter(Boolean).join("; ");
  }
  return result;
}

async function discoverPrimary(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
): Promise<BasicFactsDiscoveryResult> {
  // Discovery is the dominant line item in an audit: it pulls whole search
  // result sets into model input, and Claude input costs 15x Grok input
  // ($3/M vs $0.20/M). ARGUS_BASIC_FACTS_PRIMARY=grok runs the same questions
  // on the cheaper searcher, with Claude still available for repair, so the
  // cost/recall trade can be measured rather than assumed.
  if (env("ARGUS_BASIC_FACTS_PRIMARY") === "grok" && env("XAI_API_KEY")) {
    return discoverGrokBasicFactLeadsDetailed(ctx, questions, "primary");
  }
  if (!env("ANTHROPIC_API_KEY")) return discoverGrokBasicFactLeadsDetailed(ctx, questions, "primary");
  const claude = await discoverBasicFactLeadsDetailed(ctx, {}, questions, "primary");
  if (
    !env("XAI_API_KEY")
    || (claude.state !== "failed" && !(claude.state === "partial" && claude.leads.length === 0))
  ) return claude;
  const grok = await discoverGrokBasicFactLeadsDetailed(ctx, questions, "primary");
  return {
    ...grok,
    // Grok governs this result. Claude's failure stays visible in cost and
    // incident history without mislabeling Grok-discovered leads as Claude.
    attempts: claude.attempts + grok.attempts,
    detail: [
      `Claude primary ${claude.state}: ${claude.detail ?? "no detail"}`,
      `Grok fallback ${grok.state}: ${grok.detail ?? "no detail"}`,
    ].join("; "),
  };
}

async function discoverRepair(
  ctx: CollectContext,
  questions: readonly BasicFactsResearchQuestion[],
): Promise<BasicFactsDiscoveryResult> {
  if (!questions.length) {
    return { provider: "none", state: "skipped", leads: [], attempts: 0, completedBatches: 0, failedBatches: 0, detail: "no critical gaps" };
  }
  // Keep one governing provider for the entire bounded repair pass. Grok is
  // preferred when configured so a depleted Claude account cannot trigger a
  // second failing pass or multiply calls through per-question failover.
  if (env("XAI_API_KEY")) return discoverGrokBasicFactLeadsDetailed(ctx, questions, "repair");
  if (env("ANTHROPIC_API_KEY")) return discoverBasicFactLeadsDetailed(ctx, {}, questions, "repair");
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

const MAX_JSON_LD_BLOCK_CHARS = 200_000;
const MAX_JSON_LD_TEXT_CHARS = 240_000;
const JSON_LD_OBJECT_BOUNDARY = "ARGUSJSONLDOBJECTBOUNDARY";
const JSON_LD_TEXT_KEYS = new Set([
  "alternateName",
  "dateFounded",
  "description",
  "foundingDate",
  "headline",
  "jobTitle",
  "legalName",
  "name",
  "text",
  "tickerSymbol",
]);
const JSON_LD_RELATION_KEYS = new Set([
  "affiliation",
  "founder",
  "founders",
  "memberOf",
  "parentOrganization",
  "worksFor",
]);

/**
 * Extract only bounded, parsed schema.org text. JSON-LD is common on JS-heavy
 * investor and team pages, and often contains the canonical biography even
 * when the visible card is client-rendered. Arbitrary executable scripts are
 * still removed below and never participate in verification.
 */
function extractJsonLdText(html: string): string {
  const objects: string[] = [];
  let total = 0;
  const cleanJsonLdText = (value: string): string => value
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|section|article|li|h[1-6]|blockquote)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .trim()
    .slice(0, 12_000);
  const ownText = (value: Record<string, unknown>): string[] => Object.entries(value)
    .flatMap(([key, child]): string[] =>
      typeof child === "string" && JSON_LD_TEXT_KEYS.has(key)
        ? [cleanJsonLdText(child)].filter(Boolean)
        : []);
  const stableIdentity = (value: Record<string, unknown>): string[] => [
    value.name,
    value.legalName,
    value.alternateName,
  ].flatMap((child): string[] => typeof child === "string"
    ? [cleanJsonLdText(child)].filter(Boolean)
    : []);
  const emit = (fragments: readonly string[]): void => {
    if (!fragments.length || total >= MAX_JSON_LD_TEXT_CHARS) return;
    const remaining = MAX_JSON_LD_TEXT_CHARS - total;
    const joined = fragments.join(". ").slice(0, remaining);
    if (!joined) return;
    objects.push(joined);
    total += joined.length;
  };
  const emitObjectPaths = (
    value: Record<string, unknown>,
    inherited: readonly string[] = [],
    depth = 0,
  ): void => {
    if (depth > 5 || total >= MAX_JSON_LD_TEXT_CHARS) return;
    const current = [...inherited, ...ownText(value)];
    emit(current);
    // Children may inherit only stable identity, never narrative, headline,
    // role, or descriptive copy. Otherwise an Organization description about
    // Brian can leak into a nested founder object for Alesia and manufacture a
    // Brian/Alesia role claim.
    const childIdentity = [...inherited, ...stableIdentity(value)];
    for (const [key, child] of Object.entries(value)) {
      if (!JSON_LD_RELATION_KEYS.has(key)) continue;
      const related = Array.isArray(child) ? child : [child];
      for (const item of related) {
        if (item && typeof item === "object" && !Array.isArray(item)) {
          // Each relationship child becomes its own evidence segment with the
          // parent context. Sibling people can therefore never lend one another
          // a name, role, or organization through JSON-LD adjacency.
          emitObjectPaths(item as Record<string, unknown>, childIdentity, depth + 1);
        }
      }
    }
  };
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attributes = match[1] ?? "";
    if (!/\btype\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)(?:\s|$)/i.test(attributes)) continue;
    const raw = (match[2] ?? "").trim();
    if (!raw || raw.length > MAX_JSON_LD_BLOCK_CHARS) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.replace(/^\s*<!--|-->\s*$/g, ""));
    } catch {
      continue;
    }

    const roots = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>)["@graph"])
        ? (parsed as Record<string, unknown>)["@graph"] as unknown[]
        : [parsed];
    for (const root of roots) {
      if (!root || typeof root !== "object" || Array.isArray(root) || total >= MAX_JSON_LD_TEXT_CHARS) continue;
      emitObjectPaths(root as Record<string, unknown>);
    }
  }
  return objects.join(` ${JSON_LD_OBJECT_BOUNDARY} `);
}

function documentText(document: PublicTextDocument): string {
  if (!/html|xhtml/i.test(document.contentType)) return normalize(document.text);
  const jsonLd = extractJsonLdText(document.text);
  return normalize(decodeHtmlEntities(`${jsonLd}${jsonLd ? ` ${JSON_LD_OBJECT_BOUNDARY} ` : ""}${document.text
    .replace(/<(?:script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|svg)>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    // Keep block boundaries as sentence boundaries. Without this, a heading,
    // navigation item and unrelated paragraph can collapse into one apparent
    // supporting passage after tags are removed.
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|section|article|li|h[1-6]|tr|td|th|main|header|footer|blockquote)>/gi, ". ")
    .replace(/<[^>]+>/g, " ")}`));
}

const PREDICATE_PATTERNS: Record<BasicFactPredicate, RegExp> = {
  official_identity: /\b(?:official|known as|operated by|developed by|is (?:a|an|the)|project|organization|protocol|foundation|company|person|entrepreneur|investor|(?:co[- ]?)?founder|chief executive officer|ceo)\b/i,
  current_role: /\b(?:currently|serves as|has served as|works as|is (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|(?:co[- ]?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair(?:man|woman|person)?|board member)(?:\s*(?:,|&|and)\s*(?:co[- ]?founder|chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair(?:man|woman|person)?|board member))*|current role)\b/i,
  prior_role: /\b(?:formerly|previously|prior to|served as|was (?:the |an? )?(?:founder|co[- ]?founder|chief|ceo|cto|coo|cfo|president|partner|principal|director|head|lead|chair|member)|prior role)\b/i,
  education: /\b(?:graduated|degree|studied|attended|education|university|college|school|bachelor|master(?:'s)?|mba|phd|doctorate)\b/i,
  founder: /\b(?:co[- ]?founders?|founders?|co[- ]?founded|founded(?:\s+by)?)\b/i,
  executive: /\b(?:chief executive officer|chief technology officer|chief operating officer|chief financial officer|ceo|cto|coo|cfo|president|executive|director|head of|lead)\b/i,
  founded: /\b(?:co[- ]?founder|founded|established|formed|incorporated|inception)\b/i,
  launched: /\b(?:launched|went live|debuted|released|introduced)\b/i,
  exit: /\b(?:acquired|acquisition|bought by|sold to|sale of|exited|exit|ipo|public offering|direct listing|went public|listed publicly|shut down|closed)\b/i,
  track_record: /\b(?:track record|outcome|returned|return|revenue|users?|volume|assets under management|aum|built|grew|scaled|founded|invested)\b/i,
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

const EXPLICIT_OFFICIAL_CRYPTO_TOKEN = /\b(?:official|governance|native|utility|crypto(?:currency)?)\s+(?:crypto\s+)?token\b/i;
const EXPLICIT_WRAPPED_OR_ERC_TOKEN = /\b(?:wrapped(?:\s+[a-z0-9-]+){0,3}\s+token|erc[- ]?\d+\s+(?:wrapped\s+)?token)\b/i;

function positivePredicateMatches(excerpt: string, predicate: BasicFactPredicate): RegExpMatchArray[] {
  const pattern = new RegExp(PREDICATE_PATTERNS[predicate].source, "gi");
  return [...excerpt.matchAll(pattern)].filter((match) => {
    if (match.index === undefined) return false;
    const local = excerpt.slice(Math.max(0, match.index - 45), match.index + match[0].length + 45);
    return !/\b(?:not|never|no|without|didn't|did not|denied|false claim)\b/i.test(local);
  });
}

function predicateIsSupported(excerpt: string, predicate: BasicFactPredicate): boolean {
  return positivePredicateMatches(excerpt, predicate).length > 0;
}

const MAX_SUPPORT_PASSAGE_CHARS = 720;

interface SourceToken {
  key: string;
  raw: string;
  start: number;
  end: number;
}

function sourceTokens(value: string): SourceToken[] {
  const tokens: SourceToken[] = [];
  for (const match of value.matchAll(/[\p{L}\p{N}]+/gu)) {
    if (match.index === undefined) continue;
    const key = looseTokens(match[0])[0];
    if (key) tokens.push({ key, raw: match[0], start: match.index, end: match.index + match[0].length });
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

function sourceSegments(page: string): string[] {
  return page.split(JSON_LD_OBJECT_BOUNDARY)
    .map((segment) => normalize(segment))
    .filter(Boolean);
}

function sourceSentencePassages(page: string): string[] {
  const passages: string[] = [];
  for (const segment of sourceSegments(page)) {
    const sentences = [...segment.matchAll(/[^.!?]+(?:[.!?]+|$)/g)].flatMap((match) => {
      if (match.index === undefined || !normalize(match[0])) return [];
      return [{ start: match.index, end: match.index + match[0].length }];
    });
    for (let start = 0; start < sentences.length; start += 1) {
      for (let count = 0; count < 3 && start + count < sentences.length; count += 1) {
        const passage = normalize(segment.slice(sentences[start].start, sentences[start + count].end));
        if (passage.length > MAX_SUPPORT_PASSAGE_CHARS) break;
        passages.push(passage);
      }
    }
  }
  return passages;
}

function sourceAnchorPassages(page: string, value: string): string[] {
  return sourceSegments(page).flatMap((segment) => {
    const tokens = sourceTokens(segment);
    const valueTokens = looseTokens(value);
    if (!valueTokens.length) return [];
    return phraseTokenStarts(tokens, value).map((start) => {
      const from = Math.max(0, start - 28);
      const to = Math.min(tokens.length - 1, start + valueTokens.length - 1 + 28);
      return normalize(segment.slice(tokens[from].start, tokens[to].end));
    }).filter((passage) => passage.length <= MAX_SUPPORT_PASSAGE_CHARS);
  });
}

const EMPTY_CONTEXT_TOKENS: ReadonlySet<string> = new Set();
const DIRECT_RELATION_PREDICATES = new Set<BasicFactPredicate>([
  "current_role", "prior_role", "founder", "executive",
]);
const RELATION_CHAIN_PREDICATES = new Set<BasicFactPredicate>([
  "founded", "product", "exit", "track_record", "public_security",
]);
const RELATION_LANGUAGE = /\b(?:co[- ]?found(?:er|ed)|found(?:er|ed)|chief executive officer|ceo|chair(?:man|woman|person)?|board member|led|leads|built|created|started|works? (?:at|for)|served? (?:at|as)|controls?)\b/i;
const NON_ENTITY_ANCHORS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
]);

function individualSentences(value: string): string[] {
  const marker = "ARGUSABBREVIATIONDOT";
  const protectedValue = value.replace(
    /\b(?:Mr|Mrs|Ms|Dr|Inc|Ltd|Corp|Co|No|U\.S)\./g,
    (match) => match.replace(/\./g, marker),
  );
  return [...protectedValue.matchAll(/[^.!?]+(?:[.!?]+|$)/g)]
    .map((match) => normalize(match[0].replaceAll(marker, ".")))
    .filter(Boolean);
}

/** Split attribution-bearing prose at independent clauses. A bounded passage
 * may intentionally span adjacent sentences, but one clause's named subject
 * must never borrow another clause's role, outcome, or legal event. */
function attributionClauses(value: string): string[] {
  return individualSentences(value).flatMap((sentence) => sentence
    .split(/\s*(?:;|,\s*(?:and|but|while|whereas|which|who|that)|\s+(?:but|while|whereas)\s+)\s*/i)
    .flatMap((clause) => clause.split(
      /\s+and\s+(?=(?:(?:[A-Z][A-Za-z0-9.'’-]*)\s+){0,3}(?:[A-Z][A-Za-z0-9.'’-]*)\s+(?:is|was|has|had|serves?|served|settled|reported|announced|founded|co[- ]?founded|leads?|led|works?|worked|went|became)\b)/,
    ))
    .flatMap((clause) => clause.split(
      /\s+and\s+(?=(?:founded|co[- ]?founded|serves?|served|works?|worked|reported|announced|settled|went|became|launched|built|created|led|leads)\b)/i,
    ))
    .map(normalize)
    .filter(Boolean));
}

function hasSubjectAlias(value: string, aliases: readonly string[]): boolean {
  if (aliases.some((alias) => looseContainsPhrase(value, alias))) return true;
  return aliases.some((alias) => {
    const tokens = looseTokens(alias);
    if (tokens.length < 2) return false;
    const surname = tokens[tokens.length - 1];
    return ["mr", "mrs", "ms", "dr"].some((honorific) =>
      looseContainsPhrase(value, `${honorific} ${surname}`));
  });
}

const MATERIAL_ROLE_TOKENS = new Set([
  "adviser", "advisor", "ceo", "cfo", "coo", "cto", "chair", "director", "engineer", "founder",
  "head", "investor", "lead", "manager", "member", "partner", "president", "principal",
]);
const NON_PERSON_TITLE_TOKENS = new Set([
  "and", "at", "chief", "co", "company", "corp", "corporation",
  "exchange", "global", "group", "host", "inc", "llc", "ltd", "nasdaq", "nyse",
  "of", "officer", "spaces", "the", "to", "with",
  ...MATERIAL_ROLE_TOKENS,
]);

interface TokenSpan { start: number; end: number }
interface RoleMatch extends TokenSpan { role: string }

function roleMatchAt(tokens: readonly SourceToken[], index: number): RoleMatch | null {
  const keys = tokens.slice(index, index + 3).map((token) => token.key);
  const phrase = keys.join(" ");
  const expanded = new Map<string, string>([
    ["chief executive officer", "ceo"],
    ["chief financial officer", "cfo"],
    ["chief operating officer", "coo"],
    ["chief technology officer", "cto"],
  ]).get(phrase);
  if (expanded) return { role: expanded, start: index, end: index + 2 };
  const shortened = new Map<string, string>([
    ["chief executive", "ceo"],
    ["chief financial", "cfo"],
    ["chief operating", "coo"],
    ["chief technology", "cto"],
  ]).get(keys.slice(0, 2).join(" "));
  if (shortened) return { role: shortened, start: index, end: index + 1 };
  if (tokens[index]?.key === "co" && tokens[index + 1]?.key === "founder") {
    return { role: "founder", start: index, end: index + 1 };
  }
  if (tokens[index]?.key === "board" && tokens[index + 1]?.key === "member") {
    return { role: "member", start: index, end: index + 1 };
  }
  if (tokens[index]?.key === "software" && tokens[index + 1]?.key === "engineer") {
    return { role: "engineer", start: index, end: index + 1 };
  }
  const direct = tokens[index]?.key;
  return direct && MATERIAL_ROLE_TOKENS.has(direct)
    ? { role: direct, start: index, end: index }
    : null;
}

function roleMatches(tokens: readonly SourceToken[]): RoleMatch[] {
  const matches: RoleMatch[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const match = roleMatchAt(tokens, index);
    if (!match) continue;
    matches.push(match);
    index = match.end;
  }
  return matches;
}

function subjectTokenSpans(tokens: readonly SourceToken[], aliases: readonly string[]): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const alias of aliases) {
    const aliasTokens = looseTokens(alias);
    for (const start of phraseTokenStarts(tokens, alias)) {
      spans.push({ start, end: start + aliasTokens.length - 1 });
    }
    if (aliasTokens.length < 2) continue;
    const surname = aliasTokens.at(-1)!;
    for (let index = 0; index < tokens.length - 1; index += 1) {
      if (["mr", "mrs", "ms", "dr"].includes(tokens[index].key) && tokens[index + 1].key === surname) {
        spans.push({ start: index, end: index + 1 });
      }
    }
  }
  return spans;
}

function probablePersonSpans(
  tokens: readonly SourceToken[],
  excludedEntityTokens: ReadonlySet<string> = EMPTY_CONTEXT_TOKENS,
): TokenSpan[] {
  const capitalized = (token: SourceToken | undefined): token is SourceToken => {
    if (!token) return false;
    return /^\p{Lu}[\p{L}\p{M}'’-]+$/u.test(token.raw)
      && token.raw.length > 1
      && !NON_PERSON_TITLE_TOKENS.has(token.key)
      && !excludedEntityTokens.has(token.key);
  };
  const roles = roleMatches(tokens);
  const spans: TokenSpan[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (!capitalized(tokens[index])) continue;
    const precededByRole = roles.some((role) => role.end === index - 1);
    const followedByRole = ["is", "was", "serves", "served"].includes(tokens[index + 1]?.key ?? "")
      && roles.some((role) => role.start >= index + 2 && role.start <= index + 5);
    const twoTokenName = capitalized(tokens[index + 1]);
    if (!twoTokenName && !precededByRole && !followedByRole) continue;
    if (!precededByRole && index > 0 && ["at", "for", "from", "of", "to", "with"].includes(tokens[index - 1].key)) continue;
    let end = index;
    while (end + 1 < tokens.length && end - index < 3 && capitalized(tokens[end + 1])) end += 1;
    spans.push({ start: index, end });
    index = end;
  }
  return spans;
}

function executivePersonAliases(lead: BasicFactLead, projectAliases: readonly string[]): string[] {
  const excluded = new Set([
    ...ROLE_DESCRIPTOR_TOKENS,
    ...projectAliases.flatMap(looseTokens),
    "and", "at", "by", "for", "of", "the", "with",
  ]);
  const personTokens = looseTokens(lead.value).filter((token) => !excluded.has(token));
  return personTokens.length ? [personTokens.join(" ")] : [];
}

function roleAttributionIsSupported(
  clause: string,
  lead: BasicFactLead,
  aliases: readonly string[],
): boolean {
  if (!["current_role", "prior_role", "executive"].includes(lead.predicate)) return true;
  const requestedRoles = [...new Set(roleMatches(sourceTokens(lead.value)).map((role) => role.role))];
  if (!requestedRoles.length) return false;
  const tokens = sourceTokens(clause);
  const targetAliases = lead.predicate === "executive" ? executivePersonAliases(lead, aliases) : aliases;
  const subjectSpans = subjectTokenSpans(tokens, targetAliases);
  if (!subjectSpans.length) return false;
  const excludedEntityTokens = new Set([
    ...valueAnchorTokens(lead),
    ...(lead.predicate === "executive" ? aliases.flatMap(looseTokens) : []),
  ]);
  const allPeople = [...subjectSpans.map((span) => ({ ...span, subject: true })), ...probablePersonSpans(tokens, excludedEntityTokens)
    .filter((person) => !subjectSpans.some((subject) => person.start === subject.start && person.end === subject.end))
    .map((span) => ({ ...span, subject: false }))];
  const roles = roleMatches(tokens);
  const distance = (role: RoleMatch, span: TokenSpan): number =>
    role.end < span.start ? span.start - role.end : role.start > span.end ? role.start - span.end : 0;
  if (/\brespectively\b/i.test(clause)) {
    const firstRoleStart = roles[0]?.start ?? Number.POSITIVE_INFINITY;
    const orderedPeople = allPeople
      .filter((person) => person.end < firstRoleStart)
      .sort((left, right) => left.start - right.start)
      .filter((person, index, people) => index === 0
        || person.start !== people[index - 1].start
        || person.end !== people[index - 1].end);
    if (orderedPeople.length >= requestedRoles.length && roles.length >= requestedRoles.length) {
      return requestedRoles.every((requestedRole) => roles.some((role, roleIndex) =>
        role.role === requestedRole && orderedPeople[roleIndex]?.subject));
    }
  }
  return requestedRoles.every((requestedRole) => roles.some((role) => {
    if (role.role !== requestedRole) return false;
    const following = allPeople
      .filter((person) => person.start > role.end && person.start - role.end <= 5)
      .filter((person) => tokens.slice(role.end + 1, person.start).every((between) =>
        between.key === "and" || between.key === "co" || between.key === "chief"
        || between.key === "executive" || between.key === "financial"
        || between.key === "operating" || between.key === "technology"
        || between.key === "officer" || MATERIAL_ROLE_TOKENS.has(between.key)))
      .sort((left, right) => left.start - right.start)[0];
    if (following) return following.subject;
    const nearest = allPeople.slice().sort((left, right) =>
      distance(role, left) - distance(role, right)
      || Number(right.subject) - Number(left.subject))[0];
    return Boolean(nearest?.subject && distance(role, nearest) <= 16);
  }));
}

/** Bind title-before-name captions such as "Aave Labs CEO Stani Kulechov"
 * without letting another nearby person's title establish the identity. */
function titleBindsOfficialIdentity(clause: string, lead: BasicFactLead): boolean {
  if (looseTokens(lead.value).length < 2) return false;
  const tokens = sourceTokens(clause);
  const identityTokenKeys = new Set(looseTokens(lead.value));
  const identitySpans = phraseTokenStarts(tokens, lead.value).map((start) => ({
    start,
    end: start + looseTokens(lead.value).length - 1,
  }));
  const directAfterLinkers = new Set([
    "",
    "a",
    "an",
    "as",
    "is",
    "is the",
    "served as",
    "serves as",
    "the",
    "was",
    "was the",
  ]);
  const otherPeople = probablePersonSpans(tokens, identityTokenKeys);
  return identitySpans.some((identity) => roleMatches(tokens).some((role) => {
    // In a title-before-name caption the final title token must touch the name.
    // `CEO and Stani Kulechov` names two people; the conjunction can never act
    // as title glue. Multi-role titles still work because the nearest role in
    // `Founder and CEO Stani Kulechov` is the adjacent CEO span.
    if (role.end < identity.start) {
      return role.end === identity.start - 1;
    }
    if (role.start > identity.end) {
      const linker = tokens.slice(identity.end + 1, role.start).map((token) => token.key).join(" ");
      if (!directAfterLinkers.has(linker)) return false;
      // `Stani Kulechov and CEO Alice Example` must bind CEO to Alice, not
      // Stani. Organization tails introduced by `of/at/for` are already
      // excluded by probablePersonSpans and remain valid.
      return !otherPeople.some((person) =>
        person.start > role.end && person.start - role.end <= 3);
    }
    return false;
  }));
}

function explicitPersonIdentityIsBound(clause: string, lead: BasicFactLead): boolean {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  return [
    new RegExp(`\\b(?:official(?:\\s+(?:name|identity))?|known\\s+as)\\b[^.!?;]{0,48}\\b${value}\\b`, "i"),
    new RegExp(`\\b${value}\\b\\s*,?\\s*(?:(?:is|was)\\s+)?(?:an?\\s+|the\\s+)?(?:entrepreneur|investor|person)\\b`, "i"),
  ].some((pattern) => pattern.test(clause));
}

function loosePhrasePattern(value: string): string {
  return looseTokens(value).map(escapedPattern).join("\\W+");
}

const FOUNDER_ENTITY_CONTINUATION_TOKENS = new Set([
  "capital", "company", "corp", "corporation", "dao", "ecosystem", "exchange",
  "foundation", "global", "group", "holdings", "inc", "labs", "limited", "llc",
  "ltd", "network", "organization", "platform", "plc", "protocol", "technologies",
  "technology", "ventures",
]);

/**
 * A token-prefix match is not an entity match. `Aave Labs` cannot be recovered
 * from `Aave Labs Ventures`, and `Aave` cannot be recovered from `Aave
 * Protocol`. Lowercase prose may follow an entity naturally, while punctuation
 * or conjunctions close the entity span explicitly.
 */
function founderValueHasExactEntityBoundary(clause: string, value: string): boolean {
  const tokens = sourceTokens(clause);
  const starts = phraseTokenStarts(tokens, value);
  if (!starts.length) return false;
  const valueLength = looseTokens(value).length;
  return starts.every((start) => {
    const end = start + valueLength - 1;
    const current = tokens[end];
    const next = tokens[end + 1];
    if (!current || !next) return true;
    const separator = clause.slice(current.end, next.start);
    if (/[,.;:!?)]/.test(separator)) return true;
    if (["and", "but", "while", "whereas"].includes(next.key)) return true;
    if (FOUNDER_ENTITY_CONTINUATION_TOKENS.has(next.key)) return false;
    return !/^\p{Lu}[\p{L}\p{M}'’-]+$/u.test(next.raw);
  });
}

function founderAttributionIsSupported(
  passage: string,
  lead: BasicFactLead,
  aliases: readonly string[],
): boolean {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  const aliasPatterns = aliases.map(loosePhrasePattern).filter(Boolean);
  const founded = "(?:co[-\\s]?founded|founded)";
  const founder = "(?:co[-\\s]?founder|founder)";
  // Press profiles commonly compress a person's control relationship into
  // "Founder and CEO of Venture" or the appositive "Name, Founder of
  // Venture". Keep that bridge deliberately closed: only an optional CEO
  // title may sit between founder and the exact venture value, so a nearby
  // executive, company, or unrelated role can never satisfy the claim.
  const founderExecutiveTitle = "(?:\\s*,?\\s*(?:and|&)\\s*(?:the\\s+)?(?:chief\\s+executive\\s+officer|ceo))?";
  const exactVentureBoundary = "(?=\\s*(?:[,.;:!?)]|$))";
  const generic = "(?:the|this|our)\\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture)";
  return attributionClauses(passage).some((clause) => {
    if (!founderValueHasExactEntityBoundary(clause, lead.value)) return false;
    const hasProjectContext = aliases.some((alias) => looseContainsPhrase(passage, alias));
    if (hasProjectContext && [
      new RegExp(`\\b${generic}\\b[^.!?;]{0,40}\\b${founded}\\s+by\\s+${value}\\b`, "i"),
      new RegExp(`\\b${value}\\b[^.!?;]{0,25}\\b${founded}\\s+(?:the\\s+)?${generic}\\b`, "i"),
      new RegExp(`\\b${value}\\b[^.!?;]{0,25}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+of\\s+${generic}\\b`, "i"),
    ].some((pattern) => pattern.test(clause))) return true;
    return aliasPatterns.some((subject) => {
      const list = new RegExp(`\\b${subject}\\b(?:['’]s)?[^.!?;]{0,24}\\b${founder}s\\b\\s*(?:(?:include|are)\\s+|:\\s*)?([^.!?;]+)`, "i").exec(clause);
      if (list?.[1] && looseContainsPhrase(list[1], lead.value)) {
        const valueMatch = new RegExp(`\\b${value}\\b`, "i").exec(list[1]);
        const prefix = valueMatch?.index === undefined
          ? ""
          : list[1].slice(Math.max(0, valueMatch.index - 36), valueMatch.index);
        const explicitlyDifferentRole = /\b(?:adviser|advisor|ceo|cfo|coo|cto|director|employee|engineer|head|investor|lead|manager|member|partner|president|principal)\s*(?:,|and|&)?\s*$/i.test(prefix);
        if (!explicitlyDifferentRole) return true;
      }
      return [
        new RegExp(`\\b${subject}\\b(?:['’]s)?\\s+${founder}\\s+(?:is\\s+)?${value}\\b`, "i"),
        new RegExp(`\\b${value}\\b\\s*,?\\s*(?:is\\s+)?(?:an?\\s+|the\\s+)?${founder}\\s+of\\s+(?:the\\s+)?${subject}\\b`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,60}\\b${founded}\\s+by\\s+${value}\\b`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,40}\\b${founded}\\s+(?:the\\s+)?${value}\\b`, "i"),
        new RegExp(`\\b${subject}\\b\\s+(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}${founderExecutiveTitle}\\s+(?:of|at)\\s+(?:the\\s+)?${value}\\b${exactVentureBoundary}`, "i"),
        new RegExp(`\\b${subject}\\b\\s*,\\s*(?:an?\\s+|the\\s+)?${founder}${founderExecutiveTitle}\\s+(?:of|at)\\s+(?:the\\s+)?${value}\\b${exactVentureBoundary}`, "i"),
        new RegExp(`\\b${subject}\\b[^.!?;]{0,40}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+(?:of|at)\\s+${value}\\b`, "i"),
        new RegExp(`\\b${value}\\b[^.!?;]{0,40}\\b${founded}\\s+(?:the\\s+)?${subject}\\b`, "i"),
        new RegExp(`\\b${value}\\b[^.!?;]{0,40}\\b(?:is|was)\\s+(?:an?\\s+|the\\s+)?${founder}\\s+(?:of|at)\\s+${subject}\\b`, "i"),
      ].some((pattern) => pattern.test(clause));
    });
  });
}

function valueAnchorTokens(lead: BasicFactLead): string[] {
  const descriptors = VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? new Set<string>();
  const ticker = lead.predicate === "public_security" ? primaryTickerCandidate(lead.value) : null;
  return canonicalValueTokens(lead.value).filter((token) =>
    !descriptors.has(token)
    && !PUBLIC_SECURITY_CORPORATE_MODIFIERS.has(token)
    && !NON_ENTITY_ANCHORS.has(token)
    && !/^\d/.test(token)
    && token !== ticker?.toLowerCase());
}

function safeHostContextForSentence(
  sentence: string,
  trustedContextTokens: ReadonlySet<string>,
): ReadonlySet<string> {
  if (!trustedContextTokens.size || !/\b(?:our|we|us)\b/i.test(sentence)) return EMPTY_CONTEXT_TOKENS;
  // First-person copy such as "our co-founder" may inherit a verified official
  // host. A named organization after a relationship preposition is explicit
  // and wins instead, so the hostname can never overwrite ResearchHub with
  // Coinbase (or an equivalent contradiction).
  const namedOrganizations = [...sentence.matchAll(
    /(?:\b(?:at|for|of|with)\s+(?:(?:our|the)\s+)?|,\s*(?:the\s+)?)([A-Z][A-Za-z0-9.-]{2,})/g,
  )].map((match) => looseTokens(match[1])[0]).filter(Boolean);
  return namedOrganizations.some((token) => !trustedContextTokens.has(token))
    ? EMPTY_CONTEXT_TOKENS
    : trustedContextTokens;
}

function sentenceValueIsSupported(
  sentence: string,
  lead: BasicFactLead,
  trustedContextTokens: ReadonlySet<string>,
): boolean {
  const safeContext = safeHostContextForSentence(sentence, trustedContextTokens);
  return looseContainsPhrase(sentence, lead.value)
    || structuredValueIsSupported(sentence, lead, safeContext);
}

const OFFICIAL_SELF_REFERENCE = /\b(?:we|it|our\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture)|(?:the|this)\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i;

const SUBJECT_SWITCH_LANGUAGE = /\b(?:and|with|adviser|advisor|affiliate|announc(?:e[ds]?|ement)|client|confirm(?:s|ed)?|customer|director|employee|integration\s+partner|investor|member|partner|portfolio\s+company|report(?:s|ed)?|sa(?:id|ys)|stat(?:e[ds]?)|subsidiary|vendor)\b/gi;
const OWNERSHIP_SWITCH_LANGUAGE = /^(?:adviser|advisor|affiliate|client|customer|director|employee|integration\s+partner|investor|member|partner|portfolio\s+company|subsidiary|vendor)$/i;

function segmentIntroducesNamedActor(segment: string, lead: BasicFactLead): boolean {
  const allowedTokens = new Set([
    ...canonicalValueTokens(lead.value),
    ...(VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? []),
    "a", "an", "approval", "as", "at", "by", "completion", "for", "from", "in", "its",
    "of", "on", "own", "record", "the", "that", "to",
  ]);
  for (const match of segment.matchAll(SUBJECT_SWITCH_LANGUAGE)) {
    if (match.index === undefined) continue;
    if (OWNERSHIP_SWITCH_LANGUAGE.test(match[0])) return true;
    const after = segment.slice(match.index + match[0].length, match.index + match[0].length + 96);
    if (/^\s*(?:[,:'’s-]+\s*)?(?:that\s+)?(?:it|its|we|our|the\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i.test(after)) continue;
    const unexpected = looseTokens(after).filter((token) => !/^\d/.test(token) && !allowedTokens.has(token));
    if (unexpected.length) return true;
  }
  return false;
}

function claimTailTransfersOwnership(clause: string, lead: BasicFactLead): boolean {
  const matches = positivePredicateMatches(clause, lead.predicate);
  const firstMatch = matches[0];
  if (firstMatch?.index === undefined) return false;
  const tail = clause.slice(firstMatch.index + firstMatch[0].length);
  const allowed = new Set([
    ...canonicalValueTokens(lead.value),
    ...(VALUE_DESCRIPTOR_TOKENS[lead.predicate] ?? []),
    "april", "august", "calendar", "day", "daily", "december", "ended", "ending",
    "february", "fiscal", "january", "july", "june", "march", "may", "month", "monthly",
    "november", "october", "september",
    "period", "q1", "q2", "q3", "q4", "quarter", "quarterly", "the", "week", "year", "yearly",
  ]);
  for (const match of tail.matchAll(/\b(?:for|generated\s+by|on\s+behalf\s+of|belonging\s+to|attributed\s+to)\b/gi)) {
    if (match.index === undefined) continue;
    const after = tail.slice(match.index + match[0].length, match.index + match[0].length + 96);
    if (/^\s*(?:it|its|our|the\s+(?:business|company|exchange|organization|platform|product|project|protocol|service|venture))\b/i.test(after)) continue;
    const unexpected = looseTokens(after).filter((token) => !/^\d/.test(token) && !allowed.has(token));
    if (unexpected.length) return true;
  }
  return false;
}

function subjectAliasAvoidsTransfer(
  clause: string,
  lead: BasicFactLead,
  alias: string,
): boolean {
  const aliasPattern = new RegExp(`\\b${loosePhrasePattern(alias)}\\b`, "i");
  const aliasMatch = aliasPattern.exec(clause);
  if (!aliasMatch || aliasMatch.index === undefined) return false;
  const aliasEnd = aliasMatch.index + aliasMatch[0].length;
  if (/\baccording\s+to\s*$/i.test(clause.slice(Math.max(0, aliasMatch.index - 32), aliasMatch.index))) return false;
  return positivePredicateMatches(clause, lead.predicate).some((predicateMatch) => {
    if (predicateMatch.index === undefined) return false;
    if (predicateMatch.index < aliasMatch.index) {
      const between = clause.slice(predicateMatch.index + predicateMatch[0].length, aliasMatch.index);
      // Two common passive constructions bind a value to the subject after
      // the predicate. Keep this whitelist narrow so a subject mentioned later
      // in commentary cannot inherit an earlier company's facts.
      return (lead.predicate === "funding" && /\bby\s*$/i.test(between))
        || (lead.predicate === "official_token" && /\bof\s*$/i.test(between));
    }
    return !segmentIntroducesNamedActor(clause.slice(aliasEnd, predicateMatch.index), lead);
  });
}

function subjectComparisonIsDisqualified(clause: string, subject: string): boolean {
  const pattern = loosePhrasePattern(subject);
  if (!pattern) return true;
  return [
    new RegExp(`\\b(?:unlike|versus|vs\\.?|against|not)\\s+${pattern}\\b`, "i"),
    new RegExp(`\\b${pattern}\\b\\s+(?:competitor|rival)\\s+`, "i"),
    new RegExp(`\\b${pattern}\\b\\s+(?:and|with)\\s+[A-Z][A-Za-z0-9.'’-]+\\s+(?:reported|raised|is|was|has|had|uses|launched|completed|published|deployed|runs|settled|listed)\\b`, "i"),
  ].some((candidate) => candidate.test(clause));
}

function directClaimClause(
  clauses: readonly string[],
  lead: BasicFactLead,
  aliases: readonly string[],
  trustedContextTokens: ReadonlySet<string>,
): string | null {
  const direct = clauses.find((clause) =>
    hasSubjectAlias(clause, aliases)
    && aliases.every((alias) => !looseContainsPhrase(clause, alias) || !subjectComparisonIsDisqualified(clause, alias))
    && (DIRECT_RELATION_PREDICATES.has(lead.predicate)
      || aliases.some((alias) => subjectAliasAvoidsTransfer(clause, lead, alias)))
    && sentenceValueIsSupported(clause, lead, trustedContextTokens)
    && predicateIsSupported(clause, lead.predicate)
    && !claimTailTransfersOwnership(clause, lead)
    && roleAttributionIsSupported(clause, lead, aliases));
  if (direct) return direct;
  if (!trustedContextTokens.size) return null;
  return clauses.find((clause) =>
    OFFICIAL_SELF_REFERENCE.test(clause)
    && !/\b(?:competitor|rival|unlike|versus|vs\.)\b/i.test(clause)
    && aliases.every((alias) => !looseContainsPhrase(clause, alias) || subjectAliasAvoidsTransfer(clause, lead, alias))
    && !segmentIntroducesNamedActor(clause.slice(OFFICIAL_SELF_REFERENCE.exec(clause)?.index ?? 0), lead)
    && !claimTailTransfersOwnership(clause, lead)
    && sentenceValueIsSupported(clause, lead, trustedContextTokens)
    && predicateIsSupported(clause, lead.predicate)) ?? null;
}

function anchorGovernsClaimClause(
  clause: string,
  lead: BasicFactLead,
  anchor: string,
): boolean {
  if (
    subjectComparisonIsDisqualified(clause, anchor)
    || !sentenceValueIsSupported(clause, lead, EMPTY_CONTEXT_TOKENS)
    || !predicateIsSupported(clause, lead.predicate)
  ) return false;
  if (claimTailTransfersOwnership(clause, lead)) return false;
  const anchorPattern = new RegExp(`\\b${loosePhrasePattern(anchor)}\\b`, "i");
  const anchorMatch = anchorPattern.exec(clause);
  if (!anchorMatch || anchorMatch.index === undefined) return false;
  const anchorStart = anchorMatch.index;
  const anchorEnd = anchorStart + anchorMatch[0].length;
  for (const predicateMatch of positivePredicateMatches(clause, lead.predicate)) {
    if (predicateMatch.index === undefined) continue;
    const predicateStart = predicateMatch.index;
    if (predicateStart >= anchorStart && predicateStart - anchorEnd <= 140) {
      const between = clause.slice(anchorEnd, predicateStart);
      if (/\b(?:competitor|rival|unlike|versus|vs\.?|rather than|not)\b/i.test(between)) continue;
      if (segmentIntroducesNamedActor(between, lead)) continue;
      if (/\b(?:and|while|whereas|but)\s+[A-Z][A-Za-z0-9.'’-]+\s+(?:is|was|has|had|reported|raised|listed|settled|launched|uses|completed|published|deployed|runs)\b/.test(between)) continue;
      return true;
    }
    if (predicateStart < anchorStart && anchorStart - (predicateStart + predicateMatch[0].length) <= 55) {
      const beforeAnchor = clause.slice(predicateStart, anchorStart);
      if (["founded", "product", "exit"].includes(lead.predicate)
        && !/\b(?:unlike|competitor|rival|not)\b/i.test(beforeAnchor)) return true;
    }
  }
  return false;
}

function legalEntityGovernsClaim(clause: string, lead: BasicFactLead): boolean {
  if (!lead.attributedEntity || !looseContainsPhrase(clause, lead.value) || !predicateIsSupported(clause, lead.predicate)) return false;
  const entityPatternText = loosePhrasePattern(lead.attributedEntity);
  const valuePatternText = loosePhrasePattern(lead.value);
  if (!entityPatternText || !valuePatternText) return false;
  const entityPattern = new RegExp(`\\b${entityPatternText}\\b`, "i");
  const valuePattern = new RegExp(`\\b${valuePatternText}\\b`, "i");
  const rawEntityMatch = entityPattern.exec(clause);
  const rawValueMatch = valuePattern.exec(clause);
  if (rawValueMatch?.index !== undefined) {
    const afterValue = clause.slice(rawValueMatch.index + rawValueMatch[0].length);
    const adverseTarget = /\b(?:against|involving)\s+([^,.;]+?)(?=\s+(?:and|but|while|whereas)\b|$)/i.exec(afterValue)?.[1]?.trim();
    if (adverseTarget && !looseContainsPhrase(adverseTarget, lead.attributedEntity)) {
      const targetTokens = sourceTokens(adverseTarget);
      const capitalized = targetTokens.filter((token) => /^\p{Lu}[\p{L}\p{M}'’-]+$/u.test(token.raw));
      const entitySuffix = targetTokens.some((token) =>
        ["company", "corp", "corporation", "exchange", "foundation", "inc", "labs", "llc", "ltd", "protocol"].includes(token.key));
      if (capitalized.length >= 2 || entitySuffix) return false;
    }
  }
  if (rawEntityMatch?.index !== undefined
    && /\baccording\s+to\s*$/i.test(clause.slice(Math.max(0, rawEntityMatch.index - 32), rawEntityMatch.index))) return false;
  const predicateAfterEntity = rawEntityMatch?.index !== undefined
    && positivePredicateMatches(clause, lead.predicate).some((match) =>
      match.index !== undefined && match.index >= rawEntityMatch.index!);
  if (predicateAfterEntity && !subjectAliasAvoidsTransfer(clause, lead, lead.attributedEntity)) return false;
  const sanitized = clause
    .replace(/,\s*(?:co[- ]?)?founded\s+by\s+[^,]+,/gi, ", ")
    .replace(/\bthe\s+company\s+(?:co[- ]?)?founded\s+by\s+[^,]+,/gi, "the company ");
  if ([
    new RegExp(`\\b${entityPatternText}(?:['’]s|[- ](?:founded|owned|led))\\s+(?:business|company|firm|project|protocol|venture)?\\s*[A-Z]`, "i"),
    new RegExp(`\\b(?:founded|owned|led)\\s+by\\s+${entityPatternText}\\b`, "i"),
    new RegExp(`\\b${entityPatternText}\\b\\s+(?:and|with)\\s+[A-Z][A-Za-z0-9.'’-]+\\s+(?:settled|was|is|entered|faced|received)\\b`, "i"),
  ].some((pattern) => pattern.test(clause))) return false;
  const entityMatch = entityPattern.exec(sanitized);
  const valueMatch = valuePattern.exec(sanitized);
  if (!entityMatch || entityMatch.index === undefined || !valueMatch || valueMatch.index === undefined) return false;
  if (entityMatch.index <= valueMatch.index) {
    const between = sanitized.slice(entityMatch.index + entityMatch[0].length, valueMatch.index);
    const allowed = new Set(["sec", "cftc", "doj", "ftc", "fca", ...looseTokens(lead.value)]);
    const hasOtherNamedActor = sourceTokens(between).some((token) =>
      /^\p{Lu}[\p{L}\p{M}'’-]+$/u.test(token.raw)
      && token.raw.length > 1
      && !allowed.has(token.key));
    return !hasOtherNamedActor;
  }
  const between = sanitized.slice(valueMatch.index + valueMatch[0].length, entityMatch.index);
  return /\b(?:against|charged|charging|named|sued|suing|with)\b/i.test(between)
    || /\b(?:charged|indicted|sued)\s*$/i.test(sanitized.slice(Math.max(0, entityMatch.index - 45), entityMatch.index));
}

function legalClaimClause(
  clauses: readonly string[],
  lead: BasicFactLead,
  aliases: readonly string[],
): string | null {
  if (!lead.attributedEntity || !lead.eventStatus) return null;
  const directEntity = aliases.some((alias) => exactEntityKey(alias) === exactEntityKey(lead.attributedEntity!));
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index];
    if (!legalEntityGovernsClaim(clause, lead) || (directEntity && !hasSubjectAlias(clause, aliases))) continue;
    if (looseContainsPhrase(clause, lead.eventStatus)) return clause;
    const continuation = clauses[index + 1];
    if (continuation
      && looseContainsPhrase(continuation, lead.eventStatus)
      && /\b(?:it|the (?:action|case|matter|proceeding)|this (?:action|case|matter|proceeding))\b/i.test(continuation)
      && probablePersonSpans(sourceTokens(continuation)).length === 0) return clause;
  }
  return null;
}

function governingClaimClause(
  passage: string,
  lead: BasicFactLead,
  aliases: readonly string[],
  trustedContextTokens: ReadonlySet<string>,
): string | null {
  const clauses = attributionClauses(passage);
  if (lead.predicate === "founder") {
    if (!founderAttributionIsSupported(passage, lead, aliases)) return null;
    return clauses.find((clause) => looseContainsPhrase(clause, lead.value) && predicateIsSupported(clause, lead.predicate)) ?? null;
  }
  if (lead.predicate === "legal_regulatory_event") {
    const legalClause = legalClaimClause(clauses, lead, aliases);
    if (!legalClause || !lead.attributedEntity) return null;
    const directEntity = aliases.some((alias) => exactEntityKey(alias) === exactEntityKey(lead.attributedEntity!));
    if (directEntity) return legalClause;
    const relationshipBound = clauses.some((clause) =>
      hasSubjectAlias(clause, aliases)
      && looseContainsPhrase(clause, lead.attributedEntity!)
      && RELATION_LANGUAGE.test(clause));
    return relationshipBound ? legalClause : null;
  }
  if (lead.predicate === "official_identity") {
    const direct = directClaimClause(clauses, lead, aliases, trustedContextTokens);
    const personIdentityQuestion = /^(?:person|investor)\.official_identity$/.test(lead.questionId ?? "");
    if (
      direct
      && (!personIdentityQuestion
        || titleBindsOfficialIdentity(direct, lead)
        || explicitPersonIdentityIsBound(direct, lead))
    ) return direct;
    return clauses.find((clause) =>
      hasSubjectAlias(clause, aliases)
      && looseContainsPhrase(clause, lead.value)
      && predicateIsSupported(clause, lead.predicate)
      && (titleBindsOfficialIdentity(clause, lead)
        || (personIdentityQuestion && explicitPersonIdentityIsBound(clause, lead)))) ?? null;
  }
  if (DIRECT_RELATION_PREDICATES.has(lead.predicate)) {
    return directClaimClause(clauses, lead, aliases, trustedContextTokens);
  }
  if (!RELATION_CHAIN_PREDICATES.has(lead.predicate)) {
    return directClaimClause(clauses, lead, aliases, trustedContextTokens);
  }
  const anchors = valueAnchorTokens(lead);
  if (!anchors.length) return null;
  const direct = directClaimClause(clauses, lead, aliases, trustedContextTokens);
  if (direct && anchors.some((anchor) =>
    anchorGovernsClaimClause(direct, lead, anchor)
    || safeHostContextForSentence(direct, trustedContextTokens).has(anchor))) return direct;
  const relationEstablished = clauses.some((clause) => {
    const context = safeHostContextForSentence(clause, trustedContextTokens);
    return hasSubjectAlias(clause, aliases)
      && RELATION_LANGUAGE.test(clause)
      && anchors.some((anchor) =>
        (looseContainsPhrase(clause, anchor) && !subjectComparisonIsDisqualified(clause, anchor))
        || context.has(anchor));
  });
  if (!relationEstablished) return null;
  return clauses.find((clause) => anchors.some((anchor) => anchorGovernsClaimClause(clause, lead, anchor))) ?? null;
}

function predicateAttributionIsSupported(
  passage: string,
  lead: BasicFactLead,
  aliases: readonly string[],
  trustedContextTokens: ReadonlySet<string>,
): boolean {
  return governingClaimClause(passage, lead, aliases, trustedContextTokens) !== null;
}

function passageSupportsLead(
  passage: string,
  lead: BasicFactLead,
  aliases: readonly string[],
  trustedContextTokens: ReadonlySet<string> = new Set(),
): boolean {
  const baseSupported = aliases.some((alias) => looseContainsPhrase(passage, alias))
    && (
      looseContainsPhrase(passage, lead.value)
      || structuredValueIsSupported(passage, lead, trustedContextTokens)
    );
  return baseSupported
    && predicateAttributionIsSupported(passage, lead, aliases, trustedContextTokens);
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
  trustedContextTokens: ReadonlySet<string> = new Set(),
): string | null {
  const excerpt = normalize(decodeHtmlEntities(lead.excerpt));
  const exact = page.includes(excerpt) ? excerpt : exactTokenPassage(page, excerpt);
  if (exact && passageSupportsLead(exact, lead, aliases, trustedContextTokens)) return exact;

  const candidates = [...new Set([
    ...sourceSentencePassages(page),
    ...sourceAnchorPassages(page, lead.value),
  ])].filter((passage) => passageSupportsLead(passage, lead, aliases, trustedContextTokens));
  if (!candidates.length) return null;
  return candidates.sort((left, right) =>
    overlapScore(right, excerpt) - overlapScore(left, excerpt)
    || left.length - right.length)[0];
}

const normalizedHost = (host: string): string => host
  .toLowerCase()
  .replace(/\.$/, "")
  .replace(/^www\./, "");

const PATH_TENANTED_HOSTS = new Set([
  "bitbucket.org", "docs.google.com", "drive.google.com", "github.com", "gitlab.com",
  "linkedin.com", "medium.com", "notion.so", "t.me", "x.com", "youtube.com",
]);
const CASE_INSENSITIVE_TENANT_PATH_HOSTS = new Set(["github.com", "x.com"]);

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

function sameOfficialScope(
  document: Pick<PublicTextDocument, "host" | "url">,
  officialScopes: readonly string[],
): boolean {
  let candidateUrl: URL;
  try { candidateUrl = new URL(document.url); } catch { return false; }
  const candidateHost = normalizedHost(document.host);
  return officialScopes.some((scope) => {
    let configured: { host: string; path: string; pathScoped: boolean };
    try {
      const configuredUrl = new URL(scope.includes("://") ? scope : `https://${scope}`);
      const path = configuredUrl.pathname.replace(/\/+$/, "");
      configured = {
        host: normalizedHost(configuredUrl.hostname),
        path,
        pathScoped: scope.includes("://") && path.length > 0,
      };
    } catch {
      return false;
    }
    const { host: configuredHost, path: configuredPath, pathScoped } = configured;
    const pathTenantedHost = PATH_TENANTED_HOSTS.has(configuredHost);
    if (pathTenantedHost && candidateHost !== configuredHost) return false;
    if (!pathTenantedHost && candidateHost !== configuredHost && !candidateHost.endsWith(`.${configuredHost}`)) return false;
    // A dedicated subdomain is its own scope. Path ownership matters only when
    // many unrelated tenants share the exact configured hostname.
    if (candidateHost !== configuredHost || !pathTenantedHost) return true;
    if (!pathScoped || configuredPath === "/") return false;
    const candidatePath = candidateUrl.pathname.replace(/\/+$/, "");
    const comparableCandidatePath = CASE_INSENSITIVE_TENANT_PATH_HOSTS.has(configuredHost)
      ? candidatePath.toLowerCase()
      : candidatePath;
    const comparableConfiguredPath = CASE_INSENSITIVE_TENANT_PATH_HOSTS.has(configuredHost)
      ? configuredPath.toLowerCase()
      : configuredPath;
    return comparableCandidatePath === comparableConfiguredPath
      || comparableCandidatePath.startsWith(`${comparableConfiguredPath}/`);
  });
}

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

function directPersonLegalIdentityIsBound(
  passage: string,
  aliases: readonly string[],
  officialCounterpartyHosts: readonly string[],
): boolean {
  const knownOrganizationTokens = new Set(officialCounterpartyHosts.flatMap((scope) => {
    try {
      const url = new URL(scope.includes("://") ? scope : `https://${scope}`);
      return [...trustedHostContextTokens(url.hostname)];
    } catch {
      return [];
    }
  }));
  if (!knownOrganizationTokens.size) return false;
  return attributionClauses(passage).some((clause) =>
    hasSubjectAlias(clause, aliases)
    && RELATION_LANGUAGE.test(clause)
    && [...knownOrganizationTokens].some((token) => looseContainsPhrase(clause, token)));
}

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

/**
 * Token-type language establishes the instrument, not who owns or issued it.
 * For a person's or investor's related asset, require the same bounded clause
 * to affirmatively bind that token to the verified venture. Compatibility,
 * listing, and custody copy never establishes ownership. An explicit issuer
 * or creator outside the venture is a hard reject.
 */
const TOKEN_ENTITY_LEGAL_SUFFIX = "(?:global|group|holding|holdings|co|company|corp|corporation|inc|incorporated|limited|llc|ltd|plc)";
const CAPTURED_TOKEN_ENTITY = "([^,.!?;]{1,100}?)(?=\\s+(?:and|but|that|which|while|who)\\b|[,.;:!?)]|$)";
const CAPTURED_TERMINAL_TOKEN_ENTITY = "([^.!?;]{1,100}?)(?=[.!?;]|$)";

function exactTokenVentureEntityPattern(name: string): string | null {
  const venture = loosePhrasePattern(name);
  if (!venture) return null;
  return `(?:the\\s+)?${venture}(?:\\s*,?\\s+${TOKEN_ENTITY_LEGAL_SUFFIX})*`;
}

function capturedTokenEntityMatchesVenture(
  value: string,
  relationships: readonly VerifiedVentureAssetRelationship[],
): boolean {
  const entity = clean(value, 120);
  return Boolean(entity && relationships.some((relationship) =>
    registryIssuerMatchesRelationship(entity, relationship.name)));
}

function relationshipBoundTokenHasAffirmativeVentureLink(
  claimClause: string,
  lead: BasicFactLead,
  relationships: readonly VerifiedVentureAssetRelationship[],
): boolean {
  const value = loosePhrasePattern(lead.value);
  if (!value) return false;
  const originAttributions = [...claimClause.matchAll(new RegExp(
    `\\b(?:created|deployed|developed|issued|launched|minted|owned)\\s+(?:by|of)\\s+${CAPTURED_TOKEN_ENTITY}`,
    "gi",
  ))];
  if (originAttributions.some((match) =>
    !capturedTokenEntityMatchesVenture(match[1], relationships))) return false;
  const tokenDescriptor = "(?:official|governance|native|utility|wrapped|erc[- ]?\\d+)";
  const terminalValue = `\\(?${value}\\)?(?=$|\\s*[.!?](?:\\s|$))`;
  const tokenOfVenture = new RegExp(
    `^(?:the\\s+)?\\$?${value}\\s+is\\s+(?:the\\s+)?${tokenDescriptor}\\s+(?:crypto\\s+)?token\\s+of\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}`,
    "i",
  ).exec(claimClause);
  if (tokenOfVenture && capturedTokenEntityMatchesVenture(tokenOfVenture[1], relationships)) return true;

  const reverseOrigin = new RegExp(
    `^(?:the\\s+)?\\$?${value}\\s+(?:is|was)\\s+(?:created|issued|minted)\\s+by\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}`,
    "i",
  ).exec(claimClause);
  if (reverseOrigin && capturedTokenEntityMatchesVenture(reverseOrigin[1], relationships)) return true;

  const brandDescriptor = "(?:wrapped|staked|bridged|liquid|tokenized)";
  const brandedBase = `(?:${brandDescriptor}\\s+){1,3}([A-Za-z0-9]{2,12})`;
  const brandedContinuationIsValid = (match: RegExpExecArray | null): boolean => {
    const base = match?.[1];
    if (!base || !/^[A-Z0-9]{2,12}$/.test(base)) return false;
    const normalizedValue = looseTokens(lead.value).join("");
    if (!normalizedValue.endsWith(base.toLowerCase())) return false;
    const tail = claimClause.slice((match.index ?? 0) + match[0].length).trim();
    if (!tail || /^[\s,.;:!?()[\]'"–—-]+$/.test(tail)) return true;
    const simpleTokenTail = new RegExp(
      `^is\\s+(?:a|an|the)\\s+${tokenDescriptor}\\s+(?:crypto\\s+)?token\\s*[.!?]?$`,
      "i",
    );
    if (simpleTokenTail.test(tail)) return true;

    const stakedRepresentation = new RegExp(
      `^is\\s+a\\s+utility\\s+token\\s+that\\s+represents\\s+([A-Za-z0-9]{2,12})\\s+staked\\s+through\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}[.!?]?$`,
      "i",
    ).exec(tail);
    if (
      stakedRepresentation
      && /^[A-Z0-9]{2,12}$/.test(stakedRepresentation[1])
      && stakedRepresentation[1].toLowerCase() === base.toLowerCase()
      && capturedTokenEntityMatchesVenture(stakedRepresentation[2], relationships)
    ) return true;

    const backedRepresentation = new RegExp(
      `^[,;:\\u2013\\u2014-]?\\s*an\\s+erc(?:[- ]?\\d+)?\\s+token\\s+backed\\s+1:1\\s+by\\s+(Bitcoin|BTC)\\s+held\\s+by\\s+${CAPTURED_TERMINAL_TOKEN_ENTITY}[.!?]?$`,
      "i",
    ).exec(tail);
    return Boolean(
      backedRepresentation
      && base.toUpperCase() === "BTC"
      && capturedTokenEntityMatchesVenture(backedRepresentation[2], relationships)
    );
  };
  return relationships.some((relationship) => {
    const venture = exactTokenVentureEntityPattern(relationship.name);
    if (!venture) return false;
    const directOrigin = new RegExp(
      `^${venture}\\s+(?:created|issued|minted)\\s+${terminalValue}`,
      "i",
    ).test(claimClause);
    if (directOrigin) return true;

    const possessive = new RegExp(
      `^${venture}['’]s\\s+(?:${tokenDescriptor}\\s+){1,2}(?:crypto\\s+)?token\\s+(?:is\\s+)?${terminalValue}`,
      "i",
    ).test(claimClause);
    if (possessive) return true;

    const directBrand = new RegExp(
      `^${venture}\\s+${brandedBase}\\s*\\(\\s*${value}\\s*\\)`,
      "i",
    ).exec(claimClause);
    if (brandedContinuationIsValid(directBrand)) return true;

    const combinedBrand = new RegExp(
      `^${venture}\\s+is\\s+rolling\\s+out\\s+${value}\\s*[,;:\\u2013\\u2014-]\\s*${venture}\\s+${brandedBase}`,
      "i",
    ).exec(claimClause);
    if (brandedContinuationIsValid(combinedBrand)) return true;

    const valueFirstBrand = new RegExp(
      `^(?:the\\s+)?\\$?${value}\\s*[,;:\\u2013\\u2014-]\\s*${venture}\\s+${brandedBase}`,
      "i",
    ).exec(claimClause);
    return brandedContinuationIsValid(valueFirstBrand);
  });
}

const TOKEN_PAGE_UNCERTAINTY = /\b(?:alleged|candidate|claimed|demo|draft|experimental|fake|former|future|hypothetical|intended|mock|non-live|potential|proposed|purported|rumored|so-called|supposedly|test|testnet|unofficial|unlaunched|uncertain)\b/i;

/**
 * Coinbase's canonical wrapped-asset URLs are locale-negotiated. Cloudflare can
 * block the canonical request before that redirect is observed, while the same
 * first-party product page remains fetchable at Coinbase's stable en-mx path.
 * Keep this recovery deliberately exact so a generic listing page can never be
 * upgraded into founder-owned token evidence.
 */
function coinbaseWrappedAssetLocaleFallback(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "www.coinbase.com" && url.hostname !== "coinbase.com") return null;
    if (url.search || url.hash) return null;
    const match = /^\/(cbbtc|cbeth)\/?$/i.exec(url.pathname);
    if (!match) return null;
    url.pathname = `/en-mx/${match[1].toLowerCase()}`;
    return url.toString();
  } catch {
    return null;
  }
}

function coinbaseWrappedAssetProductPassage(
  title: string,
  body: string,
  symbol: string,
): string | null {
  if (
    !looseContainsPhrase(title, "Coinbase")
    || !looseContainsPhrase(title, symbol)
    || /\b(?:404|not found|page unavailable)\b/i.test(title)
  ) return null;

  const normalizedBody = normalize(decodeHtmlEntities(body.replace(/<[^>]+>/g, " ")));
  if (searchable(symbol) === "cbbtc") {
    const wrappedCustody = /\bCoinbase\s+wrapped\s+assets?\b[^.!?]{0,220}\bbacked\s+1:1\b[^.!?]{0,160}\bheld\s+in\s+custody\s+by\s+Coinbase\b/i.exec(normalizedBody);
    return wrappedCustody ? normalize(`${title}. ${wrappedCustody[0]}`) : null;
  }
  if (searchable(symbol) === "cbeth") {
    const productClass = /(?:\bliquid\s+staking\s+token\b|\bwrap\s+your\s+staked\s+ETH\s+to\s+cbETH\b|\bcbETH\b[^.!?]{0,120}\btraded\s+on\s+Coinbase\b)/i.exec(normalizedBody);
    const ventureWhitepaper = /(?:\bCoinbase['’]s\s+whitepaper\b[^.!?]{0,260}\bcbETH\b|\bcbETH\b[^.!?]{0,260}\bCoinbase['’]s\s+whitepaper\b)/i.exec(normalizedBody);
    return productClass && ventureWhitepaper
      ? normalize(`${title}. ${productClass[0]}. ${ventureWhitepaper[0]}`)
      : null;
  }
  return null;
}

function isExpectedCoinbaseWrappedAssetPage(
  result: PublicTextResult,
  fallbackUrl: string,
): boolean {
  if (result.status !== "ok") return false;
  const symbol = new URL(fallbackUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
  let pathSegments: string[];
  try {
    pathSegments = decodeURIComponent(new URL(result.url).pathname).split("/").filter(Boolean);
  } catch {
    return false;
  }
  const exactProductPath = pathSegments.length === 1
    || (pathSegments.length === 2 && /^[a-z]{2}(?:-[a-z]{2})?$/i.test(pathSegments[0]));
  if (!exactProductPath || searchable(pathSegments.at(-1) ?? "") !== searchable(symbol)) return false;

  const metadata = /^Title:\s*(.+?)\s+URL Source:\s*(.+?)\s+Markdown Content:\s*/i.exec(result.text);
  const htmlTitle = /<title\b[^>]*>([\s\S]{1,1000}?)<\/title>/i.exec(result.text)?.[1];
  const title = normalize(decodeHtmlEntities((metadata?.[1] ?? htmlTitle ?? "").replace(/<[^>]+>/g, " ")));
  const body = metadata?.[1] && metadata.index === 0
    ? result.text.slice(metadata[0].length)
    : result.text;
  return Boolean(coinbaseWrappedAssetProductPassage(title, body, symbol));
}

/**
 * Some first-party product pages split one proof across their page title and
 * product copy. Coinbase's cbBTC page, for example, names the product in the
 * title and separately says Coinbase wrapped assets are backed 1:1 and held by
 * Coinbase. This narrow product-page verifier permits that same-page proof only
 * when a verified current venture relationship already exists, the official
 * product URL and title both name the symbol, and the body independently binds
 * the product class to that venture. A standard locale prefix introduced by an
 * official same-host redirect is allowed. Generic asset listings, partner
 * tokens, and externally issued assets remain rejected.
 */
function officialVentureAssetPagePassage(
  document: PublicTextDocument,
  page: string,
  lead: BasicFactLead,
  relationships: readonly VerifiedVentureAssetRelationship[],
): string | null {
  if (!/^\$?[A-Za-z][A-Za-z0-9.-]{1,15}$/.test(lead.value)) return null;
  const metadata = /^Title:\s*(.+?)\s+URL Source:\s*(.+?)\s+Markdown Content:\s*/i.exec(page);
  const htmlTitle = /html|xhtml/i.test(document.contentType)
    ? /<title\b[^>]*>([\s\S]{1,1000}?)<\/title>/i.exec(document.text)?.[1]
    : undefined;
  if ((!metadata?.[1] || metadata.index !== 0) && !htmlTitle) return null;
  const title = normalize(decodeHtmlEntities((metadata?.[1] ?? htmlTitle ?? "").replace(/<[^>]+>/g, " ")));
  const body = metadata?.[1] && metadata.index === 0
    ? page.slice(metadata[0].length)
    : page;
  let pathSymbol: string;
  try {
    const segments = decodeURIComponent(new URL(document.url).pathname)
      .split("/")
      .filter(Boolean);
    if (segments.length === 2 && !/^[a-z]{2}(?:-[a-z]{2})?$/i.test(segments[0])) return null;
    if (segments.length !== 1 && segments.length !== 2) return null;
    pathSymbol = searchable(segments.at(-1) ?? "");
  } catch {
    return null;
  }
  if (pathSymbol !== searchable(lead.value)) return null;

  for (const relationship of relationships) {
    if (!looseContainsPhrase(title, relationship.name) || !looseContainsPhrase(title, lead.value)) continue;
    const venture = loosePhrasePattern(relationship.name);
    const value = loosePhrasePattern(lead.value);
    if (!venture || !value) continue;

    if (searchable(relationship.name) === "coinbase") {
      const verifiedCoinbaseProduct = coinbaseWrappedAssetProductPassage(title, body, lead.value);
      if (
        verifiedCoinbaseProduct
        && verifiedCoinbaseProduct.length <= MAX_SUPPORT_PASSAGE_CHARS
        && !TOKEN_PAGE_UNCERTAINTY.test(verifiedCoinbaseProduct)
      ) return verifiedCoinbaseProduct;
    }

    const wrappedCustody = new RegExp(
      `\\b${venture}\\s+wrapped\\s+assets?\\b[^.!?]{0,220}\\bbacked\\s+1:1\\b[^.!?]{0,160}\\bheld\\s+in\\s+custody\\s+by\\s+${venture}\\b`,
      "i",
    ).exec(body);
    if (wrappedCustody) {
      const passage = normalize(`${title}. ${wrappedCustody[0]}`);
      if (passage.length <= MAX_SUPPORT_PASSAGE_CHARS && !TOKEN_PAGE_UNCERTAINTY.test(passage)) return passage;
    }

    const tokenClass = new RegExp(
      `\\b\\$?${value}\\b[^.!?]{0,140}\\b(?:(?:liquid\\s+staking|wrapped|staked|governance|native|utility|erc[- ]?\\d+)\\s+)?token\\b`,
      "i",
    ).exec(body);
    const wrappedStakingProduct = new RegExp(
      `(?:\\bwrap\\s+your\\s+staked\\s+[a-z0-9-]+\\s+to\\s+\\$?${value}\\b|\\b\\$?${value}\\b[^.!?]{0,120}\\btraded\\s+on\\s+${venture}\\b)`,
      "i",
    ).exec(body);
    const ventureWhitepaper = new RegExp(
      `(?:\\b${venture}['’]s\\s+whitepaper\\b[^.!?]{0,260}\\b\\$?${value}\\b|\\b\\$?${value}\\b[^.!?]{0,260}\\b${venture}['’]s\\s+whitepaper\\b)`,
      "i",
    ).exec(body);
    const productClass = tokenClass ?? wrappedStakingProduct;
    if (!productClass || !ventureWhitepaper) continue;
    const passage = normalize(`${title}. ${productClass[0]}. ${ventureWhitepaper[0]}`);
    if (
      passage.length <= MAX_SUPPORT_PASSAGE_CHARS
      && looseContainsPhrase(passage, relationship.name)
      && looseContainsPhrase(passage, lead.value)
      && !TOKEN_PAGE_UNCERTAINTY.test(passage)
    ) return passage;
  }
  return null;
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
  ventureAssetRelationships: readonly VerifiedVentureAssetRelationship[] = [],
): BasicFact | null {
  const page = documentText(document);
  if (!isAtomicValue(lead.predicate, lead.value)) return null;
  if (lead.predicate === "legal_regulatory_event" && (!lead.eventStatus || !lead.attributedEntity)) return null;
  const official = sameOfficialScope(document, officialHosts);
  const publicSecurityRegulator = lead.predicate === "public_security"
    && regulatorySourceSupports(document.host, lead.predicate);
  const ventureAssetPredicate = lead.predicate === "public_security" || lead.predicate === "official_token";
  const authoritativeAssetRelationships = ventureAssetPredicate
    ? ventureAssetRelationships.filter((relationship) => {
      const ventureNamedByLead = looseContainsPhrase(
        `${lead.value} ${lead.qualifier ?? ""} ${lead.excerpt} ${lead.sourceTitle ?? ""}`,
        relationship.name,
      );
      const ventureOfficial = relationship.officialScopes.some((scope) => sameOfficialScope(document, [scope]));
      return ventureNamedByLead && (ventureOfficial || publicSecurityRegulator);
    })
    : [];
  const verificationAliases = [
    ...aliases,
    ...authoritativeAssetRelationships.map((relationship) => relationship.name),
  ];
  const counterpartyPredicate = new Set<BasicFactPredicate>([
    "official_identity", "current_role", "prior_role", "founder", "executive", "founded", "product",
    "exit", "track_record", "funding", "investor", "legal_entity", "governance",
    "public_security", "official_token",
  ]).has(lead.predicate);
  const applicableCounterpartyHosts = ventureAssetPredicate
    ? authoritativeAssetRelationships.flatMap((relationship) => relationship.officialScopes)
    : officialCounterpartyHosts;
  const officialCounterparty = !official
    && counterpartyPredicate
    && sameOfficialScope(document, applicableCounterpartyHosts);
  // A verified first-party/counterparty host may supply only the organization
  // anchor (for example, "our co-founder" on investor.coinbase.com). Subject,
  // predicate, dates, metrics, and every other value component still have to
  // appear in the same bounded passage. Independent press receives no context.
  const contextTokens = official || officialCounterparty
    ? trustedHostContextTokens(document.host)
    : new Set<string>();
  const personOrInvestorAsset = /^(?:person|investor)\./.test(lead.questionId ?? "");
  const officialAssetPageEvidence = lead.predicate === "official_token"
    && personOrInvestorAsset
    && officialCounterparty
    && authoritativeAssetRelationships.length
    ? officialVentureAssetPagePassage(document, page, lead, authoritativeAssetRelationships)
    : null;
  const excerpt = officialAssetPageEvidence
    ?? supportingSourcePassage(page, lead, verificationAliases, contextTokens);
  if (!excerpt) return null;
  const claimClause = officialAssetPageEvidence
    ?? governingClaimClause(excerpt, lead, verificationAliases, contextTokens);
  if (!claimClause) return null;
  // A related venture's first-party page may stand in for the person's name,
  // but only explicit crypto-token language may do so. A stock ticker or
  // security symbol on that same site must remain public_security evidence.
  if (lead.predicate === "official_token" && authoritativeAssetRelationships.length) {
    const explicitTokenLanguage = Boolean(officialAssetPageEvidence)
      || EXPLICIT_OFFICIAL_CRYPTO_TOKEN.test(claimClause)
      || EXPLICIT_WRAPPED_OR_ERC_TOKEN.test(claimClause);
    const affirmativeVentureLink = relationshipBoundTokenHasAffirmativeVentureLink(
      claimClause,
      lead,
      authoritativeAssetRelationships,
    ) || Boolean(officialAssetPageEvidence);
    // Project canonical-token verification remains on its existing path. The
    // stricter ownership gate applies only when a venture relationship stands
    // in for an audited person or investor.
    if (personOrInvestorAsset && (!explicitTokenLanguage || !affirmativeVentureLink)) return null;
    if (!personOrInvestorAsset && !EXPLICIT_OFFICIAL_CRYPTO_TOKEN.test(claimClause) && !affirmativeVentureLink) return null;
  }
  const verifiedValue = lead.predicate === "public_security"
    ? verifiedPublicSecurityValue(lead.value, claimClause)
    : lead.value;
  if (!verifiedValue) return null;
  const regulatory = !official && !officialCounterparty
    && regulatorySourceSupports(document.host, lead.predicate);
  const supportedQualifier = lead.qualifier && looseContainsPhrase(claimClause, lead.qualifier)
    ? lead.qualifier
    : undefined;
  const supportedEventStatus = lead.eventStatus && looseContainsPhrase(excerpt, lead.eventStatus)
    ? lead.eventStatus
    : undefined;
  const supportedAttributedEntity = lead.attributedEntity && looseContainsPhrase(excerpt, lead.attributedEntity)
    ? lead.attributedEntity
    : undefined;
  if (lead.predicate === "legal_regulatory_event" && (!supportedEventStatus || !supportedAttributedEntity)) return null;
  const rawAttributionScope = supportedAttributedEntity
    ? attributionScopeFor(supportedAttributedEntity, aliases)
    : undefined;
  const personOrInvestorLegalQuestion = lead.predicate === "legal_regulatory_event"
    && /^(?:person|investor)\./.test(lead.questionId ?? "");
  // An exact-name regulator hit is not proof that the named person is this
  // audited identity. Keep it visible, but outside question completion and
  // scoring, until the same bounded source also ties the person to a verified
  // venture/firm (or the disclosure comes from an identity-bound official site).
  const attributionScope = rawAttributionScope === "direct_subject"
    && personOrInvestorLegalQuestion
    && !official
    && !officialCounterparty
    && !directPersonLegalIdentityIsBound(excerpt, aliases, officialCounterpartyHosts)
    ? "identity_unresolved" as const
    : rawAttributionScope;
  const legalIdentity = lead.predicate === "legal_regulatory_event"
    ? `${searchable(supportedAttributedEntity!)}::${searchable(supportedEventStatus!)}`
    : "";
  const retrievalProvider = "retrievalProvider" in document
    && document.retrievalProvider === "jina-reader"
    ? "jina-reader"
    : "public-web";
  return {
    factId: factId(subjectKey, lead.predicate, verifiedValue, legalIdentity),
    subjectKey,
    predicate: lead.predicate,
    value: verifiedValue,
    normalizedValue: canonicalBasicFactComparisonValue(lead.predicate, searchable(verifiedValue)),
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
      provider: retrievalProvider,
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
  // A protocol deploys to many networks: several individually verified
  // single-chain answers ENUMERATE the footprint, they never conflict.
  "network",
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
    // A stock or debt-security classification must come from the issuer or a
    // regulator. Two news articles may corroborate a reported claim, but they
    // cannot authoritatively establish the instrument or its listing.
    if (rows[0]?.predicate === "public_security" && !official) return [];
    if (!official && independentHosts.size < 2) return [];
    return [{
      ...rows[0],
      status: official ? "verified" as const : "corroborated" as const,
      sources,
    }];
  });

  const singletonPredicates = new Set(resolved
    .filter((fact) =>
      !MULTI_VALUE_PREDICATES.has(fact.predicate)
      // A founder or investor can control more than one venture-issued token.
      // Keep the project-level canonical-token question singular, but do not
      // turn two separately verified person-level assets into a conflict.
      && !(fact.predicate === "official_token" && /^(?:person|investor)\./.test(fact.questionId ?? "")))
    .map((fact) => fact.predicate));
  for (const predicate of singletonPredicates) {
    const values = resolved.filter((fact) =>
      fact.predicate === predicate
      && !(fact.predicate === "official_token" && /^(?:person|investor)\./.test(fact.questionId ?? "")));
    if (values.length > 1) {
      values.forEach((fact) => { fact.status = "conflicted"; });
    }
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
      official = sameOfficialScope({ host, url: sourceUrl }, officialHosts)
        || sameOfficialScope({ host, url: sourceUrl }, officialCounterpartyHosts);
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

interface VerifiedVentureAssetRelationship {
  name: string;
  officialScopes: string[];
}

interface SecExchangeRegistryRow {
  cik: number;
  name: string;
  ticker: string;
  exchange: string;
  raw: unknown[];
}

const SEC_EXCHANGE_REGISTRY_URL = "https://www.sec.gov/files/company_tickers_exchange.json";

/**
 * The SEC exchange registry is a machine-readable JSON file, so fetch it
 * directly with a hard time bound. The article-recovery ladder
 * (fetchPublicTextWithRecovery: reader fallback plus delayed retry) exists for
 * flaky editorial pages and can stall for tens of seconds when the network is
 * down; a registry screen must degrade to "screen skipped" instead.
 */
async function fetchSecExchangeRegistry(): Promise<PublicTextResult> {
  let response: Response;
  try {
    response = await fetch(SEC_EXCHANGE_REGISTRY_URL, {
      headers: {
        accept: "application/json",
        // SEC.gov's fair-access policy rejects requests without a
        // self-identifying User-Agent (403). Same identity publicWeb uses.
        "user-agent": "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)",
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: "failed", reason: "transport_error" };
  }
  if (!response.ok) return { status: "failed", reason: `http_${response.status}` };
  let text: string;
  try {
    text = await response.text();
  } catch {
    return { status: "failed", reason: "response_text_error" };
  }
  return {
    status: "ok",
    url: SEC_EXCHANGE_REGISTRY_URL,
    host: "www.sec.gov",
    contentType: response.headers.get("content-type") ?? "application/json",
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Screen names against the US SEC exchange registry. Returns "matched" when
 * any name resolves to a listed issuer, "empty" when the completed screen
 * found none, and null when the registry was unavailable or no screenable
 * name was supplied. Exported for the founder related-asset path in
 * orchestrate, which screens ONLY after the venture's identity verified
 * through its official X account (an organization-NAMED host such as
 * aave.net can never anchor a consultation).
 */
export async function screenSecRegistryForNames(
  names: readonly string[],
): Promise<"matched" | "empty" | null> {
  const screenable = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 1))];
  if (!screenable.length) return null;
  const registry = await fetchSecExchangeRegistry();
  if (registry.status !== "ok") return null;
  const rows = secExchangeRegistryRows(registry);
  if (rows === null) return null;
  return screenable.some((name) => rows.some((row) => registryIssuerMatchesRelationship(row.name, name)))
    ? "matched"
    : "empty";
}

const networkChainTokens = (value: string): Set<string> => new Set(
  (value.match(/[A-Z][A-Za-z0-9]+(?: [A-Z][A-Za-z0-9]+)?/g) ?? [])
    .map((name) => name.toLowerCase())
    .filter((name) => !/^\d|^incl/.test(name)));

/**
 * Two OVERLAPPING chain lists answer "which networks" compatibly: one source
 * names the flagship deployments, another the full footprint. Overlap
 * corroborates; only disjoint lists are a real conflict. Exported for tests.
 */
export function overlappingNetworkAnswers(values: readonly string[]): boolean {
  if (values.length < 2) return true;
  const anchor = networkChainTokens(values[0]);
  if (!anchor.size) return false;
  return values.every((value, index) => index === 0
    || [...networkChainTokens(value)].some((name) => anchor.has(name)));
}

const CURRENT_CONTROL_ROLE = /\b(?:co[- ]?founder|founder|chief executive officer|ceo|chair(?:man|woman|person)?|owner|controlling)\b/i;
const CURRENT_PERIOD = /\b(?:current|currently|now|ongoing|present|today)\b/i;
const VENTURE_IDENTITY_STOP_WORDS = new Set([
  "co", "company", "corp", "corporation", "dao", "exchange", "foundation", "global",
  "group", "holding", "holdings", "inc", "labs", "limited", "llc", "ltd", "network",
  "plc", "project", "protocol", "technologies", "technology", "the",
]);
const COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS = new Set([
  "ac", "co", "com", "edu", "gov", "net", "org",
]);
const REGISTRY_LEGAL_ENTITY_TOKENS = new Set([
  "co", "company", "corp", "corporation", "inc", "incorporated", "limited", "llc", "ltd", "plc", "the",
]);
const REGISTRY_SHORTHAND_QUALIFIERS = new Set([
  "global", "group", "holding", "holdings",
]);

function safeVentureScope(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  return safeCandidateUrl(value.includes("://") ? value : `https://${value}`);
}

function ventureIdentityTokens(venture: CollectContext["evidence"]["ventures"][number]): string[] {
  return [...new Set([
    ...looseTokens(venture.project_name),
    ...looseTokens(venture.x_handle?.replace(/^@/, "") ?? ""),
  ].filter((token) => token.length >= 4 && !VENTURE_IDENTITY_STOP_WORDS.has(token)))];
}

/**
 * `evidence_url` is often a press or aggregator citation. It can define an
 * official venture scope only when the dedicated host itself identifies the
 * venture, or when a shared-host tenant path identifies it. A Forbes article
 * about Coinbase must never make forbes.com a Coinbase first-party domain.
 */
function evidenceUrlMatchesVentureIdentity(
  scope: string,
  venture: CollectContext["evidence"]["ventures"][number],
): boolean {
  let url: URL;
  try { url = new URL(scope); } catch { return false; }
  const host = normalizedHost(url.hostname);
  const identityTokens = ventureIdentityTokens(venture);
  if (!identityTokens.length) return false;
  if (PATH_TENANTED_HOSTS.has(host)) {
    let decodedPath: string;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { return false; }
    const pathTokens = looseTokens(decodedPath);
    return identityTokens.some((token) => pathTokens.includes(token));
  }
  const hostLabels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  return identityTokens.some((token) => hostLabels.includes(token));
}

function verifiedVentureOfficialScopes(
  venture: CollectContext["evidence"]["ventures"][number],
): string[] {
  const domainScope = safeVentureScope(venture.domain);
  const evidenceScope = safeVentureScope(venture.evidence_url);
  return [...new Set([
    ...(domainScope ? [domainScope] : []),
    ...(evidenceScope && evidenceUrlMatchesVentureIdentity(evidenceScope, venture)
      ? [evidenceScope]
      : []),
  ])];
}

/**
 * A person's related-asset answer is a two-link claim: the person must have a
 * verified, current control relationship with an organization, and a fetched
 * first-party source (or regulator for securities) must independently identify
 * the asset. The relationship never proves a token or security by itself; it
 * only supplies the entity and official scope for source checking.
 */
function verifiedVentureAssetRelationships(ctx: CollectContext): VerifiedVentureAssetRelationship[] {
  return ctx.evidence.ventures.flatMap((venture): VerifiedVentureAssetRelationship[] => {
    if (
      venture.artifact_verified !== true
      || venture.evidence_origin === "model_lead"
      || !venture.project_name?.trim()
      || !CURRENT_CONTROL_ROLE.test(venture.role ?? "")
      || !CURRENT_PERIOD.test(venture.period ?? "")
    ) return [];
    const officialScopes = verifiedVentureOfficialScopes(venture);
    return officialScopes.length ? [{ name: venture.project_name.trim(), officialScopes }] : [];
  });
}

function currentRoleRelationshipParts(value: string): { role: string; name: string } | null {
  const direct = /^(.{2,160}?)\s+(?:at|of)\s+(.{2,160})$/i.exec(normalize(value));
  const comma = direct ? null : /^(.{2,160}?),\s+(.{2,160})$/.exec(normalize(value));
  const role = clean(direct?.[1] ?? comma?.[1], 160);
  const name = clean(direct?.[2] ?? comma?.[2], 160);
  return role && name && CURRENT_CONTROL_ROLE.test(role) ? { role, name } : null;
}

/**
 * Search models occasionally return the same official passage for identity
 * but omit the separate founder row. When a verified current-role fact already
 * names the organization, recover that founder relationship from the fetched
 * passage itself. The synthesized row still goes through the normal source
 * fetch and founder-attribution verifier before it can publish.
 */
function sourceBackedFounderRelationshipLeads(
  ctx: CollectContext,
  facts: readonly BasicFact[],
): BasicFactLead[] {
  const audience = researchAudience(ctx);
  if (audience === "project") return [];
  const identities = facts.filter((fact) =>
    fact.predicate === "official_identity"
    && fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated")
    && plausiblePersonIdentity(fact.value));
  const relationships = facts.flatMap((fact): Array<{ name: string; discoveryProvider?: BasicFact["discoveryProvider"] }> => {
    if (
      fact.predicate !== "current_role"
      || fact.artifact_verified !== true
      || fact.status !== "verified"
    ) return [];
    const relationship = currentRoleRelationshipParts(fact.value);
    const name = relationship ? atomicPersonVentureValue(relationship.name) : null;
    return name ? [{ name, discoveryProvider: fact.discoveryProvider }] : [];
  });
  if (!identities.length || !relationships.length) return [];

  const aliases = [...new Set([...subjectAliases(ctx), ...identities.map((identity) => identity.value)])];
  const seen = new Set<string>();
  return identities.flatMap((identity) => relationships.flatMap((relationship): BasicFactLead[] =>
    facts.flatMap((fact): BasicFactLead[] => fact.sources.flatMap((source): BasicFactLead[] => {
      if (
        source.artifactVerified !== true
        || (source.sourceClass !== "official_subject" && source.sourceClass !== "official_counterparty")
        || !looseContainsPhrase(source.excerpt, identity.value)
        || !looseContainsPhrase(source.excerpt, relationship.name)
        || !predicateIsSupported(source.excerpt, "founder")
      ) return [];
      const lead: BasicFactLead = {
        subject: identity.value,
        predicate: "founder",
        value: relationship.name,
        questionId: `${audience}.founder`,
        excerpt: source.excerpt,
        sourceUrl: source.url,
        ...(source.title ? { sourceTitle: source.title } : {}),
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: identity.discoveryProvider ?? relationship.discoveryProvider ?? "claude-web-search",
      };
      if (!founderAttributionIsSupported(source.excerpt, lead, aliases)) return [];
      const key = `${searchable(relationship.name)}::${source.url}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [lead];
    }))));
}

function scopeMatchesOrganizationIdentity(scope: string, name: string): boolean {
  let url: URL;
  try { url = new URL(scope); } catch { return false; }
  const identityTokens = looseTokens(name)
    .filter((token) => token.length >= 4 && !VENTURE_IDENTITY_STOP_WORDS.has(token));
  if (!identityTokens.length) return false;
  const host = normalizedHost(url.hostname);
  if (PATH_TENANTED_HOSTS.has(host)) {
    let decodedPath: string;
    try { decodedPath = decodeURIComponent(url.pathname); } catch { return false; }
    const pathTokens = looseTokens(decodedPath);
    return identityTokens.some((token) => pathTokens.includes(token));
  }
  const hostLabels = host.split(".").map((label) => label.replace(/[^a-z0-9]/g, ""));
  // A matching arbitrary subdomain is not evidence that the organization owns
  // the host. `coinbase.attacker.com` must never be treated like coinbase.com.
  // Keep the check deliberately conservative and bind only the registrable
  // organization label (with the common co.uk/com.au style suffix shape).
  const lastLabel = hostLabels.at(-1) ?? "";
  const penultimateLabel = hostLabels.at(-2) ?? "";
  const suffixWidth = hostLabels.length >= 3
    && lastLabel.length === 2
    && COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS.has(penultimateLabel)
    ? 2
    : 1;
  const organizationLabel = hostLabels.at(-(suffixWidth + 1));
  return Boolean(organizationLabel && identityTokens.includes(organizationLabel));
}

/**
 * Collapse an identity-proven dedicated host to its registrable organization
 * scope. This lets investor.coinbase.com establish that www.coinbase.com and
 * help.coinbase.com are first-party siblings, while the identity check above
 * still rejects lookalikes such as coinbase.attacker.com. Shared hosts retain
 * their exact tenant path.
 */
function verifiedOrganizationScope(scope: string, name: string): string | null {
  if (!scopeMatchesOrganizationIdentity(scope, name)) return null;
  let url: URL;
  try { url = new URL(scope); } catch { return null; }
  const host = normalizedHost(url.hostname);
  if (PATH_TENANTED_HOSTS.has(host)) return safeVentureScope(scope);
  const hostLabels = host.split(".");
  const lastLabel = hostLabels.at(-1) ?? "";
  const penultimateLabel = hostLabels.at(-2) ?? "";
  const suffixWidth = hostLabels.length >= 3
    && lastLabel.length === 2
    && COMMON_COUNTRY_PUBLIC_SUFFIX_LABELS.has(penultimateLabel)
    ? 2
    : 1;
  const registrableHost = hostLabels.slice(-(suffixWidth + 1)).join(".");
  if (!registrableHost.includes(".")) return null;
  return `${url.protocol}//${registrableHost}/`;
}

/**
 * A source-verified current-role answer can establish the relationship during
 * this very adapter pass, before any later dossier projection has created a
 * Venture row. Accept it only when a fetched source binds the audited person
 * and control role, and the source host itself identifies the organization.
 */
function verifiedFactAssetRelationships(
  ctx: CollectContext,
  facts: readonly BasicFact[],
): VerifiedVentureAssetRelationship[] {
  const aliases = subjectAliases(ctx);
  return facts.flatMap((fact): VerifiedVentureAssetRelationship[] => {
    if (
      fact.predicate !== "current_role"
      || fact.artifact_verified !== true
      || (fact.status !== "verified" && fact.status !== "corroborated")
    ) return [];
    const relationship = currentRoleRelationshipParts(fact.value);
    if (!relationship) return [];
    const scopes = fact.sources.flatMap((source): string[] => {
      if (
        source.artifactVerified !== true
        || source.relation !== "supports"
        || (source.sourceClass !== "official_subject" && source.sourceClass !== "official_counterparty")
        || !hasSubjectAlias(source.excerpt, aliases)
        || !CURRENT_CONTROL_ROLE.test(source.excerpt)
        || !PREDICATE_PATTERNS.current_role.test(source.excerpt)
      ) return [];
      const scope = verifiedOrganizationScope(source.url, relationship.name);
      return scope ? [scope] : [];
    });
    return scopes.length
      ? [{ name: relationship.name, officialScopes: [...new Set(scopes)] }]
      : [];
  });
}

function mergeVentureAssetRelationships(
  relationships: readonly VerifiedVentureAssetRelationship[],
): VerifiedVentureAssetRelationship[] {
  const merged = new Map<string, VerifiedVentureAssetRelationship>();
  for (const relationship of relationships) {
    const key = ventureRegistryIdentity(relationship.name);
    if (!key) continue;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { name: relationship.name, officialScopes: [...new Set(relationship.officialScopes)] });
      continue;
    }
    existing.officialScopes = [...new Set([...existing.officialScopes, ...relationship.officialScopes])];
  }
  return [...merged.values()];
}

function secExchangeRegistryRows(document: PublicTextDocument): SecExchangeRegistryRow[] | null {
  let jsonText = document.text;
  if ("retrievalProvider" in document && document.retrievalProvider === "jina-reader") {
    const markers = [...document.text.matchAll(/^Markdown Content:\s*$/gm)];
    if (markers.length !== 1 || markers[0].index === undefined) return null;
    jsonText = document.text.slice(markers[0].index + markers[0][0].length).trim();
  }
  let payload: unknown;
  try { payload = JSON.parse(jsonText); } catch { return null; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const fields = (payload as { fields?: unknown }).fields;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(fields) || !Array.isArray(data)) return null;
  const indexes = new Map(fields.map((field, index) => [String(field).trim().toLowerCase(), index]));
  const cikIndex = indexes.get("cik");
  const nameIndex = indexes.get("name");
  const tickerIndex = indexes.get("ticker");
  const exchangeIndex = indexes.get("exchange");
  if ([cikIndex, nameIndex, tickerIndex, exchangeIndex].some((index) => index === undefined)) return null;

  return data.flatMap((raw): SecExchangeRegistryRow[] => {
    if (!Array.isArray(raw)) return [];
    const cik = Number(raw[cikIndex!]);
    const name = clean(raw[nameIndex!], 240);
    const ticker = clean(raw[tickerIndex!], 24)?.toUpperCase();
    const exchange = clean(raw[exchangeIndex!], 80);
    if (
      !Number.isSafeInteger(cik)
      || cik <= 0
      || !name
      || !ticker
      || !exchange
      || !/^[A-Z0-9][A-Z0-9.-]{0,23}$/.test(ticker)
    ) return [];
    return [{ cik, name, ticker, exchange, raw }];
  });
}

function ventureRegistryIdentity(value: string): string {
  return looseTokens(value)
    .filter((token) => token.length >= 2 && !REGISTRY_LEGAL_ENTITY_TOKENS.has(token))
    .join(" ");
}

function registryIssuerMatchesRelationship(issuerName: string, relationshipName: string): boolean {
  const issuerTokens = ventureRegistryIdentity(issuerName).split(" ").filter(Boolean);
  const relationshipTokens = ventureRegistryIdentity(relationshipName).split(" ").filter(Boolean);
  if (!issuerTokens.length || !relationshipTokens.length) return false;
  if (issuerTokens.length === relationshipTokens.length) {
    return issuerTokens.every((token, index) => token === relationshipTokens[index]);
  }
  // Official relationship sources often use a short brand name (Coinbase)
  // while the SEC row adds a conventional issuer qualifier (Coinbase Global).
  // Permit only that one-way expansion. If the relationship already says
  // Acme Global, it cannot collapse into a different Acme Holdings issuer.
  return issuerTokens.length > relationshipTokens.length
    && relationshipTokens.every((token, index) => token === issuerTokens[index])
    && issuerTokens.slice(relationshipTokens.length)
      .every((token) => REGISTRY_SHORTHAND_QUALIFIERS.has(token));
}

function exactSecRegistryExcerpt(document: PublicTextDocument, raw: unknown[]): string | null {
  const serialized = JSON.stringify(raw);
  const exactIndex = document.text.indexOf(serialized);
  if (exactIndex >= 0) return document.text.slice(exactIndex, exactIndex + serialized.length);
  // The SEC currently serves minified JSON, but tolerate insignificant spaces
  // while still freezing bytes taken from the fetched artifact itself.
  const values = raw.map((value) => escapedPattern(String(value)));
  const pattern = new RegExp(`\\[\\s*${values.join("\\s*,\\s*")}\\s*\\]`);
  return document.text.match(pattern)?.[0] ?? null;
}

/**
 * Resolve a controlled venture's US-listed security without relying on a
 * model-generated URL. The SEC registry can close only the second link of the
 * claim: the first link must already be a verified current-control relationship.
 * Ambiguous issuer-name matches fail closed.
 */
function secRegistryPublicSecurityFacts(
  ctx: CollectContext,
  document: PublicTextDocument,
  relationships: readonly VerifiedVentureAssetRelationship[],
  questionId: string,
): BasicFact[] {
  const rows = secExchangeRegistryRows(document);
  if (!rows) return [];
  const retrievalProvider = "retrievalProvider" in document
    && document.retrievalProvider === "jina-reader"
    ? "jina-reader"
    : "public-web";

  return relationships.flatMap((relationship): BasicFact[] => {
    const relationshipIdentity = ventureRegistryIdentity(relationship.name);
    if (!relationshipIdentity) return [];
    const matches = rows.filter((row) =>
      registryIssuerMatchesRelationship(row.name, relationship.name));
    const issuerCiks = new Set(matches.map((row) => row.cik));
    if (issuerCiks.size !== 1) return [];
    return matches.flatMap((row): BasicFact[] => {
      const excerpt = exactSecRegistryExcerpt(document, row.raw);
      if (!excerpt) return [];
      const venue = row.exchange.toUpperCase() === "NASDAQ"
        ? "NASDAQ"
        : row.exchange.toUpperCase();
      const value = `${row.ticker} (${relationship.name}, ${venue}-listed security)`;
      return [{
        factId: factId(ctx.handle, "public_security", value),
        subjectKey: ctx.handle,
        predicate: "public_security",
        value,
        normalizedValue: canonicalBasicFactComparisonValue("public_security", searchable(value)),
        status: "verified",
        critical: true,
        questionId,
        sources: [{
          url: document.url,
          title: "SEC company ticker and exchange registry",
          sourceClass: "regulatory_or_onchain",
          relation: "supports",
          excerpt,
          contentHash: document.contentHash,
          capturedAt: document.capturedAt,
          provider: retrievalProvider,
          artifactVerified: true,
        }],
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "public-web",
      }];
    });
  });
}

function verifiedCounterpartyHosts(ctx: CollectContext): string[] {
  return [...new Set(ctx.evidence.ventures.flatMap((venture): string[] => {
    if (
      venture.artifact_verified !== true
      || venture.evidence_origin === "model_lead"
    ) return [];
    return verifiedVentureOfficialScopes(venture);
  }))];
}

const NON_NAME_IDENTITY_TOKENS = new Set([
  "ceo", "cfo", "coo", "cto", "chief", "company", "dao", "exchange",
  "founder", "foundation", "labs", "network", "officer", "protocol",
]);

function plausiblePersonIdentity(value: string): boolean {
  const tokens = looseTokens(value);
  return tokens.length >= 2
    && tokens.length <= 6
    && tokens.every((token) => !NON_NAME_IDENTITY_TOKENS.has(token));
}

function profileIdentityIsSufficient(ctx: CollectContext, audience: BasicFactsResearchAudience): boolean {
  const name = ctx.evidence.profile.resolved_name?.trim()
    || ctx.evidence.profile.display_name.trim();
  if (!name) return false;
  if (audience === "project") return true;
  const tokens = looseTokens(name);
  if (tokens.length >= 2) return true;
  if (tokens.length !== 1) return false;
  const handle = looseTokens(ctx.handle.replace(/^@/, "")).join("");
  const token = tokens[0];
  // `Stani` plus @StaniKulechov is evidence that the collected display name is
  // incomplete, not a completed real-name resolution. Do not apply this to a
  // pseudonym whose handle does not begin with the displayed identity.
  return !(handle.startsWith(token) && handle.slice(token.length).length >= 3);
}

function verifiedIdentityExtendsProfile(ctx: CollectContext, candidate: string): boolean {
  if (!plausiblePersonIdentity(candidate)) return false;
  const current = ctx.evidence.profile.resolved_name?.trim()
    || ctx.evidence.profile.display_name.trim();
  const currentTokens = looseTokens(current);
  const candidateTokens = looseTokens(candidate);
  if (currentTokens.length >= 2) return personKey(current) === personKey(candidate);
  if (currentTokens.length !== 1 || !candidateTokens.includes(currentTokens[0])) return false;
  const handle = looseTokens(ctx.handle.replace(/^@/, "")).join("");
  return handle === candidateTokens.join("");
}

/**
 * A pseudonymous display name ("vitalik.eth") appears in none of the sources
 * that document the person, so every fetched passage fails the subject gate and
 * NOTHING about that subject can ever verify. The handle itself usually carries
 * the real name; derive it conservatively (letters only, two or three tokens,
 * no promotional or generic suffix).
 */
function handleDerivedNameCandidate(handle: string): string | null {
  const raw = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z][A-Za-z_]{2,30}$/.test(raw)) return null;
  const parts = raw.includes("_") ? raw.split(/_+/) : raw.split(/(?=[A-Z])/);
  const tokens = parts.map((part) => part.trim()).filter(Boolean);
  if (tokens.length < 2 || tokens.length > 3) return null;
  if (tokens.some((token) => token.length < 2 || !/^[A-Za-z]+$/.test(token))) return null;
  const generic = new Set([
    "the", "official", "real", "crypto", "eth", "ethereum", "defi", "dao", "nft",
    "labs", "web3", "sol", "solana", "fund", "capital", "team", "hq", "app", "xyz",
  ]);
  if (tokens.some((token) => generic.has(token.toLocaleLowerCase()))) return null;
  const candidate = tokens
    .map((token) => `${token.slice(0, 1).toLocaleUpperCase()}${token.slice(1).toLocaleLowerCase()}`)
    .join(" ");
  return plausiblePersonIdentity(candidate) ? candidate : null;
}

/** An account that tells you it is not the person it names. */
const SELF_DECLARED_NOT_THE_SUBJECT = /\b(?:parody|fan\s*account|fan\s*page|not\s+(?:the\s+)?real|unofficial|impersonat\w*|satire|tribute|bot)\b/i;

/** Authority a lookalike account cannot manufacture. Notable followers are
 * provider-observed top funds, founders and operators; a squatter registering a
 * name-shaped handle has neither them nor a large organic following. */
const MIN_NOTABLE_FOLLOWERS_FOR_NAME_ALIAS = 10;
const MIN_FOLLOWERS_FOR_NAME_ALIAS = 250_000;
// A follower count so large that a squatter holding the exact name-spelling
// handle is implausible. This is an ALTERNATE authority proof to the notable
// -follower reverse-check, which structurally under-observes for individuals:
// the curated reference set is mostly funds and org accounts, and those rarely
// follow a person even a maximally famous one (observed live: @ethereum and
// @BitcoinMagazine do not follow @VitalikButerin), so a mega-account would
// otherwise never clear the notable bar and its pseudonymous display name would
// block every fact from verifying.
const NOTABILITY_SELF_EVIDENT_FOLLOWERS = 1_000_000;

function approximateFollowerCount(value: string): number {
  const match = /([\d.,]+)\s*([KMB])?/i.exec(value.trim());
  if (!match) return 0;
  const base = Number(match[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return 0;
  const scale = match[2]?.toUpperCase();
  return scale === "B" ? base * 1_000_000_000 : scale === "M" ? base * 1_000_000 : scale === "K" ? base * 1_000 : base;
}

/**
 * Widen the MATCHING ALIAS SET for a widely-recognized account whose handle
 * plainly spells a person's name. This is how sources refer to the subject, and
 * nothing more: it never sets resolved_name and never touches
 * identity_confidence, because those drive name-based OFAC, sanctions and court
 * screening, and a name good enough to read a page with is not a name good
 * enough to run someone's legal history against.
 *
 * Gated on account authority rather than page proximity. A page that merely
 * mentions an account near a name proves nothing (a scam warning does exactly
 * that), whereas a decade-old account followed by ten top-tier funds and
 * founders is the account those sources are written about.
 */
function notabilityBoundNameAlias(ctx: CollectContext): string | null {
  if (researchAudience(ctx) === "project") return null;
  const profile = ctx.evidence.profile;
  if (profile.profile_collection_state !== "resolved" || profile.profile_provider !== "twitterapi") return null;
  const candidate = handleDerivedNameCandidate(ctx.handle);
  if (!candidate) return null;
  if (subjectAliases(ctx).some((alias) => personKey(alias) === personKey(candidate))) return null;
  if (SELF_DECLARED_NOT_THE_SUBJECT.test(`${profile.display_name} ${profile.bio}`)) return null;
  const followers = approximateFollowerCount(profile.followers);
  if (followers < MIN_FOLLOWERS_FOR_NAME_ALIAS) return null;
  // Either authority proof is sufficient: an observed set of notable followers,
  // OR a follower count so large that impersonation on the exact handle is
  // implausible. This never sets resolved_name or identity_confidence, so it
  // stays a reading-only alias and cannot feed name-based OFAC or court screening.
  const notable = ctx.evidence.notableFollowers?.length ?? 0;
  if (notable < MIN_NOTABLE_FOLLOWERS_FOR_NAME_ALIAS && followers < NOTABILITY_SELF_EVIDENT_FOLLOWERS) return null;
  return candidate;
}

function applyVerifiedPersonIdentity(ctx: CollectContext, facts: readonly BasicFact[]): boolean {
  if (researchAudience(ctx) === "project") return false;
  const candidate = facts
    .filter((fact) =>
      fact.predicate === "official_identity"
      && fact.artifact_verified === true
      && (fact.status === "verified" || fact.status === "corroborated")
      && verifiedIdentityExtendsProfile(ctx, fact.value))
    .sort((left, right) => looseTokens(right.value).length - looseTokens(left.value).length)[0];
  if (!candidate) return false;
  const current = ctx.evidence.profile.resolved_name?.trim() ?? "";
  if (personKey(current) === personKey(candidate.value)) return false;
  ctx.evidence.profile.resolved_name = candidate.value;
  if (ctx.evidence.profile.identity_confidence !== "Confirmed") {
    ctx.evidence.profile.identity_confidence = "Probable";
  }
  ctx.evidence.profile.identity_note = `${candidate.value} was resolved from fetched, source-backed identity evidence.`;
  return true;
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
        (question.audience === "person" || question.audience === "investor")
        && fact.predicate === "legal_regulatory_event"
        && fact.attributionScope !== "direct_subject"
      ))
    .map((fact) => fact.factId);
  const add = (ref: string) => { if (!refs.includes(ref)) refs.push(ref); };

  if (
    question.predicate === "official_identity"
    && ctx.evidence.profile.profile_collection_state === "resolved"
    && profileIdentityIsSufficient(ctx, question.audience)
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
    const questionRunState = (result: BasicFactsDiscoveryResult): BasicFactQuestionLedgerEntry["providerRuns"][number]["state"] => {
      const questionSpecificState = result.questionStates?.[question.id];
      if (questionSpecificState) return questionSpecificState;
      const state = result.batchStates?.[question.batch] ?? result.state;
      // One batched model search asks several questions at once. A blank batch
      // is not a separate, exhaustive negative screen for every question in it.
      // Keep those unanswered rows partial until a question-specific collector
      // or verified source supplies an actual checked-empty outcome.
      return state === "completed_empty" ? "partial" : state;
    };
    const providerRuns: BasicFactQuestionLedgerEntry["providerRuns"] = [{
      phase: "primary",
      provider: primary.questionProviders?.[question.id] ?? primary.provider,
      state: questionRunState(primary),
    }];
    if (repairQuestionIds.has(question.id)) {
      const repairState = questionRunState(repair);
      providerRuns.push({
        phase: "repair",
        provider: repair.questionProviders?.[question.id] ?? repair.provider,
        state: repairState,
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
  const fetchSource = dependencies.fetchSource ?? fetchPublicTextWithRecovery;
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
  const primaryLeads = selectBasicFactLeads([
    ...officialIdentityBootstrapLeads(ctx),
    ...primary.leads,
  ]);
  ctx.evidence.basicFactLeads = primaryLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = [];

  // Seeded before the first pass: notable followers are already collected by the
  // X lane, so a widely-recognized pseudonymous account can match source
  // passages immediately instead of burning a verification pass finding nothing.
  const seededNameAlias = notabilityBoundNameAlias(ctx);
  let aliases = seededNameAlias ? [...subjectAliases(ctx), seededNameAlias] : subjectAliases(ctx);
  const officialHosts = [ctx.evidence.profile.website]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try { return [new URL(value).toString()]; } catch { return []; }
    });
  let officialCounterpartyHosts = verifiedCounterpartyHosts(ctx);
  const ventureAssetRelationships = verifiedVentureAssetRelationships(ctx);
  const sourceByUrl = new Map<string, Promise<PublicTextResult>>();
  const fetchOnce = (url: string): Promise<PublicTextResult> => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const fetchAndRecord = async (target: string): Promise<PublicTextResult> => {
      try {
        const result = await fetchSource(target);
        recordCall(
          "basic-facts-web",
          "source-fetch",
          0,
          result.status === "ok" ? "source_fetched" : result.reason,
          result.status === "ok" ? "succeeded" : "failed",
        );
        return result;
      } catch {
        recordCall("basic-facts-web", "source-fetch", 0, "transport_error", "failed");
        return { status: "failed", reason: "transport_error" };
      }
    };
    const pending = (async (): Promise<PublicTextResult> => {
      const primary = await fetchAndRecord(url);
      const localized = coinbaseWrappedAssetLocaleFallback(url);
      const result = !localized || isExpectedCoinbaseWrappedAssetPage(primary, localized)
        ? primary
        : await (async () => {
          const recovered = await fetchAndRecord(localized);
          return recovered.status === "ok" ? recovered : primary;
        })();
      return result;
    })();
    sourceByUrl.set(key, pending);
    return pending;
  };

  const verifyLeads = async (
    leads: readonly BasicFactLead[],
    sourceLimit: number,
    assetRelationships: readonly VerifiedVentureAssetRelationship[] = ventureAssetRelationships,
  ): Promise<BasicFact[]> => {
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
          ? verifyBasicFactLead(
            lead,
            result,
            aliases,
            ctx.handle,
            officialHosts,
            officialCounterpartyHosts,
            assetRelationships,
          )
          : null;
      })))
      .filter((fact): fact is BasicFact => fact !== null);
  };

  const expandVerificationContext = (facts: readonly BasicFact[]): boolean => {
    let changed = false;
    const relationshipScopes = verifiedFactAssetRelationships(ctx, facts)
      .flatMap((relationship) => relationship.officialScopes);
    const nextCounterpartyHosts = [...new Set([
      ...officialCounterpartyHosts,
      ...relationshipScopes,
    ])];
    if (nextCounterpartyHosts.length !== officialCounterpartyHosts.length) {
      officialCounterpartyHosts = nextCounterpartyHosts;
      changed = true;
    }
    if (applyVerifiedPersonIdentity(ctx, facts)) changed = true;
    const nameAlias = notabilityBoundNameAlias(ctx);
    if (nameAlias && !aliases.some((alias) => personKey(alias) === personKey(nameAlias))) {
      aliases = [...aliases, nameAlias];
      changed = true;
    }
    const nextAliases = [...new Set([...aliases, ...subjectAliases(ctx)])];
    if (nextAliases.length !== aliases.length) {
      aliases = nextAliases;
      changed = true;
    }
    return changed;
  };

  const verifyWithExpandedContext = async (
    leads: readonly BasicFactLead[],
    sourceLimit: number,
    assetRelationships: readonly VerifiedVentureAssetRelationship[] = ventureAssetRelationships,
  ): Promise<BasicFact[]> => {
    const candidates: BasicFact[] = [];
    for (let pass = 0; pass < 3; pass += 1) {
      candidates.push(...await verifyLeads(leads, sourceLimit, assetRelationships));
      const published = resolveBasicFactCandidates(candidates);
      if (!expandVerificationContext(published)) break;
    }
    return candidates;
  };

  const primaryVerified = await verifyWithExpandedContext(primaryLeads, MAX_SOURCES);
  const primaryFacts = resolveBasicFactCandidates(primaryVerified);
  const missingCritical = questions.filter((question) =>
    question.critical && deterministicQuestionAnswerRefs(ctx, question, primaryFacts).length === 0);
  const repairQuestions = boundedRepairQuestions(missingCritical);
  let repair: BasicFactsDiscoveryResult = {
    provider: "none",
    state: "skipped",
    leads: [],
    attempts: 0,
    completedBatches: 0,
    failedBatches: 0,
    detail: missingCritical.length ? "repair provider not configured" : "no critical gaps",
  };
  if (repairQuestions.length && (dependencies.repair || !dependencies.discover)) {
    const output = dependencies.repair
      ? await dependencies.repair(ctx, repairQuestions)
      : await discoverRepair(ctx, repairQuestions);
    repair = normalizeDiscoveryOutput(output);
    if (missingCritical.length > repairQuestions.length) {
      repair.detail = [
        repair.detail,
        `${repairQuestions.length}/${missingCritical.length} critical gaps searched within the repair budget`,
      ].filter(Boolean).join("; ");
    }
  }
  const repairLeads = selectBasicFactLeads(repair.leads);
  const repairVerified = await verifyWithExpandedContext(repairLeads, Math.min(12, MAX_SOURCES));
  const discoveredLeads = mergeLeads(primaryLeads, repairLeads);
  // A repaired identity can add the full surname alias needed by an earlier
  // source passage, while a repaired role can establish the organization scope
  // needed by an earlier identity lead. Recheck the bounded combined set using
  // the now-expanded deterministic context; fetchOnce reuses every artifact.
  const contextualVerified = await verifyWithExpandedContext(discoveredLeads, MAX_SOURCES);
  const relationshipFactsBeforeFounderRecovery = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified,
  ]);
  const recoveredFounderLeads = sourceBackedFounderRelationshipLeads(ctx, relationshipFactsBeforeFounderRecovery);
  const recoveredFounderVerified = await verifyWithExpandedContext(
    recoveredFounderLeads,
    Math.min(8, MAX_SOURCES),
  );
  const allLeads = mergeLeads(discoveredLeads, recoveredFounderLeads);
  const relationshipFacts = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified,
  ]);
  const authoritativeAssetRelationships = mergeVentureAssetRelationships([
    ...ventureAssetRelationships,
    ...verifiedFactAssetRelationships(ctx, relationshipFacts),
  ]);
  // Asset leads can arrive in the same repair response that first proves the
  // person's current control relationship. Re-run only those leads against
  // the newly established venture scopes; fetchOnce reuses earlier responses
  // and the asset-only pass retains its own bounded source budget.
  const relationshipBoundAssets = authoritativeAssetRelationships.length
    ? await verifyLeads(
      allLeads.filter((lead) => lead.predicate === "public_security" || lead.predicate === "official_token"),
      Math.min(12, MAX_SOURCES),
      authoritativeAssetRelationships,
    )
    : [];
  const sourceVerifiedBeforeRegistry = resolveBasicFactCandidates([
    ...primaryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified,
    ...relationshipBoundAssets,
  ]);
  let registryVerified: BasicFact[] = [];
  // Set when the SEC exchange-registry screen completed over the subject's
  // asset-relationship and verified-venture names and found no listed issuer.
  // That is a completed empty screen of the primary US registry, recorded on
  // the public_security ledger entry so the founder asset-distinction check
  // can close honestly instead of staying "unresolved" forever.
  let registryScreenEmpty = false;
  const publicSecurityQuestion = questions.find((question) => question.predicate === "public_security");
  // Only authoritative relationships and structured verified ventures drive
  // the collect-time registry consultation. A fact-named venture (however it
  // verified) can be spoofed by an organization-NAMED host (aave.net), so the
  // founder path instead screens AFTER the venture token binds through its
  // official X account (screenSecRegistryForNames, called from orchestrate).
  const registryScreenNames = [...new Set([
    ...authoritativeAssetRelationships.map((relationship) => relationship.name),
    ...ctx.evidence.ventures
      .filter((venture) => venture.artifact_verified === true && venture.evidence_origin !== "model_lead")
      .map((venture) => venture.project_name.trim()),
  ])].filter((name) => name.length > 1);
  if (
    publicSecurityQuestion
    && registryScreenNames.length
    && !sourceVerifiedBeforeRegistry.some((fact) =>
      fact.predicate === "public_security"
      && (fact.status === "verified" || fact.status === "corroborated"))
  ) {
    // Injected fetchers (tests / fixtures) stay on the deterministic fetchOnce
    // path; live runs use the bounded direct fetch so a registry outage can
    // never drag the audit through the article-recovery retry ladder.
    const registry = dependencies.fetchSource
      ? await fetchOnce(SEC_EXCHANGE_REGISTRY_URL)
      : await fetchSecExchangeRegistry();
    if (registry.status === "ok") {
      registryVerified = secRegistryPublicSecurityFacts(
        ctx,
        registry,
        authoritativeAssetRelationships,
        publicSecurityQuestion.id,
      );
      const registryRows = secExchangeRegistryRows(registry);
      const anyIssuerMatch = registryVerified.length > 0
        || (registryRows !== null && registryScreenNames.some((name) =>
          registryRows.some((row) => registryIssuerMatchesRelationship(row.name, name))));
      registryScreenEmpty = registryRows !== null && !anyIssuerMatch;
    }
  }
  const verified = [
    ...primaryVerified,
    ...registryVerified,
    ...repairVerified,
    ...contextualVerified,
    ...recoveredFounderVerified,
    ...relationshipBoundAssets,
  ];
  ctx.evidence.basicFactLeads = allLeads.map((lead) => ({ ...lead }));
  ctx.evidence.basicFacts = resolveBasicFactCandidates(verified);
  const repairQuestionIds = new Set(repairQuestions.map((question) => question.id));
  ctx.evidence.basicFactQuestionLedger = questionLedger(
    ctx,
    questions,
    ctx.evidence.basicFacts,
    primary,
    repair,
    repairQuestionIds,
  );
  if (registryScreenEmpty) {
    // The completed registry screen found no listed issuer for any screened
    // name. Record it as the final run on the public_security entry so the
    // question resolves checked_empty (US exchange registry screened, none
    // found) instead of hanging unresolved. Never overrides an answered entry.
    const publicSecurityEntry = ctx.evidence.basicFactQuestionLedger
      .find((entry) => entry.predicate === "public_security");
    if (publicSecurityEntry && publicSecurityEntry.status === "unanswered") {
      publicSecurityEntry.providerRuns.push({ phase: "repair", provider: "sec-registry", state: "completed_empty" });
    }
  }

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
        detail: `broad search returned no source-linked basic-fact candidates; individual questions remain unresolved · ${providerDetail}`,
        attempts,
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
