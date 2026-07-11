// Project documents & resources finder.
// GET /api/project-docs?name=<project>&domain=<host>&symbol=<sym>
//
// What a project publishes about itself is diligence signal: a whitepaper and a
// security audit are the classic pair, but a real operation also has developer /
// API docs, an About and a named Team page, press / newsroom, a blog, tokenomics,
// governance. Their PRESENCE builds a picture; a fundraising project with none of
// it is a flag. Two sources, merged:
//   1. A deterministic crawl of the project's own homepage nav — reliable, free,
//      and authoritative for on-site pages (About / Team / API / Press / Blog).
//   2. Grok live web+X search — for what isn't linked from the homepage: a
//      GitBook / IPFS whitepaper, the audit reports, off-site press coverage.
// Every link is categorized; nothing is invented. 24h-cached.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { attachPanelCost, cacheGetJson, cacheSetJson, grokUsd, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 30 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isUrl = (s: unknown): s is string => typeof s === "string" && /^https?:\/\/\S+$/.test(s);

// Resource categories, in display order, with a default chip label.
const CATS: Record<string, string> = {
  api: "API", docs: "Docs", about: "About", team: "Team", press: "Press",
  blog: "Blog", tokenomics: "Tokenomics", governance: "Governance",
  roadmap: "Roadmap", careers: "Careers", faq: "FAQ", legal: "Legal",
};
const CAT_ORDER = Object.keys(CATS);

// href/anchor-text → category. First match wins, so the more specific rules lead.
const CAT_RULES: [RegExp, string][] = [
  [/\b(api|developers?|devs?|reference|sdk|integrat)\b/, "api"],
  [/\b(about|about-us|aboutus|company|mission|who-we-are|whoweare|story)\b/, "about"],
  [/\b(team|leadership|our-people|founders?|people|advisors?)\b/, "team"],
  [/\b(press|media|newsroom|press-kit|presskit|press-release|in-the-news)\b/, "press"],
  [/\b(tokenomics|token-economics)\b/, "tokenomics"],
  [/\b(governance|dao|proposals?|vote|voting)\b/, "governance"],
  [/\b(roadmap)\b/, "roadmap"],
  [/\b(careers?|jobs|hiring|work-with-us)\b/, "careers"],
  [/\b(faq|support|help|helpdesk|helpcenter|knowledge)\b/, "faq"],
  [/\b(terms|privacy|legal|tos|cookie|compliance|disclaimer)\b/, "legal"],
  [/\b(docs?|documentation|gitbook|guides?|wiki|manual)\b/, "docs"],
  [/\b(blog|news|announcements?|updates?|articles?|insights?)\b/, "blog"],
];
const categorize = (hay: string): string | null => { for (const [re, c] of CAT_RULES) if (re.test(hay)) return c; return null; };

const MULTI = new Set(["co.uk", "org.uk", "com.au", "co.nz", "com.br", "co.jp", "co.kr", "co.in", "com.mx", "com.sg", "co.za", "com.tr", "com.ua"]);
function apex(host: string): string {
  const p = host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "").split(".");
  if (p.length <= 2) return p.join(".");
  const last2 = p.slice(-2).join(".");
  return MULTI.has(last2) ? p.slice(-3).join(".") : last2;
}
const SOCIAL = /^(twitter\.com|x\.com|t\.me|discord|github\.com|youtube\.com|youtu\.be|linkedin\.com|reddit\.com|instagram\.com|facebook\.com|tiktok\.com|t\.co)/;

type Resource = { category: string; title: string; url: string };

