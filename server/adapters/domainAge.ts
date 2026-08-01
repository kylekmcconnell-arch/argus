// Domain registration age via RDAP: the free, keyless successor to WHOIS that
// every registry now serves. Paired with the X account creation date it brackets
// when a project could have launched, and the GAP between the two dates is its
// own signal: a domain bought years before the account, or an account that
// predates the domain by years, both say something a single date cannot.
//
// rdap.org is a REDIRECTOR to the authoritative registry, so the request must
// follow redirects; without that every lookup fails. The registry answers about
// registrable domains only, so the hostname is reduced to one before the query
// and kept alongside the answer for display.
import { recordCall } from "../cost";

const RDAP_BASE = "https://rdap.org/domain/";

export interface DomainRegistration {
  /** The registrable domain the registry actually answered about. */
  domain: string;
  /** The hostname the project publishes, so a subdomain site is still named as itself. */
  hostname: string;
  /** ISO date the registry records as registration/creation. */
  registeredAt: string;
  /** Whole months since registration at capture time. */
  ageMonths: number;
  source: string;
  capturedAt: string;
}

export type DomainRegistrationOutcome =
  | { available: true; value: DomainRegistration }
  | { available: false; reason: "no_domain" | "not_found" | "not_applicable" | "unavailable"; note: string };

const REGISTRATION_EVENTS = new Set(["registration", "last changed registration", "registrar registration"]);

/**
 * Public suffixes that registries sell one label deeper. Taking the last two
 * labels here would ask about co.uk or com.au themselves, which no registrant
 * holds, and the registry answers that with an error rather than a date.
 */
const DEEP_REGISTRY_SUFFIXES = new Set([
  "co.uk", "org.uk", "me.uk", "net.uk", "ltd.uk", "plc.uk", "sch.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "asn.au", "id.au",
  "co.nz", "net.nz", "org.nz", "ac.nz", "govt.nz", "school.nz",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp", "lg.jp",
  "com.cn", "net.cn", "org.cn", "edu.cn", "gov.cn", "ac.cn",
  "com.br", "net.br", "org.br", "gov.br",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in", "ac.in", "gov.in",
  "co.za", "org.za", "net.za", "web.za", "ac.za", "gov.za",
  "co.kr", "ne.kr", "or.kr", "re.kr", "pe.kr", "go.kr",
  "com.mx", "org.mx", "net.mx", "edu.mx", "gob.mx",
  "com.tr", "net.tr", "org.tr", "edu.tr", "gov.tr",
  "co.il", "org.il", "net.il", "ac.il", "gov.il",
  "com.sg", "net.sg", "org.sg", "edu.sg", "gov.sg",
  "com.hk", "net.hk", "org.hk", "idv.hk", "edu.hk", "gov.hk",
  "com.tw", "net.tw", "org.tw", "edu.tw", "gov.tw",
  "com.ar", "net.ar", "org.ar", "gob.ar",
  "com.es", "org.es", "nom.es", "edu.es", "gob.es",
  "com.pl", "net.pl", "org.pl", "edu.pl", "gov.pl",
  "com.ua", "net.ua", "org.ua", "kiev.ua",
  "co.id", "or.id", "ac.id", "web.id", "go.id",
  "com.ph", "net.ph", "org.ph",
  "co.th", "in.th", "ac.th", "or.th", "go.th",
  "com.vn", "net.vn", "org.vn", "edu.vn", "gov.vn",
  "com.my", "net.my", "org.my", "edu.my", "gov.my",
  "com.ru", "net.ru", "org.ru",
  "com.gr", "net.gr", "org.gr", "edu.gr", "gov.gr",
  "co.ke", "com.ng", "com.pk", "com.eg", "com.sa",
]);

/**
 * Suffixes a hosting platform registered for itself. The apex belongs to the
 * host, so reducing to it would report GitHub's or Vercel's registration date
 * as the project's own; nothing under it has a registration to age.
 */
