// "Since last scan": read the most recent persisted report version for this
// same subject in this organization, so a re-run can state its own delta
// (score, verdict, completeness) instead of leaving the repeat user to diff
// two frozen reports by hand. Read-only, bounded, and best-effort: any miss
// (no Supabase, no org, first-ever scan) is a silent null, never a failure.
import { env } from "../config";

function creds(): { url: string; key: string } | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") || env("SUPABASE_SERVICE_ROLE_KEY") || env("SUPABASE_SERVICE_KEY");
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const authHeaders = (key: string): Record<string, string> => ({
  apikey: key,
  ...(!key.startsWith("sb_secret_") ? { authorization: `Bearer ${key}` } : {}),
  "content-type": "application/json",
});

export interface PriorOutcome {
  reportVersionId?: string;
  version: number;
  score: number | null;
  verdict: string | null;
  completeness: string | null;
  capturedAt: string | null;
  payload?: unknown;
}

/** Latest persisted outcome for this org+handle, or null. Never throws. */
export async function readPriorOutcome(
  organizationId: string | undefined,
  handle: string,
): Promise<PriorOutcome | null> {
  const c = creds();
  const ref = handle.trim().replace(/^@/, "").toLowerCase();
  if (!c || !organizationId || !ref) return null;
  try {
    // The mutable report projection is the activation pointer. Reading its
    // exact immutable id avoids comparing against a newer version whose
    // persistence succeeded but activation failed.
    const projectionUrl = `${c.url}/rest/v1/reports`
      + `?organization_id=eq.${encodeURIComponent(organizationId)}`
      + `&kind=eq.person`
      + `&ref=in.(${encodeURIComponent(`"${ref}","@${ref}"`)})`
      + "&select=report_version_id&order=ts.desc&limit=1";
    const projectionRes = await fetch(projectionUrl, {
      headers: authHeaders(c.key),
      signal: AbortSignal.timeout(5_000),
    });
    if (!projectionRes.ok) return null;
    const projectionRows = (await projectionRes.json()) as Array<{ report_version_id?: string }>;
    const reportVersionId = projectionRows?.[0]?.report_version_id;
    if (!reportVersionId) return null;

    const versionUrl = `${c.url}/rest/v1/report_versions`
      + `?id=eq.${encodeURIComponent(reportVersionId)}`
      + `&organization_id=eq.${encodeURIComponent(organizationId)}`
      + "&select=id,version,score,verdict,completeness_state,created_at,payload"
      + "&limit=1";
    const versionRes = await fetch(versionUrl, { headers: authHeaders(c.key), signal: AbortSignal.timeout(5_000) });
    if (!versionRes.ok) return null;
    const rows = (await versionRes.json()) as Array<{
      id?: string; version?: number; score?: number | string | null; verdict?: string | null;
      completeness_state?: string | null; created_at?: string | null;
      payload?: unknown;
    }>;
    const row = rows?.[0];
    if (!row || typeof row.id !== "string" || typeof row.version !== "number") return null;
    const score = row.score === null || row.score === undefined ? null : Number(row.score);
    return {
      reportVersionId: row.id,
      version: row.version,
      score: Number.isFinite(score as number) ? (score as number) : null,
      verdict: typeof row.verdict === "string" && row.verdict ? row.verdict : null,
      completeness: typeof row.completeness_state === "string" ? row.completeness_state : null,
      capturedAt: typeof row.created_at === "string" ? row.created_at : null,
      payload: row.payload,
    };
  } catch {
    return null;
  }
}

/** One-line human delta, or null when there is nothing meaningful to say. */
export function describeOutcomeDelta(
  prior: PriorOutcome,
  current: { score: number | null; verdict: string | null; completeness: string | null },
): string | null {
  const parts: string[] = [];
  if (prior.verdict && current.verdict && prior.verdict !== current.verdict) {
    parts.push(`verdict ${prior.verdict} -> ${current.verdict}`);
  }
  if (prior.score !== null && current.score !== null) {
    const delta = current.score - prior.score;
    parts.push(delta === 0 ? `score steady at ${current.score}` : `score ${prior.score} -> ${current.score} (${delta > 0 ? "+" : ""}${delta})`);
  }
  if (prior.completeness && current.completeness && prior.completeness !== current.completeness) {
    parts.push(`coverage ${prior.completeness} -> ${current.completeness}`);
  }
  if (!parts.length) return null;
  const when = prior.capturedAt ? ` (v${prior.version}, ${prior.capturedAt.slice(0, 10)})` : ` (v${prior.version})`;
  return `Since last scan${when}: ${parts.join(" · ")}`;
}
