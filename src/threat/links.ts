// Pertinent project links, one place for every scan surface (report page and
// the Telegram bot card). Built from what the scan already holds - DexScreener
// socials + CoinGecko official links - plus constructible chart/registry URLs.
// Order is Enigma's: site, X, TG, DexScreener, CoinGecko, CMC, Defined.fi,
// whitepaper, YouTube, LinkedIn. Only links that actually exist are returned.
import type { TokenDossier } from "../token/audit";

export interface ProjectLink { label: string; url: string }

// CMC DexScan network slugs (pair-page URLs work keyless for any DEX pair).
const CMC_NET: Record<string, string> = {
  ethereum: "ethereum", bsc: "bsc", base: "base", solana: "solana",
  arbitrum: "arbitrum", polygon: "polygon", optimism: "optimism", avalanche: "avalanche",
};
// Defined.fi network path segments.
const DEFINED_NET: Record<string, string> = {
  ethereum: "eth", bsc: "bsc", base: "base", solana: "sol",
  arbitrum: "arb", polygon: "poly", optimism: "opti", avalanche: "avax",
};

const SOCIAL_HOST = /x\.com|twitter\.com|t\.me|telegram|discord|github|medium|reddit|youtube|youtu\.be|linkedin|instagram|tiktok|warpcast|farcaster/i;

function first(socials: { label: string; url: string }[], test: (s: { label: string; url: string }) => boolean): string | null {
  const hit = socials.find((s) => /^https?:\/\//i.test(s.url) && test(s));
  return hit ? hit.url : null;
}

export function projectLinks(d: TokenDossier): ProjectLink[] {
  const s = d.socials ?? [];
  const out: ProjectLink[] = [];
  const push = (label: string, url: string | null | undefined) => {
    if (url && !out.some((x) => x.url === url)) out.push({ label, url });
  };

  push("Website", first(s, (x) => /site|website|home/i.test(x.label) || !SOCIAL_HOST.test(x.url)) ?? d.cg?.homepage);
  const tw = first(s, (x) => /x\.com\/|twitter\.com\//i.test(x.url) || /^(x|twitter)$/i.test(x.label))
    ?? (d.cg?.twitter ? `https://x.com/${d.cg.twitter}` : null);
  push("X", tw);
  push("Telegram", first(s, (x) => /t\.me\/|telegram/i.test(x.url) || /telegram/i.test(x.label)));
  push("DexScreener", `https://dexscreener.com/${d.chain}/${d.pairAddress ?? d.address}`);
  if (d.cg?.listed && d.cg.id) push("CoinGecko", `https://www.coingecko.com/en/coins/${d.cg.id}`);
  const cmcNet = CMC_NET[d.chain];
  if (cmcNet && d.pairAddress) push("CMC", `https://coinmarketcap.com/dexscan/${cmcNet}/${d.pairAddress}/`);
  const defNet = DEFINED_NET[d.chain];
  if (defNet) push("Defined.fi", `https://www.defined.fi/${defNet}/${d.address}`);
  push("Whitepaper", first(s, (x) => /whitepaper|white-paper|docs|gitbook|paper/i.test(x.label) || /docs\.|gitbook|whitepaper/i.test(x.url)));
  push("YouTube", first(s, (x) => /youtube\.com|youtu\.be/i.test(x.url) || /youtube/i.test(x.label)));
  push("LinkedIn", first(s, (x) => /linkedin\.com/i.test(x.url) || /linkedin/i.test(x.label)));
  return out;
}