const SHARED_HOST_SUFFIXES = new Set([
  "github.io", "gitlab.io", "pages.dev", "workers.dev", "vercel.app", "netlify.app",
  "web.app", "firebaseapp.com", "herokuapp.com", "fly.dev", "onrender.com",
  "glitch.me", "repl.co", "replit.app", "notion.site", "webflow.io", "wixsite.com",
  "eth.limo", "dweb.link",
  // Every one of these answers RDAP with a real date, so an omission here is not
  // a missing lookup, it is the platform's date published as the project's:
  // checked keyless 2026-08-01, myshopify.com registered 2006-03-03,
  // wordpress.com 2000-03-03, blogspot.com 2000-07-31, substack.com 2010-04-27,
  // azurewebsites.net 2012-01-24, mystrikingly.com 2018-11-28, framer.app
  // 2020-10-02, softr.app 2021-01-13, super.site 2021-06-04, 4everland.app
  // 2021-07-08, framer.website 2021-11-19, w3s.link 2022-06-27.
  "myshopify.com", "wordpress.com", "blogspot.com", "substack.com", "squarespace.com",
  "azurewebsites.net", "mystrikingly.com", "softr.app", "bubbleapps.io", "durable.co",
  "framer.app", "framer.website", "super.site", "gitbook.io", "surge.sh",
  "4everland.app", "on-fleek.app", "w3s.link", "nftstorage.link", "ipfs.io",
]);

const normalizeHostname = (value: string): string =>
  value.trim().toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/^[^/@]*@/, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.$/, "")
    .replace(/^www\./, "");

export interface DomainScope {
  /** The published hostname, kept for display even when the query is narrower. */
  hostname: string;
  /** The name a registry can answer about, or null when the hostname has none. */
  registrable: string | null;
  /** Set when the hostname lives under a hosting platform's own registration. */
  sharedHost?: string;
}

/**
 * RDAP answers about registrable domains, not hostnames. Asking it about
 * app.uniswap.org gets a rejection, not a date, so the query has to be reduced
 * to the name someone actually registered before it is sent.
 */
export function resolveDomainScope(website: string | null | undefined): DomainScope {
  const hostname = website ? normalizeHostname(website) : "";
  const labels = hostname.split(".");
  // A numeric last label is an address, not a TLD; xn-- keeps IDN TLDs eligible.
  const tld = labels[labels.length - 1];
  if (labels.length < 2 || labels.some((label) => !label) || !/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(tld)) {
    return { hostname, registrable: null };
  }
  const lastTwo = labels.slice(-2).join(".");
  if (SHARED_HOST_SUFFIXES.has(lastTwo)) {
    return labels.length > 2
      ? { hostname, registrable: null, sharedHost: lastTwo }
      : { hostname, registrable: lastTwo };
  }
  if (DEEP_REGISTRY_SUFFIXES.has(lastTwo)) {
    return { hostname, registrable: labels.length > 2 ? labels.slice(-3).join(".") : null };
  }
  return { hostname, registrable: lastTwo };
}

export function monthsBetween(fromIso: string, now: Date): number {
  const from = new Date(fromIso);
  if (!Number.isFinite(from.getTime())) return 0;
  const months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  return Math.max(0, from.getDate() > now.getDate() ? months - 1 : months);
}

/** Earliest registration-style event in an RDAP record. */
export function registrationEventDate(events: unknown): string | null {
  if (!Array.isArray(events)) return null;
  const dates = events
    .map((event) => {
      const row = event && typeof event === "object" ? event as { eventAction?: unknown; eventDate?: unknown } : null;
      const action = typeof row?.eventAction === "string" ? row.eventAction.toLowerCase() : "";
      const date = typeof row?.eventDate === "string" ? row.eventDate : "";
      return REGISTRATION_EVENTS.has(action) && date ? date : null;
    })
    .filter((value): value is string => Boolean(value))
    .sort();
  return dates[0] ?? null;
}

