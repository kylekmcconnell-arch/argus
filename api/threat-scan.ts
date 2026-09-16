import { requireArgusAuth } from "./_auth.js";
// Full-scan cache for sharing. A shared ?threat= link should open the REPORT,
// not re-run a multi-minute scan - so the completed scan object is stored
// (one row per token, kind='threat-scan' in the reports table) and served back
// to anyone opening the link within the freshness window. After the window the
// scan re-runs live; the receipt ledger (threat-receipts) is unchanged.
// GET  /api/threat-scan?address=&chain=   -> { hit, ageMs, scan } (fresh only)
// POST /api/threat-scan  { scan }         -> stores it (fire-and-forget client)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { ThreatScan } from "../src/threat/types";

const FRESH_MS = 60 * 60 * 1000; // shared links serve the cached report for 1h
const KIND = "threat-scan";
// A scan cached by an older build has a stale SHAPE (missing new checks/panels).
// Tag every stored scan with the deploy's commit SHA and only serve hits from
// the current build, so shipping an improvement invalidates old cached scans
// automatically instead of showing pre-feature results for up to an hour.
const BUILD = process.env.VERCEL_GIT_COMMIT_SHA || "dev";

function creds() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  return url && key ? { url: url.replace(/\/$/, ""), key } : null;
}
const headers = (key: string) => ({ apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" });
const norm = (s: unknown) => { const value = String(s ?? "").trim(); return /^0x[0-9a-f]+$/i.test(value) ? value.toLowerCase() : value; };
const normChain = (s: unknown) => String(s ?? "").trim().toLowerCase();
// The same EVM address exists on several chains (CREATE2 / same-nonce deploys,
// for legitimate multichain tokens and scam clones alike). The row key is the
// chain-scoped asset identity, exactly as the receipts ledger (_ledger.js
// assetKey) keys it, so a Base scan can never be overwritten by - or served
// as - the Ethereum token at the same address.
const assetKey = (chain: string, address: string) => `${chain || "unknown"}:${address}`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const c = creds();
  if (!c) { res.status(200).json({ available: false }); return; }

  if (req.method === "POST") {
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? req.body as { scan?: Partial<ThreatScan> }
      : {};
    const scan = body.scan;
    const address = norm(scan?.address);
    const chain = normChain(scan?.chain);
    if (!address || !chain || typeof scan?.scannedAt !== "number" || !scan?.call?.verdict) {
      res.status(400).json({ error: "scan payload with address and chain required" }); return;
    }
    // Bound the stored blob; a full scan is tens of KB - reject absurd bodies.
    if (JSON.stringify(scan).length > 400_000) { res.status(413).json({ error: "too large" }); return; }
    const row = {
      organization_id: auth.organizationId,
      ref: assetKey(chain, address), kind: KIND,
      query: scan.symbol ? `$${scan.symbol}` : address,
      verdict: scan.call.verdict ?? null,
      score: typeof scan.call.risk === "number" ? scan.call.risk : null,
      payload: { ...scan, __build: BUILD }, ts: new Date().toISOString(),
    };
    const r = await fetch(`${c.url}/rest/v1/reports?on_conflict=organization_id,ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    res.status(r?.ok ? 200 : 503).json({ available: !!r?.ok, ok: !!r?.ok });
    return;
  }

  const address = norm(req.query.address);
  const chain = normChain(req.query.chain);
  if (!address) { res.status(400).json({ error: "address required" }); return; }
  // A lookup that does not say which chain it means cannot be matched to a
  // chain-scoped row; it is a miss (the caller runs the scan live), never a
  // guess at whichever chain's report happens to be stored.
  if (!chain) { res.status(200).json({ available: true, hit: false, note: "chain required for a cached report" }); return; }
  try {
    const r = await fetch(
      `${c.url}/rest/v1/reports?organization_id=eq.${encodeURIComponent(auth.organizationId)}&select=payload,ts&kind=eq.${KIND}&ref=eq.${encodeURIComponent(assetKey(chain, address))}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) { res.status(503).json({ available: false, hit: false }); return; }
    const rows = (await r.json()) as { payload?: Partial<ThreatScan> & { __build?: string }; ts?: string }[];
    const row = rows?.[0];
    const scannedAt = typeof row?.payload?.scannedAt === "number" ? row.payload.scannedAt : row?.ts ? Date.parse(row.ts) : 0;
    const ageMs = Date.now() - scannedAt;
    const staleBuild = (row?.payload?.__build ?? "") !== BUILD;
    // Belt and braces: a stored scan whose own chain disagrees with the request
    // is the other chain's token, whatever row it was found under.
    const wrongChain = normChain(row?.payload?.chain) !== chain;
    if (!row?.payload || staleBuild || wrongChain || !(ageMs >= 0 && ageMs < FRESH_MS)) { res.status(200).json({ available: true, hit: false }); return; }
    const scan = { ...row.payload };
    delete scan.__build;
    res.status(200).json({ available: true, hit: true, ageMs, scan });
  } catch {
    res.status(503).json({ available: false, hit: false });
  }
}
