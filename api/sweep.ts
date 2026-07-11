// Manual watchlist sweep. GET /api/sweep -> { checked, alerts }
//
// Deliberately NOT scheduled: there is no cron and no background monitoring —
// this runs only when an analyst presses "Sweep now" on the Watchlist page.
// (If scheduled monitoring is ever wanted, it's a vercel.json cron entry away.)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bundled ESM sibling (api functions can't import server/*.ts directly)
import { runSweep } from "./_sweep.js";

export const config = { maxDuration: 120 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  try {
    const out = await runSweep(auth.organizationId);
    res.status(200).json({ available: true, ...out });
  } catch (e) {
    res.status(200).json({ available: true, checked: 0, alerts: [], error: String(e) });
  }
}
