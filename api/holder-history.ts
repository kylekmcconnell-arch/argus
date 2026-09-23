import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import { tokenSubjectIdentity } from "../src/lib/tokenIdentity.js";

export const config = { maxDuration: 15 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "viewer");
  if (!auth) return;
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "GET") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const identity = tokenSubjectIdentity(req.query.chain, req.query.token);
  if (!identity) { res.status(400).json({ error: "valid_chain_and_token_required" }); return; }
  const credentials = serviceCredentials();
  if (!credentials) { res.status(200).json({ available: false, note: "Holder history storage is not configured." }); return; }
  const limit = 1000;
  const query = new URLSearchParams({
    select: "report_version_id,attestation_state,saved_at,captured_at,provider,source_url,coverage,registry_version,wallet_address,observation",
    organization_id: `eq.${auth.organizationId}`, chain: `eq.${identity.chain}`, token_address: `eq.${identity.address}`,
    order: "saved_at.desc", limit: String(limit),
  });
  try {
    const response = await fetch(`${credentials.url}/rest/v1/holder_observations?${query}`, { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(10000) });
    if (!response.ok) { res.status(200).json({ available: false, note: "Holder history could not be read. This is not an empty history." }); return; }
    const rows = await response.json();
    if (!Array.isArray(rows)) { res.status(200).json({ available: false, note: "Holder history returned an unusable response." }); return; }
    res.status(200).json({ available: true, chain: identity.chain, token: identity.address, rows,
      truncated: rows.length === limit,
      note: "Observations from reports saved in this workspace. A missing wallet may have fallen below the captured ranks; it has not necessarily exited. Changes in supply share do not establish buys or sales.",
    });
  } catch { res.status(200).json({ available: false, note: "Holder history was unavailable." }); }
}
