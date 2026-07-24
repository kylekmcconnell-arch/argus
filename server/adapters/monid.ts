// Monid / Akta adapter: keyed, PitchBook-grade private-company enrichment.
// Akta (served through Monid's run API) fills the private-market gaps a
// diligence report otherwise leaves blank: institutional funding rounds and
// named lead investors, verified leadership profiles with prior companies, and
// firmographics (legal name, founded year, headcount, ownership). It is the
// paid, keyed counterpart to the free DeFiLlama funding collector.
//
// Gated on MONID_API_KEY (mirrors crunchbase.ts): with no key the adapter
// resolves to a structured { available:false, reason:"no_key" } and never runs.
// Every path is never-throw — transport/HTTP/JSON failures resolve to a
// structured outcome so a Monid outage never reads as "no funding on record".
//
// Additive + standalone: exposes collectors the caller decides how to wire; it
// does not make any existing check newly decision-critical.

import { recordCall } from "../cost";
import { env } from "../config";
import { formatUsd } from "./defiLlama";

const API_BASE = "https://api.monid.ai/v1";
const PROVIDER = "akta";
// Akta enrichment list price is ~$0.125 per requested section; search is free.
const PER_SECTION_USD = 0.125;
// Async runs: poll the run-status endpoint every ~2s, bounded to ~30s total.
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30_000;
const RUN_TIMEOUT_MS = 30_000;

export type EnrichmentSection =
  | "funding_detail"
  | "mna_and_investment"
  | "management_profile"
  | "firmographic"
  | "financial_estimate"
  | "company_assessment";

const ALLOWED_SECTIONS: EnrichmentSection[] = [
  "funding_detail",
  "mna_and_investment",
  "management_profile",
  "firmographic",
  "financial_estimate",
  "company_assessment",
];

const DEFAULT_SECTIONS: EnrichmentSection[] = [
  "funding_detail",
  "management_profile",
  "firmographic",
];

export interface FundingRoundInfo {
  /** ISO-ish date (YYYY-MM-DD / YYYY-MM / YYYY) or null when Akta has none */
  date: string | null;
  round: string;
  /** absolute USD — Akta's amount_usd is already absolute; do NOT multiply */
  amountUsd: number | null;
  leadInvestors: string[];
  otherInvestors: string[];
}

export interface FundingInfo {
  totalRaisedUsd: number | null;
  rounds: FundingRoundInfo[];
  /** distinct lead investors across all rounds */
  leadInvestors: string[];
}

export interface ManagementPerson {
  name: string;
  title: string;
  priorCompanies: string[];
  linkedin: string | null;
  startYear: string | null;
}

export interface FirmographicInfo {
  legalName: string | null;
  foundedYear: string | null;
  headcountRange: string | null;
  ownership: string | null;
}

export interface CompanyEnrichment {
  name: string;
  uuid: string;
  /**
   * Management may enter a report only when the provider company joined the
   * subject through the same official website. A name-only match remains a
   * funding/firmographic research lead and cannot identify people.
   */
  identityMatch: "official_domain" | "name_only";
  /** Official project/venture domain ARGUS asked Monid to resolve. */
  requestedDomain?: string;
  /** Website domain carried by the selected Monid company record. */
  matchedDomain?: string;
  /** Deterministic rule used to select the provider company. */
  matchMethod?: "exact_host" | "parent_or_subdomain" | "exact_name" | "domain_label";
  funding?: FundingInfo;
  management?: ManagementPerson[];
  firmographic?: FirmographicInfo;
  /** human-facing reference for the resolved company (its site), else Monid */
  sourceUrl: string;
}

export type CompanyEnrichmentOutcome =
  | { available: true; value: CompanyEnrichment }
  | { available: false; reason: "no_key" | "no_match" | "unavailable"; note: string };

export interface EnrichmentOptions {
  fetcher?: typeof fetch;
  sections?: string[];
  /**
   * Project reports must use `official_domain_only`. Name-only company matches
   * are useful as research leads but are not identity proof.
   */
  identityPolicy?: "allow_name" | "official_domain_only";
  /** Official display name used only to break a same-domain candidate tie. */
  officialName?: string;
}

// ---------------------------------------------------------------------------
// small defensive helpers (res.json() is typed unknown here — cast + guard)
// ---------------------------------------------------------------------------

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const numOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/** strings, or objects carrying a `name`, → a clean de-duped string list */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out = value
    .map((entry) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object" && isNonEmptyString((entry as { name?: unknown }).name)
          ? ((entry as { name: string }).name)
          : "",
    )
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(out)];
}

