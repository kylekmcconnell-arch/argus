import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders, reserveSupplementalBudget, rejectSupplementalReservation } from "./_auth.js";
import { recordProviderUsageBatch } from "./_cache.js";
import { loadExactVersionReport } from "./report.js";
import { collectPersonResearch } from "../server/personResearch.js";
import { personResearchIdentity } from "../src/lib/personResearch.js";
import type { WebTeamMember } from "../src/data/evidence.js";
export const config = { maxDuration: 120 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (!["GET", "POST"].includes(req.method ?? "")) { res.status(405).end(); return; }
  const auth = await requireArgusAuth(req, res, req.method === "POST" ? "analyst" : "viewer");
  if (!auth) return;
  const input = req.method === "GET" ? req.query : req.body;
  const versionId = String(input?.reportVersionId ?? "");
  const name = String(input?.name ?? ""); const role = String(input?.role ?? "");
  if (!UUID.test(versionId) || !name || name.length > 160 || role.length > 200) { res.status(400).json({ error: "invalid_person_context" }); return; }
  const credentials = serviceCredentials();
  if (!credentials) { res.status(503).json({ error: "storage_unavailable" }); return; }
  try {
    const loaded = await loadExactVersionReport(credentials, auth.organizationId, versionId);
    const payload = loaded?.report.payload as { webTeam?: WebTeamMember[]; display_name?: string } | undefined;
    const matches = payload?.webTeam?.filter(member => member.name === name && member.role === role && member.kind !== "org") ?? [];
    if (matches.length !== 1) { res.status(404).json({ error: "unique_saved_person_required" }); return; }
    const member = matches[0]; const memberKey = JSON.stringify([name, role]);
    const identityKey = personResearchIdentity(member);
    const headers = serviceHeaders(credentials.key);
    const query = new URLSearchParams({ organization_id: `eq.${auth.organizationId}`, report_version_id: `eq.${versionId}`, member_key: `eq.${memberKey}`, order: "created_at.desc", limit: "5", select: "id,status,payload,created_at" });
    if (req.method === "GET") {
      const rows = await fetch(`${credentials.url}/rest/v1/person_research_runs?${query}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!rows.ok) throw new Error("storage");
      const runs = await rows.json();
      const relatedQuery = new URLSearchParams({ organization_id: `eq.${auth.organizationId}`, identity_key: `eq.${identityKey}`, report_version_id: `neq.${versionId}`, status: "eq.complete", order: "created_at.desc", limit: "10", select: "id,report_version_id,payload,created_at" });
      let related: unknown[] = []; let historyAvailable = !identityKey;
      if (identityKey) {
        const history = await fetch(`${credentials.url}/rest/v1/person_research_runs?${relatedQuery}`, { headers, signal: AbortSignal.timeout(8000) });
        if (history.ok) { const body = await history.json(); if (Array.isArray(body)) { related = body; historyAvailable = true; } }
      }
      res.status(200).json({ runs, related, historyAvailable, identityKey }); return;
    }
    const key = process.env.SERPER_API_KEY;
    if (!key) { res.status(503).json({ error: "background_search_unavailable" }); return; }
    const runId = String(input?.runId ?? "");
    if (!UUID.test(runId)) { res.status(400).json({ error: "run_id_required" }); return; }
    const claim = await fetch(`${credentials.url}/rest/v1/person_research_runs`, { method: "POST", headers, body: JSON.stringify({ id: runId, organization_id: auth.organizationId, report_version_id: versionId, member_key: memberKey, identity_key: identityKey, status: "running" }), signal: AbortSignal.timeout(8000) });
    if (!claim.ok) { res.status(claim.status === 409 ? 409 : 503).json({ error: "research_not_started", message: "This request may already exist. Read saved research before retrying." }); return; }
    const finish = async (status: string, result?: unknown) => {
      const saved = await fetch(`${credentials.url}/rest/v1/person_research_runs?id=eq.${runId}&organization_id=eq.${auth.organizationId}&status=eq.running`, { method: "PATCH", headers, body: JSON.stringify({ status, ...(result ? { payload: result } : {}) }), signal: AbortSignal.timeout(8000) });
      if (!saved.ok) throw new Error("save");
    };
    const reservation = await reserveSupplementalBudget(auth, "/api/person-research");
    if (!reservation.allowed) { await finish("failed"); rejectSupplementalReservation(res, reservation); return; }
    const result = await collectPersonResearch(member, payload?.display_name ?? "", key);
    await recordProviderUsageBatch(auth.organizationId, versionId, auth.userId, [{ provider: "serper", op: "person-background", calls: result.searches.length, usd: result.searches.length * 0.001, status: result.searches.some(row => row.status === "failed") ? "partial" : "succeeded", idempotencyKey: runId, meta: "At most four searches; list-price estimate, not a settled invoice." }]);
    await finish("complete", result);
    res.status(200).json({ runId, result });
  } catch { res.status(503).json({ error: "person_research_unavailable", message: "Research could not be completed or saved. Read saved research before retrying; this is not an empty history." }); }
}
