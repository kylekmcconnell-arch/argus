import { withLedgerOrganization } from "./_ledger.js";
import { requireArgusAuth } from "./_auth.js";
// Receipts re-check cron. GET /api/threat-recheck  (Vercel cron, nightly)
//
// Two jobs, one pass over DexScreener:
//  1. RECEIPTS — re-price every token we flagged DANGER/RUG. A flag on a token
//     that had real liquidity and then went to zero is a receipt.
//  2. VERDICT-FLIP ALERTS — re-price the tokens we rated tradeable (SAFE/CAUTION)
//     too. One that we called OK and then loses its liquidity is the alert that
//     matters most: "we said tradeable, its pool just got pulled." Recorded once
//     per token (no nightly re-spam) and optionally pushed to a webhook.
// Bounded per run so it never runs long or hammers DexScreener.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ledgerAvailable, ledgerDueReceipts, ledgerUpsert, ledgerRecordAlert, ledgerGetAlert, type LedgerReceipt, type ThreatAlert } from "./_ledger.js";

export const config = { maxDuration: 120 };

const MAX_PER_RUN = 120;
const RUN_BUDGET_MS = 80_000;

async function liquidityNow(address: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { pairs?: { liquidity?: { usd?: number } }[] | null };
    if (d.pairs !== null && !Array.isArray(d.pairs)) return null;
    const pairs = d.pairs ?? [];
    if (!pairs.length) return 0; // no pair left = dead market
    return Math.max(...pairs.map((p) => p.liquidity?.usd ?? 0));
  } catch {
    return null;
  }
}

// Fire the alert once per token, and push to THREAT_ALERT_WEBHOOK if configured
// (a generic JSON POST — the user wires it to Telegram/Slack/Discord on their
// side; ARGUS never holds a bot token).
async function emitAlert(alert: ThreatAlert, organizationId: string): Promise<boolean> {
  const existing = await ledgerGetAlert(alert.address);
  if (existing) return false; // already alerted on this token — don't re-spam
  const ok = await ledgerRecordAlert(alert);
  const hook = process.env.THREAT_ALERT_WEBHOOK;
  if (ok && hook && organizationId === process.env.ARGUS_THREAT_ORGANIZATION_ID) {
    try {
      await fetch(hook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(alert),
        signal: AbortSignal.timeout(6000),
      });
    } catch { /* best-effort push */ }
  }
  return ok;
}

const BAD = new Set(["DANGER", "RUG"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Vercel cron requests carry a bearer secret when CRON_SECRET is set; enforce
  // it if present so the endpoint can't be triggered to burn quota.
  const secret = process.env.CRON_SECRET;
  let scope: string | undefined;
  if (!(secret && req.headers.authorization === `Bearer ${secret}`)) {
    const auth = await requireArgusAuth(req, res, "owner");
    if (!auth) return;
    scope = auth.organizationId;
  }
  if (!ledgerAvailable()) { res.status(503).json({ available: false }); return; }
  try {
  const now = Date.now();
  const deadline = now + RUN_BUDGET_MS;
  // Oldest due rows first across every workspace; successful reads and failed
  // attempts move to the back, so one busy/unavailable tenant cannot monopolize runs.
  const queue = await ledgerDueReceipts(MAX_PER_RUN, now, scope);
  let dead = 0, bleeding = 0, alive = 0, updated = 0, alerts = 0, failures = 0, processed = 0;
  const BATCH = 8;
  for (let i = 0; i < queue.length; i += BATCH) {
    if (Date.now() >= deadline) break;
    const slice = queue.slice(i, i + BATCH);
    await Promise.all(slice.map(({ organizationId, receipt: r }) => withLedgerOrganization(organizationId, async () => {
      processed++;
      const liqNow = await liquidityNow(r.address);
      if (liqNow == null) {
        // Preserve measured outcomes; defer failed provider retries for ten minutes.
        failures++;
        if (!await ledgerUpsert({ ...r, recheckAfter: Date.now() + 10 * 60 * 1000 })) throw new Error("threat_ledger_write_failed");
        return;
      }
      const priceDropPct = r.liqThen > 0 ? Math.max(0, Math.min(100, Math.round((1 - liqNow / r.liqThen) * 100))) : 0;
      const status: LedgerReceipt["status"] = liqNow < 1000 ? "dead" : liqNow < r.liqThen * 0.2 ? "bleeding" : "alive";
      if (status === "dead") dead++; else if (status === "bleeding") bleeding++; else alive++;
      const ok = await ledgerUpsert({ ...r, liqNow, priceDropPct, status, checkedAt: now, recheckAfter: 0 });
      if (!ok) throw new Error("threat_ledger_write_failed");
      updated++;

      // Verdict-flip alert: a token we rated TRADEABLE that has now collapsed.
      // (Flagged tokens dying is expected — that's a receipt, not a surprise.)
      const collapsed = status === "dead" || status === "bleeding";
      if (collapsed && !BAD.has(r.verdict) && r.liqThen >= 5000) {
        const fired = await emitAlert({
          address: r.address, chain: r.chain, symbol: r.symbol,
          type: status === "dead" ? "confirmed-dead" : "liquidity-collapse",
          wasVerdict: r.verdict, liqThen: r.liqThen, liqNow, priceDropPct, at: now,
        }, organizationId);
        if (fired) alerts++;
      }
    })));
  }

  res.status(200).json({ available: failures === 0, considered: queue.length, processed, deferred: queue.length - processed, failures, updated, alerts, outcomes: { dead, bleeding, alive } });
  } catch { res.status(503).json({ available: false, error: "threat_ledger_unavailable" }); }
}