/** normalize a website/host to a comparable bare host (no scheme / www / slash) */
function hostOf(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  const raw = value.trim().toLowerCase();
  try {
    return new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`)
      .hostname
      .replace(/^www\./, "") || null;
  } catch {
    return raw
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[/?#]/, 1)[0]
      || null;
  }
}

function websiteUrl(value: unknown): string | null {
  const host = hostOf(value);
  return host ? `https://${host}` : null;
}

function normalizeSections(input?: string[]): EnrichmentSection[] {
  if (!input || input.length === 0) return [...DEFAULT_SECTIONS];
  const filtered = input.filter((section): section is EnrichmentSection =>
    (ALLOWED_SECTIONS as string[]).includes(section),
  );
  return filtered.length ? [...new Set(filtered)] : [...DEFAULT_SECTIONS];
}

// ---------------------------------------------------------------------------
// run + poll (Monid's async run API)
// ---------------------------------------------------------------------------

const TERMINAL_OK = "COMPLETED";
const TERMINAL_FAIL = new Set(["FAILED", "BLOCKED", "TIMED_OUT", "STOPPED"]);

type RunOutcome = { ok: true; data: unknown } | { ok: false; note: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The provider payload lives at run.output.data; fall back to run.output. */
function extractData(run: any): unknown {
  const output = run?.output;
  if (output && typeof output === "object" && !Array.isArray(output) && "data" in output) {
    return (output as { data: unknown }).data;
  }
  return output;
}

function runId(run: any): string | null {
  if (isNonEmptyString(run?.runId)) return run.runId.trim();
  if (isNonEmptyString(run?.id)) return run.id.trim();
  return null;
}

/** POST a run. Never throws. Resolves the run to its provider payload. */
async function startRun(
  key: string,
  endpoint: string,
  input: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<RunOutcome> {
  let res: Response;
  try {
    res = await fetcher(`${API_BASE}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ provider: PROVIDER, endpoint, input }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, note: "Monid was unavailable." };
  }
  if (!res.ok) return { ok: false, note: `Monid request failed (http_${res.status}).` };
  let run: any;
  try {
    run = await res.json();
  } catch {
    return { ok: false, note: "Monid response was unreadable." };
  }
  return resolveRun(run, key, fetcher);
}

/** Walk a run to a terminal state, polling the run-status endpoint if needed. */
async function resolveRun(initial: any, key: string, fetcher: typeof fetch): Promise<RunOutcome> {
  let current = initial;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // Bound the loop independently of the clock so a broken status can't spin.
  for (let guard = 0; guard < 32; guard += 1) {
    const status = isNonEmptyString(current?.status) ? current.status : "";
    if (status === TERMINAL_OK) {
      const data = extractData(current);
      if (data === undefined || data === null) {
        return { ok: false, note: "Monid run completed without data." };
      }
      return { ok: true, data };
    }
    if (TERMINAL_FAIL.has(status)) {
      return { ok: false, note: `Monid run ${status.toLowerCase()}.` };
    }
    const id = runId(current);
    if (!id) return { ok: false, note: "Monid run had no id to poll." };
    if (Date.now() >= deadline) return { ok: false, note: "Monid run timed out." };
    await sleep(POLL_INTERVAL_MS);
    const polled = await pollRun(id, key, fetcher);
    if (!polled.ok) return { ok: false, note: polled.note };
    current = polled.run;
  }
  return { ok: false, note: "Monid run did not settle." };
}

async function pollRun(
  id: string,
  key: string,
  fetcher: typeof fetch,
): Promise<{ ok: true; run: any } | { ok: false; note: string }> {
  let res: Response;
  try {
    res = await fetcher(`${API_BASE}/runs/${encodeURIComponent(id)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, note: "Monid was unavailable while polling." };
  }
  if (!res.ok) return { ok: false, note: `Monid poll failed (http_${res.status}).` };
  try {
    return { ok: true, run: await res.json() };
  } catch {
    return { ok: false, note: "Monid poll response was unreadable." };
  }
}

// ---------------------------------------------------------------------------
// payload shaping
// ---------------------------------------------------------------------------

/** Akta search payload → the array of candidate companies (tolerates a nest). */
function companyList(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)) {
    return (data as { data: unknown[] }).data;
  }
  return [];
}

/** Enrichment payload → the object keyed by section name (tolerates a nest). */
function sectionRoot(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const obj = data as Record<string, unknown>;
  if (ALLOWED_SECTIONS.some((section) => section in obj)) return obj;
  const nested = obj.data;
  if (nested && typeof nested === "object" && ALLOWED_SECTIONS.some((section) => section in (nested as Record<string, unknown>))) {
    return nested as Record<string, unknown>;
  }
  return obj;
}

const COMPANY_LEGAL_SUFFIX = /\b(?:incorporated|corporation|company|limited|holdings?|ventures?|inc|corp|llc|ltd|plc|co)\b/g;

function normalizedCompanyName(value: unknown): string {
  if (!isNonEmptyString(value)) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(COMPANY_LEGAL_SUFFIX, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function domainLabel(value: unknown): string {
  const host = hostOf(value);
  if (!host || !host.includes(".")) return "";
  return normalizedCompanyName(host.split(".")[0]);
}

type CompanyMatchMethod = NonNullable<CompanyEnrichment["matchMethod"]>;
type CompanyMatchDecision =
  | {
      company: any;
      method: CompanyMatchMethod;
      requestedDomain: string | null;
      matchedDomain: string | null;
      candidateCount: number;
    }
  | {
      company: null;
      reason: "no_match" | "ambiguous" | "official_domain_required";
      requestedDomain: string | null;
      candidateCount: number;
    };

function relatedOfficialHosts(expected: string, candidate: string): "exact_host" | "parent_or_subdomain" | null {
  if (expected === candidate) return "exact_host";
  if (expected.endsWith(`.${candidate}`) || candidate.endsWith(`.${expected}`)) {
    return "parent_or_subdomain";
  }
  return null;
}

function logCompanyResolution(
  event: "matched" | "rejected" | "provider_error",
  details: Record<string, unknown>,
): void {
  if (process.env.NODE_ENV === "test") return;
  console.info("[monid.company_resolution]", JSON.stringify({ event, ...details }));
}

/**
 * Resolve only an identity-bound company match.
 *
 * Provider search order is relevance-ranked, not identity proof. Falling back
 * to the first UUID can attach an unrelated namesake's funding and leadership
 * to the audited subject (for example SuperGemma -> Supergut). Project mode
 * accepts only the official host or its parent/subdomain. Name mode accepts one
 * unambiguous exact normalized name or website label. Tied candidates fail
 * closed before paid enrichment.
 */
function pickBestMatch(
  companies: any[],
  query: string,
  options: Pick<EnrichmentOptions, "identityPolicy" | "officialName">,
): CompanyMatchDecision {
  const valid = companies.filter((company) => isNonEmptyString(company?.uuid));
  const queryHost = hostOf(query);
  const queryLooksLikeHost = Boolean(queryHost?.includes(".") && !queryHost.includes(" "));
  const queryName = normalizedCompanyName(query);
  const officialName = normalizedCompanyName(options.officialName);
  const domainOnly = options.identityPolicy === "official_domain_only";

  if (domainOnly && !queryLooksLikeHost) {
    return {
      company: null,
      reason: "official_domain_required",
      requestedDomain: null,
      candidateCount: valid.length,
    };
  }
  if (!valid.length) {
    return {
      company: null,
      reason: "no_match",
      requestedDomain: queryLooksLikeHost ? queryHost : null,
      candidateCount: 0,
    };
  }

  if (queryLooksLikeHost) {
    const ranked = valid.flatMap((company) => {
      const matchedDomain = hostOf(company?.website);
      const method = matchedDomain ? relatedOfficialHosts(queryHost!, matchedDomain) : null;
      if (!method) return [];
      const exactName = officialName
        && normalizedCompanyName(company?.name) === officialName;
      return [{
        company,
        method,
        matchedDomain,
        score: (method === "exact_host" ? 100 : 80) + (exactName ? 10 : 0),
      }];
    }).sort((a, b) => b.score - a.score);
    if (!ranked.length) {
      return {
        company: null,
        reason: "no_match",
        requestedDomain: queryHost,
        candidateCount: valid.length,
      };
    }
    if (ranked.length > 1 && ranked[0].score === ranked[1].score) {
      return {
        company: null,
        reason: "ambiguous",
        requestedDomain: queryHost,
        candidateCount: valid.length,
      };
    }
    return {
      company: ranked[0].company,
      method: ranked[0].method,
      requestedDomain: queryHost,
      matchedDomain: ranked[0].matchedDomain,
      candidateCount: valid.length,
    };
  }

  const exactNameMatches = valid.filter(
    (company) => normalizedCompanyName(company?.name) === queryName,
  );
  if (exactNameMatches.length === 1) {
    const company = exactNameMatches[0];
    return {
      company,
      method: "exact_name",
      requestedDomain: null,
      matchedDomain: hostOf(company?.website),
      candidateCount: valid.length,
    };
  }
  if (exactNameMatches.length > 1) {
    return {
      company: null,
      reason: "ambiguous",
      requestedDomain: null,
      candidateCount: valid.length,
    };
  }
  if (queryName) {
    const labelMatches = valid.filter((company) => domainLabel(company?.website) === queryName);
    if (labelMatches.length === 1) {
      const company = labelMatches[0];
      return {
        company,
        method: "domain_label",
        requestedDomain: null,
        matchedDomain: hostOf(company?.website),
        candidateCount: valid.length,
      };
    }
    if (labelMatches.length > 1) {
      return {
        company: null,
        reason: "ambiguous",
        requestedDomain: null,
        candidateCount: valid.length,
      };
    }
  }
  return {
    company: null,
    reason: "no_match",
    requestedDomain: null,
    candidateCount: valid.length,
  };
}

export function companyEnrichmentMatchesOfficialDomain(
  enrichment: {
    identityMatch?: CompanyEnrichment["identityMatch"];
    requestedDomain?: string;
    matchedDomain?: string;
    sourceUrl: string;
  },
  officialWebsite?: string | null,
): boolean {
  if (enrichment.identityMatch !== "official_domain") return false;
  const expected = hostOf(officialWebsite) ?? hostOf(enrichment.requestedDomain);
  const matched = hostOf(enrichment.matchedDomain) ?? hostOf(enrichment.sourceUrl);
  return Boolean(expected && matched && relatedOfficialHosts(expected, matched));
}

/** Akta date {day,month,year} → YYYY-MM-DD / YYYY-MM / YYYY / null. */
function formatAktaDate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { day?: unknown; month?: unknown; year?: unknown };
  const year = numOrNull(raw.year);
  if (year === null) return null;
  const month = numOrNull(raw.month);
  const day = numOrNull(raw.day);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (month === null) return String(year);
  if (day === null) return `${year}-${pad(month)}`;
  return `${year}-${pad(month)}-${pad(day)}`;
}

function startYearFrom(value: unknown): string | null {
  if (typeof value === "string") {
    const match = value.match(/\b(\d{4})\b/);
    return match ? match[1] : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(value));
  if (value && typeof value === "object") {
    const year = numOrNull((value as { year?: unknown }).year);
    return year === null ? null : String(year);
  }
  return null;
}

function parseFunding(section: unknown): FundingInfo | undefined {
  if (!section || typeof section !== "object") return undefined;
  const raw = section as { funding_overview?: unknown; funding_rounds?: unknown };
  const overview =
    raw.funding_overview && typeof raw.funding_overview === "object"
      ? (raw.funding_overview as { total_funding_usd?: unknown })
      : {};
  const totalRaisedUsd = numOrNull(overview.total_funding_usd);
  const rawRounds = Array.isArray(raw.funding_rounds) ? raw.funding_rounds : [];
  const rounds: FundingRoundInfo[] = rawRounds.map((entry: any): FundingRoundInfo => {
    const investors: any[] = Array.isArray(entry?.investors) ? entry.investors : [];
    const namesWhere = (predicate: (investor: any) => boolean): string[] => [
      ...new Set(
        investors
          .filter(predicate)
          .map((investor: any): string => (isNonEmptyString(investor?.name) ? investor.name.trim() : ""))
          .filter((name: string) => name.length > 0),
      ),
    ];
    return {
      date: formatAktaDate(entry?.date),
      round: isNonEmptyString(entry?.round?.label) ? entry.round.label.trim() : "Undisclosed round",
      amountUsd: numOrNull(entry?.amount_usd), // absolute USD — do NOT multiply
      leadInvestors: namesWhere((investor) => investor?.lead_investor === true),
      otherInvestors: namesWhere((investor) => investor?.lead_investor !== true),
    };
  });
  if (totalRaisedUsd === null && rounds.length === 0) return undefined;
  const leadInvestors = [...new Set(rounds.flatMap((round) => round.leadInvestors))];
  return { totalRaisedUsd, rounds, leadInvestors };
}

function parseManagement(section: unknown): ManagementPerson[] | undefined {
  if (!section || typeof section !== "object") return undefined;
  const profiles = Array.isArray((section as { profiles?: unknown }).profiles)
    ? ((section as { profiles: unknown[] }).profiles)
    : [];
  const people: ManagementPerson[] = profiles
    .map((profile: any): ManagementPerson | null => {
      const name = isNonEmptyString(profile?.name) ? profile.name.trim() : "";
      if (!name) return null;
      return {
        name,
        title: isNonEmptyString(profile?.designation) ? profile.designation.trim() : "",
        priorCompanies: toStringList(profile?.previous_companies),
        linkedin: isNonEmptyString(profile?.social?.linkedin) ? profile.social.linkedin.trim() : null,
        startYear: startYearFrom(profile?.start_date),
      };
    })
    .filter((person): person is ManagementPerson => person !== null);
  return people.length ? people : undefined;
}

function parseFirmographic(section: unknown): FirmographicInfo | undefined {
  if (!section || typeof section !== "object") return undefined;
  const raw = section as {
    legal_name?: unknown;
    founded_year?: unknown;
    headcount_range?: unknown;
    ownership_category?: unknown;
  };
  const legalName = isNonEmptyString(raw.legal_name) ? raw.legal_name.trim() : null;
  const foundedYearNum = numOrNull(raw.founded_year);
  const foundedYear = foundedYearNum === null ? null : String(foundedYearNum);
  const headcountRange = isNonEmptyString(raw.headcount_range) ? raw.headcount_range.trim() : null;
  const ownership = isNonEmptyString(raw.ownership_category) ? raw.ownership_category.trim() : null;
  if (!legalName && !foundedYear && !headcountRange && !ownership) return undefined;
  return { legalName, foundedYear, headcountRange, ownership };
}

// ---------------------------------------------------------------------------
// public collector
// ---------------------------------------------------------------------------

/**
 * Resolve a company by name/website via the free Akta search, then enrich the
 * requested sections. Never throws. Distinguishes no-key, no-match, and
 * provider-unavailable so a partial outage never reads as "no data on record".
 */
export async function collectCompanyEnrichment(
  nameOrWebsite: string,
  options: EnrichmentOptions = {},
): Promise<CompanyEnrichmentOutcome> {
  const key = env("MONID_API_KEY");
  if (!key) {
    return { available: false, reason: "no_key", note: "MONID_API_KEY is not configured." };
  }

  const query = (nameOrWebsite ?? "").trim();
  if (!query) {
    return { available: false, reason: "no_match", note: "No company name or website supplied." };
  }
  if (options.identityPolicy === "official_domain_only") {
    const requestedDomain = hostOf(query);
    if (!requestedDomain?.includes(".") || requestedDomain.includes(" ")) {
      logCompanyResolution("rejected", {
        reason: "official_domain_required",
        queryType: "name",
      });
      return {
        available: false,
        reason: "no_match",
        note: "Monid project resolution requires an official website domain.",
      };
    }
  }

  const fetcher = options.fetcher ?? fetch;
  const sections = normalizeSections(options.sections);

  // 1) Free resolution via /v1/company/search.
  const search = await startRun(
    key,
    "/v1/company/search",
    { queryParams: { query } },
    fetcher,
  );
  if (!search.ok) {
    recordCall("monid", "company/search", 0, `search · ${search.note}`, "failed");
    logCompanyResolution("provider_error", {
      stage: "search",
      queryDomain: hostOf(query),
      note: search.note,
    });
    return { available: false, reason: "unavailable", note: search.note };
  }

  const companies = companyList(search.data);
  const decision = pickBestMatch(companies, query, options);
  if ("reason" in decision) {
    recordCall("monid", "company/search", 0, `search · ${decision.reason}`, "succeeded");
    logCompanyResolution("rejected", {
      reason: decision.reason,
      queryDomain: decision.requestedDomain,
      candidateCount: decision.candidateCount,
      candidateDomains: companies
        .map((company) => hostOf(company?.website))
        .filter((domain): domain is string => Boolean(domain))
        .slice(0, 10),
    });
    return {
      available: false,
      reason: "no_match",
      note: decision.reason === "ambiguous"
        ? `Monid/Akta returned multiple equally strong companies for "${query}"; none was trusted.`
        : `No Monid/Akta company matched "${query}".`,
    };
  }
  const chosen = decision.company;
  const uuid = isNonEmptyString(chosen?.uuid) ? chosen.uuid.trim() : "";
  if (!uuid) {
    recordCall("monid", "company/search", 0, "search · no_match", "succeeded");
    return {
      available: false,
      reason: "no_match",
      note: `No Monid/Akta company matched "${query}".`,
    };
  }
  recordCall("monid", "company/search", 0, `search · matched ${uuid}`, "succeeded");
  logCompanyResolution("matched", {
    queryDomain: decision.requestedDomain,
    selectedDomain: decision.matchedDomain,
    selectedUuid: uuid,
    selectedName: isNonEmptyString(chosen?.name) ? chosen.name.trim() : null,
    officialName: isNonEmptyString(options.officialName) ? options.officialName.trim() : null,
    matchMethod: decision.method,
    candidateCount: decision.candidateCount,
  });

  // 2) Paid enrichment via /v1/company/enrichment (~$0.125 per section).
  const enrichment = await startRun(
    key,
    "/v1/company/enrichment",
    { queryParams: { company: uuid, sections } },
    fetcher,
  );
  const sectionMeta = `enrichment · ${sections.length} section(s) · ${uuid}`;
  if (!enrichment.ok) {
    recordCall("monid", "company/enrichment", 0, `${sectionMeta} · ${enrichment.note}`, "failed");
    logCompanyResolution("provider_error", {
      stage: "enrichment",
      queryDomain: decision.requestedDomain,
      selectedDomain: decision.matchedDomain,
      selectedUuid: uuid,
      note: enrichment.note,
    });
    return { available: false, reason: "unavailable", note: enrichment.note };
  }
  // Charge for the sections actually requested (search is free, enrichment is not).
  recordCall("monid", "company/enrichment", sections.length * PER_SECTION_USD, sectionMeta, "succeeded");

  const root = sectionRoot(enrichment.data);
  const funding = sections.includes("funding_detail") ? parseFunding(root.funding_detail) : undefined;
  const management = sections.includes("management_profile") ? parseManagement(root.management_profile) : undefined;
  const firmographic = sections.includes("firmographic") ? parseFirmographic(root.firmographic) : undefined;

  const name = isNonEmptyString(chosen.name)
    ? chosen.name.trim()
    : firmographic?.legalName ?? query;
  const identityMatch = decision.method === "exact_host" || decision.method === "parent_or_subdomain"
    ? "official_domain"
    : "name_only";

  return {
    available: true,
    value: {
      name,
      uuid,
      identityMatch,
      ...(decision.requestedDomain ? { requestedDomain: decision.requestedDomain } : {}),
      ...(decision.matchedDomain ? { matchedDomain: decision.matchedDomain } : {}),
      matchMethod: decision.method,
      ...(funding ? { funding } : {}),
      ...(management ? { management } : {}),
      ...(firmographic ? { firmographic } : {}),
      sourceUrl: websiteUrl(chosen.website) ?? "https://monid.ai",
    },
  };
}

/**
 * Project-safe entry point. It refuses to search by company name and will not
 * spend on enrichment unless one unambiguous Monid candidate carries the
 * official project host (or its direct parent/subdomain).
 */
export function collectProjectCompanyEnrichment(
  officialWebsite: string,
  options: Omit<EnrichmentOptions, "identityPolicy"> = {},
): Promise<CompanyEnrichmentOutcome> {
  return collectCompanyEnrichment(officialWebsite, {
    ...options,
    identityPolicy: "official_domain_only",
  });
}

// ---------------------------------------------------------------------------

export interface EnrichmentSummary {
  status: "confirmed" | "unavailable";
  note: string;
}

/** Map an enrichment outcome to a compact status + note for the wiring layer. */
export function describeCompanyEnrichment(outcome: CompanyEnrichmentOutcome): EnrichmentSummary {
  if (!outcome.available) {
    // No affirmative enrichment data: never "confirmed" (whether the key is
    // missing, no company matched, or the provider was unavailable).
    return { status: "unavailable", note: outcome.note };
  }
  const { name, funding, management, firmographic } = outcome.value;
  const parts: string[] = [];
  if (funding) {
    const total =
      funding.totalRaisedUsd && funding.totalRaisedUsd > 0 ? ` (${formatUsd(funding.totalRaisedUsd)} total)` : "";
    const leads = funding.leadInvestors.slice(0, 3).join(", ");
    parts.push(
      `${funding.rounds.length} funding round${funding.rounds.length === 1 ? "" : "s"}${total}${leads ? `; leads incl. ${leads}` : ""}`,
    );
  }
  if (management?.length) {
    parts.push(`${management.length} leadership profile${management.length === 1 ? "" : "s"}`);
  }
  if (firmographic) {
    const bits = [
      firmographic.foundedYear ? `founded ${firmographic.foundedYear}` : "",
      firmographic.headcountRange ? `${firmographic.headcountRange} staff` : "",
      firmographic.ownership ?? "",
    ]
      .filter(Boolean)
      .join(", ");
    if (bits) parts.push(bits);
  }
  return {
    status: "confirmed",
    note: parts.length ? `${name}: ${parts.join(" · ")}` : `${name}: Monid/Akta record verified`,
  };
}

// ===========================================================================
// Additive collectors (company news + token/contract pre-trade risk).
// These reuse the run/poll helpers above and follow the same env-gated,
// never-throw conventions. They are standalone: nothing here is wired into
// the collection pipeline by this module.
// ===========================================================================

/**
 * POST a run for an arbitrary Monid provider (the existing startRun hardcodes
 * PROVIDER = "akta"). Never throws; walks the run to its provider payload.
 */
async function startRunFor(
  provider: string,
  key: string,
  endpoint: string,
  input: Record<string, unknown>,
  fetcher: typeof fetch,
): Promise<RunOutcome> {
  let res: Response;
  try {
    res = await fetcher(`${API_BASE}/run`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ provider, endpoint, input }),
      signal: AbortSignal.timeout(RUN_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, note: "Monid was unavailable." };
  }
  if (!res.ok) return { ok: false, note: `Monid request failed (http_${res.status}).` };
  let run: any;
  try {
    run = await res.json();
  } catch {
    return { ok: false, note: "Monid response was unreadable." };
  }
  return resolveRun(run, key, fetcher);
}

/** Discriminated so the caller can record provider health honestly: a monid
 *  outage/timeout ("error") must not be logged as a clean "no_match". */
export type MonidPersonOutcome =
  | { outcome: "match"; record: Record<string, unknown> }
  | { outcome: "no_match" }
  | { outcome: "error"; note: string };

// A single person enrich must not consume the scan's whole latency budget if
// Monid leaves the run in a slow polling state. The identity lane issues up to
// five attempts, so bound each to well under the module's 30s poll deadline.
const PERSON_ENRICH_TIMEOUT_MS = 12_000;

/**
 * Full-data PDL person enrichment routed through Monid. ARGUS's own PDL key is
 * on the free tier, which omits the contact fields (emails/phone) needed to
 * confirm an identity; Monid's PDL plan returns the complete record. Same PDL
 * response schema, so the caller's existing parser is unchanged. Never throws;
 * gated on MONID_API_KEY.
 */
export async function enrichPersonViaMonid(
  params: { profile?: string; name?: string; company?: string; minLikelihood?: number },
  fetcher: typeof fetch = fetch,
): Promise<MonidPersonOutcome> {
  const key = env("MONID_API_KEY");
  if (!key) return { outcome: "error", note: "no_key" };
  const body: Record<string, unknown> = {
    // A disambiguator (known company or social profile) makes a lower-likelihood
    // match safe; a bare common name demands high confidence.
    min_likelihood: params.minLikelihood ?? (params.company || params.profile ? 4 : 8),
  };
  if (params.profile) body.profile = params.profile;
  if (params.name) body.name = params.name;
  if (params.company) body.company = params.company;
  const timeout = new Promise<RunOutcome>((resolve) =>
    setTimeout(() => resolve({ ok: false, note: "person_enrich_timeout" }), PERSON_ENRICH_TIMEOUT_MS));
  const outcome = await Promise.race([
    startRunFor("pdl", key, "/v5/person/enrich", { body }, fetcher),
    timeout,
  ]);
  if (!outcome.ok) return { outcome: "error", note: outcome.note };
  // For a match, startRunFor unwrapped run.output.data (the person record). A
  // no-match unwraps to the bare {status:404,...} envelope, which has no
  // full_name — the guard below classifies it as no_match, never a person.
  const data = outcome.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return { outcome: "no_match" };
  const record = data as Record<string, unknown>;
  if (!isNonEmptyString(record.full_name) && !isNonEmptyString(record.id)) return { outcome: "no_match" };
  return { outcome: "match", record };
}

/** First non-empty trimmed string from the candidates, else null. */
function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (isNonEmptyString(value)) return value.trim();
  }
  return null;
}

