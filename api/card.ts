// Share-link unfurl route. Crawlers (Telegram/X/Discord) read the OG meta and
// render the card image from /api/og; humans are redirected into the SPA.
// Params are passed by the Share button (no audit needed on crawl).
import type { VercelRequest, VercelResponse } from "@vercel/node";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export default function handler(req: VercelRequest, res: VercelResponse) {
  const q = req.query as Record<string, string>;
  const kind = q.k === "person" ? "person" : "token";
  const ref = q.t || q.id || "";
  const title = q.title || ref;
  const verdict = (q.v || "").toUpperCase();
  const score = q.sc || "";
  const sub = q.s || "";
  const chip = kind === "token" ? "TOKEN AUDIT" : "PRINCIPAL AUDIT";

  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const host = req.headers["host"];
  const base = `${proto}://${host}`;

  const ogParams = new URLSearchParams({ k: kind, t: title, v: verdict || "PASS", sc: score, s: sub, c: chip });
  const ogImage = `${base}/api/og?${ogParams.toString()}`;

  // where a human should land
  const appUrl = kind === "token" ? `/?t=${encodeURIComponent(ref)}` : `/?s=${encodeURIComponent(ref.replace(/^@/, ""))}`;

  const heading = kind === "token" ? `$${title.replace(/^\$/, "")}` : title;
  const ogTitle = `${heading} — ${verdict || "audit"}${score ? ` · ${score}/100` : ""} · ARGUS`;
  const ogDesc = sub || "Forensic due-diligence: tokens audited on-chain, people on their evidence.";

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
<title>${esc(ogTitle)}</title>
<meta name="description" content="${esc(ogDesc)}"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${esc(ogTitle)}"/>
<meta property="og:description" content="${esc(ogDesc)}"/>
<meta property="og:image" content="${esc(ogImage)}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${esc(ogTitle)}"/>
<meta name="twitter:description" content="${esc(ogDesc)}"/>
<meta name="twitter:image" content="${esc(ogImage)}"/>
<meta http-equiv="refresh" content="0; url=${esc(appUrl)}"/>
<script>location.replace(${JSON.stringify(appUrl)});</script>
</head><body style="background:#fafafa;font-family:sans-serif;color:#52525b">Opening ARGUS…</body></html>`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=300");
  res.status(200).send(html);
}
