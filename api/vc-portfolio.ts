// A VC / investor's portfolio + track record. GET /api/vc-portfolio?handle=&name=
//
// A fund's whole pitch is its judgement, so the audit is its scoreboard: what did
// they back, and how did it end? Grok (web + X + Crunchbase) assembles the
// portfolio; the client then prices each token investment on-chain for a real
// hit-rate. XAI_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson, attachPanelCost, grokUsd } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 120 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");

async function grok(key: string, system: string, user: string): Promise<{ parsed: any | null; usd: number }> {
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        max_tool_calls: 16, // more sources -> deeper portfolio (a major fund has dozens of deals)
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) return { parsed: null, usd: 0 };
    const d = (await r.json()) as any;
    const toolCalls = Array.isArray(d.output) ? d.output.filter((o: any) => /search|tool/.test(String(o.type ?? ""))).length : 0;
    const usd = grokUsd(d.usage, toolCalls);
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    return { parsed: m ? JSON.parse(m[0]) : null, usd };
  } catch {
    return { parsed: null, usd: 0 };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const key = process.env.XAI_API_KEY;
  const handle = q(req.query.handle).replace(/^@/, "");
  const name = q(req.query.name) || handle;
  if (!name) { res.status(400).json({ error: "handle or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Grok (XAI_API_KEY) not configured." }); return; }

  // 24h cache: a fund's public portfolio doesn't change between report opens.
  // ?fresh=1 bypasses it (used to re-deepen a fund cached under an older, thinner
  // search) and overwrites the cache with the new result.
  const fresh = q(req.query.fresh) === "1";
  const cacheKey = `vcport:${(name || handle).toLowerCase()}`;
  if (!fresh) {
    const cached = await cacheGetJson<Record<string, unknown>>(cacheKey);
    if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }
  }

  const system =
    "You are a research analyst assembling the public investment portfolio of a crypto/tech VC, fund, or angel. " +
    "USE both your own knowledge AND live web/X search (Crunchbase, the fund's own portfolio page, round announcements, CryptoRank, Messari, RootData, press). A major fund has DOZENS of public investments — be EXHAUSTIVE: aim to list at least 20-40 for a well-known fund, including smaller, earlier-stage, and non-token deals, not just the famous handful. Never return an empty (or tiny) list for a fund with a known portfolio. " +
    "For EACH portfolio company or token, capture what you can (fields you don't know can be empty strings): project name (required), token ticker (with a leading $ if it has one), token contract address + chain if known, the project's X handle, the round/stage, the year, and the current OUTCOME/STATUS (active/healthy, acquired, shut down, or rugged/dead). " +
    "Only include REAL investments (from your knowledge or search); do not fabricate deals that never happened, but DO include well-documented public ones even if you cannot find every field. " +
    "Reply with ONLY compact JSON: {\"investments\":[{\"project\":\"\",\"ticker\":\"$...\",\"contract\":\"\",\"chain\":\"\",\"x_handle\":\"@...\",\"stage\":\"\",\"year\":\"\",\"outcome\":\"\"}]}. Return an empty list ONLY if this is genuinely not an investor or has no findable investments. Never use em dashes.";
  const user = `Investor/fund: ${name}${handle && handle.toLowerCase() !== name.toLowerCase() ? ` (X @${handle})` : ""}. List their crypto and startup investment portfolio — as many real, publicly known holdings as you can, with each deal's project name, token ticker, X handle, stage, year, and current outcome. Include famous ones you already know even without a citation.`;

  // Grok is nondeterministic and often returns a THIN list for a fund with a big
  // public portfolio. When the first pass comes back short, run a second pass and
  // MERGE (dedupe by project) to deepen coverage — a fund's page can list 40+.
  let spend = 0;
  const g = await grok(key, system, user);
  spend += g.usd;
  let list: any[] = Array.isArray(g.parsed?.investments) ? g.parsed.investments : [];
  if (list.length < 15) {
    const g2 = await grok(key, system, user + " Be exhaustive: list at least 25-40 holdings, including earlier-stage and less-famous portfolio companies — do NOT stop at the well-known ones.");
    spend += g2.usd;
    const more: any[] = Array.isArray(g2.parsed?.investments) ? g2.parsed.investments : [];
    const seen = new Set(list.map((i) => String(i?.project ?? "").trim().toLowerCase()).filter(Boolean));
    for (const i of more) {
      const k = String(i?.project ?? "").trim().toLowerCase();
      if (k && !seen.has(k)) { seen.add(k); list.push(i); }
    }
  }
  const raw: any[] = list;
  const investments = raw
    .filter((i) => i && typeof i.project === "string" && i.project.trim())
    .slice(0, 40)
    .map((i) => ({
      project: String(i.project).trim().slice(0, 80),
      ticker: typeof i.ticker === "string" && i.ticker.trim() ? (i.ticker.startsWith("$") ? i.ticker.trim() : "$" + i.ticker.trim()).slice(0, 16) : null,
      contract: typeof i.contract === "string" && /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(i.contract.trim()) ? i.contract.trim() : null,
      chain: typeof i.chain === "string" ? i.chain.trim().toLowerCase().slice(0, 16) : null,
      x_handle: typeof i.x_handle === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(i.x_handle.replace(/^@/, "")) ? "@" + i.x_handle.replace(/^@/, "") : null,
      stage: typeof i.stage === "string" ? i.stage.trim().slice(0, 30) : null,
      year: typeof i.year === "string" || typeof i.year === "number" ? String(i.year).slice(0, 10) : null,
      outcome: typeof i.outcome === "string" ? i.outcome.trim().slice(0, 60) : null,
    }));

  // Fold the panel spend into the KOL/VC's stored person report + cache the answer.
  await attachPanelCost(auth.organizationId, handle || name, { provider: "grok", op: "panel:vc-portfolio", calls: spend > 0 ? (g.usd < spend ? 2 : 1) : 0, usd: spend }, "person");
  const result = { available: true, name, count: investments.length, investments };
  if (investments.length) await cacheSetJson(cacheKey, result);
  res.status(200).json(result);
}
