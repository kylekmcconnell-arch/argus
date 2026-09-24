import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { collectHolderIdentities } from "./_holder-enrichment.js";
import { tokenSubjectIdentity } from "../src/lib/tokenIdentity.js";
export const config = { maxDuration: 20 };
/** Scan-time, one subscription-backed batch for at most 25 exact addresses. No Fomo calls. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "POST") { res.status(405).json({ error: "method_not_allowed" }); return; }
  const { chain, addresses } = req.body ?? {};
  if (typeof chain !== "string" || !Array.isArray(addresses) || !addresses.length || addresses.length > 25
    || addresses.some(a => typeof a !== "string" || !tokenSubjectIdentity(chain, a))) {
    res.status(400).json({ error: "up_to_25_valid_chain_addresses_required" }); return;
  }
  try { res.status(200).json(await collectHolderIdentities(chain, addresses, auth.organizationId)); }
  catch { res.status(503).json({ error: "holder_enrichment_unavailable" }); }
}
