// Shared Supabase helpers for the threat scanner's SERVER-side receipts ledger —
// the shared "we called it" track record + deployer memory that the client's
// localStorage ledger (src/threat/receipts.ts) can only ever see its own slice
// of. One row per token in the existing `reports` table, kind='threat-receipt',
// ref=normalized contract address. Payload carries the full Receipt.
//
// Underscore sibling: importable by api/ functions, never an exposed route.
// api/ functions can't import server/ at runtime (bundling), so this duplicates
// the tiny creds/headers shape from _cache.js on purpose.

const KIND = "threat-receipt";

function creds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
const normAddr = (s) => String(s || "").trim().toLowerCase();

export function ledgerAvailable() {
  return !!creds();
}

// Upsert one receipt (merge-duplicates on ref,kind — a re-check overwrites the
// same row instead of appending).
export async function ledgerUpsert(receipt) {
  const c = creds();
  if (!c || !receipt?.address) return false;
  try {
    const row = {
      ref: normAddr(receipt.address),
      kind: KIND,
      query: receipt.symbol ? `$${receipt.symbol}` : normAddr(receipt.address),
      verdict: receipt.verdict ?? null,
      score: typeof receipt.risk === "number" ? receipt.risk : null,
      payload: receipt,
      ts: new Date().toISOString(),
    };
    const r = await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function query(params) {
  const c = creds();
  if (!c) return [];
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?${params}`, {
      headers: headers(c.key),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return [];
    const rows = await r.json();
    return (rows ?? []).map((row) => row.payload).filter(Boolean);
  } catch {
    return [];
  }
}

// Most recent receipts (the public track record).
export async function ledgerRecent(limit = 100) {
  return query(`select=payload&kind=eq.${KIND}&order=ts.desc&limit=${Math.min(500, Math.max(1, limit))}`);
}

// Every token a given deployer wallet has shipped that we've scanned — the
// shared rug-factory memory. PostgREST JSON filter on payload->>deployer.
export async function ledgerByDeployer(deployer) {
  const d = normAddr(deployer);
  if (!d) return [];
  return query(`select=payload&kind=eq.${KIND}&payload->>deployer=eq.${encodeURIComponent(d)}&order=ts.desc&limit=100`);
}

// A single token's receipt, if we've scanned it before.
export async function ledgerGet(address) {
  const a = normAddr(address);
  if (!a) return null;
  const rows = await query(`select=payload&kind=eq.${KIND}&ref=eq.${encodeURIComponent(a)}&limit=1`);
  return rows[0] ?? null;
}

// Flagged receipts (DANGER/RUG) for the re-check cron.
export async function ledgerFlagged(limit = 200) {
  return query(`select=payload&kind=eq.${KIND}&or=(verdict.eq.DANGER,verdict.eq.RUG)&order=ts.desc&limit=${Math.min(500, limit)}`);
}
