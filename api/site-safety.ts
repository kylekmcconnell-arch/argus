// Linked-site safety. GET /api/site-safety?url=<token's website>
//
// A token whose only linked website is a wallet-drainer or a blacklisted host
// is a scam tell that no contract check catches - the danger is off-chain, in
// the site the token points you to. Layered, keyless-first:
//   1. Google Safe Browsing (best recall; optional GOOGLE_SAFE_BROWSING_KEY) -
//      this is what Chrome/Norton-class warnings derive from.
//   2. GoPlus phishing_site (keyless, high precision, low recall).
//   3. URLhaus recent-malware feed membership (keyless, cached hourly).
//   4. Page heuristics (keyless, always on): follow the link and flag an
//      off-domain redirect (cloaking), a stub/redirector page, and drainer-kit
//      / seed-phrase phishing signatures in the returned HTML. Catches fresh
//      drainers no blocklist has indexed yet.
import { cacheGetJson, cacheSetJson } from "./_cache.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

function host(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}
// registrable-ish domain (last two labels) - good enough to spot off-brand redirects.
function regDomain(h: string): string { const p = h.split("."); return p.slice(-2).join("."); }

async function googleSafeBrowsing(url: string): Promise<string | null> {
  const key = process.env.GOOGLE_SAFE_BROWSING_KEY;
  if (!key) return null;
  try {
    const r = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "argus", clientVersion: "1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"], threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    const d = (await r.json()) as { matches?: Array<{ threatType?: unknown }> };
    return Array.isArray(d.matches) && d.matches.length ? String(d.matches[0].threatType ?? "flagged") : "";
  } catch { return null; }
}

