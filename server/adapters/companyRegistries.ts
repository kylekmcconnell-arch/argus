import { deadlineFetch } from "../providerDeadline.js";
// Company-registry lane: ARGUS assesses all companies, not only crypto, so the
// legal-entity leg reads real registries, not just search leads.
//
//   - SEC EDGAR submissions (free): joined by the CIK that the verified
//     SEC-registry public_security fact already carries. Gives the registrant's
//     legal name, incorporation state, EIN/LEI, SIC line, its own declared
//     website (a corroboration surface against the subject's official domain),
//     and filing recency (latest 10-K / 10-Q / any filing).
//   - Companies House (keyed, COMPANIES_HOUSE_API_KEY): joined by a company
//     number the subject's OWN bound official site declares ("Company No.
//     12345678"). Names never join; a registration number printed on the
//     bound site is the identity-safe key.
//   - OpenCorporates (keyed, OPENCORPORATES_API_TOKEN): same site-declared
//     number join, for jurisdictions Companies House does not cover.
//
// Every registry read is fail-soft: a missing key is a visible dark lane (the
// health endpoint lists it), an outage is "unavailable", and nothing here ever
// throws into the scan.
import { recordCall } from "../cost";
import { captureTimestamp } from "../captureTime";

const EDGAR_BASE = "https://data.sec.gov/submissions";
const COMPANIES_HOUSE_BASE = "https://api.company-information.service.gov.uk";
const OPENCORPORATES_BASE = "https://api.opencorporates.com/v0.4";
const USER_AGENT = "ARGUS/3.0 (+https://argus-one-flax.vercel.app; due-diligence evidence research)";

// ── SEC EDGAR submissions ───────────────────────────────────────────────────

export interface SecRegistrantRecord {
  cik: number;
  entityName: string;
  tickers: string[];
  exchanges: string[];
  sicDescription: string | null;
  stateOfIncorporation: string | null;
  ein: string | null;
  lei: string | null;
  registrantWebsite: string | null;
  latestFilings: Array<{ form: string; filedAt: string }>;
  lastAnnualReportAt: string | null;
  lastQuarterlyReportAt: string | null;
  lastFilingAt: string | null;
  sourceUrl: string;
  capturedAt: string;
}

export type SecRegistrantOutcome =
  | { available: true; value: SecRegistrantRecord }
  | { available: false; reason: "no_data" | "unavailable"; note: string };

type SubmissionsBody = {
  cik?: unknown;
  name?: unknown;
  tickers?: unknown;
  exchanges?: unknown;
  sicDescription?: unknown;
  stateOfIncorporationDescription?: unknown;
  stateOfIncorporation?: unknown;
  ein?: unknown;
  lei?: unknown;
  website?: unknown;
  filings?: { recent?: { form?: unknown; filingDate?: unknown } };
};

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const strArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((entry) => asString(entry)).filter((entry): entry is string => !!entry) : [];

/**
 * Read the registrant's EDGAR submissions record by CIK. The CIK comes from a
 * fact that was already identity-bound (the SEC ticker registry join), so this
 * read cannot introduce a namesake.
 */
