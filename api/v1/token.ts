// Authenticated API: GET /api/v1/token?address=<contract> (or ?url=...).
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ResolvedInput, RunnableTokenInput } from "../../src/lib/resolveInput.js";
import { auditToken, resolveInput } from "../_collector.js";
import { consumeInvestigationQuota, requireArgusAuth } from "../_auth.js";
import { screenSanctionedAddresses } from "../_sanctions-core.js";

export const config = { maxDuration: 30 };

const isRunnableTokenInput = (input: ResolvedInput): input is RunnableTokenInput =>
  input.kind === "token"
  && (input.via === "evm" || input.via === "solana" || input.via === "dexscreener");

function cors(req: VercelRequest, res: VercelResponse): void {
  const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
  const allowed = new Set((process.env.ARGUS_CORS_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  if (origin && allowed.has(origin)) res.setHeader("access-control-allow-origin", origin);
  res.setHeader("vary", "Origin");
  res.setHeader("access-control-allow-headers", "Authorization, Content-Type");
  res.setHeader("access-control-allow-methods", "GET, OPTIONS");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  cors(req, res);
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "GET") { res.status(405).setHeader("Allow", "GET, OPTIONS").json({ error: "method_not_allowed" }); return; }
  res.setHeader("cache-control", "private, no-store");
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  // Repeated query keys parse as arrays; only a single string value is valid.
  const single = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  const ref = single(req.query.address) || single(req.query.url) || single(req.query.t);
  if (!ref) {
    res.status(400).json({ error: "pass ?address=<contract> or ?url=<dexscreener url>" });
    return;
  }
  const input = resolveInput(ref);
  if (!isRunnableTokenInput(input)) {
    res.status(400).json({ error: "input must be an exact token contract or DexScreener url" });
    return;
  }
  const quota = await consumeInvestigationQuota(auth, "/api/v1/token", { kind: "token_api" });
  if (quota.error) { res.status(503).json({ error: quota.error }); return; }
  if (!quota.allowed) { res.status(429).json({ error: "daily_investigation_limit_reached", remaining: 0 }); return; }
  try {
    // Inject the direct OFAC screener so this server path records a real
    // sanctions outcome (and applies the AVOID cap) rather than skipping the
    // browser-only same-origin fetch.
    const d = await auditToken(input, undefined, { screenSanctions: screenSanctionedAddresses });
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
      sanctions: d.sanctionsScreen
        ? { screened: d.sanctionsScreen.checked, listSize: d.sanctionsScreen.listSize, sanctioned: d.sanctionsScreen.sanctioned, available: d.sanctionsScreen.available }
        : null,
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
