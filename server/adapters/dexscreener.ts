// DexScreener adapter — FREE, keyless, real. Resolves a token by contract
// address to live DEX liquidity / volume / price, the signal that surfaces thin
// liquidity and fresh-pair rug risk. Used to enrich any promotion the subject
// pushed once we have its contract address.

import type { Adapter, CollectContext } from "./types";

const BASE = "https://api.dexscreener.com";

export interface DexTokenSnapshot {
  address: string;
  chain?: string;
  symbol?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volume24h?: number;
  fdv?: number;
  pairCreatedAt?: number;
}

// Public helper so the orchestrator / tests can hit it directly.
export async function lookupToken(address: string): Promise<DexTokenSnapshot | null> {
  try {
    const res = await fetch(`${BASE}/latest/dex/tokens/${address}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { pairs?: any[] };
    const pairs = data.pairs ?? [];
    if (!pairs.length) return { address };
    // pick the deepest-liquidity pair as canonical
    const top = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
    return {
      address,
      chain: top.chainId,
      symbol: top.baseToken?.symbol,
      priceUsd: top.priceUsd ? Number(top.priceUsd) : undefined,
      liquidityUsd: top.liquidity?.usd,
      volume24h: top.volume?.h24,
      fdv: top.fdv,
      pairCreatedAt: top.pairCreatedAt,
    };
  } catch {
    return null;
  }
}

export const dexscreenerAdapter: Adapter = {
  id: "dexscreener",
  label: "DexScreener",
  available: () => true, // keyless
  async run(ctx: CollectContext) {
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "DEX liquidity scan", detail: `Resolving ${promos.length} promoted token(s) on DexScreener…`, tone: "neutral" });
    for (const p of promos) {
      const snap = await lookupToken(p.contract_address!);
      if (!snap) continue;
      const thin = (snap.liquidityUsd ?? 0) < 10000;
      p.perf_current = snap.priceUsd;
      ctx.emit({
        phase: "On-chain",
        label: `$${snap.symbol ?? p.ticker}`,
        detail: `liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}, 24h vol $${Math.round(snap.volume24h ?? 0).toLocaleString()}${thin ? " — thin liquidity, rug-risk flag" : ""}`,
        source: "dexscreener",
        tone: thin ? "warn" : "neutral",
      });
    }
  },
};
