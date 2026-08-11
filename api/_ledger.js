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
const ALERT_KIND = "threat-alert";

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

// Recently-scanned tokens we rated tradeable (SAFE/CAUTION). The re-check cron
// re-prices these too, so a token we called OK that then loses its liquidity
// surfaces as a verdict-flip alert.
export async function ledgerRatedOk(limit = 200) {
  return query(`select=payload&kind=eq.${KIND}&or=(verdict.eq.SAFE,verdict.eq.CAUTION)&order=ts.desc&limit=${Math.min(500, limit)}`);
}

// ---- verdict-flip alerts ----
// An alert is emitted by the cron when a re-check finds a material adverse change
// on a token (liquidity collapse / went dead). Stored under its own kind; ref is
// the token address so re-alerting the same token overwrites rather than piles up.
export async function ledgerRecordAlert(alert) {
  const c = creds();
  if (!c || !alert?.address) return false;
  try {
    const row = {
      ref: normAddr(alert.address),
      kind: ALERT_KIND,
      query: alert.symbol ? `$${alert.symbol}` : normAddr(alert.address),
      verdict: alert.type ?? null,
      payload: alert,
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

export async function ledgerRecentAlerts(limit = 60) {
  return query(`select=payload&kind=eq.${ALERT_KIND}&order=ts.desc&limit=${Math.min(200, Math.max(1, limit))}`);
}

// The current alert (if any) recorded for a token — so the cron doesn't re-emit
// the same alert on every run.
export async function ledgerGetAlert(address) {
  const a = normAddr(address);
  if (!a) return null;
  const rows = await query(`select=payload&kind=eq.${ALERT_KIND}&ref=eq.${encodeURIComponent(a)}&limit=1`);
  return rows[0] ?? null;
}

// Every token sharing a runtime-bytecode fingerprint — byte-identical contracts
// are the SAME trap wearing a new ticker. Powers the known-rug-clone detector.
export async function ledgerByFingerprint(fingerprint) {
  const fp = String(fingerprint || "").toLowerCase().replace(/[^0-9a-f]/g, "");
  if (fp.length < 8) return [];
  return query(`select=payload&kind=eq.${KIND}&payload->>codeFingerprint=eq.${encodeURIComponent(fp)}&order=ts.desc&limit=50`);
}

// ---- wallet reputation: holder → token edges ----
// The thing that closes RAVN's only durable moat over time. Every time we scan
// a token we record which top holders held it (with our verdict at the time);
// the nightly re-check already learns whether each token later died. A wallet's
// reputation is then: how many scanned tokens it has held, and how many of them
// went to zero. It compounds from the first scan forward. One row per
// (wallet, token) edge so a re-scan overwrites rather than piling up.
const EDGE_KIND = "holder-edge";

export async function ledgerRecordHolderEdges(token, symbol, verdict, wallets) {
  const c = creds();
  const t = normAddr(token);
  if (!c || !t || !Array.isArray(wallets) || !wallets.length) return false;
  const at = new Date().toISOString();
  const rows = wallets.slice(0, 40).map((w) => {
    const wl = normAddr(w);
    return { ref: `${wl}|${t}`, kind: EDGE_KIND, query: symbol ? `$${symbol}` : t, verdict: verdict ?? null, payload: { wallet: wl, token: t, symbol: symbol ?? null, verdictAtScan: verdict ?? null, at } };
  }).filter((r) => r.payload.wallet);
  if (!rows.length) return false;
  try {
    const r = await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(8000),
    });
    return r.ok;
  } catch {
    return false;
  }
}

// For a set of wallets: their prior token edges joined with each token's current
// outcome (a threat-receipt with status 'dead' = it went to zero). Returns a map
// wallet -> { held, dead, deadSymbols }.
export async function ledgerWalletReputation(wallets) {
  const c = creds();
  if (!c || !Array.isArray(wallets) || !wallets.length) return {};
  const ws = wallets.map(normAddr).filter(Boolean).slice(0, 40);
  if (!ws.length) return {};
  const edges = await query(`select=payload&kind=eq.${EDGE_KIND}&payload->>wallet=in.(${ws.map(encodeURIComponent).join(",")})&limit=2000`);
  if (!edges.length) return {};
  // Outcome per token: pull the threat-receipts for the tokens seen in the edges.
  const tokens = [...new Set(edges.map((e) => e.token).filter(Boolean))];
  const statusOf = new Map();
  for (let i = 0; i < tokens.length; i += 40) {
    const slice = tokens.slice(i, i + 40);
    const recs = await query(`select=payload&kind=eq.${KIND}&ref=in.(${slice.map(encodeURIComponent).join(",")})`);
    for (const r of recs) if (r.address) statusOf.set(normAddr(r.address), r.status ?? "alive");
  }
  const rep = {};
  for (const e of edges) {
    const w = e.wallet; if (!w) continue;
    const r = rep[w] || (rep[w] = { held: 0, dead: 0, deadSymbols: [] });
    r.held += 1;
    if (statusOf.get(e.token) === "dead") { r.dead += 1; if (e.symbol && r.deadSymbols.length < 5) r.deadSymbols.push(e.symbol); }
  }
  return rep;
}
