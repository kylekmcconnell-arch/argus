// Public API: GET /api/v1/token?address=<contract>  (or ?url=<dexscreener url>)
// Live, keyless token rug-audit as clean JSON. CORS-open for bots/integrations.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditToken, resolveInput } from "../_collector.js";

export const config = { maxDuration: 30 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "public, max-age=30");
  const ref = (req.query.address || req.query.url || req.query.t) as string | undefined;
  if (!ref) {
    res.status(400).json({ error: "pass ?address=<contract> or ?url=<dexscreener url>" });
    return;
  }
  const input = resolveInput(ref);
  if (input.kind !== "token") {
    res.status(400).json({ error: "input is not a token contract or DexScreener url" });
    return;
  }
  try {
    const d = await auditToken(input);
    if (!d) {
      res.status(404).json({ error: "no DEX pair found for this contract" });
      return;
    }
    res.status(200).json({
      api: "argus/v1",
      kind: "token",
      address: d.address,
      chain: d.chain,
      symbol: d.symbol,
      name: d.name,
      verdict: d.verdict,
      score: d.score,
      cap_applied: d.capApplied,
      headline: d.headline,
      market: { priceUsd: d.priceUsd, marketCap: d.mcap, liquidityUsd: d.liquidityUsd, volume24h: d.vol24, ageDays: d.ageDays, priceChange: d.priceChange },
      safety: d.safety,
      holders: { top: d.topHolders, insiderPct: d.insiderPct, bundleCount: d.bundleCount, bundleRisk: d.bundleRisk },
      corroboration: d.cg,
      provenance: { projectX: d.projectX, deployer: d.deployer },
      axes: d.axes,
      findings: d.findings,
      links: { app: `https://argus-one-flax.vercel.app/?t=${d.address}` },
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
