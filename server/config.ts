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
  { id: "claude-research", label: "Claude (optional fallback research)", env: ["ANTHROPIC_API_KEY"], free: false, feeds: "optional cited-research fallback when ARGUS_PROVIDER_FALLBACKS is on" },
  { id: "grok", label: "Grok (primary LLM + X/web discovery)", env: ["XAI_API_KEY"], free: false, feeds: "analyst scoring, extract, vision, testimonial acknowledgment, recent activity, sentiment, portfolio and fund-scale leads" },
  { id: "twitterapi", label: "twitterapi.io (X intelligence)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age, bounded project conversation fallback" },
  { id: "x-api-bearer", label: "Official X API v2 (optional authenticity + social activity)", env: ["X_API_BEARER"], free: false, feeds: "optional x-authenticity and social-activity provider; twitterapi.io remains the production fallback" },
  { id: "safebrowsing", label: "Google Safe Browsing", env: ["GOOGLE_SAFE_BROWSING_KEY"], free: false, feeds: "optional best-recall site-safety; GoPlus/URLhaus/heuristics still run" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "optional company/funding enrichment; never required for portfolio certification" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, off-LinkedIn career history (F1/F2)" },
  { id: "github", label: "GitHub forensics", env: ["GITHUB_TOKEN"], free: false, feeds: "twitter-linked identity, org/repo affiliations (F1/F2)" },
  { id: "reddit", label: "Reddit", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], free: false, feeds: "community FUD / reputation (F5/I5/AG4)" },
  { id: "helius", label: "Helius (Solana)", env: ["HELIUS_API_KEY"], free: false, feeds: "attributed-wallet activity (K4 context)" },
  { id: "arkham", label: "Arkham", env: ["ARKHAM_API_KEY"], free: false, feeds: "score-neutral identity and exposure context for evidence-bound wallets" },
  { id: "bitquery", label: "Bitquery (not yet in core collector)", env: ["BITQUERY_API_KEY"], free: false, feeds: "reserved credential only; does not run or attest core audits" },
  { id: "analyst", label: "Grok analyst agent", env: ["XAI_API_KEY"], free: false, feeds: "messy-to-structured axis scoring + rationale + headline" },
  { id: "openrouter", label: "OpenRouter (optional extract fallback)", env: ["OPENROUTER_API_KEY"], free: false, feeds: "cheap extraction fallback when ARGUS_PROVIDER_FALLBACKS is on" },
  { id: "chart-signals", label: "Chart signals (self-hosted technical posture)", env: ["CHART_SIGNALS_URL", "CHART_SIGNALS_TOKEN"], free: true, feeds: "generic chart-posture panel on token scans (majors only)" },
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

export const GROK_ANALYST_MODEL = process.env.ARGUS_GROK_ANALYST_MODEL || process.env.ARGUS_GROK_MODEL || "grok-4-fast";
export const ANALYST_MODEL = process.env.ARGUS_ANALYST_MODEL || "claude-sonnet-4-6";

/**
 * Failure-driven provider failover (e.g. Grok analyst dies -> Claude retries
 * the same call). OFF by default by owner decision: a failed provider must
 * fail VISIBLY (ledger row + on-screen notice), never silently switch the
 * spend to a different metered provider. ARGUS_PROVIDER_FALLBACKS=on or 1
 * restores failover onto Anthropic / OpenRouter.
 */
export const providerFallbacksEnabled = (): boolean => {
  const raw = (process.env.ARGUS_PROVIDER_FALLBACKS || "").trim().toLowerCase();
  return raw === "on" || raw === "1" || raw === "true";
};
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
