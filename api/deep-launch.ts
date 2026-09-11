import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireArgusAuth, serviceCredentials, serviceHeaders } from './_auth.js';
import { payloadTokenIdentity } from '../src/lib/tokenIdentity.js';
import { researchLaunch, validateResearch, VERSION } from '../skills/robinhood-chain-research-analyst/scripts/research.mjs';

export const config = { maxDuration: 60 };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'method_not_allowed' }); return; }
  const auth = await requireArgusAuth(req, res, req.method === 'POST' ? 'analyst' : 'viewer');
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) { res.status(503).json({ error: 'research_storage_unavailable' }); return; }
  const version = req.method === 'POST' ? req.body?.reportVersionId : req.query.reportVersionId;
  if (typeof version !== 'string' || !UUID.test(version)) { res.status(400).json({ error: 'immutable_report_version_required' }); return; }
  const filter = `organization_id=eq.${auth.organizationId}&report_version_id=eq.${version}`;
  const db = async (path: string, init: RequestInit = {}) => {
    const r = await fetch(`${credentials.url}/rest/v1/${path}`, { ...init,
      headers: serviceHeaders(credentials.key, { prefer: 'return=representation' }), signal: AbortSignal.timeout(5_000) });
    if (!r.ok) throw new Error('research_storage_unavailable');
    return r.status === 204 ? null : r.json();
  };
  let runId: string | null = null;
  try {
    const rows = await db(`report_versions?select=case_id,payload&organization_id=eq.${auth.organizationId}&id=eq.${version}&limit=1`);
    if (!rows[0]) { res.status(404).json({ error: 'report_not_found' }); return; }
    const cases = await db(`cases?select=kind,status&organization_id=eq.${auth.organizationId}&id=eq.${rows[0].case_id}&limit=1`);
    if (!cases[0]) { res.status(404).json({ error: 'report_not_found' }); return; }
    const target = payloadTokenIdentity(cases[0].kind, rows[0].payload);
    if (target?.chain !== 'robinhood') { res.status(422).json({ error: 'robinhood_report_required' }); return; }
    if (req.method === 'POST' && cases[0].status !== 'open') { res.status(409).json({ error: 'case_archived' }); return; }
    const latest = () => db(`deep_launch_runs?select=run_id,state,result,started_at,finished_at&${filter}&tool_version=eq.${VERSION}&order=started_at.desc&limit=1`);
    const savedAnalysis = async () => {
      const run = (await latest())[0] ?? null;
      // Keep the latest attempt visible, but do not let an outage erase the
      // previous usable snapshot. It remains separately dated evidence.
      const previousRun = run && run.state !== 'completed'
        ? (await db(`deep_launch_runs?select=run_id,state,result,started_at,finished_at&${filter}&tool_version=eq.${VERSION}&state=eq.completed&order=started_at.desc&limit=1`))[0] ?? null
        : null;
      return { run, previousRun };
    };
    if (req.method === 'GET') { res.status(200).json(await savedAnalysis()); return; }
    runId = await db('rpc/claim_deep_launch', { method: 'POST', body: JSON.stringify({ p_org: auth.organizationId, p_version: version, p_user: auth.userId, p_tool: VERSION, p_retry: req.body?.retryMissing === true }) });
    if (!runId) {
      const saved = await savedAnalysis();
      res.status(saved.run?.state === 'running' ? 202 : 200).json({ ...saved, reused: true }); return;
    }
    // The browser can select only an authenticated saved version. Endpoints and
    // target identity are server-derived, never accepted from request fields.
    const result = validateResearch(await researchLaunch({ chain: target.chain, address: target.address }, {
      rpcUrl: process.env.ROBINHOOD_RPC_URL,
      archiveRpcUrl: process.env.ROBINHOOD_ARCHIVE_RPC_URL,
    }));
    const saved = await db(`deep_launch_runs?run_id=eq.${runId}&${filter}&state=eq.running`, { method: 'PATCH', body: JSON.stringify({
      state: result.status === 'unavailable' ? 'failed' : 'completed', result, finished_at: new Date().toISOString(),
    }) });
    if (!saved[0]) throw new Error('research_save_failed');
    res.status(200).json({ run: saved[0] });
  } catch {
    if (runId) await db(`deep_launch_runs?run_id=eq.${runId}&${filter}&state=eq.running`, {
      method: 'PATCH', body: JSON.stringify({ state: 'failed', finished_at: new Date().toISOString() }),
    }).catch(() => null);
    res.status(503).json({ error: 'research_unavailable', message: 'Research could not finish or save. Reload saved analysis before retrying.' });
  }
}
