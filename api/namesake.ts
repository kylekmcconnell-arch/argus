// Namesake / affiliation check for a token. GET /api/namesake?symbol=&name=&contract=&chain=
//
// Memecoins ride famous names ($ANSEM, $TRUMP, celebrity tokens). The single
// most load-bearing question is the RELATIONSHIP between the token and its
// namesake: did the person create it, endorse it, merely get memed, or publicly
// disown it? Faked affiliation is the classic memecoin rug setup; a genuinely
// endorsed token is a different risk class entirely. Grok (web + X search).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson, attachPanelCost, grokUsd } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 60 };

const q = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const RELS = new Set(["created", "endorsed", "acknowledged", "denied", "unaffiliated", "not_a_person", "unclear"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const key = process.env.XAI_API_KEY;
  const symbol = q(req.query.symbol).replace(/^\$/, "");
  const name = q(req.query.name);
  const contract = q(req.query.contract);
  const chain = q(req.query.chain);
  const reportVersionId = q(req.query.reportVersionId) || undefined;
  if (!symbol && !name) { res.status(400).json({ error: "symbol or name required" }); return; }
  if (!key) { res.status(200).json({ available: false, note: "Grok not configured." }); return; }

  // 24h cache: the namesake relationship doesn't change between report opens.
  const cacheKey = `namesake:${symbol}:${contract}`;
  const hit = await cacheGetJson<Record<string, unknown>>(cacheKey);
  if (hit) { res.status(200).json({ ...hit, _cached: true }); return; }

  const system =
    "You are a forensic crypto researcher with live web and X search. Determine who or what the given token is NAMED AFTER and the token's actual RELATIONSHIP to that namesake. " +
    "If the namesake is a real person (a KOL, influencer, celebrity, founder), classify the relationship with evidence: " +
    "created (the person or their team launched it), endorsed (they publicly promoted/backed THIS specific token), acknowledged (they mentioned it without endorsement), denied (they publicly disavowed it or called it fake), unaffiliated (no public statement connecting them to it; a fan/namesake token), not_a_person (named after a meme/animal/word, not a person), or unclear. " +
    "Be precise about THIS token (match the contract when given; many tokens share a ticker). Quote or describe the specific post/statement that proves the relationship, with a date if you can. Also note the namesake's X handle and roughly how influential they are. " +
    "Reply with ONLY compact JSON: {\"named_after\":\"\",\"x_handle\":\"@...\",\"who\":\"one line on who they are\",\"relationship\":\"created|endorsed|acknowledged|denied|unaffiliated|not_a_person|unclear\",\"evidence\":\"the specific post/statement/fact, dated\",\"note\":\"one-sentence bottom line for an investor\"}. NEVER invent a statement. Never use em dashes.";
  const user = `Token: $${symbol}${name && name.toLowerCase() !== symbol.toLowerCase() ? ` ("${name}")` : ""}${contract ? ` | contract ${contract}` : ""}${chain ? ` on ${chain}` : ""}. Who is it named after, and what is the namesake's actual relationship to THIS token?`;

  try {
    const r = await fetch("https://api.x.ai/v1/responses", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_GROK_MODEL || "grok-4-fast",
        input: [{ role: "system", content: system }, { role: "user", content: user }],
        tools: [{ type: "web_search" }, { type: "x_search" }],
        max_tool_calls: 6, // cost cap: xAI bills live search per source
      }),
      signal: AbortSignal.timeout(55000),
    });
    if (!r.ok) { res.status(200).json({ available: true, error: `grok ${r.status}: ${(await r.text()).slice(0, 200)}` }); return; }
    const d = (await r.json()) as any;
    const text = d.output_text ?? (Array.isArray(d.output) ? d.output.flatMap((o: any) => o.content ?? []).map((c: any) => c.text ?? "").join(" ") : "") ?? "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) { res.status(200).json({ available: true, relationship: "unclear", note: "No determination." }); return; }
    const p = JSON.parse(m[0]);
    // Fold this panel's spend into the subject's stored report (investigations
    // are stored under the contract address), then cache the answer.
    const toolCalls = Array.isArray(d.output) ? d.output.filter((o: any) => /search|tool/.test(String(o.type ?? ""))).length : 0;
    await attachPanelCost(auth.organizationId, reportVersionId, { provider: "grok", op: "panel:namesake", calls: 1, usd: grokUsd(d.usage, toolCalls), meta: `${(d.usage?.input_tokens ?? 0) + (d.usage?.output_tokens ?? 0)} tok` });
    const out = {
      available: true,
      named_after: typeof p.named_after === "string" ? p.named_after.slice(0, 80) : null,
      x_handle: typeof p.x_handle === "string" && /^@?[A-Za-z0-9_]{2,30}$/.test(p.x_handle.replace(/^@/, "")) ? "@" + p.x_handle.replace(/^@/, "") : null,
      who: typeof p.who === "string" ? p.who.slice(0, 160) : null,
      relationship: RELS.has(p.relationship) ? p.relationship : "unclear",
      evidence: typeof p.evidence === "string" ? p.evidence.slice(0, 300) : null,
      note: typeof p.note === "string" ? p.note.slice(0, 240) : null,
    };
    await cacheSetJson(cacheKey, out);
    res.status(200).json(out);
  } catch (e) {
    res.status(200).json({ available: true, error: String(e), relationship: "unclear" });
  }
}