export async function collectDomainRegistration(
  website: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<DomainRegistrationOutcome> {
  const scope = resolveDomainScope(website);
  if (scope.sharedHost) {
    // Not a gap in coverage: the platform owns the registration, so there is no
    // project-owned date to read and the platform's own date would be a lie.
    return {
      available: false,
      reason: "not_applicable",
      note: `${scope.hostname} is hosted under ${scope.sharedHost}, which the project does not register, so it has no registration date of its own`,
    };
  }
  const domain = scope.registrable;
  if (!domain) {
    return { available: false, reason: "no_domain", note: "no official domain to age" };
  }
  let response: Response;
  try {
    response = await fetchImpl(`${RDAP_BASE}${encodeURIComponent(domain)}`, {
      redirect: "follow",
      headers: { accept: "application/rdap+json, application/json" },
      signal: AbortSignal.timeout(9000),
    });
  } catch {
    recordCall("rdap", "domain-age", 0, "transport_error", "failed");
    return { available: false, reason: "unavailable", note: "RDAP was unreachable" };
  }
  if (response.status === 404) {
    // The registry has no record: an answer, not an outage.
    recordCall("rdap", "domain-age", 0, "no_record_404", "succeeded");
    return { available: false, reason: "not_found", note: `no RDAP record for ${domain}` };
  }
  if (response.status === 400) {
    // A registry rejects what it cannot answer: an out-of-scope name or a TLD
    // it does not serve. That is a question RDAP declines, not a provider
    // outage, and reporting it as one puts a false red alert on the report.
    recordCall("rdap", "domain-age", 0, "not_applicable_400", "succeeded");
    return {
      available: false,
      reason: "not_applicable",
      note: `RDAP does not serve ${domain} (rejected the query as out of scope), so no registration date exists to read`,
    };
  }
  if (!response.ok) {
    recordCall("rdap", "domain-age", 0, `http_${response.status}`, "failed");
    return { available: false, reason: "unavailable", note: `RDAP returned http_${response.status}` };
  }
  let body: { events?: unknown };
  try {
    body = await response.json() as { events?: unknown };
  } catch {
    recordCall("rdap", "domain-age", 0, "response_json_error", "failed");
    return { available: false, reason: "unavailable", note: "RDAP response was unreadable" };
  }
  const registeredAt = registrationEventDate(body?.events);
  if (!registeredAt) {
    recordCall("rdap", "domain-age", 0, "no_registration_event", "partial");
    return { available: false, reason: "not_found", note: `RDAP record for ${domain} states no registration date` };
  }
  recordCall("rdap", "domain-age", 0, undefined, "succeeded");
  return {
    available: true,
    value: {
      domain,
      hostname: scope.hostname,
      registeredAt,
      ageMonths: monthsBetween(registeredAt, now),
      source: `${RDAP_BASE}${domain}`,
      capturedAt: now.toISOString(),
    },
  };
}

export interface LaunchWindow {
  /** Earliest of the two dates: the first public trace of the project. */
  earliest: string;
  earliestSource: "domain" | "account";
  /** Latest of the two: by here, both surfaces existed. */
  latest: string;
  latestSource: "domain" | "account";
  gapMonths: number;
  summary: string;
}

const monthYear = (iso: string): string => {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

/**
 * Bracket when a project became public from the two independent dates ARGUS
 * already holds. Never a claim about a launch event: it states what existed
 * when, and flags a wide gap between the two rather than explaining it.
 */
export function deriveLaunchWindow(
  domainRegisteredAt: string | null | undefined,
  accountCreatedAt: string | null | undefined,
): LaunchWindow | null {
  const domainTime = domainRegisteredAt ? Date.parse(domainRegisteredAt) : NaN;
  const accountTime = accountCreatedAt ? Date.parse(accountCreatedAt) : NaN;
  if (!Number.isFinite(domainTime) || !Number.isFinite(accountTime)) return null;
  const domainFirst = domainTime <= accountTime;
  const earliest = domainFirst ? domainRegisteredAt! : accountCreatedAt!;
  const latest = domainFirst ? accountCreatedAt! : domainRegisteredAt!;
  const gapMonths = monthsBetween(earliest, new Date(latest));
  const earliestLabel = domainFirst ? "the domain was registered" : "the X account was created";
  const latestLabel = domainFirst ? "the X account followed" : "the domain was registered";
  const gapNote = gapMonths >= 24
    ? ` The two are ${Math.round(gapMonths / 12)} years apart, so one surface long predates the other.`
    : gapMonths >= 6
      ? ` The two are about ${gapMonths} months apart.`
      : " Both surfaces appeared within months of each other.";
  return {
    earliest,
    earliestSource: domainFirst ? "domain" : "account",
    latest,
    latestSource: domainFirst ? "account" : "domain",
    gapMonths,
    summary: `Public footprint starts ${monthYear(earliest)}, when ${earliestLabel}; ${latestLabel} ${monthYear(latest)}.${gapNote}`,
  };
}