export async function collectSecRegistrant(
  cik: number,
  options: { fetcher?: typeof fetch } = {},
): Promise<SecRegistrantOutcome> {
  if (!Number.isSafeInteger(cik) || cik <= 0) {
    return { available: false, reason: "no_data", note: `"${cik}" is not a usable CIK.` };
  }
  const fetcher = options.fetcher ?? deadlineFetch;
  const sourceUrl = `${EDGAR_BASE}/CIK${String(cik).padStart(10, "0")}.json`;
  let body: SubmissionsBody;
  try {
    const response = await fetcher(sourceUrl, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) {
      recordCall("sec-edgar", "submissions", 0, `${cik} · not_found`, "succeeded");
      return { available: false, reason: "no_data", note: `EDGAR has no submissions record for CIK ${cik}.` };
    }
    if (!response.ok) {
      recordCall("sec-edgar", "submissions", 0, `${cik} · http_${response.status}`, "failed");
      return { available: false, reason: "unavailable", note: `EDGAR answered HTTP ${response.status} for CIK ${cik}.` };
    }
    body = await response.json() as SubmissionsBody;
  } catch (error) {
    recordCall("sec-edgar", "submissions", 0, `${cik} · error`, "failed");
    return { available: false, reason: "unavailable", note: `EDGAR read failed: ${error instanceof Error ? error.message : String(error)}` };
  }

  const entityName = asString(body.name);
  if (!entityName) {
    recordCall("sec-edgar", "submissions", 0, `${cik} · empty`, "succeeded");
    return { available: false, reason: "no_data", note: `EDGAR returned no registrant name for CIK ${cik}.` };
  }
  const forms = Array.isArray(body.filings?.recent?.form) ? body.filings!.recent!.form as unknown[] : [];
  const dates = Array.isArray(body.filings?.recent?.filingDate) ? body.filings!.recent!.filingDate as unknown[] : [];
  const filings: Array<{ form: string; filedAt: string }> = [];
  for (let i = 0; i < forms.length && i < dates.length; i += 1) {
    const form = asString(forms[i]);
    const filedAt = asString(dates[i]);
    if (form && filedAt) filings.push({ form, filedAt });
  }
  const latestOf = (matcher: (form: string) => boolean): string | null =>
    filings.find((filing) => matcher(filing.form))?.filedAt ?? null;

  recordCall("sec-edgar", "submissions", 0, `${cik} · ${filings.length}_recent_filings`, "succeeded");
  return {
    available: true,
    value: {
      cik,
      entityName,
      tickers: strArray(body.tickers),
      exchanges: strArray(body.exchanges),
      sicDescription: asString(body.sicDescription),
      stateOfIncorporation: asString(body.stateOfIncorporationDescription) ?? asString(body.stateOfIncorporation),
      ein: asString(body.ein),
      lei: asString(body.lei),
      registrantWebsite: asString(body.website),
      latestFilings: filings.slice(0, 8),
      lastAnnualReportAt: latestOf((form) => form === "10-K" || form === "20-F" || form === "40-F"),
      lastQuarterlyReportAt: latestOf((form) => form === "10-Q"),
      lastFilingAt: filings[0]?.filedAt ?? null,
      sourceUrl,
      capturedAt: captureTimestamp(),
    },
  };
}

// ── Site-declared registration numbers ──────────────────────────────────────

export interface SiteDeclaredRegistration {
  number: string;
  /** OpenCorporates-style jurisdiction code when the surrounding text names one. */
  jurisdiction: string | null;
  sourceUrl: string;
  excerpt: string;
}

const REGISTRATION_PATTERNS: Array<{ pattern: RegExp; jurisdiction: string | null }> = [
  // "registered in England and Wales ... (company) no. 12345678"
  { pattern: /registered\s+in\s+england(?:\s+and\s+wales)?[^.]{0,80}?(?:no\.?|number)\s*[:\s]\s*([A-Z]{0,2}\d{6,8})/gi, jurisdiction: "gb" },
  { pattern: /registered\s+in\s+scotland[^.]{0,80}?(?:no\.?|number)\s*[:\s]\s*([A-Z]{0,2}\d{6,8})/gi, jurisdiction: "gb" },
  // "Companies House number 12345678"
  { pattern: /companies\s+house[^.]{0,60}?(?:no\.?|number)\s*[:\s]\s*([A-Z]{0,2}\d{6,8})/gi, jurisdiction: "gb" },
  // Generic "Company No. 12345678" / "Company registration number: 12345678"
  { pattern: /company\s+(?:registration\s+)?(?:no\.?|number)\s*[:\s]\s*([A-Z]{0,2}\d{6,8})/gi, jurisdiction: null },
];

/**
 * Extract company registration numbers a page declares about itself. The
 * numbers come from the subject's OWN bound site, so they are identity keys,
 * not guesses; jurisdiction stays null unless the surrounding text names one.
 */
export function siteDeclaredRegistrations(text: string, sourceUrl: string): SiteDeclaredRegistration[] {
  const found = new Map<string, SiteDeclaredRegistration>();
  for (const { pattern, jurisdiction } of REGISTRATION_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const number = match[1].toUpperCase();
      const start = Math.max(0, (match.index ?? 0) - 40);
      const excerpt = text.slice(start, (match.index ?? 0) + match[0].length + 20).replace(/\s+/g, " ").trim();
      const existing = found.get(number);
      // A jurisdiction-bearing mention wins over a generic one for the same number.
      if (!existing || (!existing.jurisdiction && jurisdiction)) {
        found.set(number, { number, jurisdiction, sourceUrl, excerpt });
      }
    }
  }
  return [...found.values()];
}

/** Candidate pages where sites print their legal footer details. */
export const REGISTRATION_PAGE_PATHS = ["", "legal", "imprint", "terms", "privacy"] as const;

