// A project account's own recent posts. GET /api/x-posts?handle=<x handle>
//
// The shipping panel grades "we launched X" against the commit log, and the
// social-activity snapshot holds mentions OF the project, not posts BY it. This
// wraps the collector's last_tweets reader (server/adapters/x.ts) so the panel
// can join the project's own words. Paid provider (twitterapi.io), so it is
// panel-metered like the other deep tools.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, resolvePanelCostVersion } from "./_cache.js";
import { getRecentPostsMeta } from "./_collector.js";

export const config = { maxDuration: 20 };

const HANDLE_RE = /^[A-Za-z0-9_]{1,30}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const panelTokenHeader = req.headers["x-argus-panel-token"];
  const panelToken = Array.isArray(panelTokenHeader) ? panelTokenHeader[0] : panelTokenHeader;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelToken);
  if (!panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }
  const handle = (typeof req.query.handle === "string" ? req.query.handle : "").replace(/^@/, "").trim();
  if (!HANDLE_RE.test(handle)) { res.status(400).json({ error: "handle required" }); return; }
  if (!process.env.TWITTERAPI_KEY) { res.status(200).json({ handle, available: false, posts: [], note: "X provider not configured." }); return; }

  let status: "succeeded" | "failed" = "succeeded";
  try {
    const posts = await getRecentPostsMeta(handle, 60);
    res.status(200).json({
      handle,
      available: true,
      posts: posts
        .filter((p) => Number.isFinite(p.createdAt) && p.text)
        .map((p) => ({ date: new Date(p.createdAt).toISOString(), text: p.text, url: `https://x.com/${handle}` })),
      note: posts.length ? `${posts.length} recent posts by @${handle}.` : `No recent posts were returned for @${handle}.`,
    });
  } catch (e) {
    status = "failed";
    res.status(200).json({ handle, available: false, posts: [], error: String(e), note: "The project's posts could not be read." });
  } finally {
    await attachPanelCost(auth.organizationId, panelCostVersionId, {
      provider: "twitterapi",
      op: "panel:x-posts",
      calls: 1,
      usd: 0.0015,
      meta: "last_tweets",
      initiatedBy: auth.userId,
      status,
    });
  }
}
