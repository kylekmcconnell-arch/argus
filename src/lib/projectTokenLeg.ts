// Attribute the subject's own project token, so the FULL scan can run the token
// threat leg in the same run. Attribution order is a trust order:
//   1. a contract address in the subject's OWN bio - authoritative (the
//      impersonation defense: the official account states its contract),
//   2. a claimed promotion that carries a contract address,
//   3. (client-side, elsewhere) a canonical CoinGecko name-match, guarded
//      against namesakes by the bio's own domain.
// Pure string logic only - this file is also compiled by the DOM-less server
// tsconfig and bundled into the collector.

export interface TokenCandidate {
  address: string;
  via: "evm" | "solana";
  source: string; // one line of provenance, rendered with the report
}

const EVM_CA = /0x[a-fA-F0-9]{40}/;
// Base58 mint, matched only as a standalone word (no base58 chars on either
// side) so prose and URLs never false-positive.
const SOL_WORD = /(?:^|[^1-9A-HJ-NP-Za-km-z])([1-9A-HJ-NP-Za-km-z]{32,44})(?![1-9A-HJ-NP-Za-km-z])/;

export function tokenFromBio(bio: string): TokenCandidate | null {
  const b = bio ?? "";
  const evm = b.match(EVM_CA)?.[0];
  if (evm) return { address: evm, via: "evm", source: "the contract in the subject's own bio" };
  const sol = b.match(SOL_WORD)?.[1];
  if (sol) return { address: sol, via: "solana", source: "the contract in the subject's own bio" };
  return null;
}

export function tokenFromPromotions(
  promos: { contract_address?: string | null; chain?: string | null; ticker?: string | null }[] | undefined,
): TokenCandidate | null {
  for (const p of promos ?? []) {
    const a = (p.contract_address ?? "").trim();
    if (!a) continue;
    const chain = (p.chain ?? "").toLowerCase();
    const via: TokenCandidate["via"] =
      chain === "solana" ? "solana" : chain ? "evm" : /^0x[a-fA-F0-9]{40}$/.test(a) ? "evm" : "solana";
    // Reject anything that isn't a plausible address on its inferred chain.
    if (via === "evm" && !/^0x[a-fA-F0-9]{40}$/.test(a)) continue;
    if (via === "solana" && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(a)) continue;
    const tick = (p.ticker ?? "").replace(/^\$+/, "");
    return { address: a, via, source: `a claimed promotion${tick ? ` ($${tick})` : ""}` };
  }
  return null;
}
