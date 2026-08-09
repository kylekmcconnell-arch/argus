// Wallet threat triage: an address in → every token position joined against the
// scanner's verdicts, with an at-risk-USD figure and dead-market flags. Modeled
// on nlyra's wallet scanner (portfolio × cached verdicts). Cached-first for an
// instant answer; the largest unknown positions are freshly scanned (which also
// records them to the shared ledger, so the next analyst gets them cached).

import type { TraceStep } from "../data/evidence";
import type { ThreatVerdict } from "./types";
import { dexByToken, pickPair } from "../token/sources";
import { threatScan } from "./scan";

export interface WalletPosition {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  balance: number;
  priceUsd: number | null;
  valueUsd: number | null;
  liquidityUsd: number | null;
  deadMarket: boolean; // no pool / no liquidity left — maybe nowhere to sell
  verdict: ThreatVerdict | null;
  risk: number | null;
  verdictAt: number | null;
  fresh: boolean; // scanned live in this pass (vs a cached/ledger verdict)
}

export interface WalletScan {
  address: string;
  chain: string;
  positions: WalletPosition[];
  totals: {
    valueUsd: number;
    atRiskUsd: number; // value held in DANGER/RUG tokens
    deadMarkets: number;
    counts: Record<ThreatVerdict | "UNSCANNED", number>;
  };
  scannedAt: number;
}

interface RawPosition {
  address: string; chain: string; symbol: string; name: string;
  balance: number; priceUsd: number | null; valueUsd: number | null;
}

const BAD: ThreatVerdict[] = ["DANGER", "RUG"];
const FRESH_SCAN_LIMIT = 5; // fresh-scan only the largest unknown positions

async function holdings(address: string): Promise<{ positions: RawPosition[]; chain: string; available: boolean; note?: string }> {
  try {
    const res = await fetch(`/api/wallet-holdings?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return { positions: [], chain: "", available: false };
    const d = (await res.json()) as { available?: boolean; chain?: string; positions?: RawPosition[]; note?: string };
    return { positions: d.positions ?? [], chain: d.chain ?? "", available: !!d.available, note: d.note };
  } catch {
    return { positions: [], chain: "", available: false };
  }
}

// A cached verdict from the shared ledger (no fresh scan).
async function cachedVerdict(address: string): Promise<{ verdict: ThreatVerdict; risk: number; at: number } | null> {
  try {
    const res = await fetch(`/api/threat-receipts?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const d = (await res.json()) as { available?: boolean; receipt?: { verdict: ThreatVerdict; risk: number; flaggedAt: number } | null };
    if (!d.available || !d.receipt) return null;
    return { verdict: d.receipt.verdict, risk: d.receipt.risk, at: d.receipt.flaggedAt };
  } catch {
    return null;
  }
}

export async function scanWallet(
  address: string,
  emit?: (s: TraceStep) => void,
): Promise<WalletScan | null> {
  emit?.({ phase: "Wallet", label: "Enumerate", detail: "Reading token positions in the wallet…", tone: "neutral" });
  const { positions: raw, chain, available, note } = await holdings(address);
  if (!available) {
    emit?.({ phase: "Wallet", label: "Unavailable", detail: note ?? "Could not enumerate holdings for this wallet.", tone: "warn" });
    return null;
  }
  if (!raw.length) {
    emit?.({ phase: "Wallet", label: "Empty", detail: "No token positions found in this wallet.", tone: "warn" });
    return { address, chain, positions: [], totals: { valueUsd: 0, atRiskUsd: 0, deadMarkets: 0, counts: emptyCounts() }, scannedAt: Date.now() };
  }
  emit?.({ phase: "Wallet", label: `${raw.length} positions`, detail: `Pricing and checking liquidity across the portfolio…`, tone: "neutral" });

  // Enrich each position with live liquidity + a cached verdict.
  const positions: WalletPosition[] = await Promise.all(raw.map(async (p) => {
    const pair = pickPair(await dexByToken(p.address), p.address);
    const liquidityUsd = pair?.liquidity?.usd ?? null;
    const priceUsd = p.priceUsd ?? (pair?.priceUsd ? Number(pair.priceUsd) : null);
    const valueUsd = priceUsd != null ? p.balance * priceUsd : p.valueUsd;
    const cached = await cachedVerdict(p.address);
    return {
      address: p.address, chain: p.chain, symbol: p.symbol, name: p.name,
      balance: p.balance, priceUsd, valueUsd,
      liquidityUsd,
      deadMarket: liquidityUsd != null && liquidityUsd < 500,
      verdict: cached?.verdict ?? null,
      risk: cached?.risk ?? null,
      verdictAt: cached?.at ?? null,
      fresh: false,
    };
  }));

  // Fresh-scan the largest UNKNOWN positions by value (bounded). A fresh scan
  // records to the shared ledger, so it also warms the cache for everyone.
  const unknowns = positions
    .filter((p) => p.verdict == null && (p.valueUsd ?? 0) > 0)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
    .slice(0, FRESH_SCAN_LIMIT);
  if (unknowns.length) emit?.({ phase: "Wallet", label: "Scan unknowns", detail: `Freshly scanning the ${unknowns.length} largest unrated position${unknowns.length === 1 ? "" : "s"}…`, tone: "neutral" });
  for (const u of unknowns) {
    const via = u.chain === "solana" ? "solana" : "evm";
    const scan = await threatScan({ kind: "token", ref: u.address, via }).catch(() => null);
    if (scan) { u.verdict = scan.call.verdict; u.risk = scan.call.risk; u.verdictAt = scan.scannedAt; u.fresh = true; }
  }

  // Totals.
  const counts = emptyCounts();
  let valueUsd = 0, atRiskUsd = 0, deadMarkets = 0;
  for (const p of positions) {
    valueUsd += p.valueUsd ?? 0;
    if (p.deadMarket) deadMarkets++;
    if (p.verdict) counts[p.verdict]++; else counts.UNSCANNED++;
    if (p.verdict && BAD.includes(p.verdict)) atRiskUsd += p.valueUsd ?? 0;
  }
  positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

  emit?.({ phase: "Verdict", label: "Portfolio triaged", detail: `$${Math.round(atRiskUsd).toLocaleString()} of $${Math.round(valueUsd).toLocaleString()} in flagged tokens; ${deadMarkets} dead market${deadMarkets === 1 ? "" : "s"}.`, tone: atRiskUsd > 0 ? "bad" : "good" });

  return { address, chain, positions, totals: { valueUsd, atRiskUsd, deadMarkets, counts }, scannedAt: Date.now() };
}

function emptyCounts(): Record<ThreatVerdict | "UNSCANNED", number> {
  return { SAFE: 0, CAUTION: 0, DANGER: 0, RUG: 0, UNKNOWN: 0, UNSCANNED: 0 };
}
