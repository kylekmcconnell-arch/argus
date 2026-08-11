// Token authenticity via the project's X bio. GET /api/x-authenticity?handle=&address=&chain=
//
// Enigma's rule: the OFFICIAL token's contract address lives in the project's X
// bio. Launchpads (Bankr, pump.fun) let anyone launch a token under any name, so
// "named Kupo Terminal" != "the real Kupo Terminal's token". We read the linked
// X account's bio and check whether the SCANNED address is in it:
//   - CA in bio            -> verified (this is the official token)
//   - a DIFFERENT CA in bio -> impersonation (the real token is elsewhere)
//   - no CA in bio          -> weak (many legit projects omit it)
//   - bio unreadable        -> say so; prompt manual check
// Keyless X-bio reads are unreliable (X locked them down), so this is best-effort
// keyless and RELIABLE only with an X API bearer (X_API_BEARER).
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const HANDLE = /^[A-Za-z0-9_]{1,20}$/;
const EVM_CA = /0x[0-9a-fA-F]{40}/g;
const SOL_CA = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

async function bioViaApi(handle: string): Promise<string | null> {
  const bearer = process.env.X_API_BEARER;
  if (!bearer) return null;
  try {
    const r = await fetch(`https://api.twitter.com/2/users/by/username/${handle}?user.fields=description,url,entities`, {
      headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    // Include expanded URLs (bios often link the CA via a t.co url).
    const desc = String(d?.data?.description ?? "");
    const urls = (d?.data?.entities?.url?.urls ?? []).concat(d?.data?.entities?.description?.urls ?? [])
      .map((u: any) => `${u.expanded_url ?? ""} ${u.display_url ?? ""}`).join(" ");
    return `${desc} ${urls}`.trim() || null;
  } catch { return null; }
}

async function bioKeyless(handle: string): Promise<string | null> {
  try {
    const r = await fetch(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${handle}`, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html" }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const t = await r.text();
    const m = t.match(/"description":"((?:[^"\\]|\\.)*)"/);
    if (!m) return null;
    try { return JSON.parse(`"${m[1]}"`); } catch { return m[1]; }
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = String(req.query.handle ?? "").replace(/^@/, "").trim();
  const address = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").toLowerCase();
  const sol = chain === "solana";
  if (!HANDLE.test(handle) || !address) { res.status(400).json({ error: "handle and address required" }); return; }
  res.setHeader("cache-control", "s-maxage=1800, stale-while-revalidate=7200");

  const bio = (await bioViaApi(handle)) ?? (await bioKeyless(handle));
  if (bio == null) {
    res.status(200).json({ available: true, handle, status: "unreadable", bioReadable: false, note: `Could not read @${handle}'s X bio (X restricts this without an API key) - verify the contract address in the project's X bio manually.` });
    return;
  }

  const want = sol ? address : address.toLowerCase();
  const cas = (bio.match(sol ? SOL_CA : EVM_CA) ?? []).map((c) => (sol ? c : c.toLowerCase()));
  // For Solana, base58 32-44 also matches normal words; require it to look like a
  // real mint (>=40 chars OR ends in a launchpad suffix) to reduce noise.
  const casFiltered = sol ? cas.filter((c) => c.length >= 40 || /pump$|bonk$|BAGS$/i.test(c)) : cas;
  const matched = casFiltered.includes(want);
  const otherCa = casFiltered.find((c) => c !== want) ?? null;

  const status = matched ? "verified" : otherCa ? "mismatch" : "absent";
  const note = status === "verified"
    ? `The scanned contract is in @${handle}'s X bio - confirmed the official token.`
    : status === "mismatch"
      ? `@${handle}'s X bio lists a DIFFERENT contract (${otherCa!.slice(0, 10)}…) - the scanned token is NOT the one the project points to. Likely a namesake/impersonation.`
      : `@${handle}'s X bio does not contain this (or any) contract address - could not confirm this is the official token; verify manually.`;
  res.status(200).json({ available: true, handle, status, bioReadable: true, otherCa, note });
}
