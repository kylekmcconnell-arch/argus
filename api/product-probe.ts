// Product authenticity. GET /api/product-probe?url=<token's website>
//
// A token that sells a product is judged on whether the product is what the
// copy says it is. For privacy / transfer products the question is sharp:
// almost every "private transfer" front-end is a wrapper around one of a few
// providers (Houdini, Railgun, THORChain, an instant-exchange API), and the
// copy usually claims original engineering. The front-end bundle cannot hide
// the provider: its error-code namespace, API host and option names ship to
// every visitor. This route reads the page and its same-origin bundles and
// names what it finds. Keyless; bounded to the page plus three bundles.
//
// First case: $HADES (hades.exchange, Robinhood Chain, 2026-09-24) - copy
// says "built by true cypherpunks", bundle says HOUDINI_AMOUNT_BELOW_MINIMUM,
// HOUDINI_TRANSFER_NOT_FOUND, useXmr, backend hades-api-production.up.railway.app.
import { fetchPublicScript, fetchPublicText } from "./_collector.js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 20 };

const BUNDLE_LIMIT = 3;
const BUNDLE_BYTES = 2_500_000;

// Provider fingerprints. Each pattern is something the provider's own client
// code carries - error-code namespaces, API hosts, SDK identifiers - not a
// word that marketing copy might use on its own.
export const PROVIDERS: { name: string; kind: "mixer" | "swap-aggregator" | "instant-exchange" | "privacy-protocol" | "bridge"; patterns: RegExp[] }[] = [
  { name: "Houdini Swap", kind: "mixer", patterns: [/HOUDINI_[A-Z_]{4,}/, /houdiniswap\.com/i, /api\.houdiniswap/i, /\buseXmr\b/] },
  { name: "Railgun", kind: "privacy-protocol", patterns: [/@railgun-community/i, /railgun-?(wallet|engine|sdk)/i, /RailgunEngine/] },
  { name: "Tornado Cash", kind: "mixer", patterns: [/tornado-?cash/i, /tornadocash\.eth/i, /TornadoProxy/i] },
  { name: "Privacy Pools", kind: "privacy-protocol", patterns: [/privacypools\.com/i, /@0xbow/i, /PrivacyPool(?:Simple|Complex)/] },
  { name: "Umbra", kind: "privacy-protocol", patterns: [/@umbracash/i, /umbra\.cash/i, /StealthKeyRegistry/] },
  { name: "Aztec", kind: "privacy-protocol", patterns: [/@aztec\/(aztec|sdk|bb)/i, /aztec-?connect/i] },
  { name: "Zcash / ZEC bridge", kind: "bridge", patterns: [/zcashd|lightwalletd/i, /zec\.rocks/i] },
  { name: "THORChain", kind: "bridge", patterns: [/thornode\.|thorchain\.(net|org)/i, /midgard\.(ninerealms|thorswap)/i, /@xchainjs/i] },
  { name: "ChangeNOW", kind: "instant-exchange", patterns: [/changenow\.io/i, /api\.changenow/i] },
  { name: "Trocador", kind: "instant-exchange", patterns: [/trocador\.app/i] },
  { name: "eXch", kind: "instant-exchange", patterns: [/exch\.cx/i] },
  { name: "FixedFloat", kind: "instant-exchange", patterns: [/fixedfloat\.com/i, /ff\.io\/api/i] },
  { name: "SideShift", kind: "instant-exchange", patterns: [/sideshift\.ai/i] },
  { name: "SimpleSwap", kind: "instant-exchange", patterns: [/simpleswap\.io/i] },
  { name: "Exolix", kind: "instant-exchange", patterns: [/exolix\.com/i] },
  { name: "LI.FI", kind: "swap-aggregator", patterns: [/li\.quest/i, /@lifi\//i] },
  { name: "Socket / Bungee", kind: "swap-aggregator", patterns: [/api\.socket\.tech/i, /bungee\.exchange/i] },
  { name: "Relay", kind: "swap-aggregator", patterns: [/api\.relay\.link/i, /@reservoir0x\/relay/i] },
];

// Hosted-backend platforms: a product whose only server is a PaaS app on a
// free-tier hostname is a weekend front-end, whatever the copy says.
const PAAS = /\b[a-z0-9-]+\.(up\.railway\.app|railway\.app|vercel\.app|herokuapp\.com|onrender\.com|fly\.dev|netlify\.app|workers\.dev|glitch\.me|replit\.app|ngrok(-free)?\.app|deno\.dev)\b/gi;

// Copy that claims original engineering or a founding pedigree. Only ever a
// finding when a third-party provider is also in the bundle.
const ORIGINALITY = /\b(built (by|from the ground up|in[- ]house)|our (own|proprietary) (protocol|engine|router|tech|stack)|proprietary|in[- ]house|from (the )?ground up|true (privacy|cypherpunks?)|real (privacy|cypherpunks?)|cypherpunks?|\bOGs?\b|trench(es| warriors?)?|tor net|onions?\b)/gi;

// Privacy-product language: what makes the probe apply at all.
const PRIVACY = /\b(privacy|private (transfer|swap|send|bridge|route|routing)|mixer|mixing|anonym(ous|ity|ise|ize)|untraceable|unlinkable|stealth|shielded|obfuscat|xmr routing|monero)\b/i;

function host(u: string): string | null {
  try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bundleUrls(html: string, base: string): string[] {
  const out: string[] = [];
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < 12) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname.replace(/^www\./, "") === host(base) && /\.m?js(\?|$)/i.test(u.pathname + u.search)) out.push(u.toString());
    } catch { /* skip */ }
  }
  return [...new Set(out)].slice(0, BUNDLE_LIMIT);
}

