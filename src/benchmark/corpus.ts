// A small, transparently-labeled benchmark corpus. Every entry is a real
// Ethereum-mainnet token; ARGUS is run live over all of them on the Track
// Record page, so the numbers are measured in your browser at view time and
// never precomputed or hand-tuned.
//
// Two buckets, two honest claims:
//   established        -> ARGUS should CLEAR it (no false alarms on known-good)
//   mintable-governance-> ARGUS should FLAG its live mint authority (it reports
//                         on-chain power, not brand reputation)
//
// We deliberately do NOT ship a "known rugs we caught" bucket: a token that has
// already rugged is dead on-chain today, so auditing its corpse is not an honest
// test of detection. ARGUS's contract layer detects time-invariant danger
// (mint / freeze / reclaimable ownership / failed sell simulation), which is the
// claim this corpus actually measures.

export type CorpusExpectation = "clear" | "flag-authority";

export interface CorpusToken {
  symbol: string;
  name: string;
  address: string;
  chain: string; // DexScreener chainId
  bucket: "established" | "mintable-governance";
  expect: CorpusExpectation;
  note: string;
}

export const CORPUS: CorpusToken[] = [
  // --- Established: fixed-supply, widely held, authorities revoked. CLEAR. ---
  { symbol: "PEPE", name: "Pepe", address: "0x6982508145454ce325ddbe47a25d4ec3d2311933", chain: "ethereum", bucket: "established", expect: "clear", note: "Fixed supply, ownership renounced, deep liquidity." },
  { symbol: "SHIB", name: "Shiba Inu", address: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce", chain: "ethereum", bucket: "established", expect: "clear", note: "Renounced, no mint authority, broadly distributed." },
  { symbol: "UNI", name: "Uniswap", address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984", chain: "ethereum", bucket: "established", expect: "clear", note: "Governance token, no active mint, deep CEX/DEX presence." },
  { symbol: "LINK", name: "Chainlink", address: "0x514910771af9ca656af840dff83e8264ecf986ca", chain: "ethereum", bucket: "established", expect: "clear", note: "Fixed supply, renounced, top-tier liquidity." },
  { symbol: "AAVE", name: "Aave", address: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9", chain: "ethereum", bucket: "established", expect: "clear", note: "Established DeFi blue chip, no mint authority." },
  { symbol: "LDO", name: "Lido DAO", address: "0x5a98fcbea516cf06857215779fd812ca3bef1b32", chain: "ethereum", bucket: "established", expect: "clear", note: "No active mint authority; broad market presence." },
  { symbol: "APE", name: "ApeCoin", address: "0x4d224452801aced8b2f0aebe155379bb5d594381", chain: "ethereum", bucket: "established", expect: "clear", note: "Fixed supply, renounced, deep liquidity." },

  // --- Mintable governance: blue chips whose contracts retain LIVE mint
  //     authority. A name-based checker waves these through; ARGUS reports that
  //     the supply can still be expanded by their controllers. FLAG. ---
  { symbol: "MKR", name: "Maker", address: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", chain: "ethereum", bucket: "mintable-governance", expect: "flag-authority", note: "MakerDAO governance can mint MKR — supply is not fixed." },
  { symbol: "CRV", name: "Curve DAO", address: "0xd533a949740bb3306d119cc777fa900ba034cd52", chain: "ethereum", bucket: "mintable-governance", expect: "flag-authority", note: "CRV has a live inflation minter controlled by the DAO." },
  { symbol: "ENS", name: "Ethereum Name Service", address: "0xc18360217d8f7ab5e7c516566761ea12ce7f9d72", chain: "ethereum", bucket: "mintable-governance", expect: "flag-authority", note: "ENS DAO can mint new ENS after a lockup — owner active." },
];
