// Classify whatever the user pasted: an X handle (person audit) or a token
// (contract address or DexScreener URL → token audit).

export type ResolvedInput =
  | { kind: "handle"; ref: string }
  | { kind: "token"; ref: string; via: "evm" | "solana" | "dexscreener" }
  | { kind: "site"; ref: string };

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0x
const DEX_URL = /dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i;
const HTTP_URL = /^https?:\/\//i;
const DOMAIN = /^([a-z0-9-]+\.)+[a-z]{2,24}(\/\S*)?$/i;
// Blockchain name services resolve to people/wallets, not websites.
const NAME_SERVICE = /\.(eth|sol|crypto|nft|bnb|x|lens)$/i;

export function resolveInput(raw: string): ResolvedInput {
  const s = raw.trim();

  const dex = s.match(DEX_URL);
  if (dex) return { kind: "token", ref: s, via: "dexscreener" };

  // strip a leading $ ticker marker but keep handles intact
  if (EVM.test(s)) return { kind: "token", ref: s, via: "evm" };
  // Solana base58 — guard against matching short handles by requiring length >= 32
  if (!s.startsWith("@") && !/twitter\.com|x\.com/i.test(s) && SOLANA.test(s) && s.length >= 32) {
    return { kind: "token", ref: s, via: "solana" };
  }

  // A website / project URL -> site recon. X/Twitter links stay handles.
  if (!/x\.com|twitter\.com/i.test(s)) {
    if (HTTP_URL.test(s)) return { kind: "site", ref: s };
    if (!s.startsWith("@") && DOMAIN.test(s) && !NAME_SERVICE.test(s)) return { kind: "site", ref: s };
  }

  return { kind: "handle", ref: s };
}
