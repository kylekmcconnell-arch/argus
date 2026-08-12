// Scan-time GMGN launch-pattern reading. GET /api/gmgn-bundle?chain=<chain>&address=<mint>
//
// One free call to GMGN's /v1/token/info answers the launch-shape questions
// ARGUS otherwise has no provider for: how much trading volume GMGN attributes
// to bundler bots and insider traders, how many tagged wallets hold, whether
// the creator still holds or has exited, how many tokens the creator has
// launched, and whether this logo appears on other tokens.
//
// Every figure is GMGN's classification and is published with that attribution.
// The report states the SHAPE (percentages, counts, floors) and never the
// conclusion "this launch was bundled"; GMGN's numbers set no score floors.
// Their per-tag wallet counter stops at 1,000, so counts at the cap are floors.
//
// Scan-time and therefore ungated, on the pattern api/gmgn-holders.ts set: a
// live scan has no persisted report version to bill a panel token against, and
// GMGN is a free keyed API, so middleware's analyst budget is the abuse guard.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { describeGmgnBundle, fetchGmgnBundleReading } from "../server/adapters/gmgn.js";

export const config = { maxDuration: 20 };

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

  const reading = await fetchGmgnBundleReading(chain, address);
  const payload = { ...reading, claims: describeGmgnBundle(reading) };

  // Launch-pattern figures move with trading, so no day-long server cache; a
  // short browser-side one is safe. Same reasoning as the gmgn-holders sibling.
  res.setHeader("cache-control", "private, max-age=300");
  return res.status(200).json(payload);
}
