// Scan-time shipping summary.
//   GET /api/shipping-summary?org=<org>|repo=<owner/name>[&address=<token>&chain=<chain>&deployer=<wallet>]
//
// The cheap lane the token audit calls while it runs, so a saved report carries
// a frozen development read (grade, cadence, who, live, adoption, health,
// chart vs commits) that the engine can score, the checklist can close, the
// PDF can print and the next scan can diff. No panel token: like site-safety
// and technical-posture it sits behind the middleware bearer gate, and it
// costs GitHub calls, not dollars. With the token's address and chain it also
// joins the daily price series (keyless) and, with the deployer, the creation
// trail (keyless on Blockscout chains, keyed on Etherscan chains), so the
// frozen card can say "shipping into weakness" and "live" without a click.
// The full assessment with the roster and evidence stays on the paid panel.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { assessShipping, summarizeShipping, type ShippingDeploy, type ShippingPeerRepo, type ShippingPricePoint, type ShippingSummary } from "../src/threat/shipping.js";
import { collectShipping, GITHUB_LOGIN_RE, GITHUB_REPO_RE, type CallCounter } from "../src/threat/shippingCollect.js";
import { deployTrailReadable, readDeployTrail } from "../src/threat/deployTrail.js";
import { fetchOhlcv } from "../src/lib/priceHistory.js";

export const config = { maxDuration: 30 };

const CACHE_BUCKET_MS = 6 * 3600 * 1000;
const ADDR_RE = /^0x[a-fA-F0-9]{40}$|^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const CHAIN_RE = /^[a-z0-9-]{2,30}$/;

export interface ShippingSummaryResponse {
  target: string;
  available: boolean;
  summary?: ShippingSummary;
  note: string;
  _cached?: boolean;
}

/** Daily closes for the token, or undefined when the chart cannot be read. */
async function readPriceSeries(address: string, chain: string): Promise<ShippingPricePoint[] | undefined> {
  const w = await fetchOhlcv(address, chain, undefined, "day").catch(() => null);
  if (!w?.candles.length) return undefined;
  return w.candles.map((c) => ({ date: new Date(c.ts < 1e12 ? c.ts * 1000 : c.ts).toISOString(), close: c.close }));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const key = process.env.GITHUB_TOKEN;
  const org = typeof req.query.org === "string" ? req.query.org.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\/.*$/, "").trim() : "";
  const repoParam = typeof req.query.repo === "string" ? req.query.repo.replace(/^https?:\/\/(www\.)?github\.com\//i, "").replace(/\.git$/, "").trim() : "";
  const address = typeof req.query.address === "string" && ADDR_RE.test(req.query.address.trim()) ? req.query.address.trim() : "";
  const chain = typeof req.query.chain === "string" && CHAIN_RE.test(req.query.chain.trim().toLowerCase()) ? req.query.chain.trim().toLowerCase() : "";
  const deployer = typeof req.query.deployer === "string" && /^0x[a-fA-F0-9]{40}$/.test(req.query.deployer.trim()) ? req.query.deployer.trim() : "";
  const target = repoParam || org;
  if (!target || !(repoParam ? GITHUB_REPO_RE.test(repoParam) : GITHUB_LOGIN_RE.test(target))) { res.status(400).json({ error: "org or repo required" }); return; }
  if (!key) { res.status(200).json({ target, available: false, note: "GitHub not configured (no GITHUB_TOKEN)." } satisfies ShippingSummaryResponse); return; }

  const ck = `ghsummary:${target.toLowerCase()}:${address.toLowerCase()}:${chain}:${deployer.toLowerCase()}:${Math.floor(Date.now() / CACHE_BUCKET_MS)}:v2`;
  const cached = await cacheGetJson<ShippingSummaryResponse>(ck);
  if (cached) { res.status(200).json({ ...cached, _cached: true }); return; }

  const usage: CallCounter = { calls: 0, succeeded: 0 };
  try {
    const peerCache = {
      get: (k: string) => cacheGetJson<ShippingPeerRepo[]>(k),
      set: (k: string, rows: ShippingPeerRepo[]) => cacheSetJson(k, rows),
    };
    const etherscanKey = process.env.ETHERSCAN_API_KEY;
    // The joins run beside the GitHub read; each is best-effort and says so.
    const [input, priceSeries, trail] = await Promise.all([
      collectShipping({ target, kind: repoParam ? "repo" : "org", key, usage, peerCache }),
      address && chain ? readPriceSeries(address, chain) : Promise.resolve(undefined),
      deployer && chain && deployTrailReadable(chain, etherscanKey) ? readDeployTrail({ chain, wallet: deployer, etherscanKey }) : Promise.resolve(null),
    ]);
    const notes = [...(input.readNotes ?? [])];
    if (address && chain && !priceSeries) notes.push("The token's daily price series could not be read, so the chart-versus-commits read is empty.");
    if (deployer && chain && !deployTrailReadable(chain, etherscanKey)) notes.push(`No explorer is configured for ${chain}, so the deployer's creations were not joined.`);
    else if (deployer && chain && trail === null) notes.push("The deployer's creation trail could not be read from the explorer.");
    const deploys: ShippingDeploy[] | undefined = trail ? trail.map((d) => ({ address: d.address, date: d.at, kind: "create" as const })) : undefined;
    const assessment = assessShipping({ ...input, readNotes: notes, ...(priceSeries ? { priceSeries } : {}), ...(deploys ? { deploys } : {}) });
    const summary = summarizeShipping(assessment, new Date().toISOString());
    const out: ShippingSummaryResponse = {
      target,
      available: true,
      summary,
      note: input.repos.length ? assessment.headline : "No public repositories found for this account.",
    };
    await cacheSetJson(ck, out);
    res.status(200).json(out);
  } catch (e) {
    const msg = String(e);
    res.status(200).json({ target, available: false, note: /owner_not_found/.test(msg) ? "No GitHub account or organization exists at that name." : "GitHub shipping summary did not complete." } satisfies ShippingSummaryResponse);
  }
}
