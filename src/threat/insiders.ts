// On-demand wallet relationship traces; links do not establish common control.
import type { InsiderCluster } from "./types";

export async function insiderClusters(chain: string, address: string): Promise<InsiderCluster | null> {
  const url = chain === "solana"
    ? `/api/cluster?mint=${encodeURIComponent(address)}&chain=solana`
    : `/api/evm-cluster?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) return null;
    const d = (await res.json()) as {
      available?: boolean;
      clusters?: { size: number; combinedPct: number; sharedFunders?: string[]; includesCreator?: boolean; wallets?: Array<string | { address: string; pct?: number }> }[];
      note?: string;
    };
    if (!d.available) return null;
    const clusters = (d.clusters ?? []).map((c) => ({
      size: c.size,
      combinedPct: c.combinedPct,
      sharedFunders: c.sharedFunders ?? [],
      includesCreator: !!c.includesCreator,
      wallets: (c.wallets ?? []).map(w => typeof w === "string" ? w : w.address),
    }));
    // The endpoint sorts largest-first.
    const largest = clusters[0];
    return {
      available: true,
      clusters,
      largestPct: largest?.combinedPct ?? 0,
      largestSize: largest?.size ?? 0,
      includesCreator: clusters.some((c) => c.includesCreator),
      note: d.note ?? "",
    };
  } catch {
    return null;
  }
}
