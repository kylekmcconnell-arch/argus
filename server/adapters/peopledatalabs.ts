// People Data Labs adapter. The defensible LinkedIn-derived layer (Proxycurl is
// dead; PDL is licensed/compiled data). Feeds F1 identity verifiability and
// F2 career history. Gated on PDL_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { env } from "../config";

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
    const name = ctx.evidence.profile.display_name;
    if (!name || name === ctx.handle.replace(/^@/, "")) return;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolution", detail: `Enriching ${name} via People Data Labs…`, tone: "neutral" });
    const person = await enrichPerson({ name });
    if (!person) {
      ctx.emit({ phase: "P1 · Identity", label: "No match", detail: "No real-world identity record; scored as pseudonymous (no penalty).", source: "peopledatalabs", tone: "neutral" });
      return;
    }
    ctx.evidence.profile.identity_confidence = person.linkedin ? "Probable" : ctx.evidence.profile.identity_confidence;
    ctx.evidence.profile.identity_note = `Resolved to ${person.fullName}, ${person.jobTitle ?? "role unknown"} @ ${person.jobCompany ?? "n/a"}. ${person.experience.length} prior roles on record.`;
    ctx.emit({ phase: "P1 · Identity", label: "Identity resolved", detail: `${person.fullName} · ${person.experience.length} verified roles`, source: "peopledatalabs", tone: "good" });
  },
};
