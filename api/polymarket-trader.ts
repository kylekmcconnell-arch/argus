// Scan-time Polymarket trader-record check. GET /api/polymarket-trader?wallet=<addr>
//
// A trading claim ("passive $6k a month") is only checkable when the poster
// published a wallet. This route reads that wallet's public record from
// Polymarket's keyless APIs and returns it beside the derived shape of the
// curve, so a report can quote the record instead of the claim.
//
// Like api/deployer-risk.ts and api/deployer-origin.ts this is a SCAN-TIME
// route. Those two exist because their gated panel siblings hard-require an
// x-argus-panel-token bound to a PERSISTED report version, which a live scan
// does not have: it is still producing the version that token would be issued
// against, so every scan-time call answered 409. Same split here, with one
// difference that makes the case easier rather than harder: there is no key to
// burn at all. Every endpoint behind this route is public and keyless, so the
// analyst metering that middleware applies is purely an abuse guard, and there
// is no cost line to attach to a report version that does not exist yet.
//
// Nothing is computed here. Every figure comes from src/polymarket: the record
// from the adapter, the derived shape from record.ts. Two code paths that word
// the same fact differently is a defect this codebase has already been bitten
// by, which is why api/deployer.ts and api/deployer-origin.ts share their copy
// helpers rather than each phrasing the funding trail their own way.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import { fetchTraderRecord, normalizeWalletInput, INVALID_INPUT_MESSAGE } from "../src/polymarket/trader.js";
import { analyzeRecord, type RecordAnalysis } from "../src/polymarket/record.js";
import type { TraderRecord } from "../src/polymarket/types.js";

// The adapter's nine requests run concurrently on a 9s per-request timeout, so
// the whole record is bounded well under this cap. Timeouts stay the adapter's
// to own: a second number here would be a second policy.
export const config = { maxDuration: 20 };

// Five minutes. An open position's value and the day's cumulative PnL both move
// while the market does, so a day-long TTL would answer today's question with
// yesterday's curve. Short enough to stay current, long enough that rescanning
// one subject inside a session does not re-spend the calls behind a record.
const TTL_MS = 5 * 60 * 1000;

// What a published wallet is evidence OF, carried with the data so no caller
// has to re-derive it. This is the proven-vs-attributed split DeployerAttribution
// draws in src/token/audit.ts: only a source that saw the creation signed earns
// the word "deployer", and everything weaker takes the cautious label. The
// record below is proven; who holds the keys is not, and neither is the absence
// of other wallets, which no public endpoint can show.
const ATTRIBUTION = {
  kind: "published-wallet" as const,
  proves: "the trading record of this wallet",
  doesNotProve: [
    "that the account which published it holds its keys",
    "that the same person trades no other wallet",
  ],
};

interface CacheEnvelope {
  cachedAt: number;
  record: TraderRecord;
  analysis: RecordAnalysis;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") { res.status(405).json({ error: "GET required" }); return; }

  // Validated before any outbound call: a malformed address cannot answer, so
  // spending nine requests to find that out is pure waste. The rule belongs to
  // the adapter, which also refuses a social handle, and the refusal is worded
  // once there: a guessed wallet would be somebody else's trading history.
  //
  // What comes back is already the canonical lowercase address, so it is what
  // the cache keys on and what this reply echoes, which keeps the wallet here
  // identical to the one inside the record it carries.
  const wallet = normalizeWalletInput(typeof req.query.wallet === "string" ? req.query.wallet : "");
  if (!wallet) { res.status(400).json({ error: INVALID_INPUT_MESSAGE }); return; }

  const ck = `polymarket-trader:${wallet}:v1`;
  // cacheSetJson pins its row for a day, which is far too long for a live
  // trading record, so the age rides in the payload and a stale hit is read as
  // a miss rather than served.
  const cached = await cacheGetJson<CacheEnvelope>(ck);
  if (cached && Date.now() - cached.cachedAt < TTL_MS) {
    res.status(200).json({
      wallet,
      available: true,
      partial: false,
      attribution: ATTRIBUTION,
      record: cached.record,
      analysis: cached.analysis,
      _cached: true,
    });
    return;
  }

  try {
    const record = await fetchTraderRecord(wallet);
    const analysis = analyzeRecord(record);
    const partial = record.failures.length > 0;
    // A provider outage is never frozen into a clean-looking answer for the next
    // caller. A record with failures is missing fields that are unmeasured, not
    // zero, and caching it would hand the next scan a gap it cannot see.
    if (!partial) await cacheSetJson(ck, { cachedAt: Date.now(), record, analysis } satisfies CacheEnvelope);
    res.status(200).json({ wallet, available: true, partial, attribution: ATTRIBUTION, record, analysis });
  } catch (e) {
    // A lookup that never completed is not a trader with no record. The caller
    // has to be able to tell "this wallet has traded nothing" from "we did not
    // get to ask", so the failure is reported and nothing is cached.
    res.status(200).json({ wallet, available: false, error: String(e), note: "Polymarket record lookup failed." });
  }
}
