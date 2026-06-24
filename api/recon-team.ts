// Deep team search for a project. GET /api/recon-team?domain=&name=&title=&names=&x=
//
// Two blind angles run concurrently and merge, because no single search finds the
// whole team:
//   1. WEB/LINKEDIN — Google, the project's LinkedIn company page + employees,
//      Crunchbase, GitHub org, press, X. Connects site names to profiles.
//   2. X-CONTENT — mines the project's OWN X account posts (team intros, role
//      announcements, cofounder/advisor mentions) + posts tagging it.
// Both are told to be EXHAUSTIVE (list everyone, not just the top two), and the
// results are deduped by handle/name. Returns people with an X handle
// (backgroundable) and/or a LinkedIn URL.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const HANDLE = /^@?[A-Za-z0-9_]{2,30}$/;

async function grokPeople(key: string, system: string, user: string): Promise<any[]> {
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
      }),
      signal: AbortSignal.timeout(52000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as any;
    const text =
      d.output_text ??
      (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ??
      "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return [];
    try { return JSON.parse(m[0]).people ?? []; } catch { return []; }
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.XAI_API_KEY;
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const name = q(req.query.name);
  const title = q(req.query.title);
  const x = q(req.query.x).replace(/^@/, "");
  const siteNames = q(req.query.names).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!domain && !name && !x) { res.status(400).json({ error: "domain, name or x required" }); return; }
  if (!key) { res.status(200).json({ available: false, people: [] }); return; }

  const proj = name || domain || `@${x}`;
  const webSystem =
    "You are a forensic OSINT researcher with live web and X search. Find EVERY person behind a crypto/tech project: founders, cofounders, core team, engineers, AND advisors/backers. " +
    "The site is thin, so DIG hard: Google, the project's LinkedIn company page and its listed employees, Crunchbase, the GitHub org and its contributors, press/interviews, podcasts, and X. Connect any names already found on the site to their X handle and LinkedIn. " +
    "Be EXHAUSTIVE: list everyone you can attribute with public evidence, not just the top one or two. Include ONLY real people tied to THIS specific project (match the domain/name; do not confuse same-named projects). EXCLUDE hype/shill accounts and unrelated people. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|engineer|team|advisor\",\"evidence\":\"\"}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const webUser =
    `Project: ${proj}${domain ? ` (website ${domain})` : ""}.${title ? ` Site title: "${title}".` : ""}` +
    `${x ? ` Official X account: @${x}.` : ""}${siteNames.length ? ` Names already on the site (connect to profiles): ${siteNames.join(", ")}.` : ""}` +
    ` Find every founder, team member, and advisor. Connect each to their X handle and LinkedIn.`;

  const xSystem =
    "You are a forensic researcher with live X search. Mine the given project's OWN X account and posts mentioning it for EVERY team member and advisor it names. " +
    "Read its own posts (team intros, 'meet the team', role announcements like 'welcome @y as our CTO', 'our founder @z', cofounder mentions, 'advised by @w'), its pinned and OLDER posts, and posts that tag the team. " +
    "Be EXHAUSTIVE. For each person give name, X handle, LinkedIn if known, role, and the post as evidence. EXCLUDE the project account itself and hype repliers. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|engineer|team|advisor\",\"evidence\":\"\"}]}. If nobody, {\"people\":[]}. NEVER invent. Never use em dashes.";
  const xUser = `Project X account: @${x}${name ? ` (${name})` : ""}. List every founder, team member, and advisor named in its posts or in posts tagging it. Search older posts too.`;

  const calls = [grokPeople(key, webSystem, webUser)];
  if (x && HANDLE.test(x)) calls.push(grokPeople(key, xSystem, xUser));

  try {
    const results = await Promise.all(calls);
    const self = new Set([domain.toLowerCase(), x.toLowerCase()].filter(Boolean));
    const byKey = new Map<string, any>();
    for (const arr of results) {
      for (const p of arr) {
        if (!p || typeof p.name !== "string" || !p.name.trim()) continue;
        const handle = p.handle && HANDLE.test(p.handle) ? "@" + p.handle.replace(/^@/, "") : undefined;
        const linkedin = typeof p.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
        const cleaned = { name: p.name.trim(), handle, linkedin, role: (p.role || "team").toString(), evidence: typeof p.evidence === "string" ? p.evidence : undefined };
        if (!cleaned.handle && !cleaned.linkedin && !cleaned.evidence) continue; // need an anchor
        const hk = handle ? handle.replace(/^@/, "").toLowerCase() : "";
        if (hk && self.has(hk)) continue;
        const k = hk || cleaned.name.toLowerCase();
        const ex = byKey.get(k);
        if (ex) {
          ex.linkedin = ex.linkedin ?? cleaned.linkedin;
          ex.handle = ex.handle ?? cleaned.handle;
          if ((!ex.evidence || ex.evidence.length < (cleaned.evidence?.length ?? 0))) ex.evidence = cleaned.evidence ?? ex.evidence;
        } else {
          byKey.set(k, cleaned);
        }
      }
    }
    res.status(200).json({ available: true, people: [...byKey.values()].slice(0, 18) });
  } catch (e) {
    res.status(200).json({ available: true, people: [], error: String(e) });
  }
}
