import { createHash } from "node:crypto";
import { deadlineFetch, providerDeadlineSignal } from "./providerDeadline.js";
import type { DiligenceProviderReceipt, DiligenceProviderCandidate } from "../src/lib/diligenceProviders.js";

interface Subject { name: string; company?: string; role?: string; publicNameEstablished?: boolean; deadlineAt?: number }
interface Dependencies { fetch: typeof fetch; keys: { openalex?: string; courtlistener?: string }; now: () => string }
const clean = (value: unknown, max = 500): string => typeof value === "string" ? value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const quote = (value: string) => `"${value.replace(/["\\\r\n]/g, " ").slice(0, 120)}"`;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
async function boundedBody(response: Response): Promise<string> {
  const limit = 512_000;
  if (Number(response.headers.get("content-length")) > limit) throw new Error("response_limit");
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0, text = "";
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) throw new Error("response_limit"); text += decoder.decode(chunk.value, { stream: true }); } }
  finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return text + decoder.decode();
}
function courtUrl(value: unknown): string | null {
  try { const url = new URL(String(value), "https://www.courtlistener.com");
    return url.origin === "https://www.courtlistener.com" && /^\/(?:docket|opinion)\/\d+\//.test(url.pathname) && !url.username && !url.password ? `${url.origin}${url.pathname}` : null;
  } catch { return null; }
}
export function parseDiligenceCandidates(provider: DiligenceProviderReceipt["provider"], raw: unknown): DiligenceProviderCandidate[] {
  const body = record(raw);
  if (!Array.isArray(body.results)) throw new Error("invalid_schema");
  const candidates: DiligenceProviderCandidate[] = [];
  for (const value of body.results.slice(0, 5)) {
    const row = record(value);
    if (provider === "openalex") {
      const id = clean(row.id).match(/^https:\/\/openalex\.org\/(A\d+)$/)?.[1];
      if (!id || !clean(row.display_name)) continue;
      const institutions = Array.isArray(row.last_known_institutions) ? row.last_known_institutions.slice(0, 3).map(v => clean(record(v).display_name)).filter(Boolean).join(", ") : "";
      candidates.push({ id, title: clean(row.display_name), url: `https://openalex.org/authors/${id}`,
        excerpt: `Possible author record. ${institutions ? `Listed institutions: ${institutions}. ` : ""}Identity and authorship must be checked against the person's public professional links; counts do not establish contribution.`, attribution: "unresolved" });
    } else {
      const url = courtUrl(row.absolute_url);
      if (!url || !clean(row.caseName)) continue;
      candidates.push({ id: url, title: clean(row.caseName), url,
        excerpt: `Possible case record. ${clean(row.court, 180)}${clean(row.dateFiled, 30) ? `; filed ${clean(row.dateFiled, 30)}` : ""}. ${clean(row.snippet, 700)} Identity, party role and current procedural status are unresolved.`, attribution: "unresolved" });
    }
  }
  if (body.results.length && !candidates.length) throw new Error("unusable_results");
  return candidates;
}

/** Read-only fixed-host discovery. No redirects, pagination, PACER purchase or automatic identity binding. */
export async function collectDiligenceProviders(subject: Subject, deps: Dependencies = { fetch: deadlineFetch,
  keys: { openalex: process.env.OPENALEX_API_KEY, courtlistener: process.env.COURTLISTENER_API_TOKEN }, now: () => new Date().toISOString() }): Promise<DiligenceProviderReceipt[]> {
  const capturedAt = deps.now();
  const jobs: Array<{ provider: DiligenceProviderReceipt["provider"]; key?: string; applicable: boolean; query: string; url: string; authorization: string; estimatedUsd: number | null }> = [
    { provider: "openalex", key: deps.keys.openalex, applicable: Boolean(subject.publicNameEstablished && /engineer|research|scientist|cryptograph|cto|academic/i.test(subject.role ?? "")),
      query: quote(subject.name), url: "https://api.openalex.org/authors", authorization: "Bearer", estimatedUsd: 0.001 },
    { provider: "courtlistener", key: deps.keys.courtlistener, applicable: Boolean(subject.publicNameEstablished && subject.company?.trim()),
      query: `${quote(subject.name)} AND ${quote(subject.company ?? "")}`, url: "https://www.courtlistener.com/api/rest/v4/search/", authorization: "Token", estimatedUsd: null },
  ];
  return Promise.all(jobs.map(async job => {
    const base: DiligenceProviderReceipt = { provider: job.provider, status: "not_configured", capturedAt, calls: 0, estimatedUsd: 0, candidates: [],
      note: job.provider === "courtlistener" ? "Existing public case-index search only; no PACER purchases. Jurisdictional and archive coverage are incomplete. No result is not a clean-record certification; search hits are not allegations against this person." : "Author search is discovery only. Same-name records and institutional affiliations do not bind an identity or demonstrate technical ability." };
    if (!job.key?.trim()) return { ...base, note: `${base.note} Access is not configured.` };
    if (!job.applicable) return { ...base, status: "not_applicable" as const, note: `${base.note} An established public name and relevant professional context are required.` };
    if (subject.deadlineAt && Date.now() >= subject.deadlineAt) return { ...base, status: "unavailable" as const, note: `${base.note} Collection deadline reached; no request made.` };
    const url = new URL(job.url);
    if (job.provider === "openalex") { url.searchParams.set("search", job.query); url.searchParams.set("per-page", "5"); }
    else { url.searchParams.set("q", job.query); url.searchParams.set("type", "r"); }
    const attempt = { ...base, query: job.query, calls: 1, estimatedUsd: job.estimatedUsd };
    try {
      const deadline = providerDeadlineSignal();
      const response = await deps.fetch(url.toString(), { headers: { authorization: `${job.authorization} ${job.key}`, accept: "application/json" }, redirect: "error",
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, Math.min(7000, (subject.deadlineAt ?? Date.now() + 7000) - Date.now()))), ...(deadline ? [deadline] : [])]) });
      if (!response.ok) return { ...attempt, status: "unavailable" as const, note: `${base.note} Provider returned HTTP ${response.status}; no absence finding.` };
      const text = await boundedBody(response);
      const candidates = parseDiligenceCandidates(job.provider, JSON.parse(text));
      return { ...attempt, status: candidates.length ? "completed" as const : "empty" as const, candidates,
        contentHash: createHash("sha256").update(text).digest("hex"), note: `${base.note}${job.estimatedUsd === null ? " Contract pricing is not known; usage is recorded without claiming a zero cost." : " List-price API estimate before free allowances; not a settled charge."}` };
    } catch { return { ...attempt, status: "unavailable" as const, note: `${base.note} Retrieval or response validation failed; no absence finding.` }; }
  }));
}
