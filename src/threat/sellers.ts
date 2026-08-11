// Sell-structure client: fetch realized sell behaviour (api/sell-structure) and
// hand it to the judge/UI. "Bad sellers" are the wallets doing the selling that
// also match a risk role - the deployer, a deployer-seeded wallet, or a
// launch-block sniper that has since exited. EVM only (keyless Etherscan);
// Solana returns null until the Helius trade-history follow-on lands.
import type { SellStructure } from "./types";

export async function sellStructure(chain: string, address: string, creator: string | null): Promise<SellStructure | null> {
  if (chain === "solana") return null;
  try {
    const q = new URLSearchParams({ address, chain });
    if (creator) q.set("creator", creator);
    const r = await fetch(`/api/sell-structure?${q}`, { signal: AbortSignal.timeout(28000) });
    if (!r.ok) return null;
    const d = (await r.json()) as SellStructure & { hit?: boolean };
    if (!d.available || d.hit === false) return null;
    return d;
  } catch {
    return null;
  }
}
