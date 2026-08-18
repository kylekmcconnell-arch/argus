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
// Keyless X-bio reads are unreliable (X locked them down). Primary source is
// twitterapi.io (TWITTERAPI_KEY - the same provider x-find already uses in prod,
// so it's reliable out of the box); falls back to the X API v2 bearer
// (X_API_BEARER), then best-effort keyless, then honest "unreadable".
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

const HANDLE = /^[A-Za-z0-9_]{1,20}$/;
const EVM_CA = /0x[0-9a-fA-F]{40}/g;
const SOL_CA = /[1-9A-HJ-NP-Za-km-z]{32,44}/g;

// Primary source in production: twitterapi.io (same provider x-find uses, so the
// key is already configured). Returns the bio description plus any expanded URLs
// linked from the bio - projects often point the CA via a basescan/etherscan link
// rather than pasting the raw address.
async function bioViaTwitterApi(handle: string): Promise<string | null> {
  const key = process.env.TWITTERAPI_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://api.twitterapi.io/twitter/user/info?userName=${encodeURIComponent(handle)}`, {
      headers: { "x-api-key": key }, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as any;
    const p = d?.data ?? d;
    if (!p || (p.name == null && p.description == null && p.followers == null && p.followers_count == null)) return null;
    const desc = String(p.description ?? p.bio ?? "");
    const urlEntities = [
      ...(p?.profile_bio?.entities?.url?.urls ?? []),
      ...(p?.profile_bio?.entities?.description?.urls ?? []),
      ...(p?.entities?.url?.urls ?? []),
      ...(p?.entities?.description?.urls ?? []),
    ].map((u: any) => `${u?.expanded_url ?? ""} ${u?.display_url ?? ""}`).join(" ");
    const website = typeof p?.url === "string" ? p.url : "";
    return `${desc} ${urlEntities} ${website}`.trim() || (p.name != null ? "" : null);
  } catch { return null; }
}

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

// Memecoin reality: many legit projects publish the CA on a link-aggregator
// page (linktree etc.) rather than in the bio text. When the bio has no CA,
// fetch the aggregator page the bio links and scan it too. Host-allowlisted
// (never an arbitrary URL) and redirects are not followed, so this cannot be
// steered at internal or attacker-chosen targets.
const AGGREGATOR_LINK = /https?:\/\/(?:www\.)?((?:linktr\.ee|beacons\.ai|bio\.link|bio\.site|carrd\.co|linkin\.bio|solo\.to|lynk\.id)\/[A-Za-z0-9._/-]+)/i;

async function linkedPageText(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; ARGUS-authenticity)", accept: "text/html" },
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    if (!r.ok) return null;
    return (await r.text()).slice(0, 400_000);
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const handle = String(req.query.handle ?? "").replace(/^@/, "").trim();
  const address = String(req.query.address ?? "").trim();
  const chain = String(req.query.chain ?? "").toLowerCase();
  const sol = chain === "solana";
  if (!HANDLE.test(handle) || !address) { res.status(400).json({ error: "handle and address required" }); return; }
  res.setHeader("cache-control", "s-maxage=1800, stale-while-revalidate=7200");

  const bio = (await bioViaTwitterApi(handle)) ?? (await bioViaApi(handle)) ?? (await bioKeyless(handle));
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

  let status = matched ? "verified" : otherCa ? "mismatch" : "absent";
  let via: "bio" | "linked-page" = "bio";
  let note = status === "verified"
    ? `The scanned contract is in @${handle}'s X bio - confirmed the official token.`
    : status === "mismatch"
      ? `@${handle}'s X bio lists a DIFFERENT contract (${otherCa!.slice(0, 10)}…) - the scanned token is NOT the one the project points to. Likely a namesake/impersonation.`
      : `@${handle}'s X bio does not contain this (or any) contract address - could not confirm this is the official token; verify manually.`;

  if (status === "absent") {
    const aggregator = bio.match(AGGREGATOR_LINK);
    if (aggregator) {
      const pageHost = aggregator[1].split("/")[0];
      const page = await linkedPageText(`https://${aggregator[1]}`);
      if (page) {
        const pageCas = (page.match(sol ? SOL_CA : EVM_CA) ?? []).map((c) => (sol ? c : c.toLowerCase()));
        const pageFiltered = sol ? pageCas.filter((c) => c.length >= 40 || /pump$|bonk$|BAGS$/i.test(c)) : pageCas;
        if (pageFiltered.includes(want)) {
          status = "verified";
          via = "linked-page";
          note = `The scanned contract is published on @${handle}'s linked page (${pageHost}) - confirmed the official token.`;
        } else if (pageFiltered.length) {
          note = `${note} The account's linked page (${pageHost}) lists a different contract; treat the name match with care.`;
        }
      }
    }
  }
  res.status(200).json({ available: true, handle, status, bioReadable: true, otherCa, via, note });
}
