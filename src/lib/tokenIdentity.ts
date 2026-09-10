import { normalizeSubjectRef } from "./subjectRef.js";
export interface TokenSubjectIdentity { chain: string; address: string; ref: string }
const aliases: Record<string, string> = { eth: "ethereum", "1": "ethereum", "8453": "base", "42161": "arbitrum", "10": "optimism", "137": "polygon", "56": "bsc", "43114": "avalanche" };
export function tokenSubjectIdentity(chain: unknown, address: unknown): TokenSubjectIdentity | null {
  if (typeof chain !== "string" || typeof address !== "string") return null;
  const rawChain = chain.trim().toLowerCase();
  const network = aliases[rawChain] ?? rawChain;
  const clean = address.trim();
  if (!/^[a-z0-9_-]{1,40}$/.test(network)) return null;
  const evm = /^0x[0-9a-f]{40}$/i.test(clean);
  const evmNetwork = /^(ethereum|base|arbitrum|optimism|polygon|bsc|avalanche|fantom|cronos|linea|scroll|mantle|zksync|blast|celo|gnosis|sonic|abstract|pulsechain|berachain|unichain|opbnb|polygonzkevm)$/.test(network);
  if (network === "solana" ? !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(clean) : evmNetwork ? !evm : !/^[A-Za-z0-9._-]{10,128}$/.test(clean)) return null;
  const normalized = evm ? normalizeSubjectRef(clean) : clean;
  return { chain: network, address: normalized, ref: `${network}:${normalized}` };
}
export function payloadTokenIdentity(kind: string, payload: unknown): TokenSubjectIdentity | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const token = kind === "investigation" ? root.token : kind === "token" ? root : null;
  if (!token || typeof token !== "object") return null;
  const row = token as Record<string, unknown>;
  return tokenSubjectIdentity(row.chain, row.address);
}
