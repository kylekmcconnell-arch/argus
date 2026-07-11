// Classify whatever the user pasted: an X handle (person audit) or a token
// (contract address or DexScreener URL → token audit).

export type TokenInput = {
  kind: "token";
  ref: string;
  via: "evm" | "solana" | "dexscreener" | "ticker" | "address-candidate";
};

export type RunnableTokenInput = Omit<TokenInput, "via"> & {
  via: "evm" | "solana" | "dexscreener";
};

export type ResolvedInput =
  | { kind: "handle"; ref: string }
  | TokenInput
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

  // A leading $ is explicit token intent. It must be resolved to one exact
  // contract before any audit starts; it is never a valid X handle fallback.
  if (TICKER.test(s)) return { kind: "token", ref: s, via: "ticker" };
  if (s.startsWith("$")) return { kind: "token", ref: s, via: "address-candidate" };

  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  // Solana base58 — guard against matching short handles by requiring length >= 32
  if (!s.startsWith("@") && !isXUrl && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }
  // Historical clients case-folded Solana mints. That can introduce forbidden
  // Base58 characters (notably lowercase "l"), but a 32+ character value still
  // cannot be an X handle. Let DexScreener recover the canonical case safely.
  if (!s.startsWith("@") && !isXUrl && TOKEN_CANDIDATE.test(s)) {
    return { kind: "token", ref: s, via: "address-candidate" };
  }

  // An X/Twitter profile URL -> extract the handle (x.com/VulcanForged ->
  // VulcanForged), never send the whole URL to the handle audit. Skip non-profile
  // paths (home, intent, search, etc.).
  const NOISE = /^(home|explore|notifications|messages|i|intent|search|hashtag|settings|share|status|about|tos|privacy)$/i;
  const xHandle = isXUrl && parsedUrl ? parsedUrl.pathname.split("/").filter(Boolean)[0] ?? "" : "";
  if (/^[A-Za-z0-9_]{1,30}$/.test(xHandle) && !NOISE.test(xHandle)) {
    return { kind: "handle", ref: xHandle };
  }

  // A website / project URL -> site recon.
  if (HTTP_URL.test(s)) return { kind: "site", ref: s };
  if (!s.startsWith("@") && DOMAIN.test(s) && !NAME_SERVICE.test(s)) return { kind: "site", ref: s };

  // A bare handle -> strip the leading @ so downstream gets the clean username.
  return { kind: "handle", ref: s.replace(/^@/, "") };
}
