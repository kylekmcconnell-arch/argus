/* Pure presentation helpers for the ARGUS report redesign.

   Nothing here scores, rescores or rewrites saved evidence. Every function
   reads a frozen report record and returns labels, links, counts or
   reconciliation notes that the chapters render. Missing inputs stay missing:
   a helper returns null instead of a zero, a default or an inferred value. */

import type { WebTeamMember, BasicFact } from "../../data/evidence";
import type { IntelligenceQuestionState, IntelligenceSourceRef } from "../../intelligence/types";

export type ChapterId = "decision" | "scores" | "product" | "people" | "market" | "social" | "connections" | "evidence";

export const CHAPTERS: ReadonlyArray<{ id: ChapterId; label: string }> = [
  { id: "decision", label: "Decision" },
  { id: "scores", label: "Scores" },
  { id: "product", label: "What the product is" },
  { id: "people", label: "People" },
  { id: "market", label: "Market" },
  { id: "social", label: "Social" },
  { id: "connections", label: "Connections" },
  { id: "evidence", label: "Evidence & method" },
];

export type Tone = "green" | "amber" | "red" | "neutral";

export function verdictTone(verdict: string | null | undefined): Tone {
  const value = String(verdict ?? "").toUpperCase();
  if (value === "PASS" || value === "SAFE" || value === "LOW") return "green";
  if (value === "FAIL" || value === "AVOID" || value === "DANGER" || value === "HIGH" || value === "CRITICAL" || value.startsWith("UNVERIFIABLE")) return "red";
  if (value === "CAUTION" || value === "PROVISIONAL" || value === "WARN" || value === "WARNING" || value === "MEDIUM") return "amber";
  return "neutral";
}

export function verdictWord(verdict: string | null | undefined): string {
  const value = String(verdict ?? "").trim();
  if (!value) return "Not scored";
  if (/^UNVERIFIABLE/i.test(value)) return "Unverifiable identity";
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase().replace(/_/g, " ");
}

// ── numbers ──────────────────────────────────────────────────────────────

export function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Floor, never round up: a lower bound must stay a lower bound. */
export function floorTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.floor(value * factor + 1e-9) / factor;
}

export function exactPercent(numerator: number, denominator: number): string | null {
  if (!finite(numerator) || !finite(denominator) || denominator <= 0) return null;
  const value = (numerator / denominator) * 100;
  const rounded = Math.round(value * 10) / 10;
  // Show the exact half point (7/8 = 87.5%) and never overstate completion.
  const shown = rounded > value ? floorTo(value, 1) : rounded;
  return `${Number.isInteger(shown) ? shown.toFixed(0) : shown.toFixed(1)}%`;
}

export function pct(value: number | null | undefined, decimals = 2): string | null {
  if (!finite(value)) return null;
  return `${value.toFixed(decimals)}%`;
}

export function usd(value: number | null | undefined, maximumFractionDigits = 2): string | null {
  if (!finite(value)) return null;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits }).format(value);
}

/** $1.50M, $17.61M, $4.32M, $209.6K, $29.4K: millions and billions keep cents of a unit, thousands one decimal. */
export function usdShort(value: number | null | undefined): string | null {
  if (!finite(value)) return null;
  const abs = Math.abs(value);
  const unit = abs >= 1e9 ? [1e9, "B", 2] as const : abs >= 1e6 ? [1e6, "M", 2] as const : abs >= 1e3 ? [1e3, "K", 1] as const : null;
  if (!unit) return usd(value, abs < 1 ? 4 : 2);
  return `$${(value / unit[0]).toFixed(unit[2])}${unit[1]}`;
}

export function countShort(value: number | null | undefined): string | null {
  if (!finite(value)) return null;
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(abs >= 1e10 ? 0 : 1).replace(/\.0$/, "")}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(abs >= 1e7 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(abs >= 1e4 ? 0 : 1).replace(/\.0$/, "")}K`;
  return value.toLocaleString("en-US");
}

export function priceUsd(value: number | null | undefined): string | null {
  if (!finite(value)) return null;
  if (value >= 1) return usd(value, 2);
  const digits = Math.min(10, Math.max(4, 2 - Math.floor(Math.log10(Math.abs(value)))));
  return `$${value.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "")}`;
}

export function signedPct(value: number | null | undefined, decimals = 2): string | null {
  if (!finite(value)) return null;
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(decimals)}%`;
}

