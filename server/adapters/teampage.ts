// Direct team-page reader. Grok's web search summarizes; it can miss the one page
// that matters — the project's own /team roster (e.g. docs.vulcanforged.com/team).
// This fetches the likely team/about pages directly, strips them to text, and has
// Claude pull the named roster. Keyless fetch + ANTHROPIC_API_KEY for extraction.
import { structured } from "../agent";
import type { TeamMember } from "./x";

// Common places a crypto/tech project lists its people, on the apex domain and on
// a docs/about subdomain.
function candidateUrls(domain: string): string[] {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
  if (!d) return [];
  const paths = ["team", "about", "about-us", "team-members", "our-team", "company", "people", "leadership"];
  const urls: string[] = [];
  for (const host of [d, `docs.${d}`, `www.${d}`]) {
    for (const p of paths) {
      urls.push(`https://${host}/${p}`);
      // Docs platforms (GitBook, Mintlify, …) render the roster via JS but serve a
      // plain-text Markdown version at <path>.md — where the names actually are.
      urls.push(`https://${host}/${p}.md`);
    }
  }
  return urls;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPage(url: string): Promise<{ url: string; text: string } | null> {
  try {
    const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS/1.0)", accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const ct = r.headers.get("content-type") ?? "";
    if (!/html|markdown|text\/plain/i.test(ct)) return null;
    const raw = await r.text();
    // Markdown variants are already text; only HTML needs stripping.
    const text = /markdown|text\/plain/i.test(ct) || url.endsWith(".md") ? raw.replace(/!\[[^\]]*\]\([^)]*\)/g, " ").replace(/\s+/g, " ").trim() : htmlToText(raw);
    // A real team page mentions roles; skip thin/404-ish pages.
    if (text.length < 300 || !/founder|ceo|cto|team|advisor|lead|head of|engineer|officer/i.test(text)) return null;
    return { url, text };
  } catch {
    return null;
  }
}

export async function fetchTeamPage(domain: string, projectName?: string): Promise<TeamMember[]> {
  const urls = candidateUrls(domain);
  if (!urls.length) return [];
  const pages = (await Promise.all(urls.map(fetchPage))).filter(Boolean) as { url: string; text: string }[];
  if (!pages.length) return [];
  // Prefer a page whose URL path literally says team, then the longest.
  pages.sort((a, b) => (/team/i.test(b.url) ? 1 : 0) - (/team/i.test(a.url) ? 1 : 0) || b.text.length - a.text.length);
  const corpus = pages.slice(0, 2).map((p) => `PAGE ${p.url}:\n${p.text.slice(0, 6000)}`).join("\n\n");

  const system =
    "You extract a crypto/tech project's team roster from the text of its own team/about page. " +
    "List EVERY named person with a role: founders, executives (CEO/CTO/COO/CFO/CMO), core team, engineering/product leads, and named advisors. " +
    "Use the exact role the page states. Capture any X/Twitter handle and LinkedIn URL shown next to a person. " +
    "Do NOT invent people or roles; include only names actually present in the text. Never use em dashes.";
  const tool = {
    name: "record_team",
    description: "Record the named people listed on the project's team/about page.",
    input_schema: {
      type: "object" as const,
      properties: {
        people: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              role: { type: "string" },
              twitter: { type: "string", description: "@handle if shown" },
              linkedin: { type: "string", description: "linkedin.com/in/... if shown" },
            },
            required: ["name", "role"],
          },
        },
      },
      required: ["people"],
    },
  };
  const out = await structured<{ people: { name: string; role: string; twitter?: string; linkedin?: string }[] }>(
    system,
    `Project${projectName ? ` ${projectName}` : ""} team page text:\n\n${corpus}`,
    tool,
    2048,
  );
  if (!out?.people?.length) return [];
  return out.people
    .filter((p) => p.name && p.name.trim())
    .map((p) => {
      const role = (p.role || "team").toString();
      const kind: "team" | "advisor" = /advisor|advis|backer|mentor/i.test(role) ? "advisor" : "team";
      const handle = p.twitter && /^@?[A-Za-z0-9_]{2,30}$/.test(p.twitter.replace(/^@/, "")) ? "@" + p.twitter.replace(/^@/, "") : undefined;
      const linkedin = p.linkedin && /linkedin\.com\/(in|company)\//i.test(p.linkedin) ? p.linkedin.replace(/^https?:\/\//, "").replace(/\/$/, "") : undefined;
      return { name: p.name.trim(), handle, role, kind, linkedin, evidence: "listed on the project's own team page", source: "team page" };
    });
}
