// Full-scan cache for sharing. A shared ?threat= link should open the REPORT,
// not re-run a multi-minute scan - so the completed scan object is stored
// (one row per token, kind='threat-scan' in the reports table) and served back
// to anyone opening the link within the freshness window. After the window the
// scan re-runs live; the receipt ledger (threat-receipts) is unchanged.
// GET  /api/threat-scan?address=&chain=   -> { hit, ageMs, scan } (fresh only)
// POST /api/threat-scan  { scan }         -> stores it (fire-and-forget client)
import type { VercelRequest, VercelResponse } from "@vercel/node";

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
const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const c = creds();
  if (!c) { res.status(200).json({ available: false }); return; }

  if (req.method === "POST") {
    const scan = (req.body as any)?.scan;
    const address = norm(scan?.address);
    if (!address || typeof scan?.scannedAt !== "number" || !scan?.call?.verdict) {
      res.status(400).json({ error: "scan payload required" }); return;
    }
    // Bound the stored blob; a full scan is tens of KB - reject absurd bodies.
    if (JSON.stringify(scan).length > 400_000) { res.status(413).json({ error: "too large" }); return; }
    const row = {
      ref: address, kind: KIND,
      query: scan.symbol ? `$${scan.symbol}` : address,
      verdict: scan.call.verdict ?? null,
      score: typeof scan.call.risk === "number" ? scan.call.risk : null,
      payload: { ...scan, __build: BUILD }, ts: new Date().toISOString(),
    };
    const r = await fetch(`${c.url}/rest/v1/reports?on_conflict=ref,kind`, {
      method: "POST",
      headers: { ...headers(c.key), prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    res.status(200).json({ ok: !!r?.ok });
    return;
  }

  const address = norm(req.query.address);
  if (!address) { res.status(400).json({ error: "address required" }); return; }
  try {
    const r = await fetch(
      `${c.url}/rest/v1/reports?select=payload,ts&kind=eq.${KIND}&ref=eq.${encodeURIComponent(address)}&limit=1`,
      { headers: headers(c.key), signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) { res.status(200).json({ available: true, hit: false }); return; }
    const rows = (await r.json()) as { payload?: any; ts?: string }[];
    const row = rows?.[0];
    const scannedAt = typeof row?.payload?.scannedAt === "number" ? row.payload.scannedAt : row?.ts ? Date.parse(row.ts) : 0;
    const ageMs = Date.now() - scannedAt;
    const staleBuild = (row?.payload?.__build ?? "") !== BUILD;
    if (!row?.payload || staleBuild || !(ageMs >= 0 && ageMs < FRESH_MS)) { res.status(200).json({ available: true, hit: false }); return; }
    const { __build, ...scan } = row.payload;
    res.status(200).json({ available: true, hit: true, ageMs, scan });
  } catch {
    res.status(200).json({ available: true, hit: false });
  }
}