/** Canonical UUID shape (8-4-4-4-12 hex). */
function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** A website or bare host (has a scheme or a dotted TLD), not a plain name. */
function looksLikeUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /\.[a-z]{2,}/i.test(value);
}

// ---------------------------------------------------------------------------
// collectCompanyNews : Akta '/v1/news'
// ---------------------------------------------------------------------------

export type NewsSentiment = "positive" | "negative" | "neutral";

export interface NewsArticle {
  title: string | null;
  summary: string | null;
  sentiment: string | null;
  publisher: string | null;
  url: string | null;
  date: string | null;
}

export interface CompanyNews {
  /** the company identifier actually queried (uuid or host) */
  company: string;
  articles: NewsArticle[];
  count: number;
}

export type CompanyNewsOutcome =
  | { available: true; value: CompanyNews }
  | { available: false; reason: "no_key" | "no_match" | "unavailable"; note: string };

export interface CompanyNewsOptions {
  fetcher?: typeof fetch;
  limit?: number;
  sentiment?: NewsSentiment;
}

const NEWS_LIMIT_DEFAULT = 8;
const NEWS_LIMIT_CAP = 15;

function clampNewsLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return NEWS_LIMIT_DEFAULT;
  return Math.max(1, Math.min(NEWS_LIMIT_CAP, Math.trunc(value)));
}

