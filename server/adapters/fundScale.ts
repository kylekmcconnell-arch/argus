import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { PortfolioLead, SourceArtifact } from "../../src/data/evidence";
import { sourceMatchesOfficialWebsiteScope } from "../../src/lib/fundScaleEvidence";
import { env } from "../config";
import { recordCall } from "../cost";
import { fetchPublicText, type PublicTextDocument, type PublicTextResult } from "../publicWeb";
import {
  discoverFocusedFundScaleEvidenceText,
  discoverInvestorEvidenceText,
} from "./investorDiscovery";
import {
  defaultInvestorDomainResolver,
  domainFromWebsite,
  portfolioEntityForLead,
  type PortfolioInvestorDomainProof,
  type PortfolioInvestorDomainResolution,
  type PortfolioInvestorEntity,
} from "./portfolio";
import type { AdapterRunResult, CollectContext } from "./types";
import { getProfile } from "./x";

const MAX_CANDIDATES = 6;
const MAX_SOURCES_PER_CANDIDATE = 3;
const MIN_FUND_AMOUNT_USD = 100_000;
const MAX_FUND_AMOUNT_USD = 10_000_000_000_000;
const CURRENT_AUM_MAX_AGE_MS = 731 * 24 * 60 * 60 * 1_000;
const AUM_CORROBORATION_WINDOW_MS = 90 * 24 * 60 * 60 * 1_000;
const AUM_AMOUNT_TOLERANCE = 0.10;

const PRIMARY_HOSTS = [
  "sec.gov",
  "fca.org.uk",
  "gov.uk",
  "companieshouse.gov.uk",
  "asic.gov.au",
  "sedarplus.ca",
] as const;

const PRESS_HOSTS = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "techcrunch.com",
  "fortune.com",
  "coindesk.com",
  "theblock.co",
  "decrypt.co",
  "blockworks.co",
  "venturebeat.com",
] as const;

const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

type FundScaleMetric = NonNullable<SourceArtifact["fundScaleMetric"]>;
type FundAmountQualifier = NonNullable<SourceArtifact["fundAmountQualifier"]>;
type FundSourceClass = NonNullable<SourceArtifact["sourceClass"]>;

export interface FundScaleLead {
  fundName: string;
  fundVehicleHint?: string;
  fundHandle?: string;
  attribution?: "direct_subject" | "affiliated_fund";
  metricHint?: "aum" | "fund_vehicle" | "first_close" | "final_close";
  amountHintUsd?: number;
  sources: { url: string; title?: string }[];
  evidence_origin: "model_lead";
  artifact_verified: false;
  provider: "grok";
}

export interface ParsedUsdAmount {
  amountUsd: number;
  raw: string;
  start: number;
  end: number;
  qualifier: FundAmountQualifier;
}

export interface FundScaleMatch {
  amountUsd: number;
  metric: FundScaleMetric;
  qualifier: FundAmountQualifier;
  excerpt: string;
  fundVehicle?: string;
  /** Stable grouping key derived only from fetched page text. */
  vehicleIdentityKey?: string;
  vehicleCorroboratable?: boolean;
  asOf?: string;
  publishedAt?: string;
  temporalState: NonNullable<SourceArtifact["fundScaleTemporalState"]>;
  eligibleForConfirmation: boolean;
}

export interface FundScaleCollectorDependencies {
  discover?: (ctx: CollectContext) => Promise<FundScaleLead[] | null>;
  fetchSource?: (url: string) => Promise<PublicTextResult>;
  resolveEntity?: (ctx: CollectContext, lead: FundScaleLead, now: Date) => PortfolioInvestorEntity | null;
  resolveInvestorDomain?: (lead: FundScaleLead, entity: PortfolioInvestorEntity) => Promise<PortfolioInvestorDomainResolution | undefined>;
  lookupProfile?: typeof getProfile;
  now?: () => Date;
}

const clean = (value: unknown, max: number): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;

const normalized = (value: string): string => value
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9@$._ -]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const compact = (value: string): string => normalized(value).replace(/[^a-z0-9]+/g, "");
const regexEscape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function entityNamesMatch(leftRaw: string, rightRaw: string): boolean {
  const left = compact(leftRaw);
  const right = compact(rightRaw);
  if (!left || !right) return false;
  return left === right || (Math.min(left.length, right.length) >= 5 && (left.includes(right) || right.includes(left)));
}

