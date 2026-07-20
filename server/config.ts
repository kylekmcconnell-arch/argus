// Provider key registry. Reads from process.env; reports what is configured so
// the orchestrator can run live where keys exist and fall back to fixtures
// where they do not. No key is ever sent to the client.

export interface ProviderInfo {
  id: string;
  label: string;
  env: string[]; // env vars that enable this provider
  free: boolean; // works with no key
  feeds: string; // which evidence/axis it populates
}

export const PROVIDERS: ProviderInfo[] = [
  { id: "claude-research", label: "Claude (cited basic-facts research)", env: ["ANTHROPIC_API_KEY"], free: false, feeds: "founders, product, token, launch, governance, audits, repositories, funding and traction leads with sources" },
  { id: "grok", label: "Grok (X + cited web discovery)", env: ["XAI_API_KEY"], free: false, feeds: "testimonial acknowledgment, recent activity, sentiment, portfolio and fund-scale leads" },
  { id: "twitterapi", label: "twitterapi.io (X follow graph)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "cryptorank", label: "CryptoRank", env: ["CRYPTORANK_API_KEY"], free: false, feeds: "market intel: rank, ATH drawdown, dilution, unlock/vesting flags" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "optional company/funding enrichment; never required for portfolio certification" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, off-LinkedIn career history (F1/F2)" },
  { id: "github", label: "GitHub forensics", env: ["GITHUB_TOKEN"], free: false, feeds: "twitter-linked identity, org/repo affiliations (F1/F2)" },
  { id: "reddit", label: "Reddit", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], free: false, feeds: "community FUD / reputation (F5/I5/AG4)" },
  { id: "helius", label: "Helius (Solana)", env: ["HELIUS_API_KEY"], free: false, feeds: "attributed-wallet activity (K4 context)" },
  { id: "bitquery", label: "Bitquery (not yet in core collector)", env: ["BITQUERY_API_KEY"], free: false, feeds: "reserved credential only; does not run or attest core audits" },
  { id: "analyst", label: "Claude analyst agent", env: ["ANTHROPIC_API_KEY"], free: false, feeds: "messy-to-structured axis scoring + rationale + headline" },
];

export function hasEnv(keys: string[]): boolean {
  if (keys.length === 0) return true; // keyless provider
  return keys.every((k) => !!process.env[k]);
}

export function env(key: string): string | undefined {
  return process.env[key];
}

export function providerStatus() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    free: p.free,
    feeds: p.feeds,
    configured: hasEnv(p.env),
  }));
}

export const ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";
/**
 * Basic-facts discovery is search-and-extract, not judgment: it reads result
 * pages and emits JSON rows that ARGUS then re-fetches and verifies itself, so
 * a wrong row costs a rejected lead rather than a wrong verdict. It is also the
 * dominant cost line, because whole result sets land in model input. Keep it
 * separately configurable so the expensive tier stays where judgment happens
 * (scoring) and the cheap tier can serve retrieval. Kept on the analyst tier by
 * default: a live A/B showed Haiku basic-facts UNDER-collects (Uniswap dropped
 * PASS -> CAUTION for want of backer/disclosure records), so the cheap tier is
 * reserved for grounded-search extraction (ARGUS_EXTRACT_MODEL), not the core
 * fact verification. ARGUS_DISCOVERY_MODEL can still force a cheaper tier.
 */
export const DISCOVERY_MODEL = process.env.ARGUS_DISCOVERY_MODEL || ANALYST_MODEL;
