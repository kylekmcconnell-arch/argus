// Cross-chain / OFT liquidity (#4). If a token is a LayerZero OFT, its liquidity
// lives on several chains — so a single-chain "thin liquidity" read is
// misleading. This calls api/oft (which PROVES the mesh from on-chain peers, no
// name-matching) and then aggregates the real liquidity of each leg via
// DexScreener. For native OFTs the peer address is directly tradeable; for
// lockbox adapters / Solana program peers the leg is shown as bridged but its
// pool can't be auto-resolved (the tradeable token is a separate address).

import type { CrossChain } from "./types";
import { dexByToken, pickPair } from "../token/sources";

export async function crossChain(chain: string, address: string, selfLiquidityUsd: number): Promise<CrossChain | null> {
  let oft: {
    isOft?: boolean; isAdapter?: boolean; endpoint?: string | null;
    peers?: { eid: number; chain: string; address: string }[];
  };
  try {
    const res = await fetch(`/api/oft?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    oft = (await res.json()) as typeof oft;
  } catch {
    return null;
  }
  if (!oft?.isOft) return null;

  const legs: CrossChain["legs"] = [{ chain, address, liquidityUsd: selfLiquidityUsd, self: true }];
  for (const p of oft.peers ?? []) {
    // Resolve the leg's pool liquidity where the peer address is directly
    // tradeable (native OFTs). Adapters / Solana-program peers return nothing.
    let liquidityUsd: number | null = null;
    try {
      const pair = pickPair(await dexByToken(p.address), p.address);
      liquidityUsd = pair?.liquidity?.usd ?? null;
    } catch { /* leg shown as bridged-but-unresolved */ }
    legs.push({ chain: p.chain, address: p.address, liquidityUsd, self: false });
  }

  const resolved = legs.filter((l) => l.liquidityUsd != null);
  const totalLiquidityUsd = resolved.reduce((a, l) => a + (l.liquidityUsd ?? 0), 0);
  return {
    isOft: true,
    isAdapter: !!oft.isAdapter,
    legs,
    totalLiquidityUsd,
    resolvedLegs: resolved.length,
  };
}