function entityPattern(entity: string, caseSensitive = false): RegExp | null {
  const words = normalized(entity.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  if (!words.length || (words.length === 1 && words[0].length < 2)) return null;
  const phrase = words.map(regexEscape).join("[^A-Za-z0-9]+");
  return new RegExp(`(?:^|[^A-Za-z0-9])${phrase}(?=$|[^A-Za-z0-9])`, caseSensitive ? "" : "i");
}

function containsEntity(text: string, entity: string): boolean {
  const words = normalized(entity.replace(/^@/, "")).split(/[^a-z0-9]+/).filter(Boolean);
  const caseSensitive = words.length === 1 && words[0].length <= 4;
  return entityPattern(entity, caseSensitive)?.test(text) ?? false;
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
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function parseFundScaleCandidates(text: string): FundScaleLead[] | null {
  const payload = parsePayload(text);
  if (!payload || !Array.isArray(payload.fund_scale)) return null;
  const leads: FundScaleLead[] = [];
  const seen = new Set<string>();
  for (const raw of payload.fund_scale) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const fundName = clean(row.fund_name ?? row.investor_entity, 120);
    if (!fundName) continue;
    const sources: FundScaleLead["sources"] = [];
    for (const sourceRaw of Array.isArray(row.sources) ? row.sources : []) {
      if (!sourceRaw || typeof sourceRaw !== "object" || Array.isArray(sourceRaw)) continue;
      const source = sourceRaw as Record<string, unknown>;
      const url = safeCandidateUrl(source.url);
      if (!url) continue;
      const title = clean(source.title, 180);
      sources.push({ url, ...(title ? { title } : {}) });
    }
    const singularUrl = safeCandidateUrl(row.source_url);
    if (singularUrl) {
      const title = clean(row.source_title, 180);
      sources.push({ url: singularUrl, ...(title ? { title } : {}) });
    }
    const uniqueSources = sources.filter((source, index) =>
      sources.findIndex((candidate) => candidate.url === source.url) === index,
    ).slice(0, MAX_SOURCES_PER_CANDIDATE);
    const fundVehicleHint = clean(row.fund_vehicle, 160);
    const fundHandleRaw = clean(row.fund_x_handle ?? row.investor_x_handle, 40)?.replace(/^@/, "");
    const fundHandle = fundHandleRaw && /^[A-Za-z0-9_]{2,30}$/.test(fundHandleRaw) ? `@${fundHandleRaw}` : undefined;
    const attribution = row.attribution === "affiliated_fund"
      ? "affiliated_fund"
      : row.attribution === "direct_subject"
        ? "direct_subject"
        : undefined;
    const metricHint = ["aum", "fund_vehicle", "first_close", "final_close"].includes(String(row.metric_hint))
      ? row.metric_hint as FundScaleLead["metricHint"]
      : undefined;
    const amountHint = typeof row.amount_hint_usd === "number" && Number.isFinite(row.amount_hint_usd)
      && row.amount_hint_usd >= MIN_FUND_AMOUNT_USD && row.amount_hint_usd <= MAX_FUND_AMOUNT_USD
      ? Math.round(row.amount_hint_usd)
      : undefined;
    const key = `${compact(fundName)}::${compact(fundVehicleHint ?? "")}::${uniqueSources.map((source) => source.url).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      fundName,
      ...(fundVehicleHint ? { fundVehicleHint } : {}),
      ...(fundHandle ? { fundHandle } : {}),
      ...(attribution ? { attribution } : {}),
      ...(metricHint ? { metricHint } : {}),
      ...(amountHint ? { amountHintUsd: amountHint } : {}),
      sources: uniqueSources,
      evidence_origin: "model_lead",
      artifact_verified: false,
      provider: "grok",
    });
    if (leads.length >= MAX_CANDIDATES) break;
  }
  return leads;
}

export async function discoverFundScaleCandidates(ctx: CollectContext): Promise<FundScaleLead[] | null> {
  if (!env("XAI_API_KEY")) return null;
  const text = await discoverInvestorEvidenceText(ctx);
  if (!text) return null;
  const shared = parseFundScaleCandidates(text);
  if (!shared) return null;
  const sourceLinked = shared.filter((lead) => lead.sources.length > 0);
  if (sourceLinked.length > 0) return shared;
  const focusedText = await discoverFocusedFundScaleEvidenceText(ctx);
  return focusedText ? parseFundScaleCandidates(focusedText) : null;
}

const USD_AMOUNT = /(?<![A-Za-z])(?:US\s*\$|USD\s*|\$)\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(trillion|tn|billion|bn|million|mm|mn|thousand|[tbmk])?\b/gi;
const NON_USD_CURRENCY_SUFFIX = /^\s*(?:[,;(]\s*)?(?:(?:denominated\s+)?in\s+)?(?:AED|ARS|AUD|BRL|CAD|CHF|CLP|CNY|COP|DKK|EUR|GBP|HKD|IDR|ILS|INR|JPY|KRW|MXN|MYR|NGN|NOK|NZD|PHP|PLN|RMB|RUB|SAR|SEK|SGD|THB|TRY|TWD|ZAR|Australian(?:\s+dollars?)?|Canadian(?:\s+dollars?)?|Hong\s+Kong(?:\s+dollars?)?|New\s+Zealand(?:\s+dollars?)?|Singapore(?:\s+dollars?)?|pounds?\s+sterling|euros?|yen|yuan)\b/i;
const NON_USD_SYMBOL_PREFIX = /(?:^|[\s(])(?:A|AU|C|CA|HK|NZ|S|SG)\s*$/;

export function parseUsdAmounts(text: string): ParsedUsdAmount[] {
  const amounts: ParsedUsdAmount[] = [];
  for (const match of text.matchAll(new RegExp(USD_AMOUNT.source, USD_AMOUNT.flags))) {
    const numericText = match[1];
    const unit = (match[2] ?? "").toLowerCase();
    if (!unit && !numericText.includes(",")) continue;
    const numeric = Number(numericText.replace(/,/g, ""));
    const multiplier = unit === "t" || unit === "tn" || unit === "trillion"
      ? 1_000_000_000_000
      : unit === "b" || unit === "bn" || unit === "billion"
        ? 1_000_000_000
        : unit === "m" || unit === "mm" || unit === "mn" || unit === "million"
          ? 1_000_000
          : unit === "k" || unit === "thousand"
            ? 1_000
            : 1;
    const amountUsd = Math.round(numeric * multiplier);
    if (!Number.isSafeInteger(amountUsd) || amountUsd < MIN_FUND_AMOUNT_USD || amountUsd > MAX_FUND_AMOUNT_USD) continue;
    const start = match.index ?? 0;
    const raw = match[0];
    const explicitUsdPrefix = /^(?:US\s*\$|USD\b)/i.test(raw);
    const immediateBefore = text.slice(Math.max(0, start - 5), start);
    const immediateAfter = text.slice(start + raw.length, start + raw.length + 40);
    if ((!explicitUsdPrefix && NON_USD_SYMBOL_PREFIX.test(immediateBefore)) || NON_USD_CURRENCY_SUFFIX.test(immediateAfter)) continue;
    const before = text.slice(Math.max(0, start - 28), start);
    const qualifier: FundAmountQualifier = /\b(?:at least|more than|over)\s*$/i.test(before)
      ? "at_least"
      : /\b(?:about|approximately|around|roughly|nearly)\s*$/i.test(before)
        ? "approximate"
        : "exact";
    amounts.push({ amountUsd, raw, start, end: start + raw.length, qualifier });
  }
  return amounts;
}

function htmlToVisibleText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/?(?:article|aside|blockquote|br|dd|div|dl|dt|figcaption|figure|footer|h[1-6]|header|li|main|nav|ol|p|section|table|tbody|td|th|thead|tr|ul)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[\t\f\v ]+/g, " ")
    .replace(/ *\n+ */g, "\n")
    .trim();
}

function safeIsoDate(value: string | undefined, now: Date): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value.trim());
  if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > now.getTime() + 24 * 60 * 60 * 1_000) return undefined;
  return parsed.toISOString();
}

function documentPublishedAt(document: PublicTextDocument, now: Date): string | undefined {
  const raw = document.text.slice(0, 250_000);
  const candidates = [
    raw.match(/["']datePublished["']\s*:\s*["']([^"']+)["']/i)?.[1],
    raw.match(/<(?:meta|time)\b[^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|datepublished)["'][^>]*(?:content|datetime)=["']([^"']+)["']/i)?.[1],
    raw.match(/<(?:meta|time)\b[^>]*(?:content|datetime)=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|datePublished|datepublished)["']/i)?.[1],
    raw.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1],
  ];
  return candidates.map((candidate) => safeIsoDate(candidate, now)).find(Boolean);
}

function explicitAsOf(segment: string, now: Date): string | undefined {
  const month = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const marker = "\\bas (?:of|at)\\s+(?:the\\s+)?";
  const iso = segment.match(new RegExp(`${marker}(\\d{4}-\\d{2}-\\d{2})`, "i"))?.[1];
  if (iso) return safeIsoDate(iso, now);
  const monthFirst = segment.match(new RegExp(`${marker}(${month}\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4})`, "i"))?.[1];
  if (monthFirst) return safeIsoDate(monthFirst.replace(/(\d)(?:st|nd|rd|th)\b/i, "$1"), now);
  const dayFirst = segment.match(new RegExp(`${marker}(\\d{1,2})(?:st|nd|rd|th)?[\\s-]+(${month})[,]?[\\s-]+(\\d{4})`, "i"));
  if (!dayFirst) return undefined;
  return safeIsoDate(`${dayFirst[2]} ${dayFirst[1]}, ${dayFirst[3]}`, now);
}

const TARGET_OR_NEGATED = /\b(?:target(?:ing|ed|s)?|seek(?:ing|s)?|aim(?:ing|s)?|plan(?:ning|s)?|expect(?:ing|s|ed)?|hope(?:s|d|fully)?|could|might|up to|hard cap|proposed|potential|failed to|did not|does not|never|may\s+(?:be|raise|close|launch|seek|target|reach|manage|have))\b/i;
const NON_SCALE_RELATION = [
  /\b(?:deployed|deploying|invested|investing|allocated|allocating|distributed|distributing|returned|returning|spent|spending)\s+(?:approximately\s+|about\s+|around\s+|over\s+|at least\s+)?__amount__/,
  /__amount__\s+(?:was\s+|were\s+|has been\s+|had been\s+)?(?:deployed|invested|allocated|distributed|returned|spent)\b/,
  /\bdry powder\b(?:(?!\b(?:aum|assets under management)\b)[^.;]){0,55}__amount__|__amount__(?:(?!\b(?:aum|assets under management)\b)[^.;]){0,55}\bdry powder\b/,
  /\b(?:valuation|valued at|market cap(?:italization)?|total value locked|tvl|revenue|turnover|sales|purchase price|deal value)\b[^.;]{0,55}__amount__|__amount__[^.;]{0,55}\b(?:valuation|market cap(?:italization)?|total value locked|tvl|revenue|turnover|sales|purchase price|deal value)\b/,
  /\b(?:series\s+[a-z0-9]+|(?:pre-?seed|seed)\s+round|financing|company round)\b[^.;]{0,70}__amount__|__amount__[^.;]{0,70}\b(?:series\s+[a-z0-9]+|(?:pre-?seed|seed)\s+round|financing|company round)\b/,
  /__amount__[^.;]{0,45}\bfrom\s+(?:its|the|a|an)\s+(?:[a-z0-9-]+\s+){0,4}fund\b/,
] as const;

const ORDINAL_FUND_NUMBER = new Map<string, number>([
  ["first", 1], ["second", 2], ["third", 3], ["fourth", 4], ["fifth", 5],
  ["sixth", 6], ["seventh", 7], ["eighth", 8], ["ninth", 9], ["tenth", 10],
]);
const ROMAN_FUND_NUMBER = new Map<string, number>([
  ["i", 1], ["ii", 2], ["iii", 3], ["iv", 4], ["v", 5],
  ["vi", 6], ["vii", 7], ["viii", 8], ["ix", 9], ["x", 10],
]);
const FUND_NUMBER_ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"] as const;

interface CanonicalVehicle {
  label: string;
  key: string;
  corroboratable: boolean;
}

const canonicalCategoryLabel = (value: string): string => value
  .toLowerCase()
  .split(/\s+/)
  .map((part) => `${part[0].toUpperCase()}${part.slice(1)}`)
  .join(" ");

function canonicalFundVehicle(segment: string): CanonicalVehicle {
  const vehicleText = segment.replace(new RegExp(USD_AMOUNT.source, USD_AMOUNT.flags), " ").replace(/\s+/g, " ");
  const numbered = vehicleText.match(/\b(?:(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+)?fund\s+(?:no\.?\s*)?([ivx]{1,4}|\d{1,2})\b/i);
  if (numbered) {
    const category = numbered[1] ? canonicalCategoryLabel(numbered[1]) : undefined;
    const rawNumber = numbered[2].toLowerCase();
    const value = /^\d+$/.test(rawNumber) ? Number(rawNumber) : ROMAN_FUND_NUMBER.get(rawNumber);
    if (value) {
      const suffix = value <= 10 ? FUND_NUMBER_ROMAN[value] : String(value);
      const label = `${category ? `${category} ` : ""}Fund ${suffix}`;
      return { label, key: `${category ? `${compact(category)}-` : ""}fund-${value}`, corroboratable: true };
    }
  }
  const ordinalMatch = vehicleText.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+)?fund\b/i);
  const ordinal = ordinalMatch?.[1].toLowerCase()
    ?? vehicleText.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:[a-z0-9-]+\s+){0,3}fund\b/i)?.[1].toLowerCase();
  const ordinalValue = ordinal ? ORDINAL_FUND_NUMBER.get(ordinal) : undefined;
  if (ordinalValue) {
    const category = ordinalMatch?.[2] ? canonicalCategoryLabel(ordinalMatch[2]) : undefined;
    const label = `${category ? `${category} ` : ""}Fund ${FUND_NUMBER_ROMAN[ordinalValue]}`;
    return { label, key: `${category ? `${compact(category)}-` : ""}fund-${ordinalValue}`, corroboratable: true };
  }

  const category = vehicleText.match(/\b(venture|growth|opportunity|seed|flagship|private equity|digital asset|blockchain|web3|crypto)\s+fund\b/i)?.[1].toLowerCase();
  if (category) {
    const canonicalCategory = canonicalCategoryLabel(category);
    return { label: `${canonicalCategory} Fund`, key: `${compact(canonicalCategory)}-fund`, corroboratable: false };
  }
  return { label: "Unspecified Fund", key: "unspecified-fund", corroboratable: false };
}

function metricAroundAmount(segment: string, amount: ParsedUsdAmount): FundScaleMetric | null {
  const before = segment.slice(Math.max(0, amount.start - 130), amount.start);
  const after = segment.slice(amount.end, Math.min(segment.length, amount.end + 150));
  const context = `${before} __amount__ ${after}`.toLowerCase();
  const localContext = `${before.slice(-90)} __amount__ ${after.slice(0, 90)}`.toLowerCase();
  if (TARGET_OR_NEGATED.test(localContext) || NON_SCALE_RELATION.some((pattern) => pattern.test(localContext))) return null;

  const aum = /\b(?:assets under management|aum)\s*(?::|of|total(?:ing)?|were|was|is|stood at|reached)?\s*__amount__/.test(context)
    || /__amount__\s+(?:in\s+)?(?:assets under management|aum|managed assets)\b/.test(context)
    || /\b(?:manages?|managed|oversees?|oversaw)\s*__amount__\s+(?:in\s+)?(?:assets under management|aum|managed assets)\b/.test(context);
  if (aum) return "reported_aum";

  const committed = /\bcommitted capital\b/.test(context)
    && (/\bcommitted capital[^.;]{0,70}__amount__/.test(context)
      || /__amount__[^.;]{0,70}\b(?:in )?committed capital\b/.test(context));
  const fundVehicle = committed
    || /__amount__\s+(?:(?:crypto|venture|growth|opportunity|seed|flagship|web3|blockchain|digital asset|private equity|investment)\s+){0,3}fund\b/.test(context)
    || /\bfund\b[^.;]{0,55}\b(?:size(?:d)?(?: at| is)?|of|at|with|total(?:ing|led)?|closed at)\s*__amount__/.test(context)
    || /\b(?:raised|closed|secured|launched|announced|completed)[^.;]{0,110}__amount__[^.;]{0,100}\bfund\b/.test(context);
  if (!fundVehicle) return null;
  if (/\bfirst close\b/.test(context)) return "first_close";
  if (/\bfinal close\b|\bclosed (?:its|the|a)[^.;]{0,70}fund\b/.test(context)) return "final_close";
  return "fund_vehicle";
}

function isAumMetric(metric: FundScaleMetric): boolean {
  return metric === "reported_aum" || metric === "regulatory_aum";
}

function hasExplicitFirstPersonOwnership(segment: string): boolean {
  return /\bour\b[^.;]{0,100}\b(?:fund|vehicle|assets under management|aum)\b/i.test(segment)
    || /\bwe(?:'ve| have)?\s+(?:currently\s+)?(?:manage|managed|oversee|oversaw)\b/i.test(segment)
    || /\bwe(?:'ve| have)?\s+(?:currently\s+)?(?:raised|closed|secured|launched|announced|completed)\s+(?:(?:our|a|an|the|new)\b|fund\b)/i.test(segment)
    || /\bwe\s+are\s+(?:launching|announcing|closing)\s+(?:(?:our|a|an|the|new)\b|fund\b)/i.test(segment);
}

export function supportsFundScaleClaim(input: {
  document: PublicTextDocument;
  sourceClass: FundSourceClass;
  subjectAliases: string[];
  now?: Date;
}): FundScaleMatch[] {
  const now = input.now ?? new Date();
  try {
    if (input.sourceClass !== "other_public" && new URL(input.document.url).protocol !== "https:") return [];
  } catch {
    return [];
  }
  if (input.sourceClass === "public_primary" && !isRegulatoryRecordUrl(input.document.url)) return [];
  const visible = htmlToVisibleText(input.document.text);
  const publishedAt = documentPublishedAt(input.document, now);
  const firstParty = input.sourceClass === "first_party_subject" || input.sourceClass === "first_party_investor";
  const segments = visible
    .split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9@])/)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length >= 8 && segment.length <= 1_600);
  const matches: FundScaleMatch[] = [];
  const seen = new Set<string>();
  for (const segment of segments) {
    const entityMentioned = input.subjectAliases.some((alias) => containsEntity(segment, alias));
    if (!entityMentioned && (!firstParty || !hasExplicitFirstPersonOwnership(segment))) continue;
    for (const amount of parseUsdAmounts(segment)) {
      let metric = metricAroundAmount(segment, amount);
      if (!metric) continue;
      if (metric === "reported_aum" && input.sourceClass === "public_primary") metric = "regulatory_aum";
      const asOf = isAumMetric(metric) ? explicitAsOf(segment, now) : undefined;
      const temporalState: FundScaleMatch["temporalState"] = isAumMetric(metric)
        ? asOf
          ? now.getTime() - new Date(asOf).getTime() <= CURRENT_AUM_MAX_AGE_MS ? "current" : "historical"
          : "unknown"
        : "fixed_historical";
      const eligibleForConfirmation = !isAumMetric(metric) || temporalState === "current";
      const qualifier: FundAmountQualifier = metric === "first_close" && amount.qualifier === "exact"
        ? "at_least"
        : amount.qualifier;
      const vehicle = isAumMetric(metric) ? undefined : canonicalFundVehicle(segment);
      const key = `${metric}:${amount.amountUsd}:${qualifier}:${vehicle?.key ?? "firm-wide"}:${normalized(segment)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        amountUsd: amount.amountUsd,
        metric,
        qualifier,
        excerpt: segment.slice(0, 700),
        ...(vehicle ? {
          fundVehicle: vehicle.label,
          vehicleIdentityKey: vehicle.key,
          vehicleCorroboratable: vehicle.corroboratable,
        } : {}),
        ...(asOf ? { asOf } : {}),
        ...(publishedAt ? { publishedAt } : {}),
        temporalState,
        eligibleForConfirmation,
      });
      if (matches.length >= 8) return matches;
    }
  }
  return matches;
}

