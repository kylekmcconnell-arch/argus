// People Data Labs adapter. The defensible LinkedIn-derived layer (Proxycurl is
// dead; PDL is licensed/compiled data). Feeds F1 identity verifiability and
// F2 career history. Gated on PDL_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { recordPdlMatch } from "../cost";
import { env } from "../config";
import { VentureOutcome } from "../../src/engine";

const BASE = "https://api.peopledatalabs.com/v5";

export async function enrichPerson(params: { profile?: string; name?: string; company?: string }) {
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
  try {
    const res = await fetch(`${BASE}/person/enrich?${qs}`, { headers: { "X-Api-Key": key } });
    if (!res.ok) { recordPdlMatch(false); return null; }
    const d = (await res.json()) as any;
    const p = d.data;
    recordPdlMatch(!!p); // PDL bills per successful match
    if (!p) return null;
    return {
      fullName: p.full_name,
      jobTitle: p.job_title,
      jobCompany: p.job_company_name,
      experience: (p.experience ?? []).map((x: any) => ({
        company: x.company?.name,
        title: x.title?.name,
        start: x.start_date,
        end: x.end_date,
        url: x.company?.website || x.company?.linkedin_url || null,
      })),
      linkedin: p.linkedin_url,
    };
  } catch {
    return null;
  }
}

const httpify = (u?: string | null) => (u ? (/^https?:\/\//.test(u) ? u : "https://" + u) : null);

export const peopledatalabsAdapter: Adapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("PDL_API_KEY"),
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
      ctx.emit({ phase: "P1 · Identity", label: "No match", detail: "No real-world identity record matched; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} roles on record${person.linkedin ? ` (${person.linkedin})` : ""}.`;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolved", detail: `${person.fullName} · ${person.experience.length} employment records${person.linkedin ? ` · ${person.linkedin}` : ""}`, source: "peopledatalabs", tone: "good" });

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
        confirmed.push(company);
      } else {
        const rec = {
          project_name: company,
          role: title,
          period,
          outcome: VentureOutcome.UNKNOWN,
          evidence_url: httpify(x.url),
          notes: "People Data Labs employment record",
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
