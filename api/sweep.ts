// Manual watchlist sweep. GET /api/sweep -> { checked, alerts }
//
// Deliberately NOT scheduled: there is no cron and no background monitoring —
// this runs only when an analyst presses "Sweep now" on the Watchlist page.
// (If scheduled monitoring is ever wanted, it's a vercel.json cron entry away.)
import type { VercelRequest, VercelResponse } from "@vercel/node";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — bundled ESM sibling (api functions can't import server/*.ts directly)
import { runSweep } from "./_sweep.js";

export const config = { maxDuration: 120 };

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  try {
    const out = await runSweep();
    res.status(200).json({ available: true, ...out });
  } catch (e) {
    res.status(200).json({ available: true, checked: 0, alerts: [], error: String(e) });
  }
}