function hostMatches(host: string, expected: string): boolean {
  const left = host.replace(/^www\./i, "").toLowerCase();
  const right = expected.replace(/^www\./i, "").toLowerCase();
  return left === right || left.endsWith(`.${right}`);
}

const listedHost = (host: string, list: readonly string[]): boolean =>
  list.some((candidate) => hostMatches(host, candidate));

export function isRegulatoryRecordUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  const path = url.pathname;
  if (host === "sec.gov" || host.endsWith(".sec.gov")) {
    return /^\/Archives\/edgar\/data\/\d{1,12}\/\d{18}\/[^/]+\.(?:html?|txt|xml|json)$/i.test(path)
      || /^\/firm\/summary\/\d+\/?$/i.test(path);
  }
  if (host === "fca.org.uk" || host.endsWith(".fca.org.uk")) {
    return /\/(?:firm|individual)\/details\/\d+/i.test(path)
      || /\/services\/v1\/(?:firm|individual)\//i.test(path);
  }
  if (
    host === "companieshouse.gov.uk"
    || host.endsWith(".companieshouse.gov.uk")
    || host === "find-and-update.company-information.service.gov.uk"
    || host === "api.company-information.service.gov.uk"
  ) {
    return /^\/company\/[A-Z0-9]{6,12}(?:\/|$)/i.test(path);
  }
  return false;
}