async function goplusPhishing(url: string): Promise<boolean | null> {
  try {
    const r = await fetch(`https://api.gopluslabs.io/api/v1/phishing_site?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { result?: { phishing_site?: unknown } };
    return d.result?.phishing_site === 1;
  } catch { return null; }
}

// URLhaus recent-malware URL feed (keyless). Host set cached ~1h.
async function urlhausHit(h: string): Promise<boolean | null> {
  try {
    const cached = await cacheGetJson<{ at: number; hosts: string[] }>("urlhaus:hosts");
    let hosts = cached && Date.now() - cached.at < 3_600_000 ? cached.hosts : null;
    if (!hosts) {
      const r = await fetch("https://urlhaus.abuse.ch/downloads/text_recent/", { signal: AbortSignal.timeout(9000) });
      if (!r.ok) return null;
      const text = await r.text();
      const set = new Set<string>();
      for (const line of text.split("\n")) { const hh = host(line.trim()); if (hh) set.add(hh); }
      hosts = [...set];
      await cacheSetJson("urlhaus:hosts", { at: Date.now(), hosts }).catch(() => {});
    }
    const hset = new Set(hosts);
    return hset.has(h) || hset.has(regDomain(h));
  } catch { return null; }
}

// Match phishing copy in VISIBLE page text only - not in inlined <script>/<style>
// bundles. A wallet-embedding trading terminal (e.g. Kupo) legitimately ships
// i18n strings like "Recovery phrase (12 words)" or "Export Private Key / Never
// share this" inside its JS bundle; those are wallet-management + safety copy,
// the opposite of a drainer, and must not be mistaken for one.
function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ");
}

// Naming a bare secret is NOT a tell (legit wallets export/warn about them).
// A drainer ASKS you to hand one over. Require an imperative ask next to the
// secret, and suppress when the neighbouring words are self-custody / safety
// copy ("never share", "export", "generate", "12/24 words", "write it down").
const SECRET = "(?:secret recovery phrase|recovery phrase|seed phrase|private key|mnemonic)";
const ASK = "(?:enter|paste|input|type|submit|provide|confirm|verify|import|restore|reveal|unlock|sync|connect)";
const SECRET_ASK = new RegExp(`${ASK}[^.!?<>{}]{0,40}${SECRET}|${SECRET}[^.!?<>{}]{0,30}(?:to (?:continue|proceed|claim|restore|verify|unlock|validate))`, "i");
const SECRET_SAFE = /never (?:share|give|enter|type|ask|reveal|store)|do ?n['o]?t share|keep (?:it|this|them)\s+(?:safe|secret|private|offline)|export|generate|new (?:address|wallet)|write .{0,20}down|controls your wallet|back ?up/i;
// Unambiguous single-hit tells: a scare banner or a named drainer kit. (No bare
// noun-phrases here - those live behind SECRET_ASK above.)
const DRAINER_STRONG = /your wallet (?:has been|was|is) (?:flagged|compromised|suspended|at risk)|(?:angel|inferno|monkey|pink|pussy|venom|ice|nova) drainer/i;
// Weaker scam-copy tells; need TWO to flag (each is common on legit sites too).
const DRAINER_WEAK = /verify your wallet|validate your wallet|sync your wallet|claim your (reward|airdrop|token)|security update required|migrate your (tokens|wallet)|connect.{0,20}restore/gi;
export function drainerHit(body: string): boolean {
  const text = visibleText(body);
  if (DRAINER_STRONG.test(text)) return true;
  // A secret-phrase ask counts only when it isn't wrapped in self-custody /
  // "never share" safety context.
  const ask = text.match(SECRET_ASK);
  if (ask) {
    const around = text.slice(Math.max(0, (ask.index ?? 0) - 60), (ask.index ?? 0) + ask[0].length + 60);
    if (!SECRET_SAFE.test(around)) return true;
  }
  const weak = text.match(DRAINER_WEAK);
  return !!weak && new Set(weak.map((s) => s.toLowerCase())).size >= 2;
}

async function pageHeuristics(url: string, wantHost: string): Promise<{ flags: string[]; finalHost: string | null }> {
  const flags: string[] = [];
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(9000), headers: { "user-agent": "Mozilla/5.0 ARGUS-safety" } });
    const finalHost = host(r.url);
    if (finalHost && regDomain(finalHost) !== regDomain(wantHost)) {
      flags.push(`redirects off-domain to ${finalHost} - a token site that bounces you to another domain is a common cloaking/drainer pattern`);
    }
    const body = (await r.text()).slice(0, 200_000);
    if (drainerHit(body)) flags.push("the page asks for wallet secrets / shows drainer-style phishing copy (private key, seed/recovery phrase, or 'verify wallet' prompts)");
    if (body.replace(/\s+/g, "").length < 400 && /location|redirect|window\.open/i.test(body)) flags.push("the linked site is a near-empty redirector stub, not a real project site");
  } catch { /* unreachable = its own weak signal, handled by caller */ }
  return { flags, finalHost: null };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = String(req.query.url ?? "").trim();
  const h = host(url);
  if (!h || !/^https?:\/\//i.test(url)) { res.status(400).json({ error: "valid url required" }); return; }
  res.setHeader("cache-control", "s-maxage=1800, stale-while-revalidate=7200");

  const [gsb, gp, uh, page] = await Promise.all([
    googleSafeBrowsing(url), goplusPhishing(url), urlhausHit(h), pageHeuristics(url, h),
  ]);

  const flags: string[] = [];
  const sources: string[] = [];
  if (gsb) { flags.push(`Google Safe Browsing flags this site (${gsb.toLowerCase().replace(/_/g, " ")})`); sources.push("Google Safe Browsing"); }
  if (gp) { flags.push("GoPlus flags this as a phishing site"); sources.push("GoPlus"); }
  if (uh) { flags.push("Host appears on the URLhaus malware feed"); sources.push("URLhaus"); }
  flags.push(...page.flags);

  const blocklisted = !!(gsb || gp || uh);
  const verdict = blocklisted ? "malicious"
    : page.flags.length ? "suspicious"
    : (gsb === null && gp === null && uh === null) ? "unknown"
    : "clean";

  res.status(200).json({ available: true, url, host: h, verdict, flags, sources, gsbConfigured: !!process.env.GOOGLE_SAFE_BROWSING_KEY });
}
