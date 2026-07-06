// The on-chain pivot. A site that reads as a token project gets reality-checked
// against the chain: ARGUS pulls the token claim off the page (ticker, FDV,
// "live" supply), finds a contract — first any address/explorer link on the
// page, then a keyless DexScreener name-search when the page hides it — runs the
// real token audit, and reconciles what the site claims against what is actually
// on-chain. A "$50M FDV, tokens LIVE" claim with no verifiable contract is a
// finding, not a footnote.
import { auditToken, type TokenDossier } from "../token/audit";
import { searchTokens } from "../token/sources";
import { resolveInput } from "../lib/resolveInput";

export interface TokenClaim {
  ticker: string | null;
  fdv: string | null;       // raw claim text, e.g. "$50M FDV"
  raise: string | null;     // e.g. "$7.5M Raise"
  live: boolean;            // page asserts a live / circulating token
}

export interface OnChainPivot {
  attempted: boolean;
  method: "contract-on-page" | "name-search" | "none";
  claim: TokenClaim;
  found: TokenDossier | null;
  candidates: { symbol: string; name: string; address: string; chain: string; liqUsd: number }[];
  reconcile: { tone: "good" | "warn" | "bad" | "gap"; line: string };
}

const EVM_ADDR = /0x[a-fA-F0-9]{40}/g;
const SOL_MINT = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/g;
const EXPLORER = /(?:etherscan\.io|basescan\.org|bscscan\.com|arbiscan\.io|polygonscan\.com)\/(?:token|address)\/(0x[a-fA-F0-9]{40})|(?:solscan\.io|birdeye\.so|pump\.fun)\/(?:token\/|address\/)?([1-9A-HJ-NP-Za-km-z]{32,44})|dexscreener\.com\/[a-z0-9]+\/([a-zA-Z0-9]+)/gi;

const GENERIC = new Set([
  "the", "our", "these", "more", "all", "total", "native", "utility", "governance", "reward", "rewards",
  "data", "ai", "new", "your", "their", "real", "live", "beta", "gm", "us", "eu", "faq", "api", "ceo",
  "cto", "nft", "dao", "dex", "cex", "tvl", "apy", "apr", "roi", "kyc", "defi", "web", "app", "io",
]);

function normTicker(t: string): string {
  return t.replace(/[$\-_\s]/g, "").toLowerCase();
}

// A real ticker is all-caps, or carries a digit/hyphen, or is $-prefixed. An
// ordinary Title-case word ("Regarding", "Native") is NOT a ticker — refusing
// to treat it as one keeps the pivot from chasing a fabricated symbol.
function tickerShaped(t: string): boolean {
  const core = t.replace(/^\$/, "");
  if (!/^[A-Za-z0-9-]{3,10}$/.test(core)) return false;
  if (GENERIC.has(core.toLowerCase())) return false;
  if (/[0-9-]/.test(core)) return true;
  return core === core.toUpperCase();
}

export function extractTokenClaim(content: string): TokenClaim {
  // $TICKER mentions are the strongest signal
  const dollar = [...content.matchAll(/\$([A-Za-z][A-Za-z0-9-]{1,9})\b/g)].map((m) => m[1]).filter(tickerShaped);
  // "<TICKER> Token(s)" — the form NeuroMesh uses ("91.2M nDATA-R Tokens")
  const beforeToken = [...content.matchAll(/\b([A-Za-z][A-Za-z0-9-]{1,11})\s+[Tt]okens?\b/g)].map((m) => m[1]).filter(tickerShaped);
  const candidates = [...dollar, ...beforeToken];
  // prefer $-prefixed / digit-or-hyphen tickers (more specific, e.g. nDATA-R)
  const ticker = candidates.sort((a, b) => (/[\d-]/.test(b) ? 1 : 0) - (/[\d-]/.test(a) ? 1 : 0))[0] ?? null;

  const fdv = content.match(/(?:at\s+)?\$[\d.]+\s?[mMbB]\s*FDV/i)?.[0] ?? null;
  const raise = content.match(/\$[\d.]+\s?[mMbBkK]\b[^.\n]{0,12}\braise/i)?.[0] ?? null;
  const live = /\btokens?\s+live\b|\blive\b[^.\n]{0,20}\btoken|circulating|\bTGE\b|now\s+live/i.test(content);

  return { ticker, fdv, raise, live };
}

function discoverContracts(content: string): { addr: string; via: "evm" | "solana" }[] {
  const out: { addr: string; via: "evm" | "solana" }[] = [];
  const seen = new Set<string>();
  const add = (addr: string, via: "evm" | "solana") => { if (!seen.has(addr)) { seen.add(addr); out.push({ addr, via }); } };
  // explorer / dex links first (highest confidence)
  for (const m of content.matchAll(EXPLORER)) {
    if (m[1]) add(m[1], "evm");
    else if (m[2]) add(m[2], "solana");
    // m[3] is a dexscreener pair id — handled by resolveInput as a dexscreener URL elsewhere
  }
  for (const m of content.match(EVM_ADDR) ?? []) add(m, "evm");
  // Solana mints are noisy (base58 also matches hashes); only take ones that look
  // like a mint (end in 'pump'/'bonk' or appear near a token/contract word).
  for (const m of content.match(SOL_MINT) ?? []) {
    if (/pump$|bonk$/i.test(m)) add(m, "solana");
  }
  return out.slice(0, 4);
}

function money(n?: number): string {
  if (n == null) return "unknown";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
  return "$" + Math.round(n);
}