/**
 * Fetch up to three pages of the bound official site and extract every
 * self-declared registration number. Mirrors githubOrgFromOfficialSite:
 * bounded reads, and a body served after a redirect off the controlled apex is
 * discarded (a parked domain must not hand us someone else's footer).
 */
export async function collectSiteDeclaredRegistrations(
  officialWebsite: string,
  fetcher: typeof fetch = deadlineFetch,
): Promise<SiteDeclaredRegistration[]> {
  let origin: URL;
  try {
    origin = new URL(officialWebsite);
  } catch {
    return [];
  }
  const apex = origin.hostname.replace(/^www\./, "");
  const candidates = REGISTRATION_PAGE_PATHS.slice(0, 3).map((path) => new URL(path, origin).toString());
  const out: SiteDeclaredRegistration[] = [];
  for (const url of candidates) {
    try {
      const response = await fetcher(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) continue;
      const landedHost = new URL(response.url || url).hostname.replace(/^www\./, "");
      if (landedHost !== apex && !landedHost.endsWith(`.${apex}`)) continue;
      const body = (await response.text()).slice(0, 600_000);
      for (const registration of siteDeclaredRegistrations(body, url)) {
        if (!out.some((existing) => existing.number === registration.number)) out.push(registration);
      }
    } catch {
      continue;
    }
  }
  if (out.length) recordCall("site-fetch", "registration-numbers", 0, `${apex} · ${out.length}_numbers`, "succeeded");
  return out;
}

// ── Companies House ─────────────────────────────────────────────────────────

export function companiesHouseConfigured(): boolean {
  return Boolean(process.env.COMPANIES_HOUSE_API_KEY?.trim());
}

export interface CompaniesHouseRecord {
  companyNumber: string;
  companyName: string;
  status: string | null;
  type: string | null;
  incorporatedOn: string | null;
  jurisdiction: string | null;
  registeredOffice: string | null;
  sourceUrl: string;
  capturedAt: string;
}

export type CompaniesHouseOutcome =
  | { available: true; value: CompaniesHouseRecord }
  | { available: false; reason: "not_configured" | "no_data" | "unavailable"; note: string };

/**
 * Read a Companies House record by the company number the subject's own site
 * declared. The number is the join; the returned name is evidence, never a key.
 */
