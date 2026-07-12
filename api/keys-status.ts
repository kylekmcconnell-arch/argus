// Provider / API-key status. GET /api/keys-status
//
// Peace-of-mind panel for Kyle + Enigma: which keys are configured, what each
// powers, where to top up, and live usage where the provider exposes it. Reports
// only CONFIGURED/NOT — never a secret value. Real dollar balances aren't
// API-exposed for most providers, so this shows plugged-in-or-not + usage.
import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = { maxDuration: 15 };

interface Prov { key: string; alternativeKeys?: string[]; also?: string; label: string; powers: string; source: string; tier: "paid" | "optional" | "infra"; live?: "github" }

const PROVIDERS: Prov[] = [
  { key: "ANTHROPIC_API_KEY", label: "Claude (Anthropic)", powers: "The analyst + vision (screenshot OCR, profile-photo check)", source: "console.anthropic.com", tier: "paid" },
  { key: "XAI_API_KEY", label: "Grok (xAI)", powers: "Live web + X search — team & affiliation discovery", source: "console.x.ai", tier: "paid" },
  { key: "TWITTERAPI_KEY", label: "twitterapi.io", powers: "X profile, posts, follower/following graph", source: "twitterapi.io", tier: "paid" },
  { key: "HELIUS_API_KEY", label: "Helius (Solana)", powers: "Core: attributed-wallet activity. Supplemental: deployer, funding, mint, and serial-launch traces", source: "dashboard.helius.dev", tier: "paid" },
  { key: "GITHUB_TOKEN", label: "GitHub", powers: "Org/repos + commit-author forensics", source: "github.com/settings/tokens", tier: "paid", live: "github" },
  { key: "PDL_API_KEY", label: "People Data Labs", powers: "Professional identity records", source: "dashboard.peopledatalabs.com", tier: "paid" },
  { key: "REDDIT_CLIENT_ID", also: "REDDIT_CLIENT_SECRET", label: "Reddit OAuth", powers: "Community reputation search in core person audits", source: "reddit.com/prefs/apps", tier: "optional" },
  { key: "SUPABASE_SECRET_KEY", alternativeKeys: ["SUPABASE_SERVICE_ROLE_KEY"], also: "SUPABASE_URL", label: "Supabase", powers: "Shared trust graph + shared audit log", source: "supabase.com/dashboard", tier: "infra" },
  { key: "COINGECKO_API_KEY", label: "CoinGecko Pro", powers: "Higher-rate token data (free tier works without)", source: "coingecko.com/api", tier: "optional" },
  { key: "CRYPTORANK_API_KEY", label: "CryptoRank", powers: "Market intel: rank, ATH drawdown, dilution, funding/vesting/unlock flags", source: "cryptorank.io/api", tier: "optional" },
  { key: "CRUNCHBASE_API_KEY", label: "Crunchbase", powers: "Optional company / funding enrichment; portfolio verification works without it", source: "crunchbase.com", tier: "optional" },
  { key: "ETHERSCAN_API_KEY", label: "Etherscan (multichain)", powers: "EVM deployer, contract-creation & funding traces (Ethereum/Base/BSC/Arbitrum/…)", source: "etherscan.io/apis", tier: "optional" },
  { key: "ARKHAM_API_KEY", label: "Arkham", powers: "Supplemental wallet labels, counterparties, holdings, and risk paths", source: "arkhamintelligence.com", tier: "optional" },
  { key: "BITQUERY_API_KEY", label: "Bitquery", powers: "Credential reserved for the next frozen EVM collector; it does not currently run or attest audits", source: "bitquery.io", tier: "optional" },
];

// Keyless sources: always on, no key. Same shape as PROVIDERS so the UI renders
// them as identical rows (not a separate hard-to-read chip cluster).
const KEYLESS: { label: string; powers: string; source: string }[] = [
  { label: "DexScreener", powers: "Token market, liquidity & pair data", source: "dexscreener.com" },
  { label: "GoPlus + honeypot.is", powers: "Contract safety + honeypot simulation", source: "gopluslabs.io" },
  { label: "GeckoTerminal", powers: "On-chain DEX price history & OHLCV", source: "geckoterminal.com" },
  { label: "Wayback Machine", powers: "Deleted-content archaeology (site diffs)", source: "archive.org" },
  { label: "Farcaster / Warpcast", powers: "Casts + connected-wallet lookups", source: "warpcast.com" },
  { label: "memory.lol", powers: "X handle-change history (rebrands)", source: "memory.lol" },
  { label: "Telegram", powers: "Public cross-platform handle presence checks", source: "t.me" },
  { label: "web3.bio / ENS / Bonfida", powers: "Name → wallet resolution", source: "web3.bio" },
  { label: "RDAP", powers: "Domain registration + age", source: "rdap.org" },
  { label: "SEC EDGAR", powers: "US securities filings", source: "sec.gov" },
];

interface GithubRateLimit {
  remaining?: unknown;
  limit?: unknown;
  reset?: unknown;
}

async function githubUsage(token: string): Promise<{ remaining: number; limit: number; resetsIn: string } | null> {
  try {
    const r = await fetch("https://api.github.com/rate_limit", { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "argus" }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const d = (await r.json()) as { resources?: { core?: GithubRateLimit }; rate?: GithubRateLimit };
    const core = d.resources?.core ?? d.rate;
    if (
      typeof core?.remaining !== "number"
      || typeof core.limit !== "number"
      || typeof core.reset !== "number"
    ) return null;
    const mins = Math.max(0, Math.round((core.reset * 1000 - Date.now()) / 60000));
    return { remaining: core.remaining, limit: core.limit, resetsIn: `${mins}m` };
  } catch {
    return null;
  }
}

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("cache-control", "no-store");
  const gh = process.env.GITHUB_TOKEN;
  const ghUsage = gh ? await githubUsage(gh) : null;

  const providers = PROVIDERS.map((p) => {
    const hasCredential = !!process.env[p.key] || (p.alternativeKeys ?? []).some((key) => !!process.env[key]);
    const configured = hasCredential && (!p.also || !!process.env[p.also]);
    return {
      label: p.label,
      powers: p.powers,
      source: p.source,
      tier: p.tier,
      configured,
      usage: p.live === "github" && configured && ghUsage ? `${ghUsage.remaining}/${ghUsage.limit} calls left · resets ${ghUsage.resetsIn}` : undefined,
    };
  });

  // Keyless sources rendered as identical rows: always-on, no key, no top-up.
  const keyless = KEYLESS.map((k) => ({ label: k.label, powers: k.powers, source: k.source, tier: "keyless" as const, configured: true }));

  res.status(200).json({ providers, keyless, note: "Dollar balances aren't API-exposed for most providers; this shows configured + live usage where available." });
}