function sourceClass(
  document: PublicTextDocument,
  investorDomain: string | undefined,
  investorDomainScope: string | undefined,
  attribution: PortfolioInvestorEntity["attribution"],
): FundSourceClass {
  let url: URL;
  try {
    url = new URL(document.url);
    if (url.protocol !== "https:") return "other_public";
  } catch {
    return "other_public";
  }
  const host = url.hostname;
  if (listedHost(host, PRIMARY_HOSTS) && isRegulatoryRecordUrl(document.url)) return "public_primary";
  if (listedHost(host, PRESS_HOSTS)) return "independent_press";
  if (
    investorDomain
    && hostMatches(host, investorDomain)
    && (!investorDomainScope || sourceMatchesOfficialWebsiteScope(document.url, investorDomainScope))
  ) {
    return attribution === "direct_subject" ? "first_party_subject" : "first_party_investor";
  }
  return "other_public";
}

function registrableApprox(host: string): string {
  const parts = host.replace(/^www\./i, "").toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const twoLevelSuffix = new Set(["co.uk", "org.uk", "com.au", "com.br", "co.nz", "co.jp"]);
  const tail = parts.slice(-2).join(".");
  return twoLevelSuffix.has(tail) ? parts.slice(-3).join(".") : tail;
}

function documentRegistrableDomain(document: PublicTextDocument): string {
  try {
    return registrableApprox(new URL(document.url).hostname);
  } catch {
    return "";
  }
}

