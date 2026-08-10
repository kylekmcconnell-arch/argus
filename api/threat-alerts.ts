// Verdict-flip alerts feed. GET /api/threat-alerts
//
// The tokens we rated tradeable that then lost their liquidity — surfaced from
// the shared ledger (populated by the re-check cron). Returns empty/av=false
// when no store is configured, so the client degrades cleanly.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { ledgerAvailable, ledgerRecentAlerts } from "./_ledger.js";

export const config = { maxDuration: 15 };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  if (!ledgerAvailable()) { res.status(200).json({ available: false, alerts: [] }); return; }
  const alerts = await ledgerRecentAlerts(60);
  res.status(200).json({ available: true, alerts });
}
