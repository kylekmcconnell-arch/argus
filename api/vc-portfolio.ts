// A VC / investor's portfolio + track record. GET /api/vc-portfolio?handle=&name=
//
// A fund's whole pitch is its judgement, so the audit is its scoreboard: what did
// they back, and how did it end? Grok (web + X + Crunchbase) assembles the
// portfolio; the client then prices each token investment on-chain for a real
// hit-rate. XAI_API_KEY.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 60 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");

let LAST_DBG = "";
async function grok(key: string, system: string, user: string): Promise<any | null> {
  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) { LAST_DBG = `http ${r.status}`; return null; }
    const d = (await r.json()) as any;
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ?? "";
    LAST_DBG = `textlen ${text.length}: ${text.slice(0, 220)}`;
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    LAST_DBG = `throw ${String(e).slice(0, 120)}`;
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.XAI_API_KEY;
  const handle = q(req.query.handle).replace(/^@/, "");
  const name = q(req.query.name) || handle;
  if (!name) { res.status(400).json({ error: "handle or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Grok (XAI_API_KEY) not configured." }); return; }

  const system =
    "You are a forensic researcher with live web and X search. Assemble the investment PORTFOLIO and track record of the given crypto/tech VC, fund, syndicate, or angel investor. " +
    "For EACH company or token they invested in, backed, incubated, or led/joined a round for, capture: the project name, its token ticker (with a leading $ if it has one), the token contract address + chain if you can find them, the project's X handle, the round/stage (pre-seed, seed, series A, strategic, etc.), the year, and the CURRENT OUTCOME/STATUS (active and healthy, acquired, quietly shut down, or rugged/collapsed/dead). " +
    "DIG: Crunchbase, the fund's own portfolio page, round announcements, CryptoRank/Messari, and press. Be thorough and list as many REAL, verifiable investments as you can — aim for the full portfolio, not just the famous ones. Never invent a deal. " +
    "Reply with ONLY compact JSON: {\"investments\":[{\"project\":\"\",\"ticker\":\"$...\",\"contract\":\"\",\"chain\":\"\",\"x_handle\":\"@...\",\"stage\":\"\",\"year\":\"\",\"outcome\":\"\"}]}. If none found, {\"investments\":[]}. Never use em dashes.";
  const user = `Investor/VC: ${name}${handle && handle.toLowerCase() !== name.toLowerCase() ? ` (X @${handle})` : ""}. List their full crypto/startup investment portfolio with each deal's stage, year, token (ticker + contract + chain), the project's X handle, and its current outcome.`;

  const out = await grok(key, system, user);
  const raw: any[] = Array.isArray(out?.investments) ? out.investments : [];
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

  res.status(200).json({ available: true, name, count: investments.length, investments, ...(investments.length ? {} : { _dbg: LAST_DBG }) });
}
