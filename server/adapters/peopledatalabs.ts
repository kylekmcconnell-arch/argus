// People Data Labs adapter. The defensible LinkedIn-derived layer (Proxycurl is
// dead; PDL is licensed/compiled data). Feeds F1 identity verifiability and
// F2 career history. Gated on PDL_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { recordCall, recordPdlMatch } from "../cost";
import { env } from "../config";
import { enrichPersonViaMonid } from "./monid";
import { VentureOutcome } from "../../src/engine";

const BASE = "https://api.peopledatalabs.com/v5";
type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export async function enrichPerson(params: { profile?: string; name?: string; company?: string }) {
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
      return null;
    }
    if (result.outcome === "no_match") {
      recordCall("peopledatalabs", "person-enrich:monid", 0, "no_match", "succeeded");
      return null;
    }
    const { person, issues } = parsePdlPerson(result.record);
    recordCall("peopledatalabs", "person-enrich:monid", 0.3, issues.length ? `incomplete:${[...new Set(issues)].join(",")}` : undefined, issues.length ? "partial" : "succeeded");
    return person;
  }
  const key = env("PDL_API_KEY");
  if (!key) return null;
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
    return null;
  }
  if (!res.ok) {
    recordPdlMatch(false, "failed", `http_${res.status}`);
    return null;
  }

  let raw: unknown;
  try {
    raw = await res.json();
  } catch {
    recordPdlMatch(false, "failed", "response_json_error");
    return null;
  }

  const payload = asRecord(raw);
  if (!payload || !("data" in payload)) {
    recordPdlMatch(false, "partial", "missing_data");
    return null;
  }
  if (payload.data == null) {
    recordPdlMatch(false, "succeeded", "no_match");
    return null;
  }
  const p = asRecord(payload.data);
  if (!p) {
    recordPdlMatch(false, "partial", "invalid_person_shape");
    return null;
  }

  const { person, issues } = parsePdlPerson(p);
  recordPdlMatch(
    true,
    issues.length ? "partial" : "succeeded",
    issues.length ? `incomplete_result:${[...new Set(issues)].join(",")}` : undefined,
  );
  return person;
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
  const person = {
    fullName,
    jobTitle: optionalString(p.job_title),
    jobCompany: optionalString(p.job_company_name),
    experience,
    linkedin: optionalString(p.linkedin_url),
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

export const peopledatalabsAdapter: Adapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("MONID_API_KEY") || !!env("PDL_API_KEY"),
  async run(ctx: CollectContext) {
    const handle = ctx.handle.replace(/^@/, "");
    const name = ctx.evidence.profile.display_name;
    const realName = name && name !== handle ? name : undefined;
    // A common display name alone is too ambiguous for PDL (it returns no match).
    // We already discovered this person's companies upstream (Grok) — feed one
    // back as a disambiguator, which is exactly what turns "Kyle McConnell" into
    // a precise hit. This is the bridge between the two intelligence layers.
    const companies = [...new Set(ctx.evidence.ventures.map((v) => v.project_name).filter(Boolean))];
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolution", detail: `Enriching ${realName ?? "@" + handle} via People Data Labs${companies.length ? ", disambiguating with discovered companies" : ""}…`, tone: "neutral" });

    let person: Awaited<ReturnType<typeof enrichPerson>> = null;
    if (realName) {
      for (const company of companies.slice(0, 3)) {
        person = await enrichPerson({ name: realName, company });
        if (person) break;
      }
      if (!person) person = await enrichPerson({ name: realName }); // last resort, high-confidence only
    }
    if (!person) person = await enrichPerson({ profile: `twitter.com/${handle}` });
    if (!person) {
      ctx.recordCheck?.({
        id: "identity-resolution",
        status: "checked-empty",
        note: "licensed identity provider completed without a matching real-world record",
        provider: "peopledatalabs",
      });
      ctx.emit({ phase: "P1 · Identity", label: "No match", detail: "No real-world identity record matched; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    if (person.fullName) ctx.evidence.profile.resolved_name = person.fullName;
    // Carry the resolved emails so the graph can bridge them to leaked GitHub commit
    // emails (an email match is a near-courtroom-grade identity confirmation).
    if (person.emails.length) ctx.evidence.profile.identity_emails = person.emails;
    const emailNote = person.emails.length ? ` Email on record: ${person.emails[0]}.` : "";
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} roles on record${person.linkedin ? ` (${person.linkedin})` : ""}.${emailNote}`;
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
    for (const x of person.experience) {
      const company = (x.company ?? "").trim();
      if (!company) continue;
      const key = company.toLowerCase();
      const title = x.title || "role on record";
      const period = [x.start, x.end].filter(Boolean).join("–");
      const ex = byName.get(key);
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
  },
};