/** News payload (array or { data:[...] }) → normalized articles. */
function parseArticles(data: unknown): NewsArticle[] {
  return companyList(data).map((entry: any): NewsArticle => ({
    title: firstString(entry?.title),
    summary: firstString(entry?.summary, entry?.ai_summary),
    sentiment: firstString(entry?.sentiment),
    publisher: firstString(entry?.publisher, entry?.publisher_domain),
    url: firstString(entry?.url),
    date: firstString(entry?.published_date, entry?.date),
  }));
}

/**
 * Recent news for a company via Akta's '/v1/news'. `company` may be a website,
 * an Akta uuid, or a bare name (resolved via the free '/v1/company/search',
 * mirroring collectCompanyEnrichment). Never throws. Distinguishes no-key,
 * no-match, and provider-unavailable.
 */
export async function collectCompanyNews(
  company: string,
  options: CompanyNewsOptions = {},
): Promise<CompanyNewsOutcome> {
  const key = env("MONID_API_KEY");
  if (!key) {
    return { available: false, reason: "no_key", note: "MONID_API_KEY is not configured." };
  }

  const query = (company ?? "").trim();
  if (!query) {
    return { available: false, reason: "no_match", note: "No company name or website supplied." };
  }

  const fetcher = options.fetcher ?? fetch;
  const limit = clampNewsLimit(options.limit);

  // Resolve to a company identifier: url/uuid pass through, a bare name is
  // resolved to a uuid through the free search (same path as enrichment).
  let companyId = "";
  if (looksLikeUuid(query)) {
    companyId = query;
  } else if (looksLikeUrl(query)) {
    companyId = hostOf(query) ?? query;
  } else {
    const search = await startRun(key, "/v1/company/search", { queryParams: { query } }, fetcher);
    if (!search.ok) {
      recordCall("monid", "company/search", 0, `news search · ${search.note}`, "failed");
      return { available: false, reason: "unavailable", note: search.note };
    }
    const decision = pickBestMatch(companyList(search.data), query, {});
    if ("reason" in decision) {
      recordCall("monid", "company/search", 0, "news search · no_match", "succeeded");
      return { available: false, reason: "no_match", note: `No Monid/Akta company matched "${query}".` };
    }
    const chosen = decision.company;
    const uuid = isNonEmptyString(chosen?.uuid) ? chosen.uuid.trim() : "";
    if (!uuid) {
      recordCall("monid", "company/search", 0, "news search · no_match", "succeeded");
      return { available: false, reason: "no_match", note: `No Monid/Akta company matched "${query}".` };
    }
    recordCall("monid", "company/search", 0, `news search · matched ${uuid}`, "succeeded");
    companyId = uuid;
  }

  const queryParams: Record<string, unknown> = { company: companyId, limit };
  if (options.sentiment) queryParams.sentiment_list = [options.sentiment];

  const news = await startRun(key, "/v1/news", { queryParams }, fetcher);
  const meta = `news · ${companyId}`;
  if (!news.ok) {
    recordCall("monid", "akta/news", 0, `${meta} · ${news.note}`, "failed");
    return { available: false, reason: "unavailable", note: news.note };
  }

  const articles = parseArticles(news.data);
  recordCall(
    "monid",
    "akta/news",
    articles.length * 0.0005 + 0.005,
    `${meta} · ${articles.length} article(s)`,
    "succeeded",
  );

  return { available: true, value: { company: companyId, articles, count: articles.length } };
}