export interface ProductProbe {
  available: boolean;
  url: string;
  host: string | null;
  privacyProduct: boolean;
  providers: { name: string; kind: string; evidence: string[] }[];
  backendHosts: string[];
  paasHosts: string[];
  originalityClaims: string[];
  contractsInApp: number;
  bundlesRead: number;
  read: "white-label" | "self-hosted" | "unknown";
  note: string;
}

// A client-rendered app carries its copy as string literals in the bundle,
// not in the HTML. Pull the human-readable literals (quoted, backticked or
// JSX text with spaces) so claims and privacy language are read from the app
// the visitor actually sees.
function bundleCopy(code: string): string {
  const out: string[] = [];
  const re = /["'`]([^"'`\n]{12,240})["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) && out.length < 4000) {
    const lit = m[1];
    if (/\s/.test(lit) && /[a-z]{3,}/i.test(lit) && !/[{}<>=;()]/.test(lit)) out.push(lit);
  }
  return out.join(" ");
}

export function probeText(url: string, html: string, bundles: string[]): ProductProbe {
  const h = host(url);
  const code = bundles.join("\n");
  const text = `${visibleText(html)} ${bundleCopy(code)}`.trim();
  const everything = `${html}\n${code}`;

  const providers = PROVIDERS.map((p) => {
    const evidence = new Set<string>();
    for (const re of p.patterns) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m: RegExpExecArray | null;
      while ((m = g.exec(everything)) && evidence.size < 4) evidence.add(m[0]);
    }
    return { name: p.name, kind: p.kind, evidence: [...evidence] };
  }).filter((p) => p.evidence.length > 0);

  const hostsFound = new Set<string>();
  const urlRe = /https?:\/\/([a-z0-9.-]+\.[a-z]{2,})(?:[/:"'`\s]|$)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(code))) {
    const hh = m[1].toLowerCase();
    if (h && (hh === h || hh.endsWith("." + h))) continue;
    if (/(^|\.)(w3\.org|react\.dev|reactjs\.org|github\.com|npmjs\.com|mozilla\.org|googleapis\.com|gstatic\.com|cloudflare\.com|jsdelivr\.net|unpkg\.com|localhost)$/.test(hh)) continue;
    hostsFound.add(hh);
  }
  const backendHosts = [...hostsFound].slice(0, 12);
  const paasHosts = backendHosts.filter((x) => new RegExp(PAAS.source, "i").test(x));

  const claims = new Set<string>();
  const oRe = new RegExp(ORIGINALITY.source, "gi");
  while ((m = oRe.exec(text)) && claims.size < 6) claims.add(m[0]);
  const originalityClaims = [...claims];

  const contractsInApp = new Set((code.match(/0x[a-fA-F0-9]{40}/g) ?? []).map((a) => a.toLowerCase())).size;
  const privacyProduct = PRIVACY.test(text) || PRIVACY.test(html.slice(0, 20_000));

  const read: ProductProbe["read"] = providers.length > 0 ? "white-label"
    : bundles.length > 0 && contractsInApp > 0 ? "self-hosted"
    : "unknown";

  const providerNames = providers.map((p) => p.name).join(", ");
  const note = read === "white-label"
    ? `The front-end is a client for ${providerNames}: ${providers.map((p) => `${p.name} (${p.evidence.slice(0, 2).join(", ")})`).join("; ")}.${paasHosts.length ? ` Backend is a hosted app on ${paasHosts.join(", ")}.` : ""}${originalityClaims.length ? ` The copy claims original engineering (${originalityClaims.slice(0, 3).map((c) => `"${c}"`).join(", ")}); the code says otherwise.` : ""}`
    : read === "self-hosted"
      ? `The front-end references ${contractsInApp} contract address${contractsInApp === 1 ? "" : "es"} of its own and no known third-party provider${paasHosts.length ? `; backend on ${paasHosts.join(", ")}` : ""}.`
      : bundles.length === 0
        ? "No readable application bundle - the product could not be inspected."
        : `No known provider fingerprint and no contract addresses in the bundle${paasHosts.length ? `; backend on ${paasHosts.join(", ")}` : ""} - what the product does is not verifiable from its client.`;

  return { available: true, url, host: h, privacyProduct, providers, backendHosts, paasHosts, originalityClaims, contractsInApp, bundlesRead: bundles.length, read, note };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = String(req.query.url ?? "").trim();
  if (!host(url) || !/^https?:\/\//i.test(url)) { res.status(400).json({ error: "valid url required" }); return; }
  res.setHeader("cache-control", "s-maxage=3600, stale-while-revalidate=86400");
  try {
    const page = await fetchPublicText(url);
    if (page.status !== "ok") { res.status(200).json({ available: false, url, host: host(url), note: `page: ${page.reason ?? "unavailable"}` }); return; }
    const html = page.text.slice(0, 400_000);
    const bundles: string[] = [];
    for (const b of bundleUrls(html, page.url || url)) {
      try {
        const r = await fetchPublicScript(b);
        if (r.status === "ok") bundles.push(r.text.slice(0, BUNDLE_BYTES));
      } catch { /* bounded best effort */ }
    }
    res.status(200).json(probeText(page.url || url, html, bundles));
  } catch (e) {
    res.status(200).json({ available: false, url, host: host(url), note: `probe failed: ${String(e).slice(0, 120)}` });
  }
}
