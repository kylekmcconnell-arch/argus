// People Data Labs adapter. The defensible LinkedIn-derived layer (Proxycurl is
// dead; PDL is licensed/compiled data). Feeds F1 identity verifiability and
// F2 career history. Gated on PDL_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { recordCall, recordPdlMatch } from "../cost";
import { env } from "../config";
import { enrichPersonViaMonid } from "./monid";
import { VentureOutcome } from "../../src/engine";
import { employmentCurrency } from "../../src/lib/employmentCurrency";
import { isOrganizationAccount } from "../../src/lib/investorSubject";

const BASE = "https://api.peopledatalabs.com/v5";
type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

/** Founder and C-level titles only: the people whose departure changes the case. */
const PROJECT_LEADER_ROLE = /\b(?:co-?founder|founder|chief(?:\s+\w+){0,3}\s+officer|ceo|cto|cfo|coo|cmo|president)\b/i;

/** Bounded so a large roster cannot quietly multiply the bill. */
const MAX_LEADER_LOOKUPS = 3;

export interface LeaderDepartureCheck {
  name: string;
  role: string;
  linkedin?: string;
  state: "current" | "departed" | "absent";
  summary: string;
  ended?: string;
}

/**
 * Does the leadership a project claims still claim the project back?
 *
 * A team page is a snapshot of who was once listed. Employment records carry
 * end dates, so a founder who quietly stopped listing the company is visible
 * in data ARGUS can buy, and no page will ever show it. Each lookup is paid
 * (about $0.10), so this is deliberately bounded to founders and C-level and
 * capped at three people, cheapest-signal-first: the ones whose departure
 * actually changes the read.
 *
 * PDL is a licensed derivative of LinkedIn and can lag the live profile, so
 * every result carries the person's LinkedIn URL for a human to confirm.
 */
