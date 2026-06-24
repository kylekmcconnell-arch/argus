// People Data Labs adapter. The defensible LinkedIn-derived layer (Proxycurl is
// dead; PDL is licensed/compiled data). Feeds F1 identity verifiability and
// F2 career history. Gated on PDL_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { env } from "../config";
import { VentureOutcome } from "../../src/engine";

const BASE = "https://api.peopledatalabs.com/v5";

export async function enrichPerson(params: { profile?: string; name?: string }) {
  const key = env("PDL_API_KEY");
  if (!key) return null;
  const qs = new URLSearchParams();
  if (params.profile) qs.set("profile", params.profile);
  if (params.name) qs.set("name", params.name);
  qs.set("min_likelihood", "6");
  try {
    const res = await fetch(`${BASE}/person/enrich?${qs}`, { headers: { "X-Api-Key": key } });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const p = d.data;
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
      })),
      linkedin: p.linkedin_url,
    };
  } catch {
    return null;
  }
}

export const peopledatalabsAdapter: Adapter = {
  id: "peopledatalabs",
  label: "People Data Labs",
  available: () => !!env("PDL_API_KEY"),
  async run(ctx: CollectContext) {
    const handle = ctx.handle.replace(/^@/, "");
    const name = ctx.evidence.profile.display_name;
    // Resolve on the X handle as a social profile, not just the (often common)
    // display name — PDL matches a handle exactly but a bare name ambiguously.
    const profile = `twitter.com/${handle}`;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolution", detail: `Enriching @${handle}${name && name !== handle ? ` (${name})` : ""} via People Data Labs…`, tone: "neutral" });
    const person =
      (await enrichPerson({ profile, name: name && name !== handle ? name : undefined })) ||
      (name && name !== handle ? await enrichPerson({ name }) : null);
    if (!person) {
      ctx.emit({ phase: "P1 · Identity", label: "No match", detail: "No real-world identity record matched this handle; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} prior roles on record.`;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolved", detail: `${person.fullName} · ${person.experience.length} verified roles`, source: "peopledatalabs", tone: "good" });

    // The career history is the off-LinkedIn affiliation gold PDL aggregates from
    // far more than LinkedIn — push each prior role into ventures so it surfaces
    // and feeds the trust graph, instead of being collapsed into a count.
    const have = new Set(ctx.evidence.ventures.map((v) => v.project_name.toLowerCase()));
    const added: string[] = [];
    for (const x of person.experience) {
      const company = (x.company ?? "").trim();
      if (!company || have.has(company.toLowerCase())) continue;
      have.add(company.toLowerCase());
      const period = [x.start, x.end].filter(Boolean).join("–");
      ctx.evidence.ventures.push({
        project_name: company,
        role: x.title || "role on record",
        period,
        outcome: VentureOutcome.UNKNOWN,
        notes: "People Data Labs employment record",
      });
      added.push(company);
    }
    if (added.length) {
      ctx.emit({ phase: "P1 · Identity", label: "Career history", detail: `${added.length} prior employer(s) on record (incl. roles not on their profile): ${added.slice(0, 5).join(", ")}.`, source: "peopledatalabs", tone: "good" });
    }
  },
};