function syntheticPortfolioLead(lead: FundScaleLead): PortfolioLead {
  return {
    projectName: lead.fundVehicleHint || `${lead.fundName} fund scale`,
    investorEntityName: lead.fundName,
    ...(lead.fundHandle ? { investorEntityHandle: lead.fundHandle } : {}),
    ...(lead.attribution ? { attribution: lead.attribution } : {}),
    relationship: "invested_in",
    sources: lead.sources.map((source) => ({ ...source })),
    evidence_origin: "model_lead",
    artifact_verified: false,
    provider: "grok",
  };
}

function frozenInvestorDomainProof(artifact: SourceArtifact): PortfolioInvestorDomainProof | undefined {
  if (
    !artifact.investorEntityDomain
    || !artifact.investorDomainSourceUrl
    || !artifact.investorDomainSourceContentHash
    || !artifact.investorDomainCapturedAt
    || artifact.investorDomainSourceKind !== "provider_profile"
    || !artifact.investorDomainProfileName
    || !artifact.investorDomainProfileWebsite
  ) return undefined;
  return {
    domain: artifact.investorEntityDomain,
    sourceUrl: artifact.investorDomainSourceUrl,
    sourceContentHash: artifact.investorDomainSourceContentHash,
    capturedAt: artifact.investorDomainCapturedAt,
    sourceKind: artifact.investorDomainSourceKind,
    profileName: artifact.investorDomainProfileName,
    profileWebsite: artifact.investorDomainProfileWebsite,
  };
}

function resolveFundEntity(ctx: CollectContext, lead: FundScaleLead, now: Date): PortfolioInvestorEntity | null {
  const existing = ctx.evidence.sourceArtifacts.find((artifact) =>
    artifact.kind === "portfolio_relationship"
    && artifact.match === "relationship_confirmed"
    && artifact.investorEntityName
    && entityNamesMatch(artifact.investorEntityName, lead.fundName),
  );
  if (existing?.investorEntityName && existing.attribution) {
    const domainProof = frozenInvestorDomainProof(existing);
    return {
      name: existing.investorEntityName,
      aliases: [existing.investorEntityName, lead.fundName],
      ...(existing.investorEntityHandle ? { handle: existing.investorEntityHandle } : {}),
      handleTrusted: Boolean(existing.investorEntityHandle),
      ...(existing.investorEntityDomain ? { domain: existing.investorEntityDomain } : {}),
      ...(domainProof ? { domainScope: domainProof.profileWebsite } : {}),
      ...(domainProof ? { domainProof } : {}),
      attribution: existing.attribution,
      entityType: "organization",
      ...(existing.subjectHandle ? { subjectHandle: existing.subjectHandle } : {}),
      ...(existing.attributionSourceUrl ? { attributionSourceUrl: existing.attributionSourceUrl } : {}),
      ...(existing.attributionSourceContentHash
        ? { attributionSourceContentHash: existing.attributionSourceContentHash }
        : {}),
      ...(existing.attributionCapturedAt ? { attributionCapturedAt: existing.attributionCapturedAt } : {}),
      ...(existing.attributionSourceKind ? { attributionSourceKind: existing.attributionSourceKind } : {}),
    };
  }
  return portfolioEntityForLead(ctx, syntheticPortfolioLead(lead), now);
}

function claimGroupMetric(metric: FundScaleMetric): string {
  return metric;
}

function artifactHash(artifact: Omit<SourceArtifact, "contentHash">): string {
  return createHash("sha256").update(JSON.stringify(artifact)).digest("hex");
}

function amountLabel(amountUsd: number): string {
  if (amountUsd >= 1_000_000_000_000) return `$${(amountUsd / 1_000_000_000_000).toFixed(amountUsd % 1_000_000_000_000 ? 1 : 0)}T`;
  if (amountUsd >= 1_000_000_000) return `$${(amountUsd / 1_000_000_000).toFixed(amountUsd % 1_000_000_000 ? 1 : 0)}B`;
  if (amountUsd >= 1_000_000) return `$${(amountUsd / 1_000_000).toFixed(amountUsd % 1_000_000 ? 1 : 0)}M`;
  return `$${amountUsd.toLocaleString("en-US")}`;
}

interface InspectedSource {
  lead: FundScaleLead;
  entity?: PortfolioInvestorEntity;
  source: FundScaleLead["sources"][number];
  document?: PublicTextDocument;
  sourceClass?: FundSourceClass;
  officialInvestorDomain?: string;
  investorDomainProof?: PortfolioInvestorDomainProof;
  matches: FundScaleMatch[];
  failed: boolean;
}

interface SupportedRow extends InspectedSource {
  entity: PortfolioInvestorEntity;
  document: PublicTextDocument;
  sourceClass: FundSourceClass;
  match: FundScaleMatch;
  claimKey: string;
}

type UnclusteredSupportedRow = Omit<SupportedRow, "claimKey">;

function amountAgreement(left: number, right: number, tolerance: number): boolean {
  return Math.abs(left - right) / Math.max(left, right) <= tolerance;
}

function rowClaimBase(row: UnclusteredSupportedRow): string {
  const metric = claimGroupMetric(row.match.metric);
  const vehicle = isAumMetric(row.match.metric)
    ? "firm-wide-aum"
    : row.match.vehicleIdentityKey ?? "unspecified-fund";
  return `${compact(row.entity.name)}::${row.entity.attribution}::${metric}::${vehicle}`;
}