export async function checkLeaderDepartures(
  team: ReadonlyArray<{ name?: string; role?: string; linkedin?: string }>,
  company: string,
  enrich: typeof enrichPerson = enrichPerson,
): Promise<LeaderDepartureCheck[]> {
  if (!company.trim()) return [];
  const leaders = team
    .filter((member) => PROJECT_LEADER_ROLE.test(member.role ?? ""))
    .filter((member) => (member.name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2)
    .slice(0, MAX_LEADER_LOOKUPS);
  const out: LeaderDepartureCheck[] = [];
  for (const leader of leaders) {
    const name = (leader.name ?? "").trim();
    const person = await enrich({
      name,
      company,
      ...(leader.linkedin ? { profile: leader.linkedin } : {}),
    });
    if (!person) continue;
    const currency = employmentCurrency(person.experience, company, name);
    out.push({
      name,
      role: (leader.role ?? "").trim(),
      ...(leader.linkedin ?? person.linkedin ? { linkedin: leader.linkedin ?? person.linkedin ?? undefined } : {}),
      state: currency.state,
      summary: currency.summary,
      ...(currency.end ? { ended: currency.end } : {}),
    });
  }
  return out;
}

type EnrichedPerson = ReturnType<typeof parsePdlPerson>["person"];

/**
 * A licensed-provider read has three outcomes, and collapsing them loses the
 * only distinction that matters to the report: "the provider answered and
 * nobody matched" is evidence, while "the provider never answered" is not.
 * A transport timeout, an HTTP failure, an unreadable body, or a malformed
 * record must never be published as a completed empty screen.
 */
export type PersonEnrichmentOutcome =
  | { outcome: "matched"; person: EnrichedPerson }
  | { outcome: "no_match" }
  | { outcome: "failed"; reason: string };

/**
 * Back-compatible view for callers that only act on a successful match and
 * treat every other outcome the same way (leadership-currency lookups skip
 * unresolved leaders either way).
 */
export async function enrichPerson(
  params: { profile?: string; name?: string; company?: string },
): Promise<EnrichedPerson | null> {
  const result = await enrichPersonOutcome(params);
  return result.outcome === "matched" ? result.person : null;
}

export async function enrichPersonOutcome(
  params: { profile?: string; name?: string; company?: string },
): Promise<PersonEnrichmentOutcome> {
  // Prefer Monid's full-data PDL: our own direct key is on the free tier, which
  // omits the contact fields (emails/phone) that confirm an identity. Same PDL
  // response schema, so parsePdlPerson is shared. Fall back to the direct key
  // when Monid is not configured.
  if (env("MONID_API_KEY")) {
    const result = await enrichPersonViaMonid(params);
    // Record under the "peopledatalabs" provider (the identity resolution is
    // PDL's; Monid is just the transport) so provider-truth accounting sees the
    // adapter's work, and distinguish a real no-match from a Monid outage so an
    // outage never reads as a healthy "no person exists".
    if (result.outcome === "error") {
      recordCall("peopledatalabs", "person-enrich:monid", 0, `monid_${result.note}`, "failed");
      return { outcome: "failed", reason: `monid_${result.note}` };
    }
    if (result.outcome === "no_match") {
      recordCall("peopledatalabs", "person-enrich:monid", 0, "no_match", "succeeded");
      return { outcome: "no_match" };
    }
    const { person, issues } = parsePdlPerson(result.record);
    recordCall("peopledatalabs", "person-enrich:monid", 0.3, issues.length ? `incomplete:${[...new Set(issues)].join(",")}` : undefined, issues.length ? "partial" : "succeeded");
    return { outcome: "matched", person };
  }
  const key = env("PDL_API_KEY");
  if (!key) return { outcome: "failed", reason: "provider_not_configured" };
  const qs = new URLSearchParams();
  if (params.profile) qs.set("profile", params.profile);
  if (params.name) qs.set("name", params.name);
  if (params.company) qs.set("company", params.company);
  // With a disambiguator (a known company or social profile) a lower-likelihood
  // match is safe; on a bare common name we demand high confidence so we never
  // attach the wrong "Kyle McConnell".
  qs.set("min_likelihood", params.company || params.profile ? "4" : "8");
  let res: Response;
  try {
    res = await fetch(`${BASE}/person/enrich?${qs}`, {
      headers: { "X-Api-Key": key },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    recordPdlMatch(false, "failed", "transport_error");
    return { outcome: "failed", reason: "transport_error" };
  }
  if (!res.ok) {
    recordPdlMatch(false, "failed", `http_${res.status}`);
    return { outcome: "failed", reason: `http_${res.status}` };
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    recordPdlMatch(false, "failed", "response_json_error");
    return { outcome: "failed", reason: "response_json_error" };
  }

  const payload = asRecord(raw);
  if (!payload || !("data" in payload)) {
    recordPdlMatch(false, "partial", "missing_data");
    return { outcome: "failed", reason: "missing_data" };
  }
  if (payload.data == null) {
    recordPdlMatch(false, "succeeded", "no_match");
    return { outcome: "no_match" };
  }
  const p = asRecord(payload.data);
  if (!p) {
    recordPdlMatch(false, "partial", "invalid_person_shape");
    return { outcome: "failed", reason: "invalid_person_shape" };
  }

  const { person, issues } = parsePdlPerson(p);
  recordPdlMatch(
    true,
    issues.length ? "partial" : "succeeded",
    issues.length ? `incomplete_result:${[...new Set(issues)].join(",")}` : undefined,
  );
  return { outcome: "matched", person };
}

// Parse a raw PDL person record into ARGUS's identity shape. No cost recording:
// each caller records for its own provider path (direct PDL key vs Monid's PDL).
function parsePdlPerson(p: JsonRecord) {
  const issues: string[] = [];
  const fullName = optionalString(p.full_name);
  if (!fullName) issues.push("missing_full_name");
  const rawExperience = p.experience;
  if (rawExperience != null && !Array.isArray(rawExperience)) issues.push("invalid_experience");
  const experience = (Array.isArray(rawExperience) ? rawExperience : []).flatMap((value) => {
    const x = asRecord(value);
    if (!x) {
      issues.push("invalid_experience_item");
      return [];
    }
    const company = asRecord(x.company);
    const title = asRecord(x.title);
    return [{
      company: optionalString(company?.name),
      title: optionalString(title?.name),
      start: optionalString(x.start_date),
      end: optionalString(x.end_date),
      url: optionalString(company?.website) || optionalString(company?.linkedin_url) || null,
    }];
  });
  const emailCandidates: unknown[] = [
    p.work_email,
    ...(Array.isArray(p.personal_emails) ? p.personal_emails : []),
    ...(Array.isArray(p.emails)
      ? p.emails.map((email) => typeof email === "string" ? email : asRecord(email)?.address)
      : []),
  ];
  const profileRecords = (Array.isArray(p.profiles) ? p.profiles : [])
    .flatMap((value) => {
      const profile = asRecord(value);
      if (!profile) return [];
      return [{
        network: optionalString(profile.network)?.toLowerCase(),
        url: optionalString(profile.url),
        username: optionalString(profile.username),
      }];
    });
  const person = {
    fullName,
    jobTitle: optionalString(p.job_title),
    jobCompany: optionalString(p.job_company_name),
    experience,
    linkedin: optionalString(p.linkedin_url),
    twitterUrl: optionalString(p.twitter_url) ?? null,
    twitterUsername: optionalString(p.twitter_username) ?? null,
    profiles: profileRecords,
    // Emails are the strongest cross-source bridge key: a PDL-resolved email that
    // MATCHES a leaked GitHub commit email proves the anon dev is this named person.
    emails: [...new Set(emailCandidates
      .filter((email): email is string => typeof email === "string" && email.includes("@"))
      .map((email) => email.toLowerCase()))],
    github: optionalString(p.github_username) ?? null,
    location: optionalString(p.location_name) ?? null,
  };
  return { person, issues };
}

const httpify = (u?: string | null) => (u ? (/^https?:\/\//.test(u) ? u : "https://" + u) : null);

function socialHandle(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const raw = value.trim().replace(/^@/, "");
  if (!raw.includes("/") && !raw.includes(".")) return raw.toLowerCase();
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "twitter.com" && host !== "x.com") return null;
    const handle = decodeURIComponent(parsed.pathname.split("/").filter(Boolean)[0] ?? "").replace(/^@/, "");
    return handle ? handle.toLowerCase() : null;
  } catch {
    return null;
  }
}

function personMatchesAuditedHandle(
  person: NonNullable<Awaited<ReturnType<typeof enrichPerson>>>,
  handle: string,
): boolean {
  const expected = handle.replace(/^@/, "").toLowerCase();
  const candidates = [
    person.twitterUsername,
    person.twitterUrl,
    ...person.profiles
      .filter((profile) => profile.network === "twitter" || profile.network === "x")
      .flatMap((profile) => [profile.username, profile.url]),
  ];
  return candidates.some((candidate) => socialHandle(candidate) === expected);
}

export const peopledatalabsAdapter: Adapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("MONID_API_KEY") || !!env("PDL_API_KEY"),
  async run(ctx: CollectContext) {
    const handle = ctx.handle.replace(/^@/, "");
    if (isOrganizationAccount(ctx.evidence)) {
      ctx.emit({
        phase: "P1 · Identity",
        label: "Person enrichment not applicable",
        detail: "The audited handle represents an organization. A person record cannot replace the organization's identity or stand in for its operators.",
        source: "peopledatalabs",
        tone: "neutral",
      });
      return { state: "skipped", detail: "organization account; person enrichment not applicable" };
    }
    const name = ctx.evidence.profile.display_name;
    const realName = name && name !== handle ? name : undefined;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolution", detail: `Enriching ${realName ?? "@" + handle} via the exact audited X profile…`, tone: "neutral" });

    const enrichment = await enrichPersonOutcome({ profile: `https://twitter.com/${handle}` });
    // A provider that never answered has not screened anybody. Publishing that
    // as a completed empty read would freeze a transport timeout into the
    // sentence "no real-world identity record matched".
    if (enrichment.outcome === "failed") {
      ctx.recordCheck?.({
        id: "identity-resolution",
        status: "unavailable",
        note: `licensed identity provider did not return a usable answer (${enrichment.reason}); identity remains unresolved, not pseudonymous`,
        provider: "peopledatalabs",
      });
      ctx.emit({
        phase: "P1 · Identity",
        label: "Identity provider unavailable",
        detail: "The licensed identity provider did not answer, so this scan cannot say whether a real-world record exists. This is missing coverage, not a finding that the subject is pseudonymous.",
        source: "peopledatalabs",
        tone: "warn",
      });
      return { state: "failed", detail: `person enrichment unavailable: ${enrichment.reason}` };
    }
    if (enrichment.outcome === "no_match") {
      ctx.recordCheck?.({
        id: "identity-resolution",
        status: "checked-empty",
        note: "licensed identity provider completed without a matching real-world record",
        provider: "peopledatalabs",
      });
      ctx.emit({ phase: "P1 · Identity", label: "No match", detail: "No real-world identity record matched; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    const person = enrichment.person;
    if (!person.fullName || !personMatchesAuditedHandle(person, handle)) {
      ctx.recordCheck?.({
        id: "identity-resolution",
        status: "checked-empty",
        note: "licensed person record did not return both a full name and the exact audited X handle; identity was not adopted",
        provider: "peopledatalabs",
      });
      ctx.emit({
        phase: "P1 · Identity",
        label: "Identity not bound",
        detail: "The licensed result did not carry both a full name and the exact audited X handle. Its identity, employers, and contact fields were discarded.",
        source: "peopledatalabs",
        tone: "warn",
      });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    if (person.fullName) ctx.evidence.profile.resolved_name = person.fullName;
    ctx.evidence.profile.identity_binding = "licensed_exact_social";
    // Carry the resolved emails so the graph can bridge them to leaked GitHub commit
    // emails (an email match is a near-courtroom-grade identity confirmation).
    if (person.emails.length) ctx.evidence.profile.identity_emails = person.emails;
    const emailNote = person.emails.length ? ` Email on record: ${person.emails[0]}.` : "";
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName} from a licensed record that returned the exact audited X handle @${handle}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} roles on record${person.linkedin ? ` (${person.linkedin})` : ""}.${emailNote}`;
    ctx.recordCheck?.({
      id: "identity-resolution",
      status: "confirmed",
      note: `licensed identity record resolved to ${person.fullName}`,
      provider: "peopledatalabs",
      sourceCount: 1,
    });
    ctx.recordCheck?.({
      id: "affiliations-associates",
      status: person.experience.length ? "confirmed" : "checked-empty",
      note: person.experience.length
        ? `${person.experience.length} employment record${person.experience.length === 1 ? "" : "s"} returned`
        : "resolved identity record returned no employment history",
      provider: "peopledatalabs",
      sourceCount: person.experience.length,
    });
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolved", detail: `${person.fullName} · ${person.experience.length} employment records${person.emails.length ? ` · ${person.emails[0]}` : ""}${person.linkedin ? ` · ${person.linkedin}` : ""}`, source: "peopledatalabs", tone: "good" });

    // Integrate the career history. Two outcomes per company:
    //  - NEW: push it as a venture (an employer no other source surfaced).
    //  - KNOWN: PDL independently confirms a company another source already found
    //    -> upgrade that lead to corroborated. This is genuine cross-source
    //    verification (e.g. a reverse-mention X lead confirmed by PDL employment).
    const byName = new Map(ctx.evidence.ventures.map((v) => [v.project_name.toLowerCase(), v]));
    const added: string[] = [];
    const confirmed: string[] = [];
    const departures: { company: string; summary: string; ended?: string }[] = [];
    for (const x of person.experience) {
      const company = (x.company ?? "").trim();
      if (!company) continue;
      const key = company.toLowerCase();
      const title = x.title || "role on record";
      const period = [x.start, x.end].filter(Boolean).join("–");
      const ex = byName.get(key);
      // Whether the record still calls this role current, and when it ended if
      // not. A founder who quietly stopped listing the company is a finding no
      // team page will ever show, and it sits in the record ARGUS already paid for.
      const currency = employmentCurrency(person.experience, company, person.fullName ?? undefined);
      if (currency.state === "departed" && !departures.some((row) => row.company === company)) {
        departures.push({ company, summary: currency.summary, ...(currency.end ? { ended: currency.end } : {}) });
      }
      if (ex) {
        if (!/corroborated:/i.test(ex.notes ?? "")) {
          const base = (ex.notes ?? "").replace(/\s*·\s*single-source lead, unverified\s*$/i, "");
          ex.notes = [base, `corroborated: PDL employment record (${title}${period ? ", " + period : ""})`].filter(Boolean).join(" · ");
        }
        if (!ex.period && period) ex.period = period;
        if (!ex.evidence_url && x.url) ex.evidence_url = httpify(x.url);
        if (ex.artifact_verified !== true) {
          // Promote only the facts the PDL record actually established. A name
          // match proves employment, not the model-claimed title: keeping that
          // title while swapping provenance to deterministic would let an
          // unverified "founder" claim pass providerBackedRoles and govern the
          // scoring methodology. The verified record owns the governing role.
          ex.role = title;
          ex.provider = "peopledatalabs";
          ex.evidence_origin = "deterministic";
          ex.artifact_verified = true;
        }
        confirmed.push(company);
      } else {
        const rec = {
          project_name: company,
          role: title,
          period,
          outcome: VentureOutcome.UNKNOWN,
          evidence_url: httpify(x.url),
          notes: "People Data Labs employment record",
          provider: "peopledatalabs",
          evidence_origin: "deterministic" as const,
          artifact_verified: true,
        };
        ctx.evidence.ventures.push(rec);
        byName.set(key, rec);
        added.push(company);
      }
    }
    if (added.length) {
      ctx.emit({ phase: "P1 · Identity", label: "Career history", detail: `${added.length} employer(s) on record (incl. roles not on their X/profile): ${added.slice(0, 5).join(", ")}.`, source: "peopledatalabs", tone: "good" });
    }
    if (confirmed.length) {
      ctx.emit({ phase: "P1 · Identity", label: "Cross-source corroboration", detail: `PDL employment independently confirms: ${confirmed.slice(0, 5).join(", ")}.`, source: "peopledatalabs", tone: "good" });
    }
    // A role the subject is still publicly associated with, which their own
    // employment record has closed, is the kind of thing a reader must be told
    // plainly. Reported as a dated record, never as a reason for leaving.
    if (departures.length) {
      ctx.evidence.employmentDepartures = departures.map((row) => ({ ...row }));
      const newest = [...departures].sort((a, b) => String(b.ended ?? "").localeCompare(String(a.ended ?? "")))[0];
      ctx.emit({
        phase: "P1 · Identity",
        label: `Ended role${departures.length === 1 ? "" : "s"} on record`,
        detail: `${newest.summary}${departures.length > 1 ? ` ${departures.length - 1} other closed role${departures.length === 2 ? "" : "s"} on record.` : ""}`,
        source: "peopledatalabs",
        tone: "warn",
      });
      ctx.recordCheck?.({
        id: "identity-continuity",
        status: "finding",
        note: departures.map((row) => row.summary).join(" "),
        provider: "peopledatalabs",
        sourceCount: departures.length,
      });
    }
  },
};