// ---------------------------------------------------------------------------
// collectTokenContractRisk : Strale '/x402/solutions/web3-pre-trade'
// ---------------------------------------------------------------------------

export interface TokenContractRisk {
  tokenId: string;
  contractSafety?: unknown;
  deployerRisk?: unknown;
  protocolHealth?: unknown;
  sentiment?: unknown;
  /** the full provider data object, so nothing is lost to normalization */
  raw: unknown;
}

export type ContractRiskOutcome =
  | { available: true; value: TokenContractRisk }
  | { available: false; reason: "no_key" | "unavailable"; note: string };

export interface TokenContractRiskOptions {
  fetcher?: typeof fetch;
  tokenId: string;
  contractAddress?: string;
  protocol?: string;
  chainId?: string;
}

/** First defined value among the candidate keys of an object. */
function firstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
}

/** Pull whatever safety/risk signals exist out of the (varying) data object. */
function extractRiskSignals(data: unknown): {
  contractSafety?: unknown;
  deployerRisk?: unknown;
  protocolHealth?: unknown;
  sentiment?: unknown;
} {
  const obj =
    data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const contractSafety = firstDefined(obj, [
    "contract_safety",
    "token_contract_safety",
    "contractSafety",
    "safety",
  ]);
  const deployerRisk = firstDefined(obj, [
    "deployer_risk",
    "deployer_wallet_risk",
    "deployerRisk",
    "deployer",
  ]);
  const protocolHealth = firstDefined(obj, ["protocol_health", "protocolHealth", "protocol"]);
  const sentiment = firstDefined(obj, ["sentiment", "sentiment_analysis"]);
  return {
    ...(contractSafety !== undefined ? { contractSafety } : {}),
    ...(deployerRisk !== undefined ? { deployerRisk } : {}),
    ...(protocolHealth !== undefined ? { protocolHealth } : {}),
    ...(sentiment !== undefined ? { sentiment } : {}),
  };
}

