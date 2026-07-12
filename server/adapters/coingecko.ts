// CoinGecko adapter. Source-of-record token market data by contract address,
// used for call-performance (K2). Free Demo key works; gated on COINGECKO_API_KEY.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";
import { env } from "../config";
import { SubjectClass } from "../../src/engine";

const PRO = "https://pro-api.coingecko.com/api/v3";
const PUBLIC = "https://api.coingecko.com/api/v3";

// chain id -> CoinGecko asset-platform id
const PLATFORM: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  base: "base",
  solana: "solana",
  bsc: "binance-smart-chain",
  polygon: "polygon-pos",
  arbitrum: "arbitrum-one",
};

export async function tokenByContract(chain: string, address: string) {
  const key = env("COINGECKO_API_KEY");
  const platform = PLATFORM[chain.toLowerCase()] ?? chain.toLowerCase();
  const base = key ? PRO : PUBLIC;
  const headers: Record<string, string> = key ? { "x-cg-pro-api-key": key } : {};
  const tier = key ? "subscription/keyed" : "keyless";
  let res: Response;
  try {
    res = await fetch(`${base}/coins/${platform}/contract/${address}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    recordCall("coingecko", "contract-lookup", 0, `${tier} · transport_error`, "failed");
    return null;
  }
  if (!res.ok) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} · http_${res.status}`, "failed");
    return null;
  }

  let d: any;
  try { d = await res.json(); }
  catch {
    recordCall("coingecko", "contract-lookup", 0, `${tier} · response_json_error`, "failed");
    return null;
  }
  if (!d || typeof d !== "object" || Array.isArray(d)) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} · result_shape_error`, "partial");
    return null;
  }
  const hasSymbol = typeof d.symbol === "string" && !!d.symbol.trim();
  const hasName = typeof d.name === "string" && !!d.name.trim();
  if (!hasSymbol && !hasName) {
    recordCall("coingecko", "contract-lookup", 0, `${tier} · missing_identity`, "partial");
    return null;
  }
  const complete = hasSymbol && hasName && (d.market_data == null || (typeof d.market_data === "object" && !Array.isArray(d.market_data)));
  recordCall(
    "coingecko",
    "contract-lookup",
    0,
    complete ? tier : `${tier} · incomplete_market_shape`,
    complete ? "succeeded" : "partial",
  );
  return {
    symbol: d.symbol,
    name: d.name,
    priceUsd: d.market_data?.current_price?.usd,
    mcapUsd: d.market_data?.market_cap?.usd,
    ath_change_pct: d.market_data?.ath_change_percentage?.usd,
  };
}

export const coingeckoAdapter: Adapter = {
  id: "coingecko",
  label: "CoinGecko",
  available: () => true, // public endpoint works without key (rate limited)
  async run(ctx: CollectContext) {
    if (ctx.evidence.roles.includes(SubjectClass.PROJECT) && !ctx.evidence.roles.includes(SubjectClass.KOL)) {
      return { state: "skipped" as const, attempts: 0, detail: "project-account token mentions are not KOL promotions" };
    }
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address && p.chain);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "Market data", detail: "Cross-referencing promoted tokens against CoinGecko (source of record)…", tone: "neutral" });
    for (const p of promos) {
      const t = await tokenByContract(p.chain!, p.contract_address!);
      if (!t) continue;
      const downBad = (t.ath_change_pct ?? 0) < -90;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: downBad ? "finding" : "confirmed",
        note: `$${t.symbol?.toUpperCase() ?? p.ticker} market record returned${t.ath_change_pct == null ? "" : ` · ${Math.round(t.ath_change_pct)}% from ATH`}`,
        provider: "coingecko",
        sourceCount: 1,
      });
      ctx.emit({
        phase: "On-chain",
        label: `$${t.symbol?.toUpperCase() ?? p.ticker}`,
        detail: `mcap $${Math.round(t.mcapUsd ?? 0).toLocaleString()}${downBad ? `, ${Math.round(t.ath_change_pct!)}% from ATH (collapsed)` : ""}`,
        source: "coingecko",
        tone: downBad ? "warn" : "neutral",
      });
    }
  },
};