function deterministicClaimId(base: string, rows: UnclusteredSupportedRow[]): string {
  const amounts = rows.map((row) => row.match.amountUsd).sort((left, right) => left - right);
  const representativeAmount = amounts[Math.floor((amounts.length - 1) / 2)];
  const dates = rows
    .map((row) => row.match.asOf)
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value).getTime())
    .sort((left, right) => left - right);
  const representativeDate = dates.length
    ? new Date(dates[Math.floor((dates.length - 1) / 2)]).toISOString().slice(0, 10)
    : "fixed";
  const digest = createHash("sha256")
    .update(JSON.stringify({ base, representativeAmount, representativeDate }))
    .digest("hex");
  return `fund_scale_claim_v1_${digest}`;
}

function clusterSupportedRows(rows: UnclusteredSupportedRow[]): SupportedRow[] {
  const sorted = [...rows].sort((left, right) =>
    rowClaimBase(left).localeCompare(rowClaimBase(right))
    || left.match.amountUsd - right.match.amountUsd
    || String(left.match.asOf ?? "").localeCompare(String(right.match.asOf ?? ""))
    || left.document.url.localeCompare(right.document.url));
  const clusters: Array<{ base: string; rows: UnclusteredSupportedRow[] }> = [];
  for (const row of sorted) {
    const base = rowClaimBase(row);
    const tolerance = isAumMetric(row.match.metric) ? AUM_AMOUNT_TOLERANCE : 0.01;
    const rowDate = row.match.asOf ? new Date(row.match.asOf).getTime() : undefined;
    const cluster = clusters.find((candidate) => candidate.base === base && candidate.rows.every((existing) => {
      if (!amountAgreement(row.match.amountUsd, existing.match.amountUsd, tolerance)) return false;
      if (!isAumMetric(row.match.metric)) return true;
      const existingDate = existing.match.asOf ? new Date(existing.match.asOf).getTime() : undefined;
      if (rowDate === undefined || existingDate === undefined) return rowDate === existingDate;
      return Math.abs(rowDate - existingDate) <= AUM_CORROBORATION_WINDOW_MS;
    }));
    if (cluster) cluster.rows.push(row);
    else clusters.push({ base, rows: [row] });
  }

  // Vehicle identity is part of the claim key. An unnumbered same-amount row
  // remains separate: uniqueness inside a bounded discovery sample is not
  // evidence that it describes the named vehicle.
  return clusters.flatMap((cluster) => {
    cluster.rows.sort((left, right) => left.document.url.localeCompare(right.document.url));
    const claimKey = deterministicClaimId(cluster.base, cluster.rows);
    return cluster.rows.map((row) => ({ ...row, claimKey }));
  });
}

