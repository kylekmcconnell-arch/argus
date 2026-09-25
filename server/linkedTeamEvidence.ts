import { deadlineFetch } from "./providerDeadline.js";
import { env } from "./config.js";
import { linkedPersonEvidence, type LinkedPersonEvidence } from "../src/lib/linkedPersonEvidence.js";
import { personResearchIdentity } from "../src/lib/personResearch.js";
import type { WebTeamMember } from "../src/data/evidence.js";
import type { Dossier } from "../src/data/dossier.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Only explicitly attached, immutable person versions in the same organization may feed a new company snapshot. */
export async function collectLinkedTeamEvidence(organizationId: string | undefined, members: WebTeamMember[], deps = { fetch: deadlineFetch,
  url: env("SUPABASE_URL"), key: env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY") }): Promise<{ people: LinkedPersonEvidence[]; status: "read" | "unavailable" | "not_requested" }> {
  const identities = [...new Set(members.map(personResearchIdentity).filter((id): id is string => Boolean(id)))].slice(0, 8);
  if (!organizationId || !deps.url || !deps.key || !identities.length) return { people: [], status: "not_requested" };
  const baseUrl = deps.url.replace(/\/$/, "");
  const headers = { apikey: deps.key, ...(!deps.key.startsWith("sb_secret_") ? { authorization: `Bearer ${deps.key}` } : {}) };
  const read = async (table: string, params: Record<string, string>) => {
    const response = await deps.fetch(`${baseUrl}/rest/v1/${table}?${new URLSearchParams({ organization_id: `eq.${organizationId}`, ...params })}`, { headers, redirect: "error", signal: AbortSignal.timeout(3500) });
    if (!response.ok) throw new Error("storage_unavailable");
    const value: unknown = await response.json(); if (!Array.isArray(value)) throw new Error("invalid_rows"); return value;
  };
  try {
    const rows = await read("person_research_runs", { identity_key: `in.(${identities.join(",")})`, status: "eq.complete", "payload->linkedReport": "not.is.null", order: "created_at.desc", limit: "20", select: "identity_key,payload" });
    const candidates: Array<{ identity: string; version: string }> = [];
    for (const row of rows) {
      const id = row?.payload?.linkedReport?.reportVersionId;
      if (identities.includes(row?.identity_key) && typeof id === "string" && uuid.test(id) && !candidates.some(c => c.identity === row.identity_key)) candidates.push({ identity: row.identity_key, version: id });
    }
    if (!candidates.length) return { people: [], status: "read" };
    const versions = await read("report_versions", { id: `in.(${candidates.map(c => c.version).join(",")})`, select: "id,payload,created_at", limit: "8" });
    const people: LinkedPersonEvidence[] = [];
    for (const candidate of candidates) {
      const version = versions.find(v => v.id === candidate.version);
      const member = members.find(m => personResearchIdentity(m) === candidate.identity);
      if (!version || !member) continue;
      const linked = linkedPersonEvidence(member, version.payload as Dossier, version.id, version.created_at);
      if (linked) people.push(linked);
    }
    return { people, status: "read" };
  } catch { return { people: [], status: "unavailable" }; }
}
