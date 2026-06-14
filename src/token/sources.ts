// Live token-data sources. Both are free, keyless, and CORS-open, so the entire
// token audit runs client-side in the browser, even on the static hosted site.
//   - DexScreener: market, liquidity, volume, txns, age, socials.
//   - GoPlus: contract safety (honeypot, mint authority, ownership, tax, holders).

export interface DexPair {
  chainId: string;
  dexId: string;
  pairAddress: string;
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  txns?: { h24?: { buys: number; sells: number } };
  priceChange?: { h24?: number };
  baseToken?: { address: string; name: string; symbol: string };
  quoteToken?: { symbol: string };
  labels?: string[];
  info?: { imageUrl?: string; websites?: { url: string }[]; socials?: { type: string; url: string }[] };
}

// DexScreener chainId -> GoPlus numeric chain id (EVM only)
export const GOPLUS_CHAIN: Record<string, string> = {
  ethereum: "1",
  bsc: "56",
  base: "8453",
  polygon: "137",
  arbitrum: "42161",
  optimism: "10",
  avalanche: "43114",
  fantom: "250",
  cronos: "25",
  zksync: "324",
  linea: "59144",
  scroll: "534352",
};

export async function dexByToken(address: string): Promise<DexPair[]> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  if (!res.ok) return [];
  const d = (await res.json()) as { pairs?: DexPair[] };
  return d.pairs ?? [];
}

export async function dexByPair(chain: string, pair: string): Promise<DexPair | null> {
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${chain}/${pair}`);
  if (!res.ok) return null;
  const d = (await res.json()) as { pairs?: DexPair[]; pair?: DexPair };
  return d.pair ?? d.pairs?.[0] ?? null;
}

export function pickPair(pairs: DexPair[], wantAddress?: string): DexPair | null {
  if (!pairs.length) return null;
  const byLiq = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
  if (wantAddress) {
    const match = byLiq.find((p) => p.baseToken?.address?.toLowerCase() === wantAddress.toLowerCase());
    if (match) return match;
  }
  return byLiq[0];
}

export interface GoPlusSecurity {
  is_honeypot?: string;
  is_mintable?: string;
  owner_address?: string;
  can_take_back_ownership?: string;
  hidden_owner?: string;
  selfdestruct?: string;
  is_proxy?: string;
  buy_tax?: string;
  sell_tax?: string;
  cannot_sell_all?: string;
  is_open_source?: string;
  transfer_pausable?: string;
  trading_cooldown?: string;
  holder_count?: string;
  lp_holder_count?: string;
  lp_total_supply?: string;
  holders?: { address: string; percent: string; is_locked?: number; is_contract?: number; tag?: string }[];
  lp_holders?: { address: string; percent: string; is_locked?: number }[];
  creator_address?: string;
  creator_percent?: string;
}

// honeypot.is — a real buy/sell SIMULATION (EVM). Stronger than a static flag.
export interface HoneypotSim {
  isHoneypot: boolean;
  simSuccess: boolean;
  buyTax: number;
  sellTax: number;
  flags: string[];
}
export async function honeypotIs(chainId: string, address: string): Promise<HoneypotSim | null> {
  try {
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainId}`);
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      simSuccess: !!d.simulationSuccess,
      buyTax: d.simulationResult?.buyTax ?? 0,
      sellTax: d.simulationResult?.sellTax ?? 0,
      flags: (d.flags ?? []).map((f: any) => f.description ?? f.flag ?? String(f)),
    };
  } catch {
    return null;
  }
}

// GoPlus Solana token security — different shape from EVM (mint/freeze authority,
// transfer hooks, metadata mutability, holders).
export interface SolanaSecurity {
  mintable?: { status?: string };
  freezable?: { status?: string };
  closable?: { status?: string };
  non_transferable?: string;
  transfer_hook?: unknown[];
  transfer_fee?: Record<string, unknown>;
  metadata_mutable?: { status?: string };
  balance_mutable_authority?: { status?: string };
  default_account_state?: string;
  holder_count?: string | number;
  holders?: { account?: string; percent?: string; is_locked?: number; tag?: string }[];
  lp_holders?: { account?: string; percent?: string; is_locked?: number }[];
  creators?: { address?: string }[];
  metadata?: { name?: string; symbol?: string };
  trusted_token?: number;
}
export async function goplusSolana(mint: string): Promise<SolanaSecurity | null> {
  try {
    const res = await fetch(`https://api.gopluslabs.io/api/v1/solana/token_security?contract_addresses=${mint}`);
    if (!res.ok) return null;
    const d = (await res.json()) as { result?: Record<string, SolanaSecurity> };
    const row = d.result?.[mint] ?? (d.result ? Object.values(d.result)[0] : undefined);
    return row ?? null;
  } catch {
    return null;
  }
}

export async function goplus(chainId: string, address: string): Promise<GoPlusSecurity | null> {
  try {
    const res = await fetch(
      `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`,
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { result?: Record<string, GoPlusSecurity> };
    const row = d.result?.[address.toLowerCase()] ?? (d.result ? Object.values(d.result)[0] : undefined);
    return row ?? null;
  } catch {
    return null;
  }
}
