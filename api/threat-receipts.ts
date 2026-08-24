// Threat scanner receipts ledger — the shared, server-side track record and
// deployer memory. GET reads it; POST records a scan.
//
//   POST  /api/threat-receipts        body: Receipt      -> record a scan
//   GET   /api/threat-receipts?deployer=0x…              -> that wallet's tokens
//   GET   /api/threat-receipts?address=0x…               -> one token's receipt
//   GET   /api/threat-receipts                           -> recent flags + stats
//
// Backed by Supabase (kind='threat-receipt'); returns empty/av=false when no
// store is configured, so the client falls back to its localStorage ledger.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ledgerAvailable, ledgerUpsert, ledgerRecent, ledgerByDeployer, ledgerByFingerprint, ledgerGet, type LedgerReceipt } from "./_ledger.js";

export const config = { maxDuration: 15 };

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const BAD = new Set(["DANGER", "RUG"]);

function statsOf(rows: LedgerReceipt[]) {
  const flagged = rows.filter((r) => BAD.has(r.verdict));
  const checked = flagged.filter((r) => r.checkedAt != null);
  return {
    total: rows.length,
    flagged: flagged.length,
    checked: checked.length,
    confirmedDead: checked.filter((r) => r.status === "dead").length,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!ledgerAvailable()) { res.status(200).json({ available: false }); return; }

  if (req.method === "POST") {
    const body = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) ?? {};
    const address = s(body.address);
    if (!address) { res.status(400).json({ error: "address required" }); return; }
    // Trust only the fields we own; never let a client write arbitrary payload.
    const receipt: LedgerReceipt = {
      address,
      chain: s(body.chain) || "unknown",
      symbol: s(body.symbol).slice(0, 24),
      verdict: ["SAFE", "CAUTION", "DANGER", "RUG", "UNKNOWN"].includes(body.verdict) ? body.verdict : "UNKNOWN",
      risk: Number.isFinite(body.risk) ? Math.max(0, Math.min(100, Math.round(body.risk))) : 0,
      flaggedAt: Number.isFinite(body.flaggedAt) ? body.flaggedAt : Date.now(),
      liqThen: Number.isFinite(body.liqThen) ? body.liqThen : 0,
      deployer: body.deployer ? s(body.deployer).toLowerCase() : null,
      codeVerified: !!body.codeVerified,
      flagCount: Number.isFinite(body.flagCount) ? body.flagCount : 0,
      codeFingerprint: body.codeFingerprint ? s(body.codeFingerprint).toLowerCase().replace(/[^0-9a-f]/g, "") || null : null,
    };
    const ok = await ledgerUpsert(receipt);
    res.status(200).json({ available: true, ok });
    return;
  }

  const deployer = s(req.query.deployer);
  if (deployer) {
    const rows = await ledgerByDeployer(deployer);
    res.status(200).json({ available: true, deployer: deployer.toLowerCase(), receipts: rows, stats: statsOf(rows) });
    return;
  }
  const fingerprint = s(req.query.fingerprint);
  if (fingerprint) {
    const rows = await ledgerByFingerprint(fingerprint);
    res.status(200).json({ available: true, fingerprint: fingerprint.toLowerCase(), receipts: rows, stats: statsOf(rows) });
    return;
  }
  const address = s(req.query.address);
  if (address) {
    const row = await ledgerGet(address);
    res.status(200).json({ available: true, receipt: row });
    return;
  }
  const rows = await ledgerRecent(120);
  res.status(200).json({ available: true, receipts: rows.filter((r) => BAD.has(r.verdict)).slice(0, 60), stats: statsOf(rows) });
}
