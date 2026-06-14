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
  { id: "grok", label: "Grok (X content)", env: ["XAI_API_KEY"], free: false, feeds: "testimonial acknowledgment, recent activity, sentiment" },
  { id: "twitterapi", label: "twitterapi.io (X follow graph)", env: ["TWITTERAPI_KEY"], free: false, feeds: "follower/following graph, profile, account age" },
  { id: "coingecko", label: "CoinGecko", env: ["COINGECKO_API_KEY"], free: true, feeds: "token price/mcap, call performance (K2)" },
  { id: "dexscreener", label: "DexScreener", env: [], free: true, feeds: "live DEX liquidity/volume, rug signals" },
  { id: "crunchbase", label: "Crunchbase", env: ["CRUNCHBASE_API_KEY"], free: false, feeds: "ventures, investors, repeat backing (F2/F3/I2)" },
  { id: "peopledatalabs", label: "People Data Labs", env: ["PDL_API_KEY"], free: false, feeds: "identity, career history (F1/F2)" },
  { id: "reddit", label: "Reddit", env: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], free: true, feeds: "community FUD / reputation (F5/I5/AG4)" },
  { id: "helius", label: "Helius (Solana)", env: ["HELIUS_API_KEY"], free: true, feeds: "wallet forensics, on-chain conduct (K4)" },
  { id: "bitquery", label: "Bitquery (multi-chain)", env: ["BITQUERY_API_KEY"], free: false, feeds: "deployer/holder forensics, rug confirmation" },
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
