// Resolve a token's OFFICIAL identity from knowledge when its on-chain sources are
// thin. GET /api/token-identity?symbol=&name=&contract=&chain=
//
// DexScreener + CoinGecko cover blue-chips, but a newer/obscure token that isn't
// on CoinGecko and links nothing on its DEX pair would otherwise dead-end on "no
// website / no X / no founder". Grok (web + X search + knowledge) fills that gap:
// the official website, the official X account, and the founder (with handle),
// pinned to THIS contract. 24h-cached; cost folded into the token's report.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson, attachPanelCost, grokUsd, resolvePanelCostVersion } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 40 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const HANDLE = /^@?[A-Za-z0-9_]{2,30}$/;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const key = process.env.XAI_API_KEY;
  const symbol = q(req.query.symbol).replace(/^\$/, "");
  const name = q(req.query.name);
  const contract = q(req.query.contract);
  const chain = q(req.query.chain);
  const panelToken = req.headers["x-argus-panel-token"];
  const panelTokenValue = Array.isArray(panelToken) ? panelToken[0] : panelToken;
  const panelCostVersionId = resolvePanelCostVersion(
    auth.organizationId,
    panelTokenValue,
  );
  if (panelTokenValue && !panelCostVersionId) { res.status(409).json({ error: "invalid_panel_context", message: "This post-scan context expired. Rescan before running paid supplemental intelligence." }); return; }
  if (!symbol && !name) { res.status(400).json({ error: "symbol or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Grok (XAI_API_KEY) not configured." }); return; }

  const cacheKey = `tokid:${chain}:${(contract || symbol || name).toLowerCase()}`;
  const hit = await cacheGetJson<Record<string, unknown>>(cacheKey);
  if (hit) { res.status(200).json({ ...hit, _cached: true }); return; }

  const system =
    "You resolve the OFFICIAL identity of one specific crypto token using live web + X search plus your own knowledge. " +
    "Given the token's symbol, name, and contract, find: (1) its official project website, (2) its official X (Twitter) account, and (3) the founder/creator (a real person) with their X handle if public. " +
    "Be precise about THIS token — match the contract address when given, because many tokens share a ticker. Do NOT return a fan account, an impersonator, a same-ticker DIFFERENT project, or a guessed name. " +
    "Reply with ONLY compact JSON: {\"website\":\"https://...\",\"x_handle\":\"@...\",\"founder\":\"Full Name\",\"founder_handle\":\"@...\",\"confidence\":\"high|medium|low\",\"note\":\"one line\"}. Use null for any field you cannot confidently determine. NEVER invent a handle or a name. Never use em dashes.";
  const user = `Token: $${symbol}${name && name.toLowerCase() !== symbol.toLowerCase() ? ` (${name})` : ""}${contract ? `, contract ${contract}` : ""}${chain ? ` on ${chain}` : ""}. What is its official website, official X account, and founder (with X handle)?`;

  let attempted = false;
  let recorded = false;
  const recordAttempt = async (status: "succeeded" | "partial" | "failed", usd = 0, meta?: string) => {
    if (!attempted || recorded) return;
    recorded = true;
    try {
      await attachPanelCost(auth.organizationId, panelCostVersionId, {
        provider: "grok",
        op: "panel:token-identity",
        calls: 1,
        usd,
        initiatedBy: auth.userId,
        status,
        ...(meta ? { meta } : {}),
      });
    } catch { /* usage attribution must not replace the provider response */ }
  };

  attempted = true;
  let r: Response;
  try {
    r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        max_tool_calls: 6,
      }),
      signal: AbortSignal.timeout(35000),
    });
  } catch (e) {
    await recordAttempt("failed", 0, "transport_error");
    res.status(200).json({ available: true, error: String(e) });
    return;
  }
  if (!r.ok) {
    await recordAttempt("failed", 0, `http_${r.status}`);
    res.status(200).json({ available: true, error: `grok ${r.status}` });
    return;
  }

  let d: any;
  try { d = await r.json(); }
  catch (e) {
    await recordAttempt("failed", 0, "response_json_error");
    res.status(200).json({ available: true, error: String(e) });
    return;
  }
  const toolCalls = Array.isArray(d?.output) ? d.output.filter((o: any) => /search|tool/.test(String(o?.type ?? ""))).length : 0;
  const usd = grokUsd(d?.usage, toolCalls);
  const text = d?.output_text ?? (Array.isArray(d?.output) ? d.output.flatMap((o: any) => o?.content ?? []).map((c: any) => c?.text ?? "").join(" ") : "") ?? "";
  const m = typeof text === "string" ? text.match(/\{[\s\S]*\}/) : null;
  let p: any = {};
  let validContract = false;
  if (m) {
    try {
      p = JSON.parse(m[0]);
      validContract = !!p
        && typeof p === "object"
        && !Array.isArray(p)
        && ["high", "medium", "low"].includes(p.confidence)
        && ["website", "x_handle", "founder", "founder_handle"].every((field) => Object.hasOwn(p, field));
    } catch { /* malformed model output is a partial provider result */ }
  }
  await recordAttempt(validContract ? "succeeded" : "partial", usd, validContract ? undefined : "output_contract_error");
  const website = typeof p.website === "string" && /^https?:\/\//i.test(p.website) ? p.website.trim() : null;
  const x_handle = typeof p.x_handle === "string" && HANDLE.test(p.x_handle) ? "@" + p.x_handle.replace(/^@/, "") : null;
  const founder = typeof p.founder === "string" && p.founder.trim().length >= 2 && p.founder.trim().length < 60 ? p.founder.trim() : null;
  const founder_handle = typeof p.founder_handle === "string" && HANDLE.test(p.founder_handle) ? "@" + p.founder_handle.replace(/^@/, "") : null;
  const out = {
    available: true,
    website,
    x_handle,
    founder,
    founder_handle,
    confidence: ["high", "medium", "low"].includes(p.confidence) ? p.confidence : "low",
    note: typeof p.note === "string" ? p.note.slice(0, 200) : "",
  };
  if (validContract && (website || x_handle || founder)) await cacheSetJson(cacheKey, out); // don't pin a malformed or all-null result
  res.status(200).json(out);
}
