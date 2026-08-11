// Registry verification: the badge systems wallets use to mark a token
// verified vs unknown. On Solana the canonical registry is Jupiter's Verify
// list - it is literally what Phantom's purple check derives from (Phantom has
// no API of its own; its badge = Jupiter verified OR CoinGecko listed). On EVM
// there is no single registry; the practical equivalents are GoPlus's curated
// trust_list, CoinGecko's reviewed listing, and the Uniswap default list.
// Absence of a badge on a fresh token is NORMAL - it is surfaced as context,
// and only weighed when a token is big enough that "no registry knows it"
// is itself strange. All calls keyless; every failure degrades to "unchecked".

import type { RegistryVerification } from "./types";

export async function registryVerification(
  chain: string,
  address: string,
  cgListed: boolean,
  goplusTrusted: boolean,
): Promise<RegistryVerification> {
  const out: RegistryVerification = {
    level: "unknown",
    jupiterVerified: null,
    organicScoreLabel: null,
    cgListed,
    goplusTrusted,
    sources: [],
    note: "",
  };

  if (chain === "solana") {
    try {
      const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(9000) });
      if (r.ok) {
        const rows = (await r.json()) as { id?: string; isVerified?: boolean | null; tags?: string[]; organicScoreLabel?: string }[];
        const row = rows.find((t) => t.id === address) ?? rows[0];
        if (row) {
          out.jupiterVerified = row.isVerified === true;
          out.organicScoreLabel = row.organicScoreLabel ?? null;
          if (row.isVerified === true) out.sources.push(`Jupiter verified${row.tags?.includes("strict") ? " (strict list)" : ""}`);
        }
      }
    } catch { /* unchecked */ }
  }

  if (goplusTrusted) out.sources.push("GoPlus trust list");
  if (cgListed) out.sources.push("CoinGecko listed");

  out.level = out.jupiterVerified || goplusTrusted ? "registry-verified"
    : cgListed ? "listed"
    : "unknown";

  out.note = out.level === "registry-verified"
    ? `Registry-verified: ${out.sources.join(", ")} - the same registries wallet badges (e.g. Phantom's check) derive from.`
    : out.level === "listed"
      ? `Listed on ${out.sources.join(", ")} - reviewed listing, not a full registry verification.`
      : chain === "solana"
        ? "Not on Jupiter's verified registry - wallets like Phantom will show this token unverified. Normal for a fresh token; strange for an established one."
        : "Not on any curated registry (GoPlus trust list, CoinGecko) - wallets will treat it as an unknown token. Normal for a fresh token; strange for an established one.";
  return out;
}
