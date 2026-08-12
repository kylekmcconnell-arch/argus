import type { RunnableTokenInput, TokenInput } from "../lib/resolveInput";
import {
  dexByPairResult,
  dexByTokenResult,
  searchTokensResult,
  type DexPair,
} from "./sources";

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const DEX_URL = /dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i;

export interface TokenCandidate {
  input: RunnableTokenInput;
  canonicalRef: string;
  chain: string;
  symbol: string;
  name: string;
  pairAddress: string;
  liquidityUsd: number;
}
export type TokenSubjectResolution =
  | { state: "resolved"; candidate: TokenCandidate }
  | { state: "ambiguous"; candidates: TokenCandidate[] }
  | { state: "not_found" }
  | { state: "unavailable" };

function candidateFromPair(pair: DexPair): TokenCandidate | null {
  const chain = String(pair.chainId ?? "").trim().toLowerCase();
  const address = String(pair.baseToken?.address ?? "").trim();
  const pairAddress = String(pair.pairAddress ?? "").trim();
  if (!chain || !address || !pairAddress) return null;

  let input: RunnableTokenInput;
  if (chain === "solana" && SOLANA_ADDRESS.test(address)) {
    input = { kind: "token", ref: address, via: "solana" };
  } else if (EVM_ADDRESS.test(address)) {
    input = { kind: "token", ref: address.toLowerCase(), via: "evm" };
  } else {
    // DexScreener can still audit non-EVM/non-Solana markets by exact pair. Do
    // not mislabel an arbitrary chain address as EVM.
    input = {
      kind: "token",
      ref: `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(pairAddress)}`,
      via: "dexscreener",
    };
  }

  return {
    input,
    canonicalRef: chain === "solana" ? address : EVM_ADDRESS.test(address) ? address.toLowerCase() : address,
    chain,
    symbol: String(pair.baseToken?.symbol ?? "").trim(),
    name: String(pair.baseToken?.name ?? "").trim(),
    pairAddress,
    liquidityUsd: Number.isFinite(pair.liquidity?.usd) ? Math.max(0, Number(pair.liquidity?.usd)) : 0,
  };
}

function uniqueCandidates(pairs: DexPair[], include: (pair: DexPair) => boolean): TokenCandidate[] {
  const byToken = new Map<string, TokenCandidate>();
  for (const pair of pairs) {
    if (!include(pair)) continue;
    const candidate = candidateFromPair(pair);
    if (!candidate) continue;
    const addressKey = candidate.chain === "solana"
      ? candidate.canonicalRef
      : candidate.canonicalRef.toLowerCase();
    const key = `${candidate.chain}\u0000${addressKey}`;
    const previous = byToken.get(key);
    if (!previous || candidate.liquidityUsd > previous.liquidityUsd) byToken.set(key, candidate);
  }
  return [...byToken.values()]
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd || a.chain.localeCompare(b.chain))
    .slice(0, 12);
}

function finish(candidates: TokenCandidate[]): TokenSubjectResolution {
  if (candidates.length === 0) return { state: "not_found" };
  if (candidates.length === 1) return { state: "resolved", candidate: candidates[0] };
  return { state: "ambiguous", candidates };
}

export async function resolveTokenSubject(input: TokenInput): Promise<TokenSubjectResolution> {
  if (input.via === "dexscreener") {
    const match = input.ref.match(DEX_URL);
    if (!match) return { state: "not_found" };
    const result = await dexByPairResult(match[1], match[2]);
    if (!result.ok) return { state: "unavailable" };
    return finish(result.pair ? uniqueCandidates([result.pair], () => true) : []);
  }

  if (input.via === "ticker") {
    const symbol = input.ref.replace(/^\$/, "").trim();
    const result = await searchTokensResult(symbol);
    if (!result.ok) return { state: "unavailable" };
    return finish(uniqueCandidates(
      result.pairs,
      (pair) => String(pair.baseToken?.symbol ?? "").trim().toUpperCase() === symbol.toUpperCase(),
    ));
  }

  const result = await dexByTokenResult(input.ref);
  if (!result.ok) return { state: "unavailable" };
  const raw = input.ref.trim();
  const rawLower = raw.toLowerCase();
  return finish(uniqueCandidates(result.pairs, (pair) => {
    const address = String(pair.baseToken?.address ?? "").trim();
    if (input.via === "solana") return address === raw;
    if (input.via === "evm") return address.toLowerCase() === rawLower;
    // Only the explicit long-address candidate may recover historical Solana
    // case-folding. It never applies fuzzy ticker/name matching.
    return address.toLowerCase() === rawLower;
  }));
}
