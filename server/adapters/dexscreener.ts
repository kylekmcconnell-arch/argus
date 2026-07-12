// DexScreener adapter — FREE, keyless, real. Resolves a token by contract
// address to live DEX liquidity / volume / price, the signal that surfaces thin
// liquidity and fresh-pair rug risk. Used to enrich any promotion the subject
// pushed once we have its contract address.

import type { Adapter, CollectContext } from "./types";
import { recordCall } from "../cost";

const BASE = "https://api.dexscreener.com";
const isRecord = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const recordDex = (op: string, status: "succeeded" | "partial" | "failed", detail?: string) => {
  recordCall("dexscreener", op, 0, ["keyless", detail].filter(Boolean).join(" · "), status);
};

export interface DexTokenSnapshot {
  address: string;
  chain?: string;
  symbol?: string;
  priceUsd?: number;
  liquidityUsd?: number;
  volume24h?: number;
  fdv?: number;
  pairCreatedAt?: number;
}

// Public helper so the orchestrator / tests can hit it directly.
export async function lookupToken(address: string): Promise<DexTokenSnapshot | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/latest/dex/tokens/${address}`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    recordDex("token-pairs", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordDex("token-pairs", "failed", `http_${res.status}`);
    return null;
  }

  let data: unknown;
  try { data = await res.json(); }
  catch {
    recordDex("token-pairs", "failed", "response_json_error");
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.pairs)) {
    recordDex("token-pairs", "partial", "result_shape_error");
    return null;
  }
  if (!data.pairs.length) {
    recordDex("token-pairs", "succeeded", "no_pairs");
    return { address };
  }
  const pairs = data.pairs.filter(isRecord);
  if (!pairs.length) {
    recordDex("token-pairs", "partial", "invalid_pair_rows");
    return null;
  }
  // pick the deepest-liquidity pair as canonical
  const top = pairs.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
  const incomplete = pairs.length !== data.pairs.length
    || (!top.chainId && !top.baseToken?.symbol && top.priceUsd == null && top.liquidity?.usd == null);
  recordDex("token-pairs", incomplete ? "partial" : "succeeded", incomplete ? "incomplete_pair_shape" : undefined);
  return {
    address,
    chain: top.chainId,
    symbol: top.baseToken?.symbol,
    priceUsd: top.priceUsd ? Number(top.priceUsd) : undefined,
    liquidityUsd: top.liquidity?.usd,
    volume24h: top.volume?.h24,
    fdv: top.fdv,
    pairCreatedAt: top.pairCreatedAt,
  };
}

// ── Token-lifecycle / migration-dive detection ──
// The playbook's "a migration restarts the chart, then it dives to zero" signal.
// A relaunch mints a NEW contract under the SAME ticker, so we search DexScreener
// by ticker and group pairs into "generations" by base-token address. Two solid
// caveats are baked in: a same-ticker COLLISION from an unrelated token is
// possible, so multi-generation is only a HEURISTIC migration flag (reported as
// "possible"); whereas the COLLAPSE of a single generation (real launch, now
// near-zero liquidity / crashed) is a self-contained, reliable signal.
export interface TokenGeneration {
  address: string;
  chain?: string;
  firstLaunch?: number; // earliest pairCreatedAt (epoch ms) across its pairs
  liquidityUsd: number; // summed across its pairs
  priceUsd?: number;
  h24?: number; // 24h price change %
}

export interface LifecycleSignal {
  ticker: string;
  generations: TokenGeneration[]; // oldest first
  migrated: boolean; // >=2 distinct same-ticker contracts on-chain (heuristic)
  dive: { address: string; detail: string } | null; // launched, then collapsed
}

export async function detectTokenLifecycle(ticker: string, knownAddress?: string): Promise<LifecycleSignal | null> {
  const sym = ticker.replace(/^\$/, "").trim();
  if (!sym) return null;
  let res: Response;
  try {
    res = await fetch(`${BASE}/latest/dex/search?q=${encodeURIComponent(sym)}`, {
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    recordDex("token-search", "failed", "transport_error");
    return null;
  }
  if (!res.ok) {
    recordDex("token-search", "failed", `http_${res.status}`);
    return null;
  }

  let data: unknown;
  try { data = await res.json(); }
  catch {
    recordDex("token-search", "failed", "response_json_error");
    return null;
  }
  if (!isRecord(data) || !Array.isArray(data.pairs)) {
    recordDex("token-search", "partial", "result_shape_error");
    return null;
  }

  try {
    const validRows = data.pairs.filter(isRecord);
    const pairs = validRows.filter((p) => (p.baseToken?.symbol ?? "").toLowerCase() === sym.toLowerCase());
    if (!pairs.length) {
      recordDex("token-search", validRows.length === data.pairs.length ? "succeeded" : "partial", validRows.length === data.pairs.length ? "no_match" : "invalid_pair_rows");
      return null;
    }

    const byAddr = new Map<string, any[]>();
    let missingAddress = 0;
    for (const p of pairs) {
      const a = p.baseToken?.address;
      if (!a) { missingAddress += 1; continue; }
      let arr = byAddr.get(a);
      if (!arr) { arr = []; byAddr.set(a, arr); }
      arr.push(p);
    }

    const generations: TokenGeneration[] = [...byAddr.entries()]
      .map(([address, ps]) => {
        const created = ps.map((p) => p.pairCreatedAt).filter((x): x is number => typeof x === "number");
        const top = ps.reduce((a, b) => ((b.liquidity?.usd ?? 0) > (a.liquidity?.usd ?? 0) ? b : a));
        return {
          address,
          chain: top.chainId,
          firstLaunch: created.length ? Math.min(...created) : undefined,
          liquidityUsd: ps.reduce((s, p) => s + (p.liquidity?.usd ?? 0), 0),
          priceUsd: top.priceUsd ? Number(top.priceUsd) : undefined,
          h24: top.priceChange?.h24,
        };
      })
      .sort((a, b) => (a.firstLaunch ?? 0) - (b.firstLaunch ?? 0));

    const migrated = generations.length >= 2;
    // Judge the collapse ONLY on the subject's VERIFIED contract. A bare ticker
    // search returns every same-symbol token — a common word like "WORLD" collides
    // with dozens of unrelated copycats — so picking "the most recent generation"
    // as a fallback attributes a random impersonator's rug to the subject. No known
    // contract → no collapse attribution. (Ticker collision is not provenance.)
    const canon = knownAddress
      ? generations.find((g) => g.address.toLowerCase() === knownAddress.toLowerCase())
      : null;
    let dive: { address: string; detail: string } | null = null;
    if (canon) {
      const nearZeroLiq = canon.liquidityUsd < 5000;
      const crashed = (canon.h24 ?? 0) < -60;
      if (nearZeroLiq || crashed) {
        dive = {
          address: canon.address,
          detail: `liquidity $${Math.round(canon.liquidityUsd).toLocaleString()}${canon.h24 != null ? `, ${Math.round(canon.h24)}% 24h` : ""}${nearZeroLiq ? " — effectively dead" : ""}`,
        };
      }
    }
    const incomplete = validRows.length !== data.pairs.length || missingAddress > 0;
    recordDex("token-search", incomplete ? "partial" : "succeeded", incomplete ? "incomplete_pair_shape" : undefined);
    return { ticker: sym, generations, migrated, dive };
  } catch {
    recordDex("token-search", "partial", "result_processing_error");
    return null;
  }
}

export const dexscreenerAdapter: Adapter = {
  id: "dexscreener",
  label: "DexScreener",
  available: () => true, // keyless
  async run(ctx: CollectContext) {
    const promos = ctx.evidence.promotions.filter((p) => p.contract_address);
    if (!promos.length) return;
    ctx.emit({ phase: "On-chain", label: "DEX liquidity scan", detail: `Resolving ${promos.length} promoted token(s) on DexScreener…`, tone: "neutral" });
    for (const p of promos) {
      const snap = await lookupToken(p.contract_address!);
      if (!snap) continue;
      const thin = (snap.liquidityUsd ?? 0) < 10000;
      p.perf_current = snap.priceUsd;
      ctx.recordCheck?.({
        id: "promoted-token-performance",
        status: thin ? "finding" : "confirmed",
        note: `$${snap.symbol ?? p.ticker} liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}${thin ? " (thin liquidity)" : ""}`,
        provider: "dexscreener",
        sourceCount: 1,
      });
      ctx.emit({
        phase: "On-chain",
        label: `$${snap.symbol ?? p.ticker}`,
        detail: `liquidity $${Math.round(snap.liquidityUsd ?? 0).toLocaleString()}, 24h vol $${Math.round(snap.volume24h ?? 0).toLocaleString()}${thin ? " — thin liquidity, rug-risk flag" : ""}`,
        source: "dexscreener",
        tone: thin ? "warn" : "neutral",
      });
    }
  },
};
