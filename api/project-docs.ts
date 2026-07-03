// Project documents finder. GET /api/project-docs?name=<project>&domain=<host>&symbol=<sym>
//
// A serious project publishes a whitepaper and (if it wants trust) security audits.
// Their ABSENCE, or an audit claimed with no linkable report, is itself diligence
// signal. Static-HTML scraping misses these — modern docs live on GitBook / Notion
// / IPFS / PDFs behind JS. So we use Grok's live web+X search to find the REAL,
// official links: the whitepaper/litepaper, the docs, and each audit with its
// auditor and a direct report URL. Links only, never invented. 24h-cached.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

export const config = { maxDuration: 30 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s);

async function findDocs(name: string, domain: string, symbol: string, key: string): Promise<any | null> {
  const system =
    "You find a crypto project's official DOCUMENTS using live web + X search: its whitepaper (or litepaper), its docs site, and every security audit. " +
    "Return ONLY real, working links that genuinely belong to THIS project — prefer the project's own domain, its GitBook/docs, IPFS, or the auditor's own site (certik.com, hacken.io, etc). " +
    "For each audit give the auditor firm, a DIRECT link to the audit report, and the date if visible. Never invent a link or an auditor; if you cannot find something, omit it. " +
    "Reply with ONLY compact JSON, no prose: {\"whitepaper\":{\"url\":\"...\",\"kind\":\"whitepaper|litepaper|docs|gitbook\"}|null,\"audits\":[{\"auditor\":\"...\",\"url\":\"...\",\"date\":\"YYYY-MM\"|null}]}";
  const user = `Project: "${name}"${symbol ? ` ($${symbol})` : ""}${domain ? `, website ${domain}` : ""}. Find its official whitepaper/litepaper and all security audits (with direct report links).`;
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ARGUS_GROK_MODEL || "grok-4-fast", input: [{ role: "system", content: system }, { role: "user", content: user }], tools: [{ type: "web_search" }, { type: "x_search" }], max_tool_calls: 6 }),
      signal: AbortSignal.timeout(26000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const name = q(req.query.name);
  const symbol = q(req.query.symbol).replace(/^\$/, "");
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  if (!name && !symbol && !domain) { res.status(400).json({ error: "name, symbol, or domain required" }); return; }
  const key = process.env.XAI_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "Grok not configured; document finder unavailable." }); return; }

  const cacheKey = `docs:${(name || symbol || domain).toLowerCase()}:${domain}`;
  const cached = await cacheGetJson<any>(cacheKey);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const raw = await findDocs(name || symbol, domain, symbol, key);
  // Sanitize: keep only real URLs, dedup audits by (auditor+url).
  const wp = raw?.whitepaper && isUrl(raw.whitepaper.url)
    ? { url: raw.whitepaper.url, kind: ["whitepaper", "litepaper", "docs", "gitbook"].includes(raw.whitepaper.kind) ? raw.whitepaper.kind : "whitepaper" }
    : null;
  const seen = new Set<string>();
  const audits = (Array.isArray(raw?.audits) ? raw.audits : [])
    .filter((a: any) => a && typeof a.auditor === "string" && isUrl(a.url))
    .map((a: any) => ({ auditor: a.auditor.trim().slice(0, 40), url: a.url, date: typeof a.date === "string" ? a.date.slice(0, 7) : null }))
    .filter((a: any) => { const k = (a.auditor + a.url).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);

  const out = {
    available: true,
    whitepaper: wp,
    audits,
    // Diligence read: no whitepaper AND no audit is a real absence worth stating.
    note: !wp && !audits.length ? "No whitepaper or security audit could be found for this project via web/X search." : undefined,
  };
  await cacheSetJson(cacheKey, out);
  res.status(200).json(out);
}
