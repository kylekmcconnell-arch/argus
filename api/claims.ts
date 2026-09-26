// Claims ledger. GET /api/claims?website=&telegram=&description=&cg=
//
// A project's own statements, collected where it makes them - the linked
// site and its app bundle, the Telegram channel preview, the token's on-chain
// description, the aggregator blurb - and typed so the scan can test each one
// against the evidence it already has. This route only collects and types;
// the verdicts live in src/threat/claims.ts, where product probe, launch
// trace, fee trace and sell tape are in scope.
//
// Why: a friend's bot summarised $HADES from the team's narrative ("smart
// router across Railgun, 0xbow, Houdini"; "no snipers at launch"; "fees to
// holders") while the code and the chain said otherwise. The gap was not the
// evidence - it was that the claims were never written down to be tested.
import { fetchPublicScript, fetchPublicText } from "./_collector.js";
import { bundleCopy, bundleUrls, hostOf, sentences, visibleText } from "./_productText";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

export type ClaimKind =
  | "router"          // routes / aggregates across named privacy protocols
  | "original"        // built by us, proprietary, cypherpunk pedigree
  | "fees-to-holders" // fees or revenue go to holders, buybacks, burns
  | "dev-locked"      // team / dev allocation locked or vested
  | "no-snipers"      // no snipers, KOLs, bundles, presale, insiders at launch
  | "no-custody"      // non-custodial / never holds funds
  | "compliance"      // OFAC / KYC / AML / sanctions screening
  | "audit"           // audited by
  | "doxxed"          // public / KYC'd team
  | "partnership";    // integration with / partnered with a named third party

export interface ProjectClaim {
  kind: ClaimKind;
  text: string;
  source: "website" | "bundle" | "telegram" | "on-chain description" | "aggregator";
  url: string | null;
  // Named third parties the claim leans on (routers, partners, auditors).
  names: string[];
}

// Provider and partner names a claim can lean on. Kept as plain names: the
// verdict step compares them with what the product's client actually loads.
const PROVIDER_NAMES: { name: string; re: RegExp }[] = [
  { name: "Railgun", re: /\brailgun\b/i },
  { name: "Privacy Pools", re: /\b(0xbow|privacy pools?)\b/i },
  { name: "Houdini Swap", re: /\bhoudini(swap)?\b/i },
  { name: "Tornado Cash", re: /\btornado\b/i },
  { name: "Starknet", re: /\bstarknet\b/i },
  { name: "Aztec", re: /\baztec\b/i },
  { name: "Zcash", re: /\b(zcash|zec)\b/i },
  { name: "Monero", re: /\b(monero|xmr)\b/i },
  { name: "THORChain", re: /\bthor(chain|swap)\b/i },
  { name: "Umbra", re: /\bumbra\b/i },
  { name: "Peer.xyz", re: /\bpeer\.xyz\b/i },
  { name: "ZKP2P", re: /\bzkp2p\b/i },
  { name: "CertiK", re: /\bcertik\b/i },
  { name: "Hashlock", re: /\bhash?lock\b/i },
  { name: "Pashov", re: /\bpashov\b/i },
];

