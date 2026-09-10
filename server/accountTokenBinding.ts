import { fetchPublicText, type PublicTextDocument } from "./publicWeb.js";

const EXPLORERS: Record<string, string> = {
  ethereum: "etherscan.io", base: "basescan.org", arbitrum: "arbiscan.io",
  optimism: "optimistic.etherscan.io", polygon: "polygonscan.com", bsc: "bscscan.com",
  avalanche: "snowtrace.io", solana: "solscan.io",
};
const links = (text: string): string[] => [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)].map(m => m[0].replace(/&amp;/g, "&"));
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };

/** The profile chooses the domain; the fetched domain must reciprocate the
 * exact account and publish an exact-chain explorer token link. No name match. */
export function reciprocalTokenProof(document: PublicTextDocument, profileUrl: string, handle: string, address: string, chain: string) {
  if (host(document.url) !== host(profileUrl)) return null;
  const urls = links(document.text);
  const reciprocal = urls.some(raw => {
    try { const u = new URL(raw); return /^(?:www\.)?(?:x|twitter)\.com$/i.test(u.hostname) && u.pathname.replace(/\/$/, "").toLowerCase() === `/${handle.toLowerCase()}`; } catch { return false; }
  });
  if (!reciprocal || !EXPLORERS[chain]) return null;
  const exact = urls.find(raw => {
    try {
      const u = new URL(raw);
      if (host(raw) !== EXPLORERS[chain]) return false;
      const match = u.pathname.match(/^\/(?:token|address)\/([^/]+)\/?$/);
      return !!match && (chain === "solana" ? match[1] === address : match[1].toLowerCase() === address.toLowerCase());
    } catch { return false; }
  });
  return exact ? { sourceUrl: document.url, contractUrl: exact, contentHash: document.contentHash, capturedAt: document.capturedAt } : null;
}

export async function officialDomainBinding(bio: string, handle: string, address: string, chain: string) {
  const excluded = /(?:^|\.)(?:x\.com|twitter\.com|t\.co|youtube\.com|discord\.gg|t\.me|linktr\.ee|beacons\.ai)$/;
  const candidates = [...new Set(links(bio))].filter(url => !excluded.test(host(url))).slice(0, 2);
  const signal = AbortSignal.timeout(4_000);
  for (const url of candidates) {
    if (signal.aborted) break;
    const doc = await fetchPublicText(url, { signal });
    if (doc.status !== "ok") continue;
    const proof = reciprocalTokenProof(doc, url, handle, address, chain);
    if (proof) return proof;
  }
  return null;
}