// ── dates ────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseDate(value: string | number | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "3 Sep 2026 · 05:08 UTC" — absolute, time-zone explicit. */
export function utcStamp(value: string | number | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} · ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
}

export function utcDay(value: string | number | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function utcMonth(value: string | number | null | undefined): string | null {
  const date = parseDate(value);
  if (!date) return null;
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${long[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

// ── links ────────────────────────────────────────────────────────────────

export function safeHttpUrl(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const candidate = /^https?:\/\//i.test(raw) ? raw : /^[a-z0-9.-]+\.[a-z]{2,}(?:\/|$)/i.test(raw) ? `https://${raw}` : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function xHandleUrl(handle: string | null | undefined): string | null {
  const clean = String(handle ?? "").trim().replace(/^@/, "");
  return /^[A-Za-z0-9_]{1,30}$/.test(clean) ? `https://x.com/${clean}` : null;
}

const CHAIN_EXPLORERS: Record<string, { name: string; token: (address: string) => string }> = {
  ethereum: { name: "Etherscan", token: (a) => `https://etherscan.io/token/${a}` },
  base: { name: "BaseScan", token: (a) => `https://basescan.org/token/${a}` },
  bsc: { name: "BscScan", token: (a) => `https://bscscan.com/token/${a}` },
  polygon: { name: "PolygonScan", token: (a) => `https://polygonscan.com/token/${a}` },
  arbitrum: { name: "Arbiscan", token: (a) => `https://arbiscan.io/token/${a}` },
  optimism: { name: "Optimism Explorer", token: (a) => `https://optimistic.etherscan.io/token/${a}` },
  avalanche: { name: "Snowtrace", token: (a) => `https://snowtrace.io/token/${a}` },
  linea: { name: "LineaScan", token: (a) => `https://lineascan.build/token/${a}` },
  scroll: { name: "ScrollScan", token: (a) => `https://scrollscan.com/token/${a}` },
  solana: { name: "Solscan", token: (a) => `https://solscan.io/token/${a}` },
  robinhood: { name: "Blockscout", token: (a) => `https://robinhoodchain.blockscout.com/token/${a}` },
};

const CHAIN_LABELS: Record<string, string> = {
  bsc: "BNB Chain",
  ethereum: "Ethereum",
  base: "Base",
  solana: "Solana",
  polygon: "Polygon",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  avalanche: "Avalanche",
  robinhood: "Robinhood Chain",
};

export function chainLabel(chain: string | null | undefined): string {
  const key = String(chain ?? "").trim().toLowerCase();
  if (!key) return "Unknown chain";
  return CHAIN_LABELS[key] ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function tokenExplorer(chain: string | null | undefined, address: string | null | undefined): { name: string; url: string } | null {
  const key = String(chain ?? "").trim().toLowerCase();
  const explorer = CHAIN_EXPLORERS[key];
  if (!explorer || !address) return null;
  return { name: explorer.name, url: explorer.token(address) };
}

export function dexscreenerUrl(chain: string | null | undefined, address: string | null | undefined): string | null {
  const key = String(chain ?? "").trim().toLowerCase();
  if (!key || !address || !/^[A-Za-z0-9]{20,64}$/.test(address)) return null;
  return `https://dexscreener.com/${key}/${address.toLowerCase()}`;
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// ── provider + source language ───────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  monid: "Monid/Akta",
  akta: "Monid/Akta",
  peopledatalabs: "People Data Labs",
  pdl: "People Data Labs",
  crunchbase: "Crunchbase",
  teampage: "The official team page",
  website: "The official website",
  twitterapi: "The official X account",
  "twitterapi-io": "X search",
  grok: "Model-assisted web research",
  "claude-web-search": "Model-assisted web research",
  github: "GitHub",
  goplus: "GoPlus",
  coingecko: "CoinGecko",
  dexscreener: "DexScreener",
  defillama: "DeFiLlama",
  cryptorank: "CryptoRank",
  arkham: "Arkham",
  "argus-graph": "ARGUS organization graph",
  "analyst-scoring": "Frozen scoring analysis",
  opensanctions: "Sanctions screening",
  courtlistener: "Court records",
  "memory.lol": "Handle-history provider",
};

export function providerLabel(provider: string | null | undefined): string {
  const key = String(provider ?? "").trim();
  if (!key) return "Recorded source";
  if (PROVIDER_LABELS[key.toLowerCase()]) return PROVIDER_LABELS[key.toLowerCase()];
  const plain = key.replace(/[_-]+/g, " ").trim();
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

const LICENSED_PROVIDERS = new Set(["monid", "akta", "peopledatalabs", "pdl", "crunchbase", "cryptorank"]);
const FIRST_PARTY_PROVIDERS = new Set(["teampage", "website", "official_site", "official-site"]);

export function sourceTierLabel(source: Pick<IntelligenceSourceRef, "sourceClass" | "evidenceState" | "relation">): string {
  if (source.relation === "contradicts") return "Conflicting view";
  switch (source.sourceClass) {
    case "official_subject":
    case "first_party_profile":
      return "First party";
    case "official_counterparty":
      return "Counterparty record";
    case "licensed_enrichment":
    case "canonical_market_registry":
    case "protocol_index":
    case "vesting_data_provider":
      return "Provider-reported";
    case "onchain_data_provider":
      return source.evidenceState === "measured" ? "Measured" : "Onchain provider";
    case "direct_chain_rpc":
      return "Measured";
    case "public_registry":
      return "Public registry";
    case "independent_publication":
      return "Independent publication";
    case "bounded_collection_record":
      return "Collection record";
    default:
      return source.evidenceState === "verified" ? "Verified artifact" : "Public source";
  }
}

export function evidenceStateLabel(state: string | null | undefined): string {
  switch (state) {
    case "verified": return "Verified artifact";
    case "measured": return "Measured";
    case "bounded": return "Bounded sample";
    case "reported_context": return "Reported context";
    default: return "Recorded";
  }
}

export function questionStatusLabel(state: IntelligenceQuestionState | string): string {
  switch (state) {
    case "resolved": return "Answered";
    case "reported": return "Reported";
    case "partial": return "Partly answered";
    case "unresolved": return "Not established";
    case "unavailable": return "Source unavailable";
    case "not_collected": return "Not checked";
    case "not_applicable": return "Not applicable";
    default: return "Open";
  }
}

export function questionStatusTone(state: IntelligenceQuestionState | string): Tone {
  if (state === "resolved" || state === "reported") return "green";
  if (state === "not_collected" || state === "unavailable") return "red";
  if (state === "not_applicable") return "neutral";
  return "amber";
}

export function questionIsOpen(state: IntelligenceQuestionState | string): boolean {
  return state !== "resolved" && state !== "not_applicable";
}

// ── identity + contacts ──────────────────────────────────────────────────

function nameTokens(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((token) => token.length >= 2);
}

export function linkedinSlug(url: string | null | undefined): string | null {
  const match = String(url ?? "").match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return match ? decodeURIComponent(match[1]).replace(/\/$/, "") : null;
}

/**
 * True only when the profile slug reads as ANOTHER person's name: two or more
 * name-like words, none of which matches the person. A single handle-like slug
 * ("in/silur") cannot be judged either way and is not flagged.
 */
export function linkedinIdentityMismatch(personName: string, url: string | null | undefined): boolean {
  const slug = linkedinSlug(url);
  if (!slug) return false;
  const slugWords = slug
    .toLowerCase()
    .split(/[-_.]+/)
    .map((word) => word.replace(/\d+/g, ""))
    .filter((word) => /^[a-z]{3,}$/.test(word));
  if (slugWords.length < 2) return false;
  const person = nameTokens(personName);
  if (!person.length) return false;
  const overlaps = slugWords.some((word) => person.some((token) =>
    token.length >= 3 && (word === token || word.startsWith(token) || token.startsWith(word))));
  return !overlaps;
}

export interface ContactValue { label: string; url: string }

export interface PersonContacts {
  x: ContactValue | null;
  telegram: ContactValue | null;
  linkedin: ContactValue | null;
  email: ContactValue | null;
  /** Set when a recorded LinkedIn reference was excluded as an apparent mismatch. */
  linkedinIssue?: string;
  mismatchedLinkedinSlug?: string;
}

/** LinkedIn profiles recorded by a provider-backed fact source that names this person. */
export function recordedLinkedinsFor(name: string, facts: readonly BasicFact[] | undefined): string[] {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return [];
  const urls = new Set<string>();
  for (const fact of facts ?? []) {
    for (const source of fact.sources ?? []) {
      const url = source.url ?? "";
      if (!/linkedin\.com\/in\//i.test(url)) continue;
      if ((source as { artifactVerified?: boolean }).artifactVerified === false) continue;
      const text = `${source.excerpt ?? ""} ${source.title ?? ""}`.toLowerCase();
      if (text.includes(wanted)) urls.add(url);
    }
  }
  return [...urls];
}

export function personContacts(
  member: Pick<WebTeamMember, "name" | "handle" | "linkedin" | "telegram" | "email" | "identity_link_evidence_origin" | "handleProvenance">,
  extraLinkedins: readonly (string | null | undefined)[] = [],
): PersonContacts {
  const handleTrusted = Boolean(member.handle)
    && (member.handleProvenance === "subject_first_party" || member.identity_link_evidence_origin !== "model_lead");
  const xUrl = handleTrusted ? xHandleUrl(member.handle) : null;
  const telegramSlug = String(member.telegram ?? "").trim().replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  const email = String(member.email ?? "").trim();

  let linkedin: ContactValue | null = null;
  let linkedinIssue: string | undefined;
  let mismatchedLinkedinSlug: string | undefined;
  const candidates = [member.linkedin, ...extraLinkedins]
    .map((value) => safeHttpUrl(value ?? ""))
    .filter((value): value is string => Boolean(value))
    .filter((value, index, all) => all.findIndex((other) => linkedinSlug(other)?.toLowerCase() === linkedinSlug(value)?.toLowerCase()) === index);
  for (const url of candidates) {
    if (linkedinIdentityMismatch(member.name, url)) {
      linkedinIssue = "Recorded link excluded: apparent identity mismatch.";
      mismatchedLinkedinSlug = linkedinSlug(url) ?? undefined;
      continue;
    }
    if (!linkedin) linkedin = { label: `in/${linkedinSlug(url) ?? "profile"}`, url };
  }

  return {
    x: xUrl ? { label: `@${String(member.handle).replace(/^@/, "")}`, url: xUrl } : null,
    telegram: /^[A-Za-z0-9_]{4,64}$/.test(telegramSlug) ? { label: `@${telegramSlug}`, url: `https://t.me/${telegramSlug}` } : null,
    linkedin,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { label: email, url: `mailto:${email}` } : null,
    ...(linkedinIssue && !linkedin ? { linkedinIssue } : {}),
    ...(mismatchedLinkedinSlug ? { mismatchedLinkedinSlug } : {}),
  };
}

export function personSourceBadge(member: Pick<WebTeamMember, "provider" | "source">, contacts: PersonContacts): { label: string; tone: Tone } {
  if (contacts.mismatchedLinkedinSlug) return { label: "Identity link needs correction", tone: "red" };
  const provider = String(member.provider ?? "").toLowerCase();
  if (FIRST_PARTY_PROVIDERS.has(provider) || /official (?:team|site|website)/i.test(member.source)) return { label: "First-party listing", tone: "green" };
  if (LICENSED_PROVIDERS.has(provider)) return { label: "Provider-reported", tone: "amber" };
  if (provider === "twitterapi") return { label: "Named by the official account", tone: "amber" };
  return { label: "Recorded, not verified", tone: "amber" };
}

export function initials(name: string): string {
  const words = name.replace(/^@/, "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

// ── product ──────────────────────────────────────────────────────────────

/** "Altcoinist is an onchain trading execution platform and bot that …" → "Onchain trading execution platform and bot". */
export function productLabel(subjectName: string, what: string | null | undefined): string | null {
  const text = String(what ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const escaped = subjectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let body = text.replace(new RegExp(`^(?:the\\s+)?${escaped}\\s+(?:is|are|operates as|provides)\\s+`, "i"), "");
  if (body === text) body = text.replace(/^[A-Z][\w$.-]*(?:\s[A-Z][\w$.-]*)?\s+(?:is|are)\s+/, "");
  body = body.replace(/^(?:an?|the)\s+/i, "");
  const clause = body.split(/\s+(?:that|which|delivering|offering|providing|designed|built|with|where|who)\s+|[,;:.(]/)[0]?.trim() ?? "";
  if (clause.length < 8 || clause.length > 90) return null;
  return clause.charAt(0).toUpperCase() + clause.slice(1);
}

// ── holders ─────────────────────────────────────────────────────────────

export interface HolderRow { label: string; percent: number; alert?: boolean; address?: string }

// ── report-quality reconciliation ────────────────────────────────────────

export type IssueSeverity = "Critical" | "High" | "Medium";

export interface ReportIssue {
  id: string;
  severity: IssueSeverity;
  area: string;
  title: string;
  observed: string;
  handling: string;
  /** Short plural noun phrase used in the review banner. */
  bannerLabel: string;
  chapter: ChapterId;
  /** Reconciliation conflicts drive the decision banner; integrity notes stay in the audit list. */
  kind: "reconciliation" | "integrity";
}

/** "F1_identity_verifiability" → "identity verifiability": internal axis keys never reach the reader. */
export function plainAxisKeys(text: string): string {
  return text.replace(/\b[A-Z]\d+_([a-z0-9_]+)\b/g, (_match, words: string) => words.replace(/_/g, " "));
}

export interface ReconciliationInput {
  subjectName: string;
  tokenSymbol?: string | null;
  tokenScore?: { score: number | null; verdict: string | null } | null;
  /** Market-mechanics lens on the opposite (risk-points) scale. */
  riskLens?: { risk: number | null; verdict: string | null } | null;
  assessedWallets?: { topPct: number | null; combinedPct: number | null; assessedCount: number | null; excludedNote?: string | null } | null;
  largestNonPoolHolderPct?: number | null;
  teamAxis?: { score: number; weight: number; label: string } | null;
  /** The strict project-team identity check (status + note as frozen). */
  strictTeamVerification?: { status: string; note: string } | null;
  mismatchedIdentities?: Array<{ name: string; slug: string }>;
  tradingWindows?: Array<{ label: string; buys: number; sells: number }>;
  collection?: { successful: number; applicable: number } | null;
  openQuestions?: { open: number; total: number } | null;
  qualityFindings?: Array<{ severity: "error" | "warning"; code: string; message: string }>;
}

const TOKEN_PASS = /^(PASS|SAFE)$/i;
const RISK_ALARM = /^(DANGER|AVOID|HIGH|CRITICAL|FAIL)$/i;

export function reconciliationIssues(input: ReconciliationInput): ReportIssue[] {
  const issues: ReportIssue[] = [];
  const symbol = input.tokenSymbol ? `$${input.tokenSymbol}` : "the token";

  if (input.tokenScore && input.riskLens
    && TOKEN_PASS.test(String(input.tokenScore.verdict ?? ""))
    && RISK_ALARM.test(String(input.riskLens.verdict ?? ""))) {
    const riskText = finite(input.riskLens.risk) ? `${input.riskLens.risk} risk points and ${String(input.riskLens.verdict).toUpperCase()}` : String(input.riskLens.verdict).toUpperCase();
    issues.push({
      id: "token-lens-conflict",
      severity: "Critical",
      area: "Scoring",
      title: `Token ${verdictWord(input.tokenScore.verdict).toUpperCase()} conflicts with ${String(input.riskLens.verdict).toUpperCase()}`,
      observed: `${finite(input.tokenScore.score) ? `${input.tokenScore.score}/100 ` : ""}${String(input.tokenScore.verdict).toUpperCase()} is the saved token safety result; the market-mechanics lens for ${symbol} reports ${riskText}. The two use different scales, and no saved rule states how they interact.`,
      handling: "Both historical outputs are kept and labelled with their scales. Treat the token result as unsettled until a versioned rule reconciles them; no corrected score is inferred here.",
      bannerLabel: "token risk scales",
      chapter: "scores",
      kind: "reconciliation",
    });
  }

  const assessedTop = input.assessedWallets?.topPct;
  const largest = input.largestNonPoolHolderPct;
  if (finite(assessedTop) && finite(largest) && largest - assessedTop >= 10) {
    const combined = input.assessedWallets?.combinedPct;
    const count = input.assessedWallets?.assessedCount;
    issues.push({
      id: "holder-population-conflict",
      severity: "Critical",
      area: "Data",
      title: "Holder classifications change the verdict",
      observed: `The holder score uses a largest assessed wallet of ${assessedTop.toFixed(2)}%${finite(count) ? ` across ${count} assessed wallet row${count === 1 ? "" : "s"}` : ""}${finite(combined) ? ` (combined at least ${floorTo(combined, 2).toFixed(2)}%)` : ""}. The market view labels one non-pool address at ${largest.toFixed(2)}% of supply. Exclusion rules and contract status alone do not settle economic control.`,
      handling: "Withhold concentration reassurance until one holder register records address type, beneficiary, lock terms, denominator, block time and the reason for each exclusion.",
      bannerLabel: "holder classifications",
      chapter: "market",
      kind: "reconciliation",
    });
  }

  const strict = input.strictTeamVerification;
  const strictFailed = strict
    && strict.status !== "confirmed"
    && strict.status !== "not-applicable"
    && /did not pass strict verification|not (?:been )?verified|unverified/i.test(strict.note);
  if (input.teamAxis && strict && strictFailed
    && input.teamAxis.weight > 0 && input.teamAxis.score / input.teamAxis.weight >= 0.75) {
    const count = strict.note.match(/(\d+)\s+source-attributed founder or executive records?/i)?.[1];
    issues.push({
      id: "team-verification-conflict",
      severity: "Critical",
      area: "Evidence",
      title: "Verified leadership conflicts with failed verification",
      observed: `${input.teamAxis.label} earns ${input.teamAxis.score}/${input.teamAxis.weight}. The strict team-identity check records ${count ? `${count} founder or executive record${count === "1" ? "" : "s"} that` : "records that"} did not pass strict verification and did not resolve operator identity.`,
      handling: "Read team members as provider-reported until evidence tier and source eligibility agree across the score and the checks. Confirm each current role separately from the existence of a provider entry.",
      bannerLabel: "verification status",
      chapter: "people",
      kind: "reconciliation",
    });
  }

  for (const mismatch of input.mismatchedIdentities ?? []) {
    issues.push({
      id: `identity-mismatch-${mismatch.slug}`,
      severity: "High",
      area: "Identity",
      title: "A LinkedIn link appears bound to the wrong person",
      observed: `${mismatch.name} links to linkedin.com/in/${mismatch.slug}. The profile name does not match the person. This is an apparent mismatch, not an independently verified identity finding.`,
      handling: "The link is excluded as a contact and as identity proof. Rebind through an exact platform ID and reciprocal first-party evidence before it supports a role or score.",
      bannerLabel: "identity links",
      chapter: "people",
      kind: "reconciliation",
    });
  }

  const windows = (input.tradingWindows ?? []).filter((window) => finite(window.buys) && finite(window.sells));
  if (windows.length >= 2) {
    const first = windows[0];
    const differing = windows.slice(1).filter((window) => window.buys !== first.buys || window.sells !== first.sells);
    if (differing.length) {
      issues.push({
        id: "trading-population-conflict",
        severity: "High",
        area: "Data",
        title: "Trading figures use unexplained populations",
        observed: [first, ...differing].map((window) => `${window.label}: ${window.buys} buys / ${window.sells} sells`).join(". ") + ".",
        handling: "Each figure keeps its own provider, pair set and window. Differences are not proof that one provider is wrong; recompute only within aligned populations.",
        bannerLabel: "trading windows",
        chapter: "market",
        kind: "reconciliation",
      });
    }
  }

  if (input.collection && input.openQuestions
    && input.collection.applicable > 0
    && input.collection.successful >= input.collection.applicable - 1
    && input.openQuestions.total > 0
    && input.openQuestions.open / input.openQuestions.total >= 0.5) {
    issues.push({
      id: "coverage-vs-answers",
      severity: "Medium",
      area: "Coverage",
      title: "Collection completion is not answered diligence",
      observed: `${input.collection.successful}/${input.collection.applicable} collection checks finished (${exactPercent(input.collection.successful, input.collection.applicable)}), while ${input.openQuestions.open} of ${input.openQuestions.total} diligence questions remain wholly or partly open.`,
      handling: "Read the collection percentage as coverage of checks run, not as answered questions. Decision-critical gaps are listed separately in Evidence & method.",
      bannerLabel: "coverage",
      chapter: "evidence",
      kind: "reconciliation",
    });
  }

  for (const finding of input.qualityFindings ?? []) {
    issues.push({
      id: `quality-${finding.code}-${issues.length}`,
      severity: finding.severity === "error" ? "High" : "Medium",
      area: "Record integrity",
      title: finding.code.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
      observed: plainAxisKeys(finding.message),
      handling: "Recorded by the stored-report quality audit. The saved score and evidence are unchanged; resolve the record before relying on the affected view.",
      bannerLabel: "record integrity",
      chapter: "evidence",
      kind: "integrity",
    });
  }

  const rank: Record<IssueSeverity, number> = { Critical: 0, High: 1, Medium: 2 };
  return issues.sort((left, right) => rank[left.severity] - rank[right.severity]);
}

export function bannerSummary(issues: readonly ReportIssue[]): string {
  const labels = [...new Set(issues.filter((issue) => issue.kind === "reconciliation" && issue.severity !== "Medium").map((issue) => issue.bannerLabel))];
  if (!labels.length) return "";
  const joined = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `${joined.charAt(0).toUpperCase()}${joined.slice(1)} disagree across the saved report.`;
}

/** Parse "176 buys / 154 sells" style tallies from a saved rationale. */
export function parseBuySellTally(text: string | null | undefined): { buys: number; sells: number } | null {
  const value = String(text ?? "");
  const buysFirst = value.match(/(\d[\d,]*)\s+buys?\s*\/\s*(\d[\d,]*)\s+sells?/i);
  if (buysFirst) return { buys: Number(buysFirst[1].replace(/,/g, "")), sells: Number(buysFirst[2].replace(/,/g, "")) };
  const sellsFirst = value.match(/(\d[\d,]*)\s+sells?\s*\/\s*(\d[\d,]*)\s+buys?/i);
  if (sellsFirst) return { buys: Number(sellsFirst[2].replace(/,/g, "")), sells: Number(sellsFirst[1].replace(/,/g, "")) };
  return null;
}

/** Distinct, human-readable references attached to one intelligence snapshot. */
export function uniqueArtifactCount(sources: readonly IntelligenceSourceRef[]): number {
  const keys = new Set<string>();
  for (const source of sources) {
    const hash = source.contentHashes?.[0];
    keys.add(hash ?? source.sourceUrl ?? source.id);
  }
  return keys.size;
}

/** Stable, persistent finding identifier: chapter + record key, never DOM order. */
export function findingId(chapter: ChapterId, key: string): string {
  return `${chapter}:${key}`.toLowerCase().replace(/[^a-z0-9:._-]+/g, "-").slice(0, 120);
}