const KINDS: { kind: ClaimKind; re: RegExp }[] = [
  { kind: "router", re: /\b(smart[- ]?router|multi[- ]?protocol|aggregat(or|es|ing)|routes? (across|through|via)|picks? the (fastest|best|most efficient)|across (multiple|several) (privacy )?(protocols|layers|mixers))\b/i },
  { kind: "original", re: /\b(built (by|from the ground up|in[- ]house)|our (own|proprietary) (protocol|engine|router|tech|stack)|proprietary|in[- ]house|from (the )?ground up|true (privacy|cypherpunks?)|real (privacy|cypherpunks?)|cypherpunks?|\bOGs?\b|trench(es| warriors?)?|tor net|onions?\b)/i },
  { kind: "fees-to-holders", re: /\b(fees?|revenue|profits?)\b.{0,80}\b(holders|buy ?backs?|burn(s|ed|ing)?|distribut(ed|ion)|stakers?|dividends?)\b|\b(buy ?backs?|burn(s|ing)?)\b.{0,60}\b(fees?|revenue)\b/i },
  { kind: "dev-locked", re: /\b(dev|team|founder)s?'?\s*(wallet|allocation|tokens?|supply)?\b.{0,40}\b(locked|vest(ed|ing)|time ?lock)\b/i },
  { kind: "no-snipers", re: /\b(no|zero|without)\s+(kols?|snipers?|sniping|bundl(e|es|ing)|presale|pre-sale|insiders?|team allocation)\b/i },
  { kind: "no-custody", re: /\b(non[- ]?custodial|no (fund )?custody|never (holds?|custod(y|ies)|touch(es)?) (your |user )?funds|aggregator,? not a mixer)\b/i },
  { kind: "compliance", re: /\b(ofac|kyc|aml|compliance|compliant|sanctions? (screen|check)|geo-?block)/i },
  { kind: "audit", re: /\baudit(ed|s)?\b/i },
  { kind: "doxxed", re: /\b(doxx?ed|kyc'?d team|public team|real names?)\b/i },
  { kind: "partnership", re: /\b(integrat(ion|ed|ing)( with| in progress| coming)?|partner(ed|ship|ships)?( with)?|powered by|in partnership|off-?ramp (via|with|through))\b/i },
];

export function extractClaims(text: string, source: ProjectClaim["source"], url: string | null): ProjectClaim[] {
  const out: ProjectClaim[] = [];
  const seen = new Set<string>();
  for (const s of sentences(text)) {
    for (const k of KINDS) {
      if (!k.re.test(s)) continue;
      const key = `${k.kind}:${s.toLowerCase().slice(0, 80)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const names = PROVIDER_NAMES.filter((p) => p.re.test(s)).map((p) => p.name);
      out.push({ kind: k.kind, text: s.slice(0, 300), source, url, names });
      if (out.length >= 40) return out;
    }
  }
  return out;
}

async function telegramPreview(handle: string): Promise<{ text: string; members: number | null; url: string } | null> {
  const clean = handle.replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_]{4,32}$/.test(clean)) return null;
  const url = `https://t.me/${clean}`;
  try {
    const r = await fetchPublicText(url);
    if (r.status !== "ok") return null;
    const html = r.text.slice(0, 200_000);
    const title = html.match(/<div class="tgme_page_title"[^>]*>\s*<span[^>]*>([^<]*)<\/span>/i)?.[1] ?? "";
    const desc = html.match(/<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? "";
    const extra = html.match(/<div class="tgme_page_extra">([^<]*)<\/div>/i)?.[1] ?? "";
    const members = extra.match(/([\d\s,]+)\s+(members|subscribers)/i)?.[1]?.replace(/[\s,]/g, "");
    const text = visibleText(`${title}. ${desc}`);
    return { text, members: members ? Number(members) : null, url };
  } catch { return null; }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const website = String(req.query.website ?? "").trim();
  const telegram = String(req.query.telegram ?? "").trim();
  const description = String(req.query.description ?? "").trim().slice(0, 2000);
  const cg = String(req.query.cg ?? "").trim().slice(0, 4000);
  res.setHeader("cache-control", "s-maxage=1800, stale-while-revalidate=7200");

  const claims: ProjectClaim[] = [];
  const sources: string[] = [];
  const unavailable: string[] = [];

  if (description) { claims.push(...extractClaims(description, "on-chain description", null)); sources.push("on-chain description"); }
  if (cg) { claims.push(...extractClaims(cg, "aggregator", null)); sources.push("aggregator"); }

  if (/^https?:\/\//i.test(website) && hostOf(website)) {
    try {
      const page = await fetchPublicText(website);
      if (page.status === "ok") {
        const html = page.text.slice(0, 400_000);
        claims.push(...extractClaims(visibleText(html), "website", page.url || website));
        sources.push("website");
        for (const b of bundleUrls(html, page.url || website, 2)) {
          try {
            const r = await fetchPublicScript(b);
            if (r.status === "ok") { claims.push(...extractClaims(bundleCopy(r.text.slice(0, 2_500_000)), "bundle", b)); sources.push("bundle"); }
          } catch { /* bounded */ }
        }
      } else unavailable.push(`website: ${page.reason ?? "unavailable"}`);
    } catch { unavailable.push("website: fetch failed"); }
  }

  let telegramMembers: number | null = null;
  if (telegram) {
    const tg = await telegramPreview(telegram);
    if (tg) { claims.push(...extractClaims(tg.text, "telegram", tg.url)); sources.push("telegram"); telegramMembers = tg.members; }
    else unavailable.push("telegram: preview unavailable");
  }

  res.status(200).json({ available: sources.length > 0, claims: claims.slice(0, 60), sources: [...new Set(sources)], unavailable, telegramMembers });
}
