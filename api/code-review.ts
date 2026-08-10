// LYRA-style AI code read. GET /api/code-review?address=<0x…>&chain=<chainId>
//   &verdict=<mechanical verdict>&risk=<n>&danger=<n>&gated=<n>
//
// The mechanical scan flags capabilities; this pass reads the actual Solidity
// and says what the code DOES, in plain English, citing functions and line
// numbers. It is explicitly allowed to DISSENT from the mechanical verdict -
// guarded power is not open power (a bounded, timelocked setFee is not a rug
// switch), and a clean-looking flag set can still hide a trap in _transfer.
// Dissent direction is returned separately so the UI surfaces it instead of
// averaging it away.
//
// Source tiers: Etherscan v2 (keyed, best coverage) → Sourcify (keyless).
// PROXIES: Etherscan's getsourcecode returns the PROXY STUB's source, not the
// implementation where the token logic (and any trap) actually lives - so for a
// verified proxy we resolve the implementation address and read ITS source, and
// cache keyed on that address so an upgrade invalidates the read.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore - bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { requireArgusAuth } from "./_auth.js";

export const config = { maxDuration: 60 };

const CHAINID: Record<string, number> = {
  ethereum: 1, bsc: 56, base: 8453, polygon: 137, arbitrum: 42161,
  optimism: 10, avalanche: 43114, fantom: 250, cronos: 25, zksync: 324,
  linea: 59144, scroll: 534352, robinhood: 4663,
};

// Chains Etherscan/Sourcify don't cover - read verified source from Blockscout.
const BLOCKSCOUT: Record<string, string> = {
  robinhood: "https://robinhoodchain.blockscout.com",
};

const MAX_SOURCE = 120_000; // chars of source fed to the model (~30k tokens)
const ADDR = /^0x[a-f0-9]{40}$/;

interface Fetched { name: string | null; source: string; readAddress: string; proxyOf: string | null }

// Flatten an Etherscan SourceCode field (raw single-file, or {{...}}-wrapped
// multi-file JSON) into one blob with per-file headers so line citations stay
// meaningful per file.
function flattenEtherscanSource(raw: string): string {
  if (raw.startsWith("{{") || raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw.replace(/^\{\{/, "{").replace(/\}\}$/, "}"));
      const files = parsed.sources ?? parsed;
      const flat = Object.entries(files as Record<string, { content?: string }>)
        .map(([p, v]) => `// ===== FILE: ${p} =====\n${v?.content ?? ""}`)
        .join("\n\n");
      if (flat.trim()) return flat;
    } catch { /* fall through to raw */ }
  }
  return raw;
}

// One raw getsourcecode row -> {name, source, proxy fields} or null.
async function etherscanRow(chainid: number, address: string, key: string): Promise<any | null> {
  try {
    const r = await fetch(
      `https://api.etherscan.io/v2/api?chainid=${chainid}&module=contract&action=getsourcecode&address=${address}&apikey=${key}`,
      { signal: AbortSignal.timeout(12000) },
    );
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    return d.result?.[0] ?? null;
  } catch {
    return null;
  }
}

async function fromEtherscan(chainid: number, address: string, key: string): Promise<Fetched | null> {
  const row = await etherscanRow(chainid, address, key);
  if (!row?.SourceCode) return null;
  // If this is a proxy with a resolvable implementation, read the implementation's
  // source instead - that's where the logic lives. Fall back to the proxy's own
  // source when the implementation isn't verified.
  const impl = String(row.Implementation ?? "").toLowerCase();
  if ((row.Proxy === "1" || row.Proxy === 1) && ADDR.test(impl) && impl !== address) {
    const implRow = await etherscanRow(chainid, impl, key);
    if (implRow?.SourceCode) {
      return { name: implRow.ContractName || row.ContractName || null, source: flattenEtherscanSource(implRow.SourceCode), readAddress: impl, proxyOf: address };
    }
  }
  return { name: row.ContractName || null, source: flattenEtherscanSource(row.SourceCode), readAddress: address, proxyOf: null };
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
    return source ? { name: d.compilation?.name ?? null, source, readAddress: address, proxyOf: null } : null;
  } catch {
    return null;
  }
}

