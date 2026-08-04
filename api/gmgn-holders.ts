// Scan-time GMGN holder reading. GET /api/gmgn-holders?chain=<chain>&address=<mint>
//
// What GMGN answers that nothing else here does is what each top holder PAID.
// "The largest holder has 31% of supply" does not say whether they are likely to
// sell; "they are underwater on a $52M position" does. Their per-wallet risk
// tags come along with it, carried as THEIR classification.
//
// Corroboration, not replacement. GoPlus and RugCheck stay primary for holder
// concentration and contract safety: they are independent of GMGN, and two
// sources agreeing is stronger than either alone. Swapping one out for a
// provider that explicitly disclaims high availability would trade independent
// corroboration for a single point of failure.
//
// Scan-time and therefore ungated, on the pattern api/deployer-risk.ts set: a
// live scan has no persisted report version to bill a panel token against.
// GMGN is a free keyed API with no per-call marginal cost, so middleware's
// analyst budget is the abuse guard.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describeGmgnHolders, fetchGmgnTokenIntel, riskTagsOf } from "../server/adapters/gmgn.js";

export const config = { maxDuration: 20 };

/**
 * Deliberately uncached. The shared provider cache holds entries for 24 hours,
 * and cost basis, holdings and PnL move continuously: a day-old reading served
 * as current would misstate the one thing this route exists to report. GMGN is
 * free and bounded only by a one-per-second limit, so the cache would buy time,
 * not money, and would pay for it in accuracy.
 */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const chain = String(req.query.chain ?? "").trim().toLowerCase();
  const address = String(req.query.address ?? "").trim();
  if (!chain || !address) return res.status(400).json({ error: "chain and address are required" });
  // Bound before spending a call: an address this long is not one we can ask about.
  if (address.length > 128) return res.status(400).json({ error: "address is not a token address" });

  const intel = await fetchGmgnTokenIntel(chain, address, { limit: 20 });
  const payload = {
    available: intel.available,
    note: intel.note,
    capped: intel.capped,
    claims: describeGmgnHolders(intel),
    holders: intel.holders.map((holder) => ({
      address: holder.address,
      percent: holder.percent,
      usdValue: holder.usdValue,
      costUsd: holder.costUsd,
      profitUsd: holder.profitUsd,
      riskTags: riskTagsOf(holder),
      suspicious: holder.suspicious,
      xHandle: holder.xHandle,
      exchange: holder.exchange,
    })),
  };

  // A short browser-side cache is safe; a day-long server one is not.
  res.setHeader("cache-control", "private, max-age=60");
  return res.status(200).json(payload);
}
