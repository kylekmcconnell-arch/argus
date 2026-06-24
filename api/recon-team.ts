// Web-deep team search for a project. GET /api/recon-team?domain=&name=&title=&names=
//
// Site recon renders the page and regex-hunts a team section, which fails on the
// thin sites sketchy projects ship. This digs: a Grok web + X search across
// Google, LinkedIn, Crunchbase, GitHub, press and X for the people behind the
// project, and connects any names already found on the site to their profiles.
// Returns people with an X handle (backgroundable) and/or a LinkedIn URL.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.XAI_API_KEY;
  const domain = q(req.query.domain).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const name = q(req.query.name);
  const title = q(req.query.title);
  const siteNames = q(req.query.names).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 8);
  if (!domain && !name) { res.status(400).json({ error: "domain or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, people: [] }); return; }

  const system =
    "You are a forensic OSINT researcher with live web and X search. Find the PEOPLE behind a crypto/tech project: founders, cofounders, and core team. " +
    "The project's own website is thin, so DIG: search Google, the project's LinkedIn company page and its employees, Crunchbase, GitHub org, press/interviews, and X. If names were already found on the site, connect each to their X handle and LinkedIn profile. " +
    "For each person return: name, X handle if found, LinkedIn URL if found, role, and a one-line evidence phrase citing where you found them. Include ONLY real people with public evidence tying them to THIS specific project (match the domain/name, do not confuse same-named projects). EXCLUDE generic advisors-for-hire unless clearly tied, hype accounts, and unrelated people. " +
    "Reply with ONLY compact JSON: {\"people\":[{\"name\":\"\",\"handle\":\"@...\",\"linkedin\":\"linkedin.com/in/...\",\"role\":\"founder|cofounder|ceo|cto|engineer|team\",\"evidence\":\"\"}]}. If you find nobody, return {\"people\":[]}. NEVER invent or guess. Never use em dashes.";
  const user =
    `Project: ${name || domain}${domain ? ` (website ${domain})` : ""}.${title ? ` Site title: "${title}".` : ""}` +
    `${siteNames.length ? ` Names already found on the site (connect these to profiles): ${siteNames.join(", ")}.` : ""}` +
    ` Find every founder and team member. Search Google, LinkedIn, Crunchbase, GitHub, press, and X. Connect each person to their X handle and LinkedIn.`;

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
    if (!r.ok) { res.status(200).json({ available: true, people: [], note: `grok ${r.status}` }); return; }
    const d = (await r.json()) as any;
    const text =
      d.output_text ??
      (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ??
      "";
    const m = text.match(/\{[\s\S]*\}/);
    let people: any[] = [];
    if (m) {
      try { people = JSON.parse(m[0]).people ?? []; } catch { people = []; }
    }
    const self = domain.toLowerCase();
    const clean = (people as any[])
      .filter((p) => p && typeof p.name === "string" && p.name.trim())
      .map((p) => ({
        name: p.name.trim(),
        handle: p.handle && /^@?[A-Za-z0-9_]{2,30}$/.test(p.handle) ? "@" + p.handle.replace(/^@/, "") : undefined,
        linkedin: typeof p.linkedin === "string" && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined,
        role: (p.role || "team").toString(),
        evidence: typeof p.evidence === "string" ? p.evidence : undefined,
      }))
      .filter((p) => p.handle || p.linkedin || p.evidence) // require at least one anchor
      .filter((p) => !p.handle || p.handle.replace(/^@/, "").toLowerCase() !== self)
      .slice(0, 12);
    res.status(200).json({ available: true, people: clean });
  } catch (e) {
    res.status(200).json({ available: true, people: [], error: String(e) });
  }
}
