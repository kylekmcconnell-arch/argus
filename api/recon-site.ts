// Server-side raw-HTML retrieval for the site-scan lane. GET /api/recon-site?url=<page>
//
// The recon pipeline runs in the browser, where a direct fetch of almost any
// third-party origin is CORS-blocked. That starved the lane of raw markup: no
// anchor hrefs, so a footer of icon-only social links ("Find us on X") read as
// "no social links on the page", and the bridge to the full audit — gated on an
// official account being found — silently never appeared (issue #464, Dynex).
//
// This endpoint is the same bounded, SSRF-guarded public fetch every server
// adapter uses (validated public origins only, redirect hop guards, byte cap).
// It returns raw markup for the client to classify; it never renders, never
// follows the page's links, and never proxies query-bearing URLs anywhere.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchPublicText } from "../server/publicWeb.js";
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 25 };

// A stored page is read for its links and text, not archived: 600k chars keeps
// every real footer while a pathological page cannot balloon the response.
const MAX_HTML_CHARS = 600_000;

type ReconSiteBody =
  | { status: "ok"; url: string; html: string }
  | { status: "failed"; reason: string };

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET") {
    res.status(405).json({ status: "failed", reason: "method_not_allowed" });
    return;
  }
  const raw = typeof req.query.url === "string" ? req.query.url.trim() : "";
  if (!raw || raw.length > 2048) {
    res.status(400).json({ status: "failed", reason: "missing_or_oversized_url" });
    return;
  }

  const cacheKey = `recon-site:${raw.toLowerCase()}`;
  const cached = await cacheGetJson<ReconSiteBody>(cacheKey);
  if (cached) {
    res.status(200).json(cached);
    return;
  }

  const read = await fetchPublicText(raw);
  const body: ReconSiteBody = read.status === "ok"
    ? { status: "ok", url: read.url, html: read.text.slice(0, MAX_HTML_CHARS) }
    : { status: "failed", reason: read.reason };
  // Only a successful read is cached: the shared cache TTL is hours long, and
  // a transient outage must not pin a site as unreadable for that long. The
  // client escalates a failure to its rendering crawler either way.
  if (body.status === "ok") await cacheSetJson(cacheKey, body);
  res.status(200).json(body);
}
