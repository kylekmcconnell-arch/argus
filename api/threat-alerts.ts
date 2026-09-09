import { requireArgusAuth } from "./_auth.js";
import { withLedgerOrganization } from "./_ledger.js";
// Verdict-flip alerts feed. GET /api/threat-alerts
//
// The tokens we rated tradeable that then lost their liquidity — surfaced from
// the shared ledger (populated by the re-check cron). Returns empty/av=false
// when no store is configured, so the client degrades cleanly.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ledgerAvailable, ledgerRecentAlerts } from "./_ledger.js";

export const config = { maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  return withLedgerOrganization(auth.organizationId, async () => {

  if (!ledgerAvailable()) { res.status(200).json({ available: false, alerts: [] }); return; }
  const alerts = await ledgerRecentAlerts(60);
  res.status(200).json({ available: true, alerts });
  }).catch(() => { res.status(503).json({ available: false, error: "threat_ledger_unavailable" }); });
}