export async function pivotOnChain(
  content: string,
  tokenSignalCount: number,
  emit?: (label: string) => void,
): Promise<OnChainPivot> {
  const claim = extractTokenClaim(content);
  const looksLikeToken = tokenSignalCount >= 2 || claim.ticker != null || claim.live || claim.fdv != null;
  if (!looksLikeToken) {
    return { attempted: false, method: "none", claim, found: null, candidates: [], reconcile: { tone: "good", line: "Not a token project; on-chain pivot not needed." } };
  }

  // 1) contract address / explorer link on the page
  const onPage = discoverContracts(content);
  if (onPage.length) {
    emit?.(`contract on page (${onPage[0].addr.slice(0, 8)}…) → auditing on-chain`);
    const d = await auditToken(resolveInput(onPage[0].addr));
    if (d) return { attempted: true, method: "contract-on-page", claim, found: d, candidates: [], reconcile: reconcile(claim, d) };
  }

  // 2) no contract on the page — search the chain by ticker / project name
  if (claim.ticker) {
    emit?.(`no contract on page → searching DEXes for "${claim.ticker}"`);
    const pairs = await searchTokens(claim.ticker);
    const want = normTicker(claim.ticker);
    const candidates = pairs
      .filter((p) => p.baseToken)
      .map((p) => ({ symbol: p.baseToken!.symbol, name: p.baseToken!.name, address: p.baseToken!.address, chain: p.chainId, liqUsd: p.liquidity?.usd ?? 0 }))
      .sort((a, b) => b.liqUsd - a.liqUsd);
    // A confident match needs an exact (normalized) symbol equality AND a ticker
    // long enough not to collide with random memecoins. 3-char and shorter
    // tickers are too generic to auto-confirm by search alone.
    const match = want.length >= 4 ? candidates.find((c) => normTicker(c.symbol) === want) : undefined;
    if (match) {
      const d = await auditToken(resolveInput(match.address));
      if (d) return { attempted: true, method: "name-search", claim, found: d, candidates: candidates.slice(0, 4), reconcile: reconcile(claim, d, true) };
    }
    // searched, found nothing matching
    return {
      attempted: true, method: "name-search", claim, found: null, candidates: candidates.slice(0, 4),
      reconcile: {
        tone: claim.live || claim.fdv ? "bad" : "warn",
        line: candidates.length
          ? `Site advertises ${claim.ticker}${claim.fdv ? ` at ${claim.fdv}` : ""}, but no DEX-listed token matches that ticker (closest by name: ${candidates.slice(0, 2).map((c) => `${c.symbol} on ${c.chain}`).join(", ")}). The token claim is unsubstantiated on-chain.`
          : `Site advertises a ${claim.live ? "live " : ""}token (${claim.ticker}${claim.fdv ? `, ${claim.fdv}` : ""}) with no contract address on the page and no match on any DEX. The token claim is unverifiable on-chain.`,
      },
    };
  }

  return {
    attempted: true, method: "none", claim, found: null, candidates: [],
    reconcile: { tone: "warn", line: "Reads as a token project, but no ticker or contract could be extracted to verify on-chain." },
  };
}

function reconcile(claim: TokenClaim, d: TokenDossier, viaSearch = false): OnChainPivot["reconcile"] {
  // NAME-SEARCH is a ticker match, NOT a confirmed link to this project. Many
  // tokens share a ticker, and the highest-liquidity one is often a totally
  // different (frequently legitimate) project. So a name-search match is
  // presented NEUTRALLY and NEVER inherits the matched token's verdict — judging
  // a site by a random same-ticker token's health would be defamatory and wrong.
  if (viaSearch) {
    return {
      tone: "warn",
      line: `A token trading as ${claim.ticker} exists on-chain (${d.symbol} on ${d.chain}, liquidity ${money(d.liquidityUsd)}). This is a ticker match only — the site links no contract to confirm it is this project's token, and many projects share a ticker. Open its audit to judge that token on its own.`,
    };
  }

  const onChainFdv = d.mcap ?? undefined;
  const claimFdvNum = parseMoney(claim.fdv);
  const lead = `On-chain: ${d.symbol} on ${d.chain}, ${d.verdict} (${d.score ?? "—"}), liquidity ${money(d.liquidityUsd)}, FDV ${money(onChainFdv)}.`;
  const parts: string[] = [lead];
  let tone: OnChainPivot["reconcile"]["tone"] = d.verdict === "PASS" ? "good" : d.verdict === "CAUTION" ? "warn" : "bad";

  if (claimFdvNum && onChainFdv) {
    const ratio = claimFdvNum / onChainFdv;
    if (ratio > 3 || ratio < 0.33) { parts.push(`Site claims ${claim.fdv}, ~${ratio >= 1 ? ratio.toFixed(0) + "x higher than" : (1 / ratio).toFixed(0) + "x below"} the on-chain figure — claim contradicted.`); tone = "bad"; }
    else parts.push(`Site's ${claim.fdv} is in line with on-chain.`);
  } else if (claim.fdv && (d.liquidityUsd ?? 0) < 25000) {
    parts.push(`Site claims ${claim.fdv} but on-chain liquidity is only ${money(d.liquidityUsd)} — the valuation claim is not backed by real depth.`);
    tone = "bad";
  }
  return { tone, line: parts.join(" ") };
}

function parseMoney(s: string | null): number | null {
  if (!s) return null;
  const m = s.match(/\$([\d.]+)\s?([mMbBkK])/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  const mult = /b/i.test(m[2]) ? 1e9 : /m/i.test(m[2]) ? 1e6 : /k/i.test(m[2]) ? 1e3 : 1;
  return n * mult;
}
