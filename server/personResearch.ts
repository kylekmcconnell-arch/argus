import { fetchPublicText } from "./publicWeb.js";
import type { PersonResearchResult } from "../src/lib/personResearch.js";
import type { WebTeamMember } from "../src/data/evidence.js";

const quoted = (s: string) => `"${s.replace(/["\\\r\n]/g, " ").slice(0, 120)}"`;
export function personResearchQuestions(member: Pick<WebTeamMember, "name" | "linkedin" | "handle">, company: string) {
  const identity = `${quoted(member.name)} ${quoted(company)}`;
  return [
    { question: "Identity and LinkedIn employment", query: member.linkedin ? `${quoted(member.linkedin)} ${identity}` : `site:linkedin.com/in/ ${identity}` },
    { question: "Earlier companies and projects", query: `${quoted(member.name)} (founder OR cofounder OR previously OR former)` },
    { question: "Venture outcomes and collaborators", query: `${quoted(member.name)} (acquired OR shutdown OR cofounder OR lawsuit) ${quoted(company)}` },
    { question: "Public X project history", query: `site:x.com ${identity} (founded OR building OR launched)` },
  ];
}
export async function collectPersonResearch(member: WebTeamMember, company: string, key: string,
  deps = { fetch, read: fetchPublicText },
): Promise<PersonResearchResult> {
  const capturedAt = new Date().toISOString();
  const result: PersonResearchResult = { version: 1, name: member.name, company, capturedAt, searches: [], sources: [],
    note: "Bounded background discovery, not a scored person audit. Search results may refer to namesakes. Reading a page does not confirm its claims or bind a person, wallet, venture or common control. No adverse result is an all-clear." };
  // Sequential and capped: stop on throttling/configuration failure, with no retries.
  for (const item of personResearchQuestions(member, company)) {
    let response: Response;
    try {
      response = await deps.fetch("https://google.serper.dev/search", { method: "POST", headers: { "X-API-KEY": key, "content-type": "application/json" }, body: JSON.stringify({ q: item.query, num: 5 }), signal: AbortSignal.timeout(8000) });
      if (!response.ok) { result.searches.push({ question: item.question, status: "failed", count: 0 }); break; }
      const raw = await response.json();
      const body = raw && typeof raw === "object" ? raw as { organic?: unknown } : {};
      if (!Array.isArray(body.organic)) { result.searches.push({ question: item.question, status: "failed", count: 0 }); break; }
      const rows = body.organic.slice(0, 5).filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object")).map(row => ({ link: String(row.link ?? ""), title: String(row.title ?? ""), snippet: String(row.snippet ?? "") })).filter((row) => {
        try { const url = new URL(String(row.link)); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
      });
      result.searches.push({ question: item.question, status: "searched", count: rows.length });
      for (const row of rows) if (!result.sources.some(source => source.url === row.link)) result.sources.push({ url: row.link, title: String(row.title ?? "Source lead").slice(0, 300), excerpt: String(row.snippet ?? "").slice(0, 1500), discovery: item.question, access: "search_snippet", capturedAt });
    } catch { result.searches.push({ question: item.question, status: "failed", count: 0 }); break; }
  }
  // Safe, pinned public transport. Platform snippets are not presented as profile reads.
  for (const source of result.sources.filter(source => !/(^|\.)(linkedin\.com|x\.com|twitter\.com)$/.test(new URL(source.url).hostname)).slice(0, 3)) {
    try {
      const page = await deps.read(source.url);
      if (page.status === "ok") { source.access = "page_read"; source.excerpt = page.text.slice(0, 1800); source.contentHash = page.contentHash; source.capturedAt = page.capturedAt; }
      else source.access = "unavailable";
    } catch { source.access = "unavailable"; }
  }
  return result;
}
