// Buyer cohort / Common Coins client. On-demand (like insider clusters): the
// top holders' shared OTHER holdings, computed live per scan via /api/cohort.
// A set of wallets all holding the same obscure tokens is a coordinated crowd.
import type { CohortOverlap } from "./types";

export async function buyerCohort(chain: string, address: string): Promise<CohortOverlap | null> {
  try {
    const r = await fetch(`/api/cohort?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return null;
    const d = (await r.json()) as CohortOverlap & { available?: boolean };
    if (!d.available) return null;
    return d;
  } catch {
    return null;
  }
}
