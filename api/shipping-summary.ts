// Scan-time shipping summary. GET /api/shipping-summary?org=<org>|repo=<owner/name>
//
// The cheap lane the token audit calls while it runs, so a saved report carries
// a frozen development read (grade, cadence, who, live, adoption, health) that
// the engine can score, the checklist can close, the PDF can print and the next
// scan can diff. No panel token: like site-safety and technical-posture it sits
// behind the middleware bearer gate, and it costs GitHub calls, not dollars.
// The full assessment with the roster and evidence stays on the paid panel.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { assessShipping, summarizeShipping, type ShippingPeerRepo, type ShippingSummary } from "../src/threat/shipping.js";
import { collectShipping, GITHUB_LOGIN_RE, GITHUB_REPO_RE, type CallCounter } from "../src/threat/shippingCollect.js";

export const config = { maxDuration: 30 };

const CACHE_BUCKET_MS = 6 * 3600 * 1000;

export interface ShippingSummaryResponse {
  target: string;
  available: boolean;
  summary?: ShippingSummary;
  note: string;
  _cached?: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.GITHUB_TOKEN;
  const org = typeof req.query.org === "string" ? req.query.org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "").trim() : "";
  const repoParam = typeof req.query.repo === "string" ? req.query.repo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").trim() : "";
  const target = repoParam || org;
  if (!target || !(repoParam ? GITHUB_REPO_RE.test(repoParam) : GITHUB_LOGIN_RE.test(target))) { res.status(400).json({ error: "org or repo required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." } satisfies ShippingSummaryResponse); return; }

  const ck = `ghsummary:${target.toLowerCase()}:${Math.floor(Date.now() / CACHE_BUCKET_MS)}:v1`;
  const cached = await cacheGetJson<ShippingSummaryResponse>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const peerCache = {
      get: (k: string) => cacheGetJson<ShippingPeerRepo[]>(k),
      set: (k: string, rows: ShippingPeerRepo[]) => cacheSetJson(k, rows),
    };
    const input = await collectShipping({ target, kind: repoParam ? "repo" : "org", key, usage, peerCache });
    const assessment = assessShipping(input);
    const summary = summarizeShipping(assessment, new Date().toISOString());
    const out: ShippingSummaryResponse = {
      target,
      available: true,
      summary,
      note: input.repos.length ? assessment.headline : "No public repositories found for this account.",
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    const msg = String(e);
    res.status(200).json({ target, available: false, note: /owner_not_found/.test(msg) ? "No GitHub account or organization exists at that name." : "GitHub shipping summary did not complete." } satisfies ShippingSummaryResponse);
  }
}
