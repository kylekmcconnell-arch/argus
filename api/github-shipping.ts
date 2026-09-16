// Shipping assessment. GET /api/github-shipping?org=<org>|login=<user>[&sector=<id>][&repo=<owner/name>]
//
// The paid, on-click read behind the report panel. Fetching lives in
// src/threat/shippingCollect.ts and the judgement in src/threat/shipping.ts;
// this handler adds auth, panel metering and a six-hour cache, and returns the
// normalised input beside the assessment so the panel can re-run the judgement
// with the price series, deployer history, posts, docs, previous summary and
// stage cohort joined in.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth } from "./_auth.js";
import { attachPanelCost, cacheGetJson, cacheSetJson, resolvePanelCostVersion } from "./_cache.js";
import { assessShipping, type ShippingPeerRepo } from "../src/threat/shipping.js";
import { collectShipping, GITHUB_LOGIN_RE, GITHUB_REPO_RE, type CallCounter } from "../src/threat/shippingCollect.js";
import { peerSectorById } from "../src/threat/shippingPeers.js";

export const config = { maxDuration: 30 };

const CACHE_BUCKET_MS = 6 * 3600 * 1000;

export { collectShipping };

export const peerCache = {
  get: (key: string) => cacheGetJson<ShippingPeerRepo[]>(key),
  set: (key: string, rows: ShippingPeerRepo[]) => cacheSetJson(key, rows),
};

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

  const key = process.env.GITHUB_TOKEN;
  const login = typeof req.query.login === "string" ? req.query.login.replace(/^@/, "").trim() : "";
  const org = typeof req.query.org === "string" ? req.query.org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "").trim() : "";
  const repoParam = typeof req.query.repo === "string" ? req.query.repo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").trim() : "";
  const sector = peerSectorById(typeof req.query.sector === "string" ? req.query.sector : "");
  const target = repoParam || login || org;
  if (!target || !(repoParam ? GITHUB_REPO_RE.test(repoParam) : GITHUB_LOGIN_RE.test(target))) { res.status(400).json({ error: "org, login or repo required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." }); return; }

  // Six-hour buckets in the key: the shared cache keeps entries for a day, and
  // a shipping read older than that would say "shipping" about a repo that
  // went quiet this morning.
  const ck = `ghship:${target.toLowerCase()}:${sector?.id ?? "none"}:${Math.floor(Date.now() / CACHE_BUCKET_MS)}:v2`;
  const cached = await cacheGetJson<Record<string, unknown>>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const input = await collectShipping({ target, kind: repoParam ? "repo" : login ? "user" : "org", key, usage, sector, peerCache });
    const assessment = assessShipping(input);
    const out = {
      target,
      available: true,
      reposScanned: input.repos.map((r) => r.nameWithOwner),
      historyRepos: [...new Set(input.commits.map((c) => c.repo))],
      input,
      assessment,
      note: input.repos.length ? assessment.headline : "No public repositories found for this account.",
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    const msg = String(e);
    res.status(200).json({ target, available: false, error: msg, note: /owner_not_found/.test(msg) ? "No GitHub account or organization exists at that name." : "GitHub shipping assessment did not complete." });
  } finally {
    if (usage.calls > 0) {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "github",
        op: "panel:github-shipping",
        calls: usage.calls,
        usd: 0,
        meta: "subscription/keyed",
        initiatedBy: auth.userId,
        status: usage.succeeded === usage.calls ? "succeeded" : usage.succeeded > 0 ? "partial" : "failed",
      });
    }
  }
}
