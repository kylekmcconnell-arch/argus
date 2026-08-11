// Buyer cohort / Common Coins + wallet taxonomy + wallet reputation. All
// on-demand (like insider clusters): the top holders' shared OTHER holdings,
// their age/funding mix, and their track record from OUR own prior scans.
import type { CohortOverlap, WalletTaxonomy } from "./types";
import { apiFetch } from "./net";

export async function buyerCohort(chain: string, address: string, verdict?: string, symbol?: string): Promise<CohortOverlap | null> {
  try {
    const q = new URLSearchParams({ address, chain });
    if (verdict) q.set("verdict", verdict);
    if (symbol) q.set("symbol", symbol);
    const r = await apiFetch(`/api/cohort?${q}`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const d = (await r.json()) as CohortOverlap & { available?: boolean };
    if (!d.available) return null;
    return d;
  } catch {
    return null;
  }
}

export async function walletTaxonomy(chain: string, address: string): Promise<WalletTaxonomy | null> {
  try {
    const r = await apiFetch(`/api/wallet-taxonomy?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(45000) });
    if (!r.ok) return null;
    const d = (await r.json()) as WalletTaxonomy & { available?: boolean };
    if (!d.available) return null;
    return d;
  } catch {
    return null;
  }
}