async function fromBlockscout(base: string, address: string): Promise<Fetched | null> {
  try {
    const r = await fetch(`${base}/api/v2/smart-contracts/${address}`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    if (!d.is_verified || !d.source_code) return null;
    const files = [
      { path: d.file_path || `${d.name ?? "Contract"}.sol`, content: d.source_code as string },
      ...((d.additional_sources ?? []) as { file_path?: string; source_code?: string }[])
        .filter((s) => s.file_path && s.source_code)
        .map((s) => ({ path: s.file_path!, content: s.source_code! })),
    ].filter((f) => /\.sol$/i.test(f.path));
    if (!files.length) return null;
    const source = files.map((f) => `// ===== FILE: ${f.path} =====\n${f.content}`).join("\n\n");
    return { name: d.name ?? null, source, readAddress: address, proxyOf: null };
  } catch {
    return null;
  }
}

// Truncate long source at a FILE boundary when possible, so a citation never
// lands past a mid-file cut.
function clampSource(source: string): { source: string; truncated: boolean } {
  if (source.length <= MAX_SOURCE) return { source, truncated: false };
  const head = source.slice(0, MAX_SOURCE);
  const lastBoundary = head.lastIndexOf("\n// ===== FILE:");
  return { source: lastBoundary > MAX_SOURCE * 0.5 ? head.slice(0, lastBoundary) : head, truncated: true };
}

// Robustly turn the model's reply into {summary, dissent}. Prefers strict JSON,
// then a fenced ```json block, and finally falls back to the cleaned prose as
// the summary - showing LYRA's read beats failing with "unparseable output".
export function parseReview(text: string): { summary: string; dissent: "cleaner" | "darker" | null } | null {
  const clean = (s: string) => s.replace(/```json\s*|\s*```/g, "").trim();
  const dissentOf = (v: unknown) => (v === "cleaner" || v === "darker" ? v : null);
  // 1) a JSON object anywhere in the reply
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const p = JSON.parse(m[0]);
      if (typeof p.summary === "string" && p.summary.trim()) {
        return { summary: p.summary.trim().slice(0, 4000), dissent: dissentOf(p.dissent) };
      }
    } catch { /* fall through */ }
  }
  // 1b) truncated / unterminated JSON (a long reply cut off before the closing
  // brace). Pull the summary string value out by hand so a cut-off read still
  // renders as prose instead of dumping the raw {"summary":"..." envelope. The
  // body pattern stops at the first UNescaped quote or at end-of-text.
  const partial = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/);
  if (partial && partial[1].trim()) {
    const summary = partial[1]
      .replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "").replace(/\\\\/g, "\\")
      .trim();
    const d = text.match(/"dissent"\s*:\s*"(cleaner|darker)"/);
    return { summary: summary.slice(0, 4000), dissent: d ? (d[1] as "cleaner" | "darker") : null };
  }
  // 2) fenced block or raw prose - use the whole thing as the summary
  const prose = clean(text);
  if (prose) {
    const dissent = /\bcleaner\b/i.test(prose) && !/\bdarker\b/i.test(prose) ? "cleaner" : /\bdarker\b/i.test(prose) && !/\bcleaner\b/i.test(prose) ? "darker" : null;
    return { summary: prose.slice(0, 4000), dissent };
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // This panel spends Anthropic budget per call, so it is auth-gated like every
  // other paid panel on main (the mechanical scan stays keyless/public). The
  // in-app scanner reaches it through the global authenticated fetch, which
  // attaches the session bearer token automatically; anonymous callers get 401.
  // NOTE: intentionally NOT the panel-token/persisted-report gate — the threat
  // scanner is a standalone surface with no persisted reportVersion.
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;

  const address = String(req.query.address ?? "").toLowerCase();
  const chain = String(req.query.chain ?? "ethereum");
  const mechVerdict = String(req.query.verdict ?? "").slice(0, 12);
  const mechRisk = String(req.query.risk ?? "").slice(0, 4);
  const danger = String(req.query.danger ?? "0").slice(0, 6);
  const gated = String(req.query.gated ?? "0").slice(0, 6);
  if (!/^0x[a-f0-9]{40}$/.test(address)) { res.status(400).json({ ok: false, error: "bad address" }); return; }
  const chainid = CHAINID[chain];
  if (!chainid) { res.status(200).json({ ok: false, note: "chain not supported" }); return; }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) { res.status(200).json({ ok: false, note: "Claude not configured" }); return; }

  const esKey = process.env.ETHERSCAN_API_KEY;
  const bs = BLOCKSCOUT[chain];
  const fetched =
    (esKey ? await fromEtherscan(chainid, address, esKey) : null) ??
    (await fromSourcify(chainid, address)) ??
    (bs ? await fromBlockscout(bs, address) : null);
  if (!fetched) { res.status(200).json({ ok: false, note: "no verified source" }); return; }

  // Cache keyed on the address whose source was actually READ - for a proxy that
  // is the implementation, so an upgrade to a new implementation reads fresh.
  const cacheKey = `code-review:${chainid}:${fetched.readAddress}`;
  const cached = await cacheGetJson<{ summary: string; dissent: string | null; name: string | null; proxyOf?: string | null }>(cacheKey);
  if (cached) { res.status(200).json({ ok: true, cached: true, ...cached }); return; }

  const { source, truncated } = clampSource(fetched.source);

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anthropicKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6",
        // A cited 2-4 paragraph read of a large contract can run long; 1200 was
        // truncating the JSON mid-string (the reply never closed the brace, so
        // parseReview fell back to dumping the raw envelope). Give it headroom.
        max_tokens: 2000,
        system:
          "You are LYRA-class contract reader for a token threat scanner: you read the ACTUAL Solidity source of a token and tell a non-technical buyer what the code does to them. Rules: " +
          "(1) Cite specific functions and approximate line numbers for every claim - functions and lines, not vibes. " +
          "(2) Distinguish GUARDED power from OPEN power: a bounded setFee (require <= 10%) or a timelocked owner is not a rug switch; an unbounded one is. Say which. " +
          "(3) Look hardest at _transfer/_update and any modifier gates - that is where traps live (conditional blocks on sells, hidden fee escalation, balance rewrites). " +
          "(4) If the token has a buy/sell TAX, say what the tax DOES with the money: reflections to holders, buyback-and-burn, auto-liquidity, a marketing/treasury wallet, or the newer pattern of buying real-world assets/stocks to distribute to holders. A tax that funds reflections/buyback/RWA distribution is a legitimate - even attractive - mechanism, not a rug tax; say so. Also note any burn mechanic (manual burn vs auto-burn on transfer) and, if visible, the burn address. " +
          "(5) You may DISSENT from the mechanical scan: if the flags overstate the danger (capabilities that are bounded/renounced/dead code) say the code is CLEANER than the score; if the code hides a trap the flags missed, say it is DARKER. " +
          "(6) Plain English, second person for consequences ('you would not be able to sell'), 2-4 short paragraphs, no headings. End with one plain sentence: is this code a trap, safe, or conditionally safe. " +
          "Reply with ONLY compact JSON: {\"summary\":\"the 2-4 paragraph read\",\"dissent\":\"cleaner\"|\"darker\"|null}",
        messages: [{
          role: "user",
          content:
            `Token contract ${fetched.name ?? "(unnamed)"} at ${address} on ${chain}.\n` +
            (fetched.proxyOf ? `NOTE: this is an upgradeable PROXY; the source below is its current implementation (${fetched.readAddress}). The logic can be swapped by whoever controls the upgrade - weigh that.\n` : "") +
            `Mechanical scan: verdict ${mechVerdict || "n/a"}${mechRisk ? ` (${mechRisk}/100 risk points)` : ""}, ` +
            `${danger} danger-pattern hits, ${gated} privileged functions.${truncated ? " NOTE: source truncated at a file boundary." : ""}\n\n` +
            `Verified source:\n\n${source}`,
        }],
      }),
      signal: AbortSignal.timeout(50000),
    });
    if (!r.ok) { res.status(200).json({ ok: false, note: `claude ${r.status}` }); return; }
    const d = (await r.json()) as any;
    // NOTE: panel-cost accounting is intentionally skipped here. Main scopes
    // attachPanelCost to (organizationId, persisted reportVersionId) via an
    // x-argus-panel-token; the threat scanner's LYRA read runs on a standalone,
    // non-persisted surface with no such token. Wiring this endpoint into the
    // paid-panel/auth model (and thereby gating cost-abuse) is a follow-up.
    const text = (d.content ?? []).map((b: any) => b.text ?? "").join(" ");
    const review = parseReview(text);
    if (!review) { res.status(200).json({ ok: false, note: "empty model output" }); return; }
    const out = { ...review, name: fetched.name, proxyOf: fetched.proxyOf };
    await cacheSetJson(cacheKey, out);
    res.status(200).json({ ok: true, cached: false, ...out });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e) });
  }
}
