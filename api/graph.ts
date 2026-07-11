// Authenticated, organization-scoped shared trust graph.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import { canonicalGraphKey, graphSubjectKey } from "./_graph.js";

export const config = { maxDuration: 15 };

const TABLE = "graph_contributions";
const READ_LIMIT = 500;
const MAX_NODES = 4_000;
const MAX_EDGES = 4_000;
const MAX_BODY = 1_500_000;
type JsonRecord = Record<string, unknown>;

interface GraphRow {
  handle?: unknown;
  aliases?: unknown;
  verdict?: unknown;
  nodes?: unknown;
  edges?: unknown;
  report_version_id?: unknown;
  provenance_state?: unknown;
}

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
        `${credentials.url}/rest/v1/${TABLE}?select=handle,aliases,verdict,nodes,edges,report_version_id,provenance_state&${orgFilter}&order=updated_at.desc&limit=${READ_LIMIT}`,
        { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error(`graph read failed (${response.status})`);
      const rows = (await response.json()) as GraphRow[];
      const contributions = (Array.isArray(rows) ? rows : []).map((row) => ({
        handle: row.handle,
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
        verdict: row.verdict ?? undefined,
        nodes: Array.isArray(row.nodes) ? row.nodes : [],
        edges: Array.isArray(row.edges) ? row.edges : [],
        reportVersionId: typeof row.report_version_id === "string" ? row.report_version_id : undefined,
        provenanceState: typeof row.provenance_state === "string" ? row.provenance_state : "legacy",
      }));
      res.status(200).json({ available: true, contributions });
      return;
    }

    if (req.method === "POST") {
      const parsed = typeof req.body === "string" ? safeParse(req.body) : req.body;
      const raw: JsonRecord = parsed && typeof parsed === "object" ? parsed as JsonRecord : {};
      if (JSON.stringify(raw).length > MAX_BODY) {
        res.status(413).json({ error: "contribution_too_large" });
        return;
      }
      const handle = typeof raw.handle === "string" ? raw.handle.trim().slice(0, 500) : "";
      const nodes = Array.isArray(raw.nodes) ? raw.nodes.slice(0, MAX_NODES) : [];
      const edges = Array.isArray(raw.edges) ? raw.edges.slice(0, MAX_EDGES) : [];
      const aliases = Array.isArray(raw.aliases)
        ? raw.aliases.filter((item: unknown) => typeof item === "string").map((item: string) => item.slice(0, 300)).slice(0, 30)
        : [];
      const canonicalKey = graphSubjectKey(raw, nodes);
      if (!handle || !canonicalKey || !nodes.length) {
        res.status(400).json({ error: "handle_and_subject_nodes_required" });
        return;
      }
      const existingResponse = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?select=provenance_state&${orgFilter}&canonical_key=eq.${encodeURIComponent(canonicalGraphKey(canonicalKey))}&limit=1`,
        { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10_000) },
      );
      if (!existingResponse.ok) throw new Error(`graph provenance read failed (${existingResponse.status})`);
      const existingRows = await existingResponse.json() as Array<{ provenance_state?: unknown }>;
      if (existingRows[0]?.provenance_state === "server_collected") {
        res.status(200).json({ ok: true, canonicalKey, preserved: true });
        return;
      }
      const row = {
        organization_id: auth.organizationId,
        canonical_key: canonicalKey,
        handle,
        aliases,
        verdict: typeof raw.verdict === "string" ? raw.verdict.slice(0, 40) : null,
        nodes,
        edges,
        contributor: auth.displayName.slice(0, 80),
        contributor_user_id: auth.userId,
        provenance_state: "client_submitted",
      };
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?on_conflict=organization_id,canonical_key`,
        {
          method: "POST",
          headers: serviceHeaders(credentials.key, { prefer: "resolution=merge-duplicates,return=minimal" }),
          body: JSON.stringify(row),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        throw new Error(`graph write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
      }
      res.status(200).json({ ok: true, canonicalKey });
      return;
    }

    if (req.method === "DELETE") {
      res.status(410).json({
        error: "graph_history_deletion_disabled",
        message: "Trust-graph intelligence is retained when a case is archived.",
      });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, DELETE").json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[graph] failed", error);
    res.status(502).json({ error: "graph_store_failed", message: String(error) });
  }
}