/**
 * Pre-trade token/contract risk via Strale's '/x402/solutions/web3-pre-trade'
 * (run through Monid, provider 'api.strale.io'). Defensively normalizes the
 * varying response into contract-safety, deployer-risk, protocol-health, and
 * sentiment signals while preserving the full data object as `raw`. Never
 * throws; gated on MONID_API_KEY.
 */
export async function collectTokenContractRisk(
  options: TokenContractRiskOptions,
): Promise<ContractRiskOutcome> {
  const key = env("MONID_API_KEY");
  if (!key) {
    return { available: false, reason: "no_key", note: "MONID_API_KEY is not configured." };
  }

  const tokenId = (options?.tokenId ?? "").trim();
  if (!tokenId) {
    return { available: false, reason: "unavailable", note: "No token id supplied." };
  }

  const fetcher = options.fetcher ?? fetch;
  const body: Record<string, unknown> = {
    token_id: tokenId,
    chain_id: isNonEmptyString(options.chainId) ? options.chainId.trim() : "1",
  };
  if (isNonEmptyString(options.contractAddress)) body.contract_address = options.contractAddress.trim();
  if (isNonEmptyString(options.protocol)) body.protocol = options.protocol.trim();

  const run = await startRunFor("api.strale.io", key, "/x402/solutions/web3-pre-trade", { body }, fetcher);
  const meta = `web3-pre-trade · ${tokenId}`;
  if (!run.ok) {
    recordCall("monid", "strale/web3-pre-trade", 0, `${meta} · ${run.note}`, "failed");
    return { available: false, reason: "unavailable", note: run.note };
  }
  recordCall("monid", "strale/web3-pre-trade", 0.14256, meta, "succeeded");

  return {
    available: true,
    value: { tokenId, ...extractRiskSignals(run.data), raw: run.data },
  };
}
