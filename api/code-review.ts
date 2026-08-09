// LYRA-style AI code read. GET /api/code-review?address=<0x…>&chain=<chainId>
//   &verdict=<mechanical verdict>&risk=<n>&danger=<n>&gated=<n>
//
// The mechanical scan flags capabilities; this pass reads the actual Solidity
// and says what the code DOES, in plain English, citing functions and line
// numbers. It is explicitly allowed to DISSENT from the mechanical verdict —
// guarded power is not open power (a bounded, timelocked setFee is not a rug
// switch), and a clean-looking flag set can still hide a trap in _transfer.
// Dissent direction is returned separately so the UI surfaces it instead of
// averaging it away.
//
// Source tiers: Etherscan v2 (keyed, best coverage) → Sourcify (keyless).
// Verdicts are cached by contract — source code is immutable, so a cached read
// never goes stale (a proxy upgrade changes the implementation ADDRESS, which
// the mechanical scan flags separately).
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { attachPanelCost, cacheGetJson, cacheSetJson, claudeUsd } from "./_cache.js";

export const config = { maxDuration: 60 };

const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, cronos: 25, zksync: 324,
  linea: 59144, scroll: 534352,
};

const MAX_SOURCE = 120_000; // chars of source fed to the model (~30k tokens)

interface Fetched { name: string | null; source: string }

async function fromEtherscan(chainid: number, address: string, key: string): Promise<Fetched | null> {
  try {
    const r = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${chainid}&module=contract&action=getsourcecode&address=${address}&apikey=${key}`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const row = d.result?.[0];
    if (!row?.SourceCode) return null;
    let src: string = row.SourceCode;
    // Multi-file uploads arrive as {{...}}-wrapped JSON; flatten to one blob
    // with per-file headers so line citations stay meaningful per file.
    if (src.startsWith("{{") || src.startsWith("{")) {
      try {
        const parsed = JSON.parse(src.replace(/^\{\{/, "{").replace(/\}\}$/, "}"));
        const files = parsed.sources ?? parsed;
        src = Object.entries(files as Record<string, { content?: string }>)
          .map(([p, v]) => `// ===== FILE: ${p} =====\n${v?.content ?? ""}`)
          .join("\n\n");
      } catch { /* keep raw */ }
    }
    return { name: row.ContractName || null, source: src };
  } catch {
    return null;
  }
}

async function fromSourcify(chainid: number, address: string): Promise<Fetched | null> {
  try {
    const r = await fetch(
      `https://sourcify.dev/server/v2/contract/${chainid}/${address}?fields=sources,compilation`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    if (!d.match || !d.sources) return null;
    const source = Object.entries(d.sources as Record<string, { content?: string }>)
      .filter(([p]) => /\.sol$/i.test(p))
      .map(([p, v]) => `// ===== FILE: ${p} =====\n${v?.content ?? ""}`)
      .join("\n\n");
    return source ? { name: d.compilation?.name ?? null, source } : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const address = String(req.query.address ?? "").toLowerCase();
  const chain = String(req.query.chain ?? "ethereum");
  const mechVerdict = String(req.query.verdict ?? "").slice(0, 12);
  const mechRisk = String(req.query.risk ?? "").slice(0, 4);
  const danger = String(req.query.danger ?? "0").slice(0, 6);
  const gated = String(req.query.gated ?? "0").slice(0, 6);
  if (!/^0x[a-f0-9]{40}$/.test(address)) { res.status(400).json({ ok: false, error: "bad address" }); return; }
  const chainid = CHAINID[chain];
  if (!chainid) { res.status(200).json({ ok: false, note: "chain not supported" }); return; }

  // Source is immutable per address — cache the read forever.
  const cacheKey = `code-review:${chainid}:${address}`;
  const cached = await cacheGetJson<{ summary: string; dissent: string | null; name: string | null }>(cacheKey);
  if (cached) { res.status(200).json({ ok: true, cached: true, ...cached }); return; }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) { res.status(200).json({ ok: false, note: "Claude not configured" }); return; }

  const esKey = process.env.ETHERSCAN_API_KEY;
  const fetched =
    (esKey ? await fromEtherscan(chainid, address, esKey) : null) ??
    (await fromSourcify(chainid, address));
  if (!fetched) { res.status(200).json({ ok: false, note: "no verified source" }); return; }

  const source = fetched.source.slice(0, MAX_SOURCE);
  const truncated = fetched.source.length > MAX_SOURCE;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        max_tokens: 1200,
        system:
          "You are LYRA-class contract reader for a token threat scanner: you read the ACTUAL Solidity source of a token and tell a non-technical buyer what the code does to them. Rules: " +
          "(1) Cite specific functions and approximate line numbers for every claim — functions and lines, not vibes. " +
          "(2) Distinguish GUARDED power from OPEN power: a bounded setFee (require <= 10%) or a timelocked owner is not a rug switch; an unbounded one is. Say which. " +
          "(3) Look hardest at _transfer/_update and any modifier gates — that is where traps live (conditional blocks on sells, hidden fee escalation, balance rewrites). " +
          "(4) If the token has a buy/sell TAX, say what the tax DOES with the money: reflections to holders, buyback-and-burn, auto-liquidity, a marketing/treasury wallet, or the newer pattern of buying real-world assets/stocks to distribute to holders. A tax that funds reflections/buyback/RWA distribution is a legitimate — even attractive — mechanism, not a rug tax; say so. Also note any burn mechanic (manual burn vs auto-burn on transfer) and, if visible, the burn address. " +
          "(5) You may DISSENT from the mechanical scan: if the flags overstate the danger (capabilities that are bounded/renounced/dead code) say the code is CLEANER than the score; if the code hides a trap the flags missed, say it is DARKER. " +
          "(6) Plain English, second person for consequences ('you would not be able to sell'), 2-4 short paragraphs, no headings. End with one plain sentence: is this code a trap, safe, or conditionally safe. " +
          "Reply with ONLY compact JSON: {\"summary\":\"the 2-4 paragraph read\",\"dissent\":\"cleaner\"|\"darker\"|null}",
        messages: [{
          role: "user",
          content:
            `Token contract ${fetched.name ?? "(unnamed)"} at ${address} on ${chain}.\n` +
            `Mechanical scan: verdict ${mechVerdict || "n/a"}${mechRisk ? ` (${mechRisk}/100 risk points)` : ""}, ` +
            `${danger} danger-pattern hits, ${gated} privileged functions.${truncated ? " NOTE: source truncated." : ""}\n\n` +
            `Verified source:\n\n${source}`,
        }],
      }),
      signal: AbortSignal.timeout(50000),
    });
    if (!r.ok) { res.status(200).json({ ok: false, note: `claude ${r.status}` }); return; }
    const d = (await r.json()) as any;
    await attachPanelCost(address, { provider: "claude", op: "panel:code-review", calls: 1, usd: claudeUsd(d.usage) });
    const text = (d.content ?? []).map((b: any) => b.text ?? "").join(" ");
    const m = text.match(/\{[\s\S]*\}/);
    let parsed: any = {};
    if (m) { try { parsed = JSON.parse(m[0]); } catch { /* */ } }
    if (typeof parsed.summary !== "string" || !parsed.summary.trim()) {
      res.status(200).json({ ok: false, note: "unparseable model output" });
      return;
    }
    const out = {
      summary: parsed.summary.trim().slice(0, 4000),
      dissent: parsed.dissent === "cleaner" || parsed.dissent === "darker" ? parsed.dissent : null,
      name: fetched.name,
    };
    await cacheSetJson(cacheKey, out);
    res.status(200).json({ ok: true, cached: false, ...out });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
}
