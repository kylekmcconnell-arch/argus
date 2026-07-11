// Authenticated organization audit feed. Identity is derived from membership;
// callers cannot impersonate another analyst by changing contributor fields.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";

export const config = { maxDuration: 15 };

const TABLE = "audit_log";
type JsonRecord = Record<string, unknown>;

interface AuditLogRow {
  client_id?: unknown;
  ts?: unknown;
  kind?: unknown;
  query?: unknown;
  ref?: unknown;
  image?: unknown;
  verdict?: unknown;
  score?: unknown;
  summary?: unknown;
  coverage?: unknown;
  flags?: unknown;
  contributor?: unknown;
  contributor_user_id?: unknown;
}
const str = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

function safeParse(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const minimumRole = req.method === "DELETE" ? "owner" : req.method === "POST" ? "analyst" : "viewer";
  const auth = await requireArgusAuth(req, res, minimumRole);
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }
  const orgFilter = `organization_id=eq.${encodeURIComponent(auth.organizationId)}`;

  try {
    if (req.method === "GET") {
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?select=client_id,ts,kind,query,ref,image,verdict,score,summary,coverage,flags,contributor,contributor_user_id&${orgFilter}&order=ts.desc&limit=200`,
        { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`audit log read failed (${response.status})`);
      const rows = (await response.json()) as AuditLogRow[];
      const entries = (Array.isArray(rows) ? rows : []).map((row) => ({
        id: row.client_id,
        ts: typeof row.ts === "string" ? Date.parse(row.ts) || 0 : 0,
        kind: row.kind,
        query: row.query,
        ref: row.ref ?? undefined,
        image: row.image ?? undefined,
        verdict: row.verdict ?? undefined,
        score: row.score ?? undefined,
        summary: row.summary ?? "",
        coverage: row.coverage ?? undefined,
        flags: Array.isArray(row.flags) ? row.flags : [],
        contributor: row.contributor,
        canEdit: auth.role === "owner" || row.contributor_user_id === auth.userId,
      }));
      res.status(200).json({ available: true, entries });
      return;
    }

    if (req.method === "POST") {
      const parsed = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const raw: JsonRecord = parsed && typeof parsed === "object" ? (parsed as JsonRecord) : {};
      const kind = str(raw.kind, 20);
      const query = str(raw.query, 500);
      if (!kind || !query) {
        res.status(400).json({ error: "kind_and_query_required" });
        return;
      }

      const mode = raw.mode === "update" ? "update" : "append";
      const localId = str(raw.id, 120) || `${Date.now()}`;
      let clientId = `${auth.userId}:${localId}`;
      if (mode === "update" && str(raw.client_id, 200)) {
        const requestedId = str(raw.client_id, 200);
        if (auth.role !== "owner" && !requestedId.startsWith(`${auth.userId}:`)) {
          res.status(403).json({ error: "cannot_edit_another_analyst_entry" });
          return;
        }
        clientId = requestedId;
      }

      const tsNumber = typeof raw.ts === "number" && Number.isFinite(raw.ts) ? raw.ts : Date.now();
      const row = {
        organization_id: auth.organizationId,
        client_id: clientId,
        ts: new Date(tsNumber).toISOString(),
        kind,
        query,
        ref: raw.ref != null ? str(raw.ref, 500) : null,
        image: raw.image != null ? str(raw.image, 600) : null,
        verdict: raw.verdict != null ? str(raw.verdict, 40) : null,
        score: typeof raw.score === "number" && Number.isFinite(raw.score) ? raw.score : null,
        summary: str(raw.summary, 500),
        coverage: raw.coverage != null ? str(raw.coverage, 40) : null,
        flags: Array.isArray(raw.flags)
          ? raw.flags.filter((flag: unknown) => typeof flag === "string").map((flag: string) => flag.slice(0, 200)).slice(0, 30)
          : [],
        contributor: auth.displayName.slice(0, 80),
        contributor_user_id: auth.userId,
      };
      const resolution = mode === "update" ? "merge-duplicates" : "ignore-duplicates";
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?on_conflict=organization_id,client_id`,
        {
          method: "POST",
          headers: serviceHeaders(credentials.key, { prefer: `resolution=${resolution},return=minimal` }),
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        throw new Error(`audit log write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
      }
      res.status(200).json({ ok: true, clientId });
      return;
    }

    if (req.method === "DELETE") {
      const ref = str(typeof req.query.ref === "string" ? req.query.ref : "", 500);
      if (!ref) {
        res.status(400).json({ error: "ref_required" });
        return;
      }
      const bare = ref.replace(/^[@$]/, "");
      const variants = [...new Set([ref, bare, `@${bare}`, `$${bare}`])];
      for (const column of ["ref", "query"] as const) {
        for (const value of variants) {
          const response = await fetch(
            `${credentials.url}/rest/v1/${TABLE}?${orgFilter}&${column}=eq.${encodeURIComponent(value)}`,
            {
              method: "DELETE",
              headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok) throw new Error(`audit log delete failed (${response.status})`);
        }
      }
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, DELETE").json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[auditlog] failed", error);
    res.status(502).json({ error: "audit_log_store_failed", message: String(error) });
  }
}