// Deterministic: read the homepage and categorize its own nav links. On-site
// (same registrable domain, incl. docs./api./blog. subdomains) only — Grok
// handles off-site. This is what reliably surfaces About / Team / Press.
async function crawlNav(domain: string): Promise<Resource[]> {
  const origin = `https://${domain}`;
  try {
    const r = await fetch(`${origin}/`, { headers: { "user-agent": "Mozilla/5.0 (ARGUS due-diligence)" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
    if (!r.ok) return [];
    const html = (await r.text()).slice(0, 700_000);
    const targetApex = apex(domain);
    const out: Resource[] = [];
    const seen = new Set<string>();
    for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#\s]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const rawHref = m[1].trim();
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!rawHref || /^(mailto:|tel:|javascript:|data:)/i.test(rawHref)) continue;
      let u: URL;
      try { u = new URL(rawHref, origin); } catch { continue; }
      if (u.protocol !== "https:" && u.protocol !== "http:") continue;
      const host = u.hostname.replace(/^www\./, "");
      if (SOCIAL.test(host)) continue;
      if (apex(host) !== targetApex) continue;
      if (u.pathname === "/" || u.pathname === "") continue; // the homepage itself
      const cat = categorize(`${u.hostname} ${u.pathname} ${text}`.toLowerCase());
      if (!cat) continue;
      const url = u.origin + u.pathname.replace(/\/$/, "");
      const key = `${cat}|${url.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ category: cat, title: text || CATS[cat], url });
    }
    return out;
  } catch { return []; }
}

// Grok: whitepaper, audits, and any resource not linked from the homepage.
type GrokResult = {
  parsed: any | null;
  calls: number;
  usd: number;
  status: "succeeded" | "partial" | "failed";
  meta?: string;
};

async function findViaGrok(name: string, domain: string, symbol: string, key: string): Promise<GrokResult> {
  const cats = "api, docs, about, team, press, blog, tokenomics, governance, roadmap, faq, legal";
  const system =
    "You find a crypto project's official DOCUMENTS and RESOURCES using live web + X search. " +
    "Return ONLY real, working links that genuinely belong to THIS project — prefer the project's own domain, its GitBook/docs, IPFS, or an auditor's own site (certik.com, hacken.io, etc). Never invent a link. " +
    `Find: (1) the whitepaper or litepaper; (2) every security audit (auditor firm + DIRECT report link + date if visible); (3) key RESOURCES, each labeled with a category from this set: ${cats}. ` +
    "For 'press', include the project's own press/newsroom page AND notable independent media coverage (a real article URL). For 'team', the page that names the people. Only include a category you actually found a link for. " +
    "Reply with ONLY compact JSON, no prose: {\"whitepaper\":{\"url\":\"...\",\"kind\":\"whitepaper|litepaper|docs|gitbook\"}|null,\"resources\":[{\"category\":\"api|docs|about|team|press|blog|tokenomics|governance|roadmap|faq|legal\",\"title\":\"short\",\"url\":\"...\"}],\"audits\":[{\"auditor\":\"...\",\"url\":\"...\",\"date\":\"YYYY-MM\"|null}]}";
  const user = `Project: "${name}"${symbol ? ` ($${symbol})` : ""}${domain ? `, website ${domain}` : ""}. Find its whitepaper, security audits, and official resources (API/developer docs, about, team, press/newsroom + notable coverage, blog, tokenomics, governance, roadmap, FAQ, legal).`;
  let r: Response;
  try {
    r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: process.env.ARGUS_GROK_MODEL || "grok-4-fast", input: [{ role: "system", content: system }, { role: "user", content: user }], tools: [{ type: "web_search" }, { type: "x_search" }], max_tool_calls: 8 }),
      signal: AbortSignal.timeout(27000),
    });
  } catch { return { parsed: null, calls: 1, usd: 0, status: "failed", meta: "transport_error" }; }
  if (!r.ok) return { parsed: null, calls: 1, usd: 0, status: "failed", meta: `http_${r.status}` };

  let d: any;
  try { d = await r.json(); }
  catch { return { parsed: null, calls: 1, usd: 0, status: "failed", meta: "response_json_error" }; }
  const text = d?.output_text ?? (Array.isArray(d?.output) ? d.output.flatMap((o: any) => o?.content ?? []).map((c: any) => c?.text ?? "").join(" ") : "") ?? "";
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  let parsed: any | null = null;
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch { /* malformed model output */ }
  }
  const toolCalls = Array.isArray(d?.output)
    ? d.output.filter((item: any) => /search|tool/.test(String(item?.type ?? ""))).length
    : 0;
  const validContract = parsed
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && Object.hasOwn(parsed, "whitepaper")
    && Array.isArray(parsed.resources)
    && Array.isArray(parsed.audits);
  return {
    parsed,
    calls: 1,
    usd: grokUsd(d?.usage, toolCalls),
    status: validContract ? "succeeded" : "partial",
    ...(validContract ? {} : { meta: "output_contract_error" }),
  };
}

function assembleResult(nav: Resource[], raw: any | null, searchedWithGrok: boolean) {
  const wp = raw?.whitepaper && isUrl(raw.whitepaper.url)
    ? { url: raw.whitepaper.url, kind: ["whitepaper", "litepaper", "docs", "gitbook"].includes(raw.whitepaper.kind) ? raw.whitepaper.kind : "whitepaper" }
    : null;

  const seen = new Set<string>();
  const audits = (Array.isArray(raw?.audits) ? raw.audits : [])
    .filter((a: any) => a && typeof a.auditor === "string" && isUrl(a.url))
    .map((a: any) => ({ auditor: a.auditor.trim().slice(0, 40), url: a.url, date: typeof a.date === "string" ? a.date.slice(0, 7) : null }))
    .filter((a: any) => { const k = (a.auditor + a.url).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, 6);

  // Merge on-site crawl (authoritative first) with Grok, dedupe by URL, validate
  // category, and cap per-category so one blog can't flood the panel.
  const norm = (u: string) => u.toLowerCase().replace(/\/$/, "");
  // A bare homepage (no path) is not a resource — Grok sometimes labels it "about".
  const bareRoot = (u: string) => { try { const p = new URL(u).pathname; return p === "" || p === "/"; } catch { return false; } };
  const grokRes: Resource[] = (Array.isArray(raw?.resources) ? raw.resources : [])
    .filter((x: any) => x && isUrl(x.url) && !bareRoot(x.url) && typeof x.category === "string" && CATS[x.category])
    .map((x: any) => ({ category: x.category, title: (typeof x.title === "string" && x.title.trim() ? x.title.trim() : CATS[x.category]).slice(0, 40), url: x.url }));
  const urlSeen = new Set<string>([wp ? norm(wp.url) : ""]);
  const perCat: Record<string, number> = {};
  const resources: Resource[] = [];
  for (const rsc of [...nav, ...grokRes]) {
    const u = norm(rsc.url);
    if (urlSeen.has(u)) continue;
    if ((perCat[rsc.category] ?? 0) >= 3) continue;
    urlSeen.add(u);
    perCat[rsc.category] = (perCat[rsc.category] ?? 0) + 1;
    resources.push(rsc);
  }
  resources.sort((a, b) => CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category));

  return {
    available: true,
    whitepaper: wp,
    resources: resources.slice(0, 18),
    audits,
    // Transparency read: a named team/about page is a mild positive signal we surface.
    hasTeamPage: resources.some((r) => r.category === "team"),
    hasAbout: resources.some((r) => r.category === "about"),
    note: !wp && !resources.length && !audits.length
      ? (searchedWithGrok
          ? "No whitepaper, documentation, or security audit could be found for this project via its site or web/X search."
          : "No on-site documents were found. Live web search is available after the report is persisted.")
      : undefined,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;

  const panelToken = req.headers["x-argus-panel-token"];
  const panelTokenValue = Array.isArray(panelToken) ? panelToken[0] : panelToken;
  const panelCostVersionId = resolvePanelCostVersion(auth.organizationId, panelTokenValue);
  if (panelTokenValue && !panelCostVersionId) {
    res.status(409).json({ error: "invalid_panel_context", message: "This paid supplemental check needs a fresh persisted report. Rescan before running it." });
    return;
  }

  const name = q(req.query.name);
  const symbol = q(req.query.symbol).replace(/^\$/, "");
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
  if (!name && !symbol && !domain) { res.status(400).json({ error: "name, symbol, or domain required" }); return; }

  const subjectCacheKey = `${(name || symbol || domain).toLowerCase()}:${domain}:v4`;
  const enhancedCacheKey = `docs:${subjectCacheKey}:grok`;
  const crawlCacheKey = `docs:${subjectCacheKey}:crawl`;

  // Cached enrichment is safe to read without spending. Only a valid persisted-
  // report capability may initiate a new Grok request.
  const enhanced = await cacheGetJson<any>(enhancedCacheKey);
  if (enhanced) { res.status(200).json({ ...enhanced, _cached: true }); return; }

  const key = process.env.XAI_API_KEY;
  if (!panelCostVersionId || !key) {
    const crawlCached = await cacheGetJson<any>(crawlCacheKey);
    if (crawlCached) { res.status(200).json({ ...crawlCached, _cached: true }); return; }
    const nav = domain ? await crawlNav(domain) : [];
    const out = assembleResult(nav, null, false);
    await cacheSetJson(crawlCacheKey, out);
    res.status(200).json(out);
    return;
  }

  const [nav, grok] = await Promise.all([
    domain ? crawlNav(domain) : Promise.resolve([] as Resource[]),
    findViaGrok(name || symbol, domain, symbol, key),
  ]);
  await attachPanelCost(auth.organizationId, panelCostVersionId, {
    provider: "grok",
    op: "panel:project-docs",
    calls: grok.calls,
    usd: grok.usd,
    initiatedBy: auth.userId,
    status: grok.status,
    ...(grok.meta ? { meta: grok.meta } : {}),
  });
  const out = assembleResult(nav, grok.parsed, true);
  if (grok.status === "succeeded") await cacheSetJson(enhancedCacheKey, out);
  res.status(200).json(out);
}
