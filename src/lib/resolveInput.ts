// Classify whatever the user pasted: an X handle (person audit) or a token
// (contract address or DexScreener URL → token audit).

export type ResolvedInput =
  | { kind: "handle"; ref: string }
  | { kind: "token"; ref: string; via: "evm" | "solana" | "dexscreener" };

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/; // base58, no 0x
const DEX_URL = /dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i;

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

  return { kind: "handle", ref: s };
}
