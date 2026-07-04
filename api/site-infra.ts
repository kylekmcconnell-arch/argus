// Site-infrastructure operator linking. GET /api/site-infra?domain=<host>
//
// On-chain forensics link operators by shared wallets; this does the same OFF
// chain, for the project's WEBSITE. Three free signals, each a way one operator
// leaves the same print on many sites:
//   1. Analytics / monetization IDs (Google Analytics, GTM, AdSense, Meta Pixel)
//      pulled from the page source — you don't share a GA property or an AdSense
//      payout account with unrelated projects, so a shared ID is a hard operator
//      tie. These also become graph bridge nodes, so two ARGUS-audited sites that
//      share an ID collapse into one operator automatically.
//   2. Co-registered domains via Certificate Transparency (certspotter) — sibling
//      apexes issued alongside the target reveal a domain stable behind one hand.
//   3. Hosting neighbours via urlscan (shared IP / ASN) — high-signal only when
//      the site isn't behind a shared CDN, which we detect and down-rank.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 25 };

// Registrable apex without a full public-suffix list — good enough to tell a
// sibling apex from a subdomain of the target.
const MULTI = new Set(["co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "com.br", "com.cn", "co.jp", "co.kr", "co.in", "com.mx", "com.sg", "com.hk", "co.za", "com.tr", "com.ua", "com.hr"]);
function apex(host: string): string {
  const p = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(".");
  if (p.length <= 2) return p.join(".");
  const last2 = p.slice(-2).join(".");
  return MULTI.has(last2) ? p.slice(-3).join(".") : last2;
}
const isCdn = (s: string) => /cloudflare|fastly|akamai|amazon|cloudfront|\bgoogle\b|vercel|netlify|incapsula|sucuri|azure|microsoft|gcore|bunny|stackpath|cachefly|edgecast/i.test(s || "");

type Fingerprint = { kind: "ga" | "gtm" | "adsense" | "fbpixel" | "yandex" | "hotjar" | "favicon"; id: string; label: string };

async function fingerprints(host: string): Promise<Fingerprint[]> {
  const out: Fingerprint[] = [];
  try {
    const r = await fetch(`https://${host}/`, { headers: { "user-agent": "Mozilla/5.0 (ARGUS due-diligence)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    const html = (await r.text()).slice(0, 900_000);
    const seen = new Set<string>();
    const add = (kind: Fingerprint["kind"], id: string, label: string) => { const k = kind + ":" + id; if (id && !seen.has(k)) { seen.add(k); out.push({ kind, id, label }); } };
    for (const m of html.matchAll(/\bG-[A-Z0-9]{6,12}\b/g)) add("ga", m[0], "Google Analytics 4");
    for (const m of html.matchAll(/\bUA-\d{4,10}-\d{1,4}\b/g)) add("ga", m[0], "Universal Analytics");
    for (const m of html.matchAll(/\bGTM-[A-Z0-9]{5,9}\b/g)) add("gtm", m[0], "Google Tag Manager");
    for (const m of html.matchAll(/\bca-pub-\d{10,20}\b/g)) add("adsense", m[0], "Google AdSense");
    for (const m of html.matchAll(/fbq\(\s*['"]init['"]\s*,\s*['"](\d{9,20})['"]/g)) add("fbpixel", m[1], "Meta Pixel");
    for (const m of html.matchAll(/ym\(\s*(\d{6,10})\s*,/g)) add("yandex", m[1], "Yandex Metrica");
    for (const m of html.matchAll(/hjid\s*[:=]\s*(\d{5,10})/g)) add("hotjar", m[1], "Hotjar");
  } catch { /* page unreachable — the other signals still run */ }
  // Favicon hash: a reused custom favicon is a soft operator print (templated rugs).
  try {
    const f = await fetch(`https://${host}/favicon.ico`, { signal: AbortSignal.timeout(6000) });
    if (f.ok) {
      const buf = Buffer.from(await f.arrayBuffer());
      // Skip trivially-empty / default responses.
      if (buf.length > 120) out.push({ kind: "favicon", id: createHash("sha1").update(buf).digest("hex").slice(0, 16), label: "favicon" });
    }
  } catch { /* optional */ }
  return out;
}

async function ctSiblings(host: string): Promise<{ siblings: string[]; subdomainCount: number }> {
  const target = apex(host);
  try {
    const r = await fetch(`https://api.certspotter.com/v1/issuances?domain=${encodeURIComponent(target)}&include_subdomains=true&expand=dns_names`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return { siblings: [], subdomainCount: 0 };
    const rows = (await r.json()) as { dns_names?: string[] }[];
    const names = new Set<string>();
    for (const row of rows) for (const n of row.dns_names ?? []) names.add(n.replace(/^\*\./, "").toLowerCase());
    const siblings = new Set<string>();
    let sub = 0;
    for (const n of names) {
      if (n.includes("*")) continue;
      if (apex(n) === target) sub++;
      else siblings.add(apex(n));
    }
    return { siblings: [...siblings].slice(0, 15), subdomainCount: sub };
  } catch { return { siblings: [], subdomainCount: 0 }; }
}

async function hosting(host: string): Promise<{ ip?: string; asn?: string; server?: string; cdn: boolean; neighbors: string[] }> {
  try {
    const r = await fetch(`https://urlscan.io/api/v1/search/?q=page.domain:${encodeURIComponent(host)}&size=1`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { cdn: false, neighbors: [] };
    const d = (await r.json()) as { results?: { page?: { ip?: string; asnname?: string; server?: string } }[] };
    const page = d.results?.[0]?.page;
    if (!page?.ip) return { cdn: false, neighbors: [] };
    const cdn = isCdn(page.asnname || "") || isCdn(page.server || "");
    const base = { ip: page.ip, asn: page.asnname, server: page.server, cdn };
    // Neighbour pivot only makes sense on a dedicated IP — a shared CDN IP fronts
    // millions of unrelated sites, so we skip it there rather than fake-bridge.
    if (cdn) return { ...base, neighbors: [] };
    const targetApex = apex(host);
    const n = await fetch(`https://urlscan.io/api/v1/search/?q=page.ip:%22${encodeURIComponent(page.ip)}%22&size=40`, { signal: AbortSignal.timeout(10000) });
    const neighbors = new Set<string>();
    if (n.ok) {
      const nd = (await n.json()) as { results?: { page?: { domain?: string } }[] };
      for (const x of nd.results ?? []) { const dom = x.page?.domain; if (dom && apex(dom) !== targetApex) neighbors.add(apex(dom)); }
    }
    return { ...base, neighbors: [...neighbors].slice(0, 12) };
  } catch { return { cdn: false, neighbors: [] }; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = (typeof req.query.domain === "string" ? req.query.domain : typeof req.query.url === "string" ? req.query.url : "").trim();
  let host = raw;
  try { host = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
  if (!host || !host.includes(".")) { res.status(400).json({ error: "domain required" }); return; }

  const ck = `siteinfra:${host}:v1`;
  const cached = await cacheGetJson<any>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  try {
    const [fp, ct, host_] = await Promise.all([fingerprints(host), ctSiblings(host), hosting(host)]);
    const out = {
      available: true,
      host,
      fingerprints: fp,
      siblings: ct.siblings,
      subdomainCount: ct.subdomainCount,
      hosting: host_,
      // Anything we can actually pivot on — drives whether the panel renders a
      // "linked infrastructure" story or a quiet "nothing shared" note.
      hasLinks: fp.some((f) => f.kind !== "favicon") || ct.siblings.length > 0 || host_.neighbors.length > 0,
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: false, error: String(e), note: "Site-infra screen failed." });
  }
}
