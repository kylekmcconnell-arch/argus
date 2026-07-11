// Authenticated, organization-scoped shared trust graph.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";

export const config = { maxDuration: 15 };

const TABLE = "graph_contributions";
const READ_LIMIT = 500;
const MAX_NODES = 4_000;
const MAX_EDGES = 4_000;
const MAX_BODY = 1_500_000;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
type JsonRecord = Record<string, unknown>;

interface GraphRow {
  handle?: unknown;
  aliases?: unknown;
  verdict?: unknown;
  nodes?: unknown;
  edges?: unknown;
}

function canonical(raw: string): string {
  const value = String(raw).trim();
  const typed = value.match(/^(token|wallet):([^:]+):(.+)$/i);
  if (typed) {
    const type = typed[1].toLowerCase();
    const chain = typed[2].trim().toLowerCase();
    const address = typed[3].trim();
    return `${type}:${chain}:${chain === "solana" ? address : address.toLowerCase()}`;
  }
  if (SOLANA_ADDRESS.test(value)) return value;
  const lower = value.toLowerCase().replace(/\s+/g, "");
  if (lower.startsWith("$")) return lower;
  return lower.replace(/^@/, "");
}

function subjectKey(raw: JsonRecord, nodes: unknown[]): string {
  const subject = nodes.find((node) => {
    const record = node && typeof node === "object" ? node as JsonRecord : null;
    return record?.subject === true && typeof record.key === "string";
  });
  const record = subject && typeof subject === "object" ? subject as JsonRecord : null;
  return canonical((typeof record?.key === "string" ? record.key : null) || (typeof raw.handle === "string" ? raw.handle : ""));
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
        `${credentials.url}/rest/v1/${TABLE}?select=handle,aliases,verdict,nodes,edges&${orgFilter}&order=updated_at.desc&limit=${READ_LIMIT}`,
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
      const canonicalKey = subjectKey(raw, nodes);
      if (!handle || !canonicalKey || !nodes.length) {
        res.status(400).json({ error: "handle_and_subject_nodes_required" });
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
      const handle = typeof req.query.handle === "string" ? req.query.handle.trim().slice(0, 500) : "";
      if (!handle) {
        res.status(400).json({ error: "handle_required" });
        return;
      }
      const response = await fetch(
        `${credentials.url}/rest/v1/${TABLE}?${orgFilter}&canonical_key=eq.${encodeURIComponent(canonical(handle))}`,
        {
          method: "DELETE",
          headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) throw new Error(`graph delete failed (${response.status})`);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, DELETE").json({ error: "method_not_allowed" });
  } catch (error) {
    console.error("[graph] failed", error);
    res.status(502).json({ error: "graph_store_failed", message: String(error) });
  }
}
