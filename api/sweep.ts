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

const SWEEP_MAX_DURATION_SECONDS = 120;
// Time kept back from the function ceiling so alerts persist before the
// platform kills the invocation.
const SWEEP_FINALIZATION_RESERVE_MS = 15_000;

export const config = { maxDuration: SWEEP_MAX_DURATION_SECONDS };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const startedAt = Date.now();
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  res.setHeader("cache-control", "private, no-store");
  try {
    const out = await runSweep(auth.organizationId, {
      deadlineAt: startedAt + SWEEP_MAX_DURATION_SECONDS * 1000 - SWEEP_FINALIZATION_RESERVE_MS,
    });
    if (out.unavailable) {
      // A sweep that reached no backend checked nothing. Saying so with 200
      // let a rotated credential look like a clean watchlist forever.
      res.status(503).json({ available: false, error: "sweep_backend_unavailable", checked: 0, alerts: [], note: out.note });
      return;
    }
    res.status(200).json({ available: true, ...out });
  } catch (e) {
    console.error("[sweep] failed", e instanceof Error ? e.message : e);
    res.status(502).json({ available: false, error: "sweep_failed", checked: 0, alerts: [] });
  }
}
