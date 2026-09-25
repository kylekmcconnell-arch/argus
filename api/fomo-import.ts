// Owner-controlled receipt ingestion. No paid provider calls or report rewrites.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";
import { importFomoWalletSweep } from "../server/fomoHolderStore.js";
export const config = { maxDuration: 30 };
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "private, no-store");
  if (req.method !== "POST") { res.setHeader("allow", "POST"); res.status(405).json({ error: "method_not_allowed" }); return; }
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const raw = req.body?.receipt;
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 1_000_000) {
    res.status(400).json({ error: "invalid_receipt", message: "Supply a wallet receipt smaller than 1 MB." }); return;
  }
  let observations;
  try {
    observations = importFomoWalletSweep(raw);
    if (observations.length > 250) throw new Error("Import at most 250 observations per receipt.");
  } catch (error) {
    res.status(400).json({ error: "invalid_receipt", message: error instanceof SyntaxError ? "Receipt is not valid JSON." : error instanceof Error ? error.message : "Invalid receipt." }); return;
  }
  const summary = { observations: observations.length, labelled: observations.filter(row => row.state === "reported").length,
    unlabelled: observations.filter(row => row.state === "unlabelled").length, receiptHash: observations[0]?.receiptHash ?? null,
    capturedAt: observations[0]?.capturedAt ?? null, providerCalls: 0 };
  if (req.body?.apply !== true) { res.status(200).json({ available: true, mode: "validate", ...summary }); return; }
  if (!observations.length) { res.status(400).json({ error: "no_observations", message: "No importable wallet-resolution observations." }); return; }
  const credentials = serviceCredentials();
  if (!credentials) { res.status(503).json({ available: false, message: "Workspace storage is unavailable." }); return; }
  try {
    const response = await fetch(`${credentials.url}/rest/v1/fomo_wallet_observations`, {
      method: "POST", headers: { ...serviceHeaders(credentials.key), prefer: "resolution=ignore-duplicates,return=minimal" },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify(observations.map(row => ({ organization_id: auth.organizationId, chain: row.chain, address: row.address,
        captured_at: row.capturedAt, source_url: row.sourceUrl, receipt_hash: row.receiptHash, state: row.state,
        label: row.label ?? null, twitter: row.twitter ?? null }))),
    });
    if (!response.ok) throw new Error("Storage write failed");
    res.status(200).json({ available: true, mode: "applied", ...summary,
      note: "Receipt accepted; exact duplicates are ignored. Counts describe this receipt, not newly inserted rows. Stored provider claims are not verified ownership. Existing saved reports are unchanged." });
  } catch {
    res.status(503).json({ available: false, message: "Import was not confirmed. Retrying the identical receipt is safe; do not assume that no rows were written." });
  }
}
