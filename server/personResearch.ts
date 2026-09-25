import { collectDiligenceProviders } from "./diligenceProviders.js";
import { classifyRelationship } from "../src/lib/relationshipDiligence.js";
import { fetchPublicText } from "./publicWeb.js";
import type { PersonResearchResult } from "../src/lib/personResearch.js";
import type { WebTeamMember } from "../src/data/evidence.js";

export function researchExcerpt(text: string, name: string): string {
  const plain = text.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const at = plain.toLowerCase().indexOf(name.toLowerCase());
  return plain.slice(Math.max(0, at - 240), Math.max(0, at - 240) + 1800);
}
const identityQuery = (name: string, company: string) => `${quoted(name)} ${quoted(company)}`;
const quoted = (s: string) => `"${s.replace(/["\\\r\n]/g, " ").slice(0, 120)}"`;
export function personResearchQuestions(member: Pick<WebTeamMember, "name" | "linkedin" | "handle"> & { role?: string }, company: string) {
  const identity = `${quoted(member.name)} ${quoted(company)}`;
  const role = member.role ?? "";
  const classification = classifyRelationship(role);
  const roleResearch = /engineer|developer|cto|coder/i.test(role)
    ? { question: "Attributable engineering work", query: `${identity} (site:github.com OR release OR maintainer OR contributor)` }
    : /investor|partner|principal|venture capital/i.test(role)
      ? { question: "Personal investment responsibility and outcomes", query: `${identity} (investment OR board OR portfolio OR realized OR exit)` }
      : { question: "Venture outcomes and collaborators", query: `${identity} (acquired OR shutdown OR cofounder OR collaborator)` };
  if (classification.functions.includes("Sales / BD") || classification.functions.includes("Marketing / PR")) {
    roleResearch.question = "Personal commercial contribution"; roleResearch.query = `${identity} (customer OR distribution OR sales OR retention OR campaign)`;
  } else if (classification.functions.includes("Legal / compliance")) {
    roleResearch.question = "Professional scope and jurisdiction"; roleResearch.query = `${identity} (counsel OR qualification OR regulator OR engagement)`;
  } else if (classification.functions.includes("Token / mechanism design")) {
    roleResearch.question = "Attributable mechanism design"; roleResearch.query = `${identity} (tokenomics OR simulation OR mechanism OR paper OR repository)`;
  } else if (classification.functions.includes("Operations") || classification.functions.includes("People / HR")) {
    roleResearch.question = "Operating responsibility and delivery"; roleResearch.query = `${identity} (operations OR hiring OR delivery OR incident OR previously)`;
  }
  return [
    { question: "Identity and LinkedIn employment", reason: "Bind the exact person and employer before interpreting a career record.", query: member.linkedin ? `${quoted(member.linkedin)} ${identity}` : `site:linkedin.com/in/ ${identity}` },
    { question: "Earlier companies and projects", reason: "Reconstruct dated ventures and personal contribution, including unsuccessful outcomes.", query: `${quoted(member.name)} (founder OR cofounder OR previously OR former)` },
    { ...roleResearch, reason: `Investigate the actual responsibility: ${classification.functions.join(", ") || role || "role unresolved"}.` },
    { question: "Attributable public records and disputed claims", reason: "Find primary records for material concerns; a name match is never attribution.", query: `${identity} (court OR regulator OR judgment OR dismissed OR site:reddit.com)` },
  ];
}
export async function collectPersonResearch(member: WebTeamMember, company: string, key: string,
  deps = { fetch, read: fetchPublicText },
  context: { publicNameEstablished?: boolean } = {},
): Promise<PersonResearchResult> {
  const capturedAt = new Date().toISOString();
  const result: PersonResearchResult = { version: 1, name: member.name, company, capturedAt, searches: [], sources: [],
    note: "Bounded background discovery, not a scored person audit. Search results may refer to namesakes. Reading a page does not confirm its claims or bind a person, wallet, venture or common control. No adverse result is an all-clear." };
  const plan = personResearchQuestions(member, company);
  if (member.projects_evidence_origin === "deterministic" && member.projects?.[0]?.name) {
    plan[1] = { question: "Outcome of the recorded prior venture", reason: "A prior venture is already recorded; test its outcome and this person's contribution.", query: `${quoted(member.name)} ${quoted(member.projects[0].name)} (launched OR acquired OR closed OR shutdown OR contribution)` };
  }
  result.plannedQuestions = plan.map(({ question, reason }) => ({ question, reason }));
  // Sequential and capped: stop on throttling/configuration failure, with no retries.
  for (let index = 0; index < plan.length; index++) {
    let item = plan[index];
    if (index === 3 && result.sources.some(s => /\b(?:cloud|startup|platform) credits\b/i.test(s.excerpt)) && /investor|backer|partner/i.test(member.role)) {
      item = { question: "Reconcile claimed backing with programme support", reason: "Discovery mentions credits; establish whether a separate financial investment exists.", query: `${identityQuery(member.name, company)} (investment OR equity OR credits OR accelerator)` };
      result.plannedQuestions[index] = { question: item.question, reason: item.reason };
    }
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
      if (page.status === "ok") { source.access = "page_read"; source.excerpt = researchExcerpt(page.text, member.name); source.contentHash = page.contentHash; source.capturedAt = page.capturedAt; }
      else source.access = "unavailable";
    } catch { source.access = "unavailable"; }
  }
  result.stopReason = result.searches.some(row => row.status === "failed") ? "provider_failure" : "completed_budget";
  // Optional keys are read by the server only; this call cannot buy PACER documents.
  result.providerReceipts = await collectDiligenceProviders({ name: member.name, company, role: member.role,
    publicNameEstablished: context.publicNameEstablished === true }, { fetch: deps.fetch,
    keys: { openalex: process.env.OPENALEX_API_KEY, courtlistener: process.env.COURTLISTENER_API_TOKEN }, now: () => capturedAt });
  return result;
}
