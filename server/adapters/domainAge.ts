// Domain registration age via RDAP: the free, keyless successor to WHOIS that
// every registry now serves. Paired with the X account creation date it brackets
// when a project could have launched, and the GAP between the two dates is its
// own signal: a domain bought years before the account, or an account that
// predates the domain by years, both say something a single date cannot.
//
// rdap.org is a REDIRECTOR to the authoritative registry, so the request must
// follow redirects; without that every lookup fails.
import { recordCall } from "../cost";

const RDAP_BASE = "https://rdap.org/domain/";

export interface DomainRegistration {
  domain: string;
  /** ISO date the registry records as registration/creation. */
  registeredAt: string;
  /** Whole months since registration at capture time. */
  ageMonths: number;
  source: string;
  capturedAt: string;
}

export type DomainRegistrationOutcome =
  | { available: true; value: DomainRegistration }
  | { available: false; reason: "no_domain" | "not_found" | "unavailable"; note: string };

const REGISTRATION_EVENTS = new Set(["registration", "last changed registration", "registrar registration"]);

const apex = (value: string): string =>
  value.trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");

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
  const domain = website ? apex(website) : "";
  if (!domain || !domain.includes(".")) {
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
