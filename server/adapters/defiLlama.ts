// DeFiLlama TVL: a free, keyless attestation of a DeFi protocol's total value
// locked. Complements the CoinGecko market-liveness signals (rank / market cap /
// liquidity) with the on-chain usage metric they lack — the "TVL attestation"
// a due-diligence report otherwise reports as "not collected".
//
// Additive by design: a standalone collector. The caller decides whether the
// result feeds a project traction basic fact or a transparency/liveness check.
// api.llama.fi is free and needs no key (the paid tier is pro-api.llama.fi).
import { recordCall } from "../cost";

const API_BASE = "https://api.llama.fi";

export interface ProtocolTvl {
  slug: string;
  name: string;
  symbol: string | null;
  tvlUsd: number;
  chains: string[];
  chainBreakdown: { chain: string; tvlUsd: number }[];
  geckoId: string | null;
  /** human-facing DeFiLlama page */
  sourceUrl: string;
}

export type TvlOutcome =
  | { available: true; value: ProtocolTvl }
  | { available: false; note: string };

// currentChainTvls mixes real chains with pseudo-segments (borrowed/staking/
// pool2/vesting/…). Exclude those so chainBreakdown is raw chain TVL only.
const NON_CHAIN_SEGMENT = /(?:^|[-])(?:borrowed|staking|pool2|vesting|treasury|offers|options)(?:$|[-])/i;

/** Best-effort DeFiLlama slug from a project name. Callers may pass an explicit slug. */
export function defiLlamaSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Fetch a protocol's current TVL and per-chain breakdown from DeFiLlama.
 * Never throws — every failure (including "no such protocol", an HTTP 400) is a
 * clean unavailable outcome. A 400 is treated as a completed "no match" screen,
 * not a provider failure, so it does not poison the provider ledger.
 */
export async function collectProtocolTvl(
  projectName: string,
  options: { fetcher?: typeof fetch; slug?: string } = {},
): Promise<TvlOutcome> {
  const fetcher = options.fetcher ?? fetch;
  const slug = options.slug ?? defiLlamaSlug(projectName);
  if (!slug) return { available: false, note: "No resolvable DeFiLlama protocol slug." };

  const url = `${API_BASE}/protocol/${encodeURIComponent(slug)}`;
  let response: Response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(20000) });
  } catch {
    recordCall("defillama", "protocol", 0, `${slug} · transport_error`, "failed");
    return { available: false, note: "DeFiLlama was unavailable." };
  }
  if (!response.ok) {
    // 400 = protocol not found: a completed lookup with no match, not an outage.
    const notFound = response.status === 400;
    recordCall("defillama", "protocol", 0, `${slug} · http_${response.status}`, notFound ? "succeeded" : "failed");
    return {
      available: false,
      note: notFound ? `No DeFiLlama protocol matched "${slug}".` : "DeFiLlama request failed.",
    };
  }

  type ProtocolResponse = {
    name?: unknown;
    symbol?: unknown;
    gecko_id?: unknown;
    currentChainTvls?: unknown;
    tvl?: unknown;
  };
  let data: ProtocolResponse;
  try {
    data = ((await response.json()) ?? {}) as ProtocolResponse;
  } catch {
    recordCall("defillama", "protocol", 0, `${slug} · json_error`, "failed");
    return { available: false, note: "DeFiLlama response was unreadable." };
  }

  const series = Array.isArray(data.tvl) ? (data.tvl as { totalLiquidityUSD?: unknown }[]) : [];
  const latest = series.length ? series[series.length - 1] : undefined;
  const tvlUsd = typeof latest?.totalLiquidityUSD === "number" ? latest.totalLiquidityUSD : null;
  if (tvlUsd === null || !(tvlUsd > 0)) {
    recordCall("defillama", "protocol", 0, `${slug} · no_tvl`, "partial");
    return { available: false, note: "DeFiLlama returned no positive TVL for this protocol." };
  }

  const rawChainTvls =
    data.currentChainTvls && typeof data.currentChainTvls === "object"
      ? (data.currentChainTvls as Record<string, unknown>)
      : {};
  const chainBreakdown = Object.entries(rawChainTvls)
    .filter(([chain, value]) => typeof value === "number" && value > 0 && !NON_CHAIN_SEGMENT.test(chain))
    .map(([chain, value]) => ({ chain, tvlUsd: value as number }))
    .sort((a, b) => b.tvlUsd - a.tvlUsd);

  recordCall("defillama", "protocol", 0, `${slug} · tvl_${Math.round(tvlUsd)}`, "succeeded");
  return {
    available: true,
    value: {
      slug,
      name: typeof data.name === "string" ? data.name : projectName,
      symbol: typeof data.symbol === "string" ? data.symbol : null,
      tvlUsd,
      chains: chainBreakdown.map((entry) => entry.chain),
      chainBreakdown,
      geckoId: typeof data.gecko_id === "string" ? data.gecko_id : null,
      sourceUrl: `https://defillama.com/protocol/${slug}`,
    },
  };
}

/** Compact USD, e.g. 13699712109 → "$13.7B". For evidence/traction strings. */
export function formatTvlUsd(tvlUsd: number): string {
  if (tvlUsd >= 1_000_000_000) return `$${(tvlUsd / 1_000_000_000).toFixed(1)}B`;
  if (tvlUsd >= 1_000_000) return `$${(tvlUsd / 1_000_000).toFixed(1)}M`;
  if (tvlUsd >= 1_000) return `$${(tvlUsd / 1_000).toFixed(1)}K`;
  return `$${Math.round(tvlUsd)}`;
}
