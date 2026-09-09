/** EVM addresses are case insensitive; base58 identities are not. */
export function canonicalAddress(address: string): string {
  const value = address.trim();
  return /^0x[0-9a-f]{40}$/i.test(value) ? value.toLowerCase() : value;
}

export function assetIdentity(chain: string, address: string): string {
  return `${chain.trim().toLowerCase()}:${canonicalAddress(address)}`;
}

export type MarketObservation =
  | { kind: "measured"; liquidityUsd: number }
  | { kind: "no_pair"; liquidityUsd: 0 }
  | { kind: "unavailable" | "malformed" };

/** Filter identity before aggregating. Missing liquidity is never measured zero. */
export function marketObservation(payload: unknown, chain: string, address: string): MarketObservation {
  if (!payload || typeof payload !== "object" || !("pairs" in payload)) return { kind: "malformed" };
  const pairs = (payload as { pairs: unknown }).pairs;
  if (pairs === null || Array.isArray(pairs) && pairs.length === 0) return { kind: "no_pair", liquidityUsd: 0 };
  if (!Array.isArray(pairs)) return { kind: "malformed" };
  const matches = pairs.filter((p) => p && typeof p.chainId === "string" && typeof p.baseToken?.address === "string" && assetIdentity(p.chainId, p.baseToken.address) === assetIdentity(chain, address));
  // A nonempty response for other identities does not prove this asset disappeared.
  if (!matches.length) return { kind: "malformed" };
  const values = matches.map((p) => p.liquidity?.usd);
  if (values.some((n) => typeof n !== "number" || !Number.isFinite(n) || n < 0)) return { kind: "malformed" };
  return { kind: "measured", liquidityUsd: Math.max(...values) };
}