export async function collectCompaniesHouseRecord(
  companyNumber: string,
  options: { fetcher?: typeof fetch } = {},
): Promise<CompaniesHouseOutcome> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!apiKey) return { available: false, reason: "not_configured", note: "COMPANIES_HOUSE_API_KEY is not configured." };
  const clean = companyNumber.trim().toUpperCase();
  if (!/^[A-Z]{0,2}\d{6,8}$/.test(clean)) {
    return { available: false, reason: "no_data", note: `"${companyNumber}" is not a Companies House number shape.` };
  }
  const fetcher = options.fetcher ?? deadlineFetch;
  const sourceUrl = `${COMPANIES_HOUSE_BASE}/company/${encodeURIComponent(clean)}`;
  try {
    const response = await fetcher(sourceUrl, {
      headers: {
        authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
        accept: "application/json",
        "user-agent": USER_AGENT,
      },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) {
      recordCall("companies-house", "company", 0, `${clean} · not_found`, "succeeded");
      return { available: false, reason: "no_data", note: `Companies House has no record for ${clean}.` };
    }
    if (response.status === 401 || response.status === 403) {
      recordCall("companies-house", "company", 0, `${clean} · unauthorized`, "failed");
      return { available: false, reason: "unavailable", note: "Companies House rejected the configured API key." };
    }
    if (!response.ok) {
      recordCall("companies-house", "company", 0, `${clean} · http_${response.status}`, "failed");
      return { available: false, reason: "unavailable", note: `Companies House answered HTTP ${response.status}.` };
    }
    const body = await response.json() as {
      company_number?: unknown;
      company_name?: unknown;
      company_status?: unknown;
      type?: unknown;
      date_of_creation?: unknown;
      jurisdiction?: unknown;
      registered_office_address?: Record<string, unknown>;
    };
    const companyName = asString(body.company_name);
    if (!companyName) {
      recordCall("companies-house", "company", 0, `${clean} · empty`, "succeeded");
      return { available: false, reason: "no_data", note: `Companies House returned no company name for ${clean}.` };
    }
    const office = body.registered_office_address
      ? Object.values(body.registered_office_address).map((part) => asString(part)).filter(Boolean).join(", ")
      : "";
    recordCall("companies-house", "company", 0, `${clean} · ok`, "succeeded");
    return {
      available: true,
      value: {
        companyNumber: asString(body.company_number) ?? clean,
        companyName,
        status: asString(body.company_status),
        type: asString(body.type),
        incorporatedOn: asString(body.date_of_creation),
        jurisdiction: asString(body.jurisdiction),
        registeredOffice: office || null,
        sourceUrl: `https://find-and-update.company-information.service.gov.uk/company/${encodeURIComponent(clean)}`,
        capturedAt: captureTimestamp(),
      },
    };
  } catch (error) {
    recordCall("companies-house", "company", 0, `${clean} · error`, "failed");
    return { available: false, reason: "unavailable", note: `Companies House read failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── OpenCorporates ──────────────────────────────────────────────────────────

export function openCorporatesConfigured(): boolean {
  return Boolean(process.env.OPENCORPORATES_API_TOKEN?.trim());
}

export interface OpenCorporatesRecord {
  jurisdiction: string;
  companyNumber: string;
  companyName: string;
  status: string | null;
  incorporatedOn: string | null;
  companyType: string | null;
  sourceUrl: string;
  capturedAt: string;
}

export type OpenCorporatesOutcome =
  | { available: true; value: OpenCorporatesRecord }
  | { available: false; reason: "not_configured" | "no_data" | "unavailable"; note: string };

/**
 * Read an OpenCorporates record by jurisdiction + the company number the
 * subject's own site declared. Runs only when the jurisdiction is known: a
 * bare number probed across jurisdictions would be a namesake machine.
 */
export async function collectOpenCorporatesRecord(
  jurisdiction: string,
  companyNumber: string,
  options: { fetcher?: typeof fetch } = {},
): Promise<OpenCorporatesOutcome> {
  const token = process.env.OPENCORPORATES_API_TOKEN?.trim();
  if (!token) return { available: false, reason: "not_configured", note: "OPENCORPORATES_API_TOKEN is not configured." };
  const cleanJurisdiction = jurisdiction.trim().toLowerCase();
  const clean = companyNumber.trim().toUpperCase();
  if (!/^[a-z_]{2,8}$/.test(cleanJurisdiction) || !/^[A-Z0-9-]{4,16}$/.test(clean)) {
    return { available: false, reason: "no_data", note: "Jurisdiction or company number is not registry-shaped." };
  }
  const fetcher = options.fetcher ?? deadlineFetch;
  const requestUrl = `${OPENCORPORATES_BASE}/companies/${encodeURIComponent(cleanJurisdiction)}/${encodeURIComponent(clean)}?api_token=${encodeURIComponent(token)}`;
  try {
    const response = await fetcher(requestUrl, {
      headers: { accept: "application/json", "user-agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404) {
      recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · not_found`, "succeeded");
      return { available: false, reason: "no_data", note: `OpenCorporates has no ${cleanJurisdiction} record for ${clean}.` };
    }
    if (response.status === 401 || response.status === 403) {
      recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · unauthorized`, "failed");
      return { available: false, reason: "unavailable", note: "OpenCorporates rejected the configured API token." };
    }
    if (!response.ok) {
      recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · http_${response.status}`, "failed");
      return { available: false, reason: "unavailable", note: `OpenCorporates answered HTTP ${response.status}.` };
    }
    const body = await response.json() as { results?: { company?: Record<string, unknown> } };
    const company = body.results?.company;
    const companyName = company ? asString(company.name) : null;
    if (!company || !companyName) {
      recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · empty`, "succeeded");
      return { available: false, reason: "no_data", note: "OpenCorporates returned no company record." };
    }
    recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · ok`, "succeeded");
    return {
      available: true,
      value: {
        jurisdiction: cleanJurisdiction,
        companyNumber: asString(company.company_number) ?? clean,
        companyName,
        status: asString(company.current_status),
        incorporatedOn: asString(company.incorporation_date),
        companyType: asString(company.company_type),
        sourceUrl: asString(company.opencorporates_url) ?? `https://opencorporates.com/companies/${cleanJurisdiction}/${clean}`,
        capturedAt: captureTimestamp(),
      },
    };
  } catch (error) {
    recordCall("opencorporates", "company", 0, `${cleanJurisdiction}/${clean} · error`, "failed");
    return { available: false, reason: "unavailable", note: `OpenCorporates read failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
