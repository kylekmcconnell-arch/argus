// Creator & insider clustering (#9): the deep, on-demand answer to "how many of
// the 'separate' top holders are secretly one hand?" Reuses Argus's existing,
// proven wallet-clustering endpoints — /api/cluster (Solana/Helius) and
// /api/evm-cluster (EVM/Etherscan) — which union wallets tied by a shared funder
// or a direct transfer, and mark when the token's creator is inside a cluster.
// Keyed + slow (up to ~60s), so the UI loads it lazily after the verdict, the
// way nlyra gates "Bundle Detection" behind a button.

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
      clusters?: { size: number; combinedPct: number; sharedFunders?: string[]; includesCreator?: boolean; wallets?: string[] }[];
      note?: string;
    };
    if (!d.available) return null;
    const clusters = (d.clusters ?? []).map((c) => ({
      size: c.size,
      combinedPct: c.combinedPct,
      sharedFunders: c.sharedFunders ?? [],
      includesCreator: !!c.includesCreator,
      wallets: c.wallets ?? [],
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
