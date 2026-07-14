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
  const host = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
  return host || null;
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

/** Best match: exact website host, then exact name, then first with a uuid. */
function pickBestMatch(companies: any[], query: string): any | null {
  const valid = companies.filter((company) => isNonEmptyString(company?.uuid));
  if (!valid.length) return null;
  const queryHost = hostOf(query);
  const queryName = query.trim().toLowerCase();
  if (queryHost) {
    const byWebsite = valid.find((company) => hostOf(company?.website) === queryHost);
    if (byWebsite) return byWebsite;
  }
  const byName = valid.find(
    (company) => isNonEmptyString(company?.name) && company.name.trim().toLowerCase() === queryName,
  );
  if (byName) return byName;
  return valid[0];
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
    return { available: false, reason: "unavailable", note: search.note };
  }

  const companies = companyList(search.data);
  const chosen = pickBestMatch(companies, query);
  const uuid = isNonEmptyString(chosen?.uuid) ? chosen.uuid.trim() : "";
  if (!chosen || !uuid) {
    recordCall("monid", "company/search", 0, "search · no_match", "succeeded");
    return {
      available: false,
      reason: "no_match",
      note: `No Monid/Akta company matched "${query}".`,
    };
  }
  recordCall("monid", "company/search", 0, `search · matched ${uuid}`, "succeeded");

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

  return {
    available: true,
    value: {
      name,
      uuid,
      ...(funding ? { funding } : {}),
      ...(management ? { management } : {}),
      ...(firmographic ? { firmographic } : {}),
      sourceUrl: websiteUrl(chosen.website) ?? "https://monid.ai",
    },
  };
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
