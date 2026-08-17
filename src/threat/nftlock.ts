// Client wrapper for api/nftlock.ts — see that file for the method. Keyed to a
// pool address rather than a token, so it's called with the dexscreener pair
// address, not the token contract.
import type { NftLockReport } from "./types";
import { retryFetch } from "../lib/retry";

export async function nftLiquidityLock(chain: string, pairAddress: string): Promise<NftLockReport | null> {
  try {
    const res = await retryFetch(`/api/nftlock?address=${encodeURIComponent(pairAddress)}&chain=${encodeURIComponent(chain)}`, {
      signal: AbortSignal.timeout(24000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as NftLockReport & { error?: string };
    if (!d.available) return null;
    return d;
  } catch {
    return null;
  }
}
