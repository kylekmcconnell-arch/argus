// Receipts re-check cron. GET /api/threat-recheck  (Vercel cron, nightly)
//
// The credibility engine: take every token this scanner flagged DANGER/RUG and
// re-price it against DexScreener. A flag on a token that had real liquidity and
// then went to zero is a receipt — "flagged at $32K, now $0, dead." Recovered
// tokens are updated honestly too (a track record with the misses left in means
// something). Bounded per run so it never runs long or hammers DexScreener.
import type { VercelRequest, VercelResponse } from "@vercel/node";
// @ts-ignore — bundled JS sibling
import { ledgerAvailable, ledgerFlagged, ledgerUpsert, type LedgerReceipt } from "./_ledger.js";

export const config = { maxDuration: 60 };

const MAX_PER_RUN = 80;
const STALE_MS = 12 * 3600 * 1000; // don't re-check something checked in the last 12h

async function liquidityNow(address: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { pairs?: { liquidity?: { usd?: number } }[] };
    const pairs = d.pairs ?? [];
    if (!pairs.length) return 0; // no pair left = dead market
    return Math.max(...pairs.map((p) => p.liquidity?.usd ?? 0));
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron requests carry a bearer secret when CRON_SECRET is set; enforce
  // it if present so the endpoint can't be triggered to burn quota.
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) { res.status(401).json({ error: "unauthorized" }); return; }
  if (!ledgerAvailable()) { res.status(200).json({ available: false }); return; }

  const now = Date.now();
  const flagged = (await ledgerFlagged(300))
    .filter((r) => r.checkedAt == null || now - r.checkedAt > STALE_MS)
    .slice(0, MAX_PER_RUN);

  let dead = 0, bleeding = 0, alive = 0, updated = 0;
  // Small concurrency so the whole batch fits the maxDuration budget.
  const BATCH = 8;
  for (let i = 0; i < flagged.length; i += BATCH) {
    const slice = flagged.slice(i, i + BATCH);
    await Promise.all(slice.map(async (r: LedgerReceipt) => {
      const liqNow = await liquidityNow(r.address);
      if (liqNow == null) return; // fetch failed — leave the receipt untouched
      const priceDropPct = r.liqThen > 0 ? Math.max(0, Math.min(100, Math.round((1 - liqNow / r.liqThen) * 100))) : undefined;
      const status: LedgerReceipt["status"] = liqNow < 1000 ? "dead" : liqNow < r.liqThen * 0.2 ? "bleeding" : "alive";
      if (status === "dead") dead++; else if (status === "bleeding") bleeding++; else alive++;
      const ok = await ledgerUpsert({ ...r, liqNow, priceDropPct, status, checkedAt: now });
      if (ok) updated++;
    }));
  }

  res.status(200).json({ available: true, considered: flagged.length, updated, outcomes: { dead, bleeding, alive } });
}
