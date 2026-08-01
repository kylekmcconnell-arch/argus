// Classify whatever the user pasted: an X handle (person audit), a token
// (contract address or DexScreener URL → token audit), a site, or a Polymarket
// trader profile.

import { normalizeWalletInput } from "../polymarket/trader";

export type TokenInput = {
  kind: "token";
  ref: string;
  via: "evm" | "solana" | "dexscreener" | "ticker" | "address-candidate";
};

export type RunnableTokenInput = Omit<TokenInput, "via"> & {
  via: "evm" | "solana" | "dexscreener";
};

/**
 * A Polymarket trader profile. `ref` is the lowercase 0x wallet the URL named.
 *
 * This kind is only ever reached from a polymarket.com/profile link, never from
 * a bare address. The same 0x string is a valid EVM token contract and a valid
 * Polymarket wallet, and no offline test tells them apart: choosing by guess
 * would silently reroute every token contract anybody pastes. The path is what
 * carries the intent, so the path is what decides. A bare 0x address stays a
 * token contract, exactly as it was.
 */
export type PolymarketInput = { kind: "polymarket"; ref: string };

export type ResolvedInput =
  | { kind: "handle"; ref: string }
  | TokenInput
  | PolymarketInput
  | { kind: "site"; ref: string };

export function isRunnableTokenInput(input: ResolvedInput): input is RunnableTokenInput {
  return input.kind === "token"
    && (input.via === "evm" || input.via === "solana" || input.via === "dexscreener");
}

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0x
const TOKEN_CANDIDATE = /^[A-Za-z0-9]{32,44}$/;
const TICKER = /^\$[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
const HTTP_URL = /^https?:\/\//i;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,24}(\/\S*)?$/i;
// Blockchain name services resolve to people/wallets, not websites.
const NAME_SERVICE = /\.(eth|sol|crypto|nft|bnb|x|lens)$/i;

const approvedHost = (hostname: string, root: string) =>
  hostname === root || hostname.endsWith(`.${root}`);

function inputUrl(value: string): URL | null {
  const candidate = HTTP_URL.test(value)
    ? value
    : /^(?:[a-z0-9-]+\.)*(?:x\.com|twitter\.com|dexscreener\.com)\//i.test(value)
      ? `https://${value}`
      : null;
  if (!candidate) return null;
  try { return new URL(candidate); } catch { return null; }
}

export function resolveInput(raw: string): ResolvedInput {
  const s = raw.trim();
  const parsedUrl = inputUrl(s);
  const hostname = parsedUrl?.hostname.toLowerCase() ?? "";
  const isDexUrl = !!parsedUrl && approvedHost(hostname, "dexscreener.com");
  const isXUrl = !!parsedUrl && (
    approvedHost(hostname, "x.com") || approvedHost(hostname, "twitter.com")
  );

  const dexPath = isDexUrl
    ? parsedUrl.pathname.match(/^\/([a-z0-9]+)\/([a-zA-Z0-9]+)(?:\/|$)/i)
    : null;
  if (dexPath && parsedUrl) return { kind: "token", ref: parsedUrl.href, via: "dexscreener" };

  // A Polymarket profile LINK, and only a link. The host and path rule is the
  // adapter's, imported rather than restated, because it is the rule that
  // decides whose trading history a report is about: an address sitting in some
  // other site's /profile/ path was never published by Polymarket as that
  // trader's wallet.
  //
  // The `!EVM.test` guard is the whole disambiguation and is not redundant with
  // the branch order below. normalizeWalletInput accepts a BARE 0x address as
  // well as a link, because a caller that already knows it holds a wallet wants
  // both. Here we do not know that: the identical string is a valid EVM token
  // contract and a valid Polymarket wallet, and nothing offline separates them.
  // Passing it through unguarded would reroute every token contract anybody
  // pastes into a trader report. The path is the only published intent, so only
  // the path routes here, and a bare address stays a token contract.
  //
  // Checked above the generic URL branches so it beats the site-recon fallback,
  // which would otherwise scrape the profile page as a project website.
  const polymarketWallet = EVM.test(s) ? null : normalizeWalletInput(s);
  if (polymarketWallet) return { kind: "polymarket", ref: polymarketWallet };

  // A leading $ is explicit token intent. It must be resolved to one exact
  // contract before any audit starts; it is never a valid X handle fallback.
  if (TICKER.test(s)) return { kind: "token", ref: s, via: "ticker" };
  if (s.startsWith("$")) return { kind: "token", ref: s, via: "address-candidate" };

  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  // Solana base58: guard against matching short handles by requiring length >= 32
  if (!s.startsWith("@") && !isXUrl && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }
  // Historical clients case-folded Solana mints. That can introduce forbidden
  // Base58 characters (notably lowercase "l"), but a 32+ character value still
  // cannot be an X handle. Let DexScreener recover the canonical case safely.
  if (!s.startsWith("@") && !isXUrl && TOKEN_CANDIDATE.test(s)) {
    return { kind: "token", ref: s, via: "address-candidate" };
  }

  // An X/Twitter profile URL -> extract the handle (x.com/VulcanForged or
  // x.com/@VulcanForged -> VulcanForged), never send the whole URL to the handle
  // audit. Skip non-profile paths (home, intent, search, etc.).
  const NOISE = /^(home|explore|notifications|messages|i|intent|search|hashtag|settings|share|status|about|tos|privacy)$/i;
  const xHandle = isXUrl && parsedUrl
    ? (parsedUrl.pathname.split("/").filter(Boolean)[0] ?? "").replace(/^@/, "")
    : "";
  if (/^[A-Za-z0-9_]{1,30}$/.test(xHandle) && !NOISE.test(xHandle)) {
    return { kind: "handle", ref: xHandle };
  }

  // A website / project URL -> site recon.
  if (HTTP_URL.test(s)) return { kind: "site", ref: s };
  if (!s.startsWith("@") && DOMAIN.test(s) && !NAME_SERVICE.test(s)) return { kind: "site", ref: s };

  // A bare handle -> strip the leading @ so downstream gets the clean username.
  return { kind: "handle", ref: s.replace(/^@/, "") };
}
