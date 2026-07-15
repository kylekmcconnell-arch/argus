// Shared OFAC SDN address-screening core.
//
// A wallet on the US Treasury OFAC SDN list is the hardest signal a due-diligence
// tool can produce, and a real legal-exposure flag for anyone touching the token.
// Source: 0xB10C/ofac-sanctioned-digital-currency-addresses (the maintained,
// auto-updated extraction of Treasury's sdn_advanced.xml). Free, public domain.
//
// This module is imported directly by API handlers (never bundled into the
// collector), so both the HTTP screen (GET /api/sanctions) and server-side
// audit paths (the public /api/v1/token) can screen from one implementation
// without a handler self-calling its own HTTP route.
// @ts-ignore — bundled JS sibling
import { cacheGetJson, cacheSetJson } from "./_cache.js";

const RAW = "https://raw.githubusercontent.com/0xB10C/ofac-sanctioned-digital-currency-addresses/lists/sanctioned_addresses_";
// EVM addresses are shared across chains, so the Ethereum-format lists (ETH +
// stablecoins + L2s) cover Base/BSC/Arbitrum/etc. Solana has its own list.
const LISTS: Record<string, string[]> = {
  evm: ["ETH", "USDC", "USDT", "BSC", "ARB"],
  solana: ["SOL"],
};

export type SanctionsFamily = "evm" | "solana";

export const sanctionsFamily = (chain: string): SanctionsFamily =>
  (chain || "").toLowerCase() === "solana" ? "solana" : "evm";

export interface SanctionsScreenResult {
  available: boolean;
  checked: number;
  listSize?: number;
  sanctioned: string[];
}

// Mirrors src/token/audit.ts SanctionsScreenOutcome so an injected screener can
// hand its result straight to the token audit's checklist recorder + AVOID cap.
export interface SanctionsScreenOutcome extends SanctionsScreenResult {
  completedAt: string;
}

export async function sanctionedSet(family: SanctionsFamily): Promise<Set<string>> {
  // EVM addresses are case-insensitive, so the set is lowercased and the query
  // is lowercased to match. Solana base58 addresses ARE case-sensitive (and
  // real ones almost always carry uppercase), so the Solana set must be stored
  // case-preserved or every hit is missed. The cache key is versioned so a
  // previously-lowercased Solana list does not survive this fix.
  const ck = `ofac:${family}:v2`;
  const cached = await cacheGetJson<string[]>(ck);
  if (cached && cached.length) return new Set(cached);
  const set = new Set<string>();
  await Promise.all(
    LISTS[family].map(async (asset) => {
      try {
        const r = await fetch(`${RAW}${asset}.txt`, { signal: AbortSignal.timeout(9000) });
        if (!r.ok) return;
        const t = await r.text();
        for (const line of t.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#")) continue;
          set.add(family === "solana" ? trimmed : trimmed.toLowerCase());
        }
      } catch { /* one list failing shouldn't sink the screen */ }
    }),
  );
  if (set.size) await cacheSetJson(ck, [...set]);
  return set;
}

/**
 * Screen an already-normalized address list against the OFAC SDN set. Returns
 * available:false (never a false clean) when the list cannot be loaded.
 */
export async function screenAddresses(chain: string, addresses: readonly string[]): Promise<SanctionsScreenResult> {
  const family = sanctionsFamily(chain);
  const unique = [...new Set(addresses.map((a) => a.trim()).filter(Boolean))].slice(0, 40);
  if (!unique.length) return { available: false, checked: 0, sanctioned: [] };
  const set = await sanctionedSet(family);
  if (!set.size) return { available: false, checked: unique.length, sanctioned: [] };
  // Solana is matched case-sensitively; EVM case-insensitively.
  const sanctioned = unique.filter((a) => (family === "solana" ? set.has(a) : set.has(a.toLowerCase())));
  return { available: true, checked: unique.length, listSize: set.size, sanctioned };
}

/**
 * Direct screener for server-side audit paths. Accepts the raw
 * (deployer + holders) list a scan resolved, normalizes it, and stamps a
 * completion time. Returns undefined when there is nothing to screen so the
 * checklist records "not run" rather than a failed attempt. Never throws.
 */
export async function screenSanctionedAddresses(
  chain: string,
  addresses: readonly (string | null | undefined)[],
): Promise<SanctionsScreenOutcome | undefined> {
  const clean = [...new Set(addresses.filter((a): a is string => typeof a === "string" && a.length > 8))].slice(0, 40);
  if (!clean.length) return undefined;
  const completedAt = new Date().toISOString();
  try {
    const result = await screenAddresses(chain, clean);
    return { ...result, completedAt };
  } catch {
    return { available: false, checked: clean.length, sanctioned: [], completedAt };
  }
}
