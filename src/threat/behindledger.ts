// Client wrapper for api/behindledger.ts - "Behind the Ledger", the deep
// transfer-graph read. Slow by nature (it walks the token's whole recent
// Transfer history on-chain), so the UI loads it lazily behind a run button,
// the same way the insider-cluster panel is gated. Takes the token address
// plus the dossier's pair address so pair txs can be split into swaps vs
// liquidity ops.
import type { BehindLedgerReport } from "./types";

// Plain fetch, no retry: the endpoint is expensive (a budgeted 40s chain walk)
// and answers 200 even on internal failure, so a retry would only ever re-run
// the whole scan on a network blip.
export async function behindLedger(chain: string, address: string, pairAddress?: string | null): Promise<BehindLedgerReport | null> {
  try {
    const pair = pairAddress ? `&pair=${encodeURIComponent(pairAddress)}` : "";
    const res = await fetch(`/api/behindledger?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}${pair}`, {
      signal: AbortSignal.timeout(65_000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as BehindLedgerReport & { error?: string; note?: string };
    if (!d.available) return null;
    return d;
  } catch {
    return null;
  }
}
