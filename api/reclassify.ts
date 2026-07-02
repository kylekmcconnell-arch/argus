// Batch role re-categorization WITHOUT rerunning audits.
// POST { subjects: [{ ref, query, summary, roles? }] } -> { results: [{ ref, roles }] }
//
// Classification rules evolve (PROJECT class added, INVESTOR tightened); old
// audits keep their stale role flags until rescanned. This re-runs ONLY the role
// classification over each audit's stored headline/summary — one Claude call for
// the whole batch, seconds instead of a 3-minute audit each. The scores/verdicts
// are untouched; only the taxonomy filing changes.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const ROLES = new Set(["FOUNDER", "PROJECT", "KOL", "INVESTOR", "ADVISOR", "AGENCY", "MEMBER"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(200).json({ available: false, note: "no analyst key" }); return; }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const subjects: { ref: string; query: string; summary: string; roles?: string[] }[] = (Array.isArray(body?.subjects) ? body.subjects : [])
    .filter((s: any) => s && typeof s.ref === "string" && s.ref.trim())
    .slice(0, 60)
    .map((s: any) => ({ ref: String(s.ref).slice(0, 60), query: String(s.query ?? s.ref).slice(0, 60), summary: String(s.summary ?? "").slice(0, 400), roles: Array.isArray(s.roles) ? s.roles.slice(0, 6) : undefined }));
  if (!subjects.length) { res.status(400).json({ error: "subjects required" }); return; }

  const system =
    "You are ARGUS taxonomy. Re-classify each audited subject's ROLE SET from its stored audit summary. Roles: " +
    "PROJECT = the account IS an organization: a token, protocol, product, company, or DAO's own brand/official handle (ships and promotes its OWN product/token, speaks as we/our). " +
    "FOUNDER = an individual PERSON who founded or leads a project. " +
    "KOL = an influencer/caller promoting OTHER people's tokens across many projects (calls, alpha, gems, shills). " +
    "INVESTOR = PROFESSIONAL capital allocation ONLY: an actual fund/VC/syndicate (or its official account), a GP/partner at one, or an angel with named verifiable investments. Buying/trading tokens or 'investing in gems' talk is NOT INVESTOR — a caller who trades is KOL. " +
    "ADVISOR = formally advises named projects. AGENCY = a services shop (marketing/PR/market-making). MEMBER = none of the above. " +
    "Decisive rules: a brand account promoting its own token is PROJECT, never KOL; an investment firm's brand account is INVESTOR, never PROJECT; do not tag KOL for hype words about the subject's own token; do not tag INVESTOR for trading talk. " +
    "A subject can hold several roles. Use the summary text as ground truth; the prior roles are shown only as context and are often WRONG under these rules. " +
    "Never use em dashes.";
  const user = subjects
    .map((s, i) => `${i + 1}. ref=${s.ref} | handle/query: ${s.query}${s.roles?.length ? ` | prior roles (may be wrong): ${s.roles.join(",")}` : ""}\n   summary: ${s.summary || "(none)"}`)
    .join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: `Re-classify these ${subjects.length} audited subjects:\n\n${user}` }],
        tools: [{
          name: "record_roles",
          description: "Record the corrected role set for every subject.",
          input_schema: {
            type: "object",
            properties: {
              results: {
                type: "array",
                items: {
                  type: "object",
                  properties: { ref: { type: "string" }, roles: { type: "array", items: { type: "string" } } },
                  required: ["ref", "roles"],
                },
              },
            },
            required: ["results"],
          },
        }],
        tool_choice: { type: "tool", name: "record_roles" },
      }),
      signal: AbortSignal.timeout(50000),
    });
    if (!r.ok) { res.status(200).json({ available: true, results: [], error: `analyst ${r.status}` }); return; }
    const d = (await r.json()) as any;
    const input = (d.content ?? []).find((b: any) => b.type === "tool_use")?.input;
    const raw: any[] = Array.isArray(input?.results) ? input.results : [];
    const byRef = new Map(subjects.map((s) => [s.ref.toLowerCase(), s]));
    const results = raw
      .filter((x) => x && typeof x.ref === "string" && byRef.has(x.ref.toLowerCase()))
      .map((x) => {
        let roles: string[] = (Array.isArray(x.roles) ? x.roles : []).map((r: any) => String(r).toUpperCase()).filter((r: string) => ROLES.has(r));
        // Deterministic backstops, same as the live pipeline.
        if (roles.includes("INVESTOR") && roles.includes("PROJECT")) roles = roles.filter((r) => r !== "PROJECT");
        if (!roles.length) roles = ["MEMBER"];
        return { ref: x.ref, roles };
      });
    res.status(200).json({ available: true, results });
  } catch (e) {
    res.status(200).json({ available: true, results: [], error: String(e) });
  }
}