export async function collectFundScale(
  ctx: CollectContext,
  dependencies: FundScaleCollectorDependencies = {},
): Promise<AdapterRunResult> {
  const discover = dependencies.discover ?? discoverFundScaleCandidates;
  const fetchSource = dependencies.fetchSource ?? fetchPublicText;
  const lookupProfile = dependencies.lookupProfile ?? getProfile;
  const resolveEntity = dependencies.resolveEntity ?? resolveFundEntity;
  const now = dependencies.now?.() ?? new Date();
  const resolveInvestorDomain = dependencies.resolveInvestorDomain
    ?? ((lead: FundScaleLead, entity: PortfolioInvestorEntity) =>
      defaultInvestorDomainResolver(syntheticPortfolioLead(lead), entity, lookupProfile, now));
  const investorDomainByEntity = new Map<string, Promise<PortfolioInvestorDomainResolution | undefined>>();
  const sourceByUrl = new Map<string, Promise<PublicTextResult>>();
  const fetchSourceOnce = (url: string) => {
    const key = new URL(url).toString();
    const existing = sourceByUrl.get(key);
    if (existing) return existing;
    const pending = fetchSource(url).then((result) => {
      recordCall(
        "fund-scale-web",
        "source-fetch",
        0,
        result.status === "ok" ? "source_fetched" : result.reason,
        result.status === "ok" ? "succeeded" : "failed",
      );
      return result;
    });
    sourceByUrl.set(key, pending);
    return pending;
  };
  const resolveInvestorDomainOnce = (lead: FundScaleLead, entity: PortfolioInvestorEntity) => {
    const key = `${entity.attribution}::${compact(entity.name)}::${entity.handle?.replace(/^@/, "").toLowerCase() ?? ""}`;
    const existing = investorDomainByEntity.get(key);
    if (existing) return existing;
    const pending = resolveInvestorDomain(lead, entity).catch(() => entity.domain);
    investorDomainByEntity.set(key, pending);
    return pending;
  };

  if (!dependencies.discover && !env("XAI_API_KEY")) {
    return { state: "skipped", detail: "source-linked fund-scale discovery is not configured" };
  }

  ctx.emit({
    phase: "Investor",
    label: "Fund scale evidence",
    detail: "Fetching cited fund closes and AUM claims, then re-deriving the entity, metric, USD amount, and date before scoring…",
    source: "grok · manager pages · regulatory sources · independent press",
    tone: "neutral",
  });

  const leads = await discover(ctx);
  if (!leads) return { state: "failed", detail: "fund-scale discovery failed" };
  if (!leads.length) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale unavailable",
      detail: "Discovery returned no cited scale claim. Model silence was not treated as proof of a small fund or angel tier.",
      source: "fund-scale-web",
      tone: "warn",
    });
    return { state: "partial", detail: "0 source-linked fund-scale candidates" };
  }

  const entityByLead = new Map<FundScaleLead, PortfolioInvestorEntity | null>(
    leads.slice(0, MAX_CANDIDATES).map((lead) => [lead, resolveEntity(ctx, lead, now)]),
  );
  const unattributed = [...entityByLead.values()].filter((entity) => !entity).length;
  const sourceLess = [...entityByLead.entries()].filter(([lead, entity]) => Boolean(entity) && lead.sources.length === 0).length;
  const inspections: InspectedSource[] = (await Promise.all(leads.slice(0, MAX_CANDIDATES).map(async (lead) => {
    const entity = entityByLead.get(lead) ?? null;
    if (!entity) return [];
    const resolvedInvestorDomain = await resolveInvestorDomainOnce(lead, entity);
    const resolvedDomain = typeof resolvedInvestorDomain === "string"
      ? resolvedInvestorDomain
      : resolvedInvestorDomain?.domain;
    const officialInvestorDomain = domainFromWebsite(resolvedDomain);
    const investorDomainProof = typeof resolvedInvestorDomain === "object"
      && officialInvestorDomain === resolvedInvestorDomain.domain
      ? { ...resolvedInvestorDomain, domain: officialInvestorDomain }
      : undefined;
    const officialInvestorDomainScope = investorDomainProof?.profileWebsite ?? entity.domainScope;
    const aliases = [
      ...entity.aliases,
      entity.handle && (entity.handleTrusted || officialInvestorDomain) ? entity.handle.replace(/^@/, "") : undefined,
    ].filter((value): value is string => Boolean(value?.trim()));
    return Promise.all(lead.sources.slice(0, MAX_SOURCES_PER_CANDIDATE).map(async (source): Promise<InspectedSource> => {
      const result = await fetchSourceOnce(source.url);
      if (result.status !== "ok") {
        return { lead, entity, source, officialInvestorDomain, investorDomainProof, matches: [], failed: true };
      }
      const classification = sourceClass(result, officialInvestorDomain, officialInvestorDomainScope, entity.attribution);
      const matches = supportsFundScaleClaim({ document: result, sourceClass: classification, subjectAliases: aliases, now });
      return { lead, entity, source, document: result, sourceClass: classification, officialInvestorDomain, investorDomainProof, matches, failed: false };
    }));
  }))).flat();

  const unclusteredSupported: UnclusteredSupportedRow[] = inspections.flatMap((inspection) => {
    if (!inspection.entity || !inspection.document || !inspection.sourceClass) return [];
    return inspection.matches.map((match) => ({
      ...inspection,
      entity: inspection.entity!,
      document: inspection.document!,
      sourceClass: inspection.sourceClass!,
      match,
    }));
  });
  const supported = clusterSupportedRows(unclusteredSupported);
  const failed = inspections.filter((inspection) => inspection.failed).length;
  const successfulFetches = inspections.length - failed;
  const groups = new Map<string, SupportedRow[]>();
  for (const row of supported) groups.set(row.claimKey, [...(groups.get(row.claimKey) ?? []), row]);

  const baseRowEligibleForConfirmation = (row: SupportedRow): boolean => {
    if (!row.match.eligibleForConfirmation) return false;
    // The audited subject profile proves the person→fund affiliation, while a
    // separate frozen provider-profile proof must bind the fund's exact handle,
    // name, and website before an affiliated first-party page can confirm scale.
    // A caller-supplied domain string alone remains lead-only.
    if (
      row.entity.attribution === "affiliated_fund"
      && row.sourceClass === "first_party_investor"
      && !row.investorDomainProof
    ) return false;
    if (row.entity.attribution === "affiliated_fund" && row.entity.attributionSourceKind !== "provider_profile") return false;
    return true;
  };

  const pressRowEligible = (row: SupportedRow): boolean => baseRowEligibleForConfirmation(row)
    && row.sourceClass === "independent_press"
    && (isAumMetric(row.match.metric) || row.match.vehicleCorroboratable === true);
  const independentPressPair = (row: SupportedRow, other: SupportedRow): boolean => {
    const rowDomain = documentRegistrableDomain(row.document);
    const otherDomain = documentRegistrableDomain(other.document);
    const distinctDomains = Boolean(rowDomain && otherDomain && rowDomain !== otherDomain);
    const distinctContent = /^[a-f0-9]{64}$/i.test(row.document.contentHash)
      && /^[a-f0-9]{64}$/i.test(other.document.contentHash)
      && row.document.contentHash.toLowerCase() !== other.document.contentHash.toLowerCase();
    const rowExcerptHash = createHash("sha256").update(normalized(row.match.excerpt)).digest("hex");
    const otherExcerptHash = createHash("sha256").update(normalized(other.match.excerpt)).digest("hex");
    return distinctDomains && distinctContent && rowExcerptHash !== otherExcerptHash;
  };
  const pressRowCorroborated = (row: SupportedRow, rows: SupportedRow[]): boolean =>
    pressRowEligible(row)
    && rows.some((other) => other !== row && pressRowEligible(other) && independentPressPair(row, other));
  const pressGroupCorroborated = (rows: SupportedRow[]): boolean =>
    rows.some((row) => pressRowCorroborated(row, rows));
  const preliminaryPressConfirmation = new Map(
    [...groups].map(([claimKey, rows]) => [claimKey, pressGroupCorroborated(rows)]),
  );

  // AUM is a dated point-in-time metric. Retain older rows as history, but only
  // the newest 90-day window may confirm current scale. If that window contains
  // materially conflicting amounts, fail closed instead of choosing the larger
  // claim. Unvetted public pages may remain visible as candidates but cannot
  // move the authoritative date window or veto a qualified source.
  const latestAumByEntity = new Map<string, number>();
  const conflictEligibleAum = supported.filter((candidate) =>
    isAumMetric(candidate.match.metric)
    && candidate.match.asOf
    && baseRowEligibleForConfirmation(candidate)
    && (
      candidate.sourceClass === "first_party_subject"
      || candidate.sourceClass === "first_party_investor"
      || candidate.sourceClass === "public_primary"
      || (candidate.sourceClass === "independent_press" && preliminaryPressConfirmation.get(candidate.claimKey) === true)
    ));
  for (const row of conflictEligibleAum) {
    const entityKey = compact(row.entity.name);
    const timestamp = new Date(row.match.asOf!).getTime();
    latestAumByEntity.set(entityKey, Math.max(latestAumByEntity.get(entityKey) ?? 0, timestamp));
  }
  const conflictingAumEntities = new Set<string>();
  for (const [entityKey, latest] of latestAumByEntity) {
    const newestAmounts = conflictEligibleAum
      .filter((row) =>
        compact(row.entity.name) === entityKey
        && row.match.asOf
        && latest - new Date(row.match.asOf).getTime() <= AUM_CORROBORATION_WINDOW_MS)
      .map((row) => row.match.amountUsd);
    const materiallyConflicting = newestAmounts.some((amount, index) =>
      newestAmounts.slice(index + 1).some((other) => !amountAgreement(amount, other, AUM_AMOUNT_TOLERANCE)));
    if (materiallyConflicting) conflictingAumEntities.add(entityKey);
  }
  const rowEligibleForConfirmation = (row: SupportedRow): boolean => {
    if (!baseRowEligibleForConfirmation(row)) return false;
    if (!isAumMetric(row.match.metric)) return true;
    if (!row.match.asOf) return false;
    const entityKey = compact(row.entity.name);
    const latest = latestAumByEntity.get(entityKey);
    return latest !== undefined
      && latest - new Date(row.match.asOf).getTime() <= AUM_CORROBORATION_WINDOW_MS
      && !conflictingAumEntities.has(entityKey);
  };

  const confirmations = new Map<string, { confirmed: boolean; pressConfirmed: boolean; sourceCount: number }>();
  const confirmedClaims = new Set<string>();
  for (const [claimKey, rows] of groups) {
    const eligible = rows.filter(rowEligibleForConfirmation);
    const authoritative = eligible.some((row) =>
      row.sourceClass === "first_party_subject"
      || row.sourceClass === "first_party_investor"
      || row.sourceClass === "public_primary");
    const pressConfirmed = pressGroupCorroborated(eligible);
    const confirmed = authoritative || pressConfirmed;
    const sourceCount = new Set(eligible
      .filter((row) => row.sourceClass !== "other_public")
      .map((row) => row.document.url)).size;
    confirmations.set(claimKey, { confirmed, pressConfirmed, sourceCount });
    if (confirmed) confirmedClaims.add(claimKey);
  }

  for (const row of supported) {
    const confirmation = confirmations.get(row.claimKey);
    const acceptedClass = row.sourceClass === "first_party_subject"
      || row.sourceClass === "first_party_investor"
      || row.sourceClass === "public_primary"
      || row.sourceClass === "independent_press";
    const confirmationThreshold = row.sourceClass === "independent_press"
      ? pressRowCorroborated(row, (groups.get(row.claimKey) ?? []).filter(rowEligibleForConfirmation))
      : confirmation?.confirmed;
    const sourceConfirmed = Boolean(confirmationThreshold && rowEligibleForConfirmation(row) && acceptedClass);
    const basis: SourceArtifact["fundScaleBasis"] = row.sourceClass === "public_primary"
      ? "regulatory"
      : row.sourceClass === "first_party_subject" || row.sourceClass === "first_party_investor"
        ? "manager_reported"
        : row.sourceClass === "independent_press" && sourceConfirmed
          ? "press_corroborated"
          : undefined;
    const unhashed: Omit<SourceArtifact, "contentHash"> = {
      kind: "fund_scale",
      provider: "fund-scale-web",
      title: `${row.entity.name} ${row.match.metric.replace(/_/g, " ")} ${amountLabel(row.match.amountUsd)}`,
      sourceUrl: row.document.url,
      capturedAt: row.document.capturedAt,
      sourceContentHash: row.document.contentHash,
      excerpt: row.match.excerpt,
      match: sourceConfirmed ? "fund_scale_confirmed" : "candidate",
      subjectName: ctx.evidence.profile.resolved_name || ctx.evidence.profile.display_name || ctx.handle,
      subjectHandle: row.entity.subjectHandle ?? ctx.handle,
      investorEntityName: row.entity.name,
      ...(row.entity.handle && (row.entity.handleTrusted || row.officialInvestorDomain)
        ? { investorEntityHandle: row.entity.handle }
        : {}),
      ...(row.officialInvestorDomain ? { investorEntityDomain: row.officialInvestorDomain } : {}),
      ...(row.investorDomainProof ? {
        investorDomainSourceUrl: row.investorDomainProof.sourceUrl,
        investorDomainSourceContentHash: row.investorDomainProof.sourceContentHash,
        investorDomainCapturedAt: row.investorDomainProof.capturedAt,
        investorDomainSourceKind: row.investorDomainProof.sourceKind,
        investorDomainProfileName: row.investorDomainProof.profileName,
        investorDomainProfileWebsite: row.investorDomainProof.profileWebsite,
      } : {}),
      attribution: row.entity.attribution,
      ...(row.entity.attributionSourceUrl ? { attributionSourceUrl: row.entity.attributionSourceUrl } : {}),
      ...(row.entity.attributionSourceContentHash
        ? { attributionSourceContentHash: row.entity.attributionSourceContentHash }
        : {}),
      ...(row.entity.attributionCapturedAt ? { attributionCapturedAt: row.entity.attributionCapturedAt } : {}),
      ...(row.entity.attributionSourceKind ? { attributionSourceKind: row.entity.attributionSourceKind } : {}),
      sourceClass: row.sourceClass,
      fundName: row.entity.name,
      fundSizeUsd: row.match.amountUsd,
      ...(row.match.fundVehicle ? { fundVehicle: row.match.fundVehicle } : {}),
      fundScaleMetric: row.match.metric,
      fundAmountQualifier: row.match.qualifier,
      ...(basis ? { fundScaleBasis: basis } : {}),
      ...(row.match.asOf ? { fundScaleAsOf: row.match.asOf } : {}),
      ...(row.match.publishedAt ? { publishedAt: row.match.publishedAt } : {}),
      fundScaleTemporalState: row.match.temporalState,
      fundScaleSourceCount: confirmation?.sourceCount ?? 0,
      fundScaleClaimId: row.claimKey,
    };
    const artifact: SourceArtifact = { ...unhashed, contentHash: artifactHash(unhashed) };
    const exists = ctx.evidence.sourceArtifacts.some((candidate) =>
      candidate.kind === "fund_scale"
      && candidate.fundScaleClaimId === artifact.fundScaleClaimId
      && candidate.fundScaleMetric === artifact.fundScaleMetric
      && candidate.sourceUrl === artifact.sourceUrl,
    );
    if (!exists) ctx.evidence.sourceArtifacts.push(artifact);
  }

  const reportedClaims = [...groups.keys()].filter((key) => !confirmedClaims.has(key)).length;
  const incomplete = unattributed + sourceLess + failed;
  if (confirmedClaims.size > 0 && incomplete > 0) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale verification partial",
      detail: `${confirmedClaims.size} scale claim${confirmedClaims.size === 1 ? "" : "s"} verified, but ${incomplete} candidate disposition${incomplete === 1 ? " remains" : "s remain"} incomplete.`,
      source: "fund-scale-web",
      tone: "warn",
    });
    return { state: "partial", detail: `${confirmedClaims.size} verified · ${reportedClaims} reported · ${incomplete} incomplete` };
  }
  if (confirmedClaims.size > 0) {
    ctx.emit({
      phase: "Investor",
      label: "Fund scale verified",
      detail: `${confirmedClaims.size} source-fetched scale claim${confirmedClaims.size === 1 ? "" : "s"} passed the deterministic confirmation threshold.`,
      source: "fund-scale-web",
      tone: "good",
    });
    return { state: "executed", detail: `${confirmedClaims.size} verified · ${reportedClaims} reported` };
  }
  if (!inspections.length || incomplete > 0) {
    return {
      state: successfulFetches ? "partial" : "failed",
      detail: `${successfulFetches} fetched · ${incomplete} incomplete · 0 verified`,
    };
  }
  ctx.emit({
    phase: "Investor",
    label: "Fund scale not verified",
    detail: "Cited pages were inspected, but no current AUM or completed fund-size claim met the confirmation threshold.",
    source: "fund-scale-web",
    tone: "warn",
  });
  return { state: "partial", detail: `${successfulFetches} sources inspected · ${reportedClaims} reported · 0 verified` };
}
