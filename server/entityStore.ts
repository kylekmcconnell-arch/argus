// Entity knowledge base: a durable, per-organization store of the VERIFIED
// facts an audit resolves about an entity, keyed by canonicalEntityKey. Every
// audit writes its verified facts here; a later audit of the same or an
// overlapping entity reads them back instead of re-paying discovery. The
// fact-level sibling of graph_contributions. No-op when Supabase or the org is
// unset (local dev falls through to a full live audit).
import { env } from "./config";

const TABLE = "entity_facts";

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

export interface EntityFactsRecord {
  facts: Record<string, unknown>;
  updatedAt: string;
  auditCount: number;
  entityType: string | null;
}

export interface EntityFactsWrite {
  entityType?: string | null;
  handle?: string | null;
  displayName?: string | null;
  facts: Record<string, unknown>;
  sourceReportVersionId?: string | null;
}

/** Read stored verified facts for an entity, only if fresher than maxAgeMs. */
export async function readEntityFacts(
  organizationId: string | undefined,
  canonicalKey: string,
  maxAgeMs: number,
): Promise<EntityFactsRecord | null> {
  const c = creds();
  if (!c || !organizationId || !canonicalKey) return null;
  try {
    const url = `${c.url}/rest/v1/${TABLE}`
      + `?organization_id=eq.${encodeURIComponent(organizationId)}`
      + `&canonical_key=eq.${encodeURIComponent(canonicalKey)}`
      + `&select=facts,entity_type,audit_count,updated_at&limit=1`;
    const res = await fetch(url, { headers: authHeaders(c.key), signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ facts?: Record<string, unknown>; entity_type?: string | null; audit_count?: number; updated_at?: string }>;
    const row = rows?.[0];
    if (!row?.facts || !row.updated_at) return null;
    const age = Date.now() - Date.parse(row.updated_at);
    if (!Number.isFinite(age) || age < 0 || age > maxAgeMs) return null;
    return { facts: row.facts, updatedAt: row.updated_at, auditCount: typeof row.audit_count === "number" ? row.audit_count : 1, entityType: row.entity_type ?? null };
  } catch {
    return null;
  }
}

/** Upsert verified facts for an entity. Best-effort: never throws into an audit. */
export async function writeEntityFacts(
  organizationId: string | undefined,
  canonicalKey: string,
  entry: EntityFactsWrite,
): Promise<boolean> {
  const c = creds();
  if (!c || !organizationId || !canonicalKey) return false;
  try {
    // Increment the audit counter without a race-prone in-DB expression: read the
    // current count once, then upsert count+1. A concurrent double-audit at worst
    // under-counts by one, which is cosmetic.
    let auditCount = 1;
    try {
      const existing = await fetch(
        `${c.url}/rest/v1/${TABLE}?organization_id=eq.${encodeURIComponent(organizationId)}&canonical_key=eq.${encodeURIComponent(canonicalKey)}&select=audit_count&limit=1`,
        { headers: authHeaders(c.key), signal: AbortSignal.timeout(5_000) },
      );
      if (existing.ok) {
        const rows = (await existing.json()) as Array<{ audit_count?: number }>;
        if (typeof rows?.[0]?.audit_count === "number") auditCount = rows[0].audit_count + 1;
      }
    } catch { /* treat as first write */ }

    const res = await fetch(`${c.url}/rest/v1/${TABLE}?on_conflict=organization_id,canonical_key`, {
      method: "POST",
      headers: { ...authHeaders(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{
        organization_id: organizationId,
        canonical_key: canonicalKey,
        entity_type: entry.entityType ?? null,
        handle: entry.handle ?? null,
        display_name: entry.displayName ?? null,
        facts: entry.facts,
        audit_count: auditCount,
        source_report_version_id: entry.sourceReportVersionId ?? null,
        updated_at: new Date().toISOString(),
      }]),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
