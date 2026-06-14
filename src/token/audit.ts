// Token audit: contract address / DexScreener URL -> a forensic rug verdict,
// computed live in the browser from DexScreener + GoPlus. The engine owns the
// bands and caps; the sources only supply evidence. No keys, no backend.

import type { ResolvedInput } from "../lib/resolveInput";
import type { TraceStep } from "../data/evidence";
import {
  dexByToken,
  dexByPair,
  pickPair,
  goplus,
  GOPLUS_CHAIN,
  type DexPair,
  type GoPlusSecurity,
} from "./sources";

export interface TokenAxis {
  key: string;
  label: string;
  score: number;
  weight: number;
  rationale: string;
}

export interface TokenDossier {
  address: string;
  chain: string;
  dexId: string;
  symbol: string;
  name: string;
  imageUrl?: string;
  priceUsd?: number;
  mcap?: number;
  liquidityUsd?: number;
  vol24?: number;
  ageDays?: number;
  verdict: string;
  score: number | null;
  capApplied: string | null;
  headline: string;
  axes: TokenAxis[];
  safety: Record<string, string | number | boolean | null>;
  socials: { label: string; url: string }[];
  findings: { claim: string; tone: "good" | "warn" | "bad"; source: string }[];
  trace: TraceStep[];
  live: boolean;
  goplusChecked: boolean;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (s?: string) => (s == null || s === "" ? null : Number(s));
const truthy = (s?: string) => s === "1";

function band(score: number): string {
  if (score >= 70) return "PASS";
  if (score >= 40) return "CAUTION";
  return "FAIL";
}

export async function auditToken(input: ResolvedInput, emit?: (s: TraceStep) => void): Promise<TokenDossier | null> {
  if (input.kind !== "token") return null;
  const trace: TraceStep[] = [];
  const step = (s: TraceStep) => {
    trace.push(s);
    emit?.(s);
  };

  step({ phase: "P0 · Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener…`, tone: "neutral" });

  // 1) resolve to a canonical pair
  let pair: DexPair | null = null;
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) pair = await dexByPair(m[1], m[2]);
    if (!pair && m) pair = pickPair(await dexByToken(m[2]), m[2]);
  } else {
    pair = pickPair(await dexByToken(input.ref), input.ref);
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 · Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }

  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const vol24 = pair.volume?.h24 ?? 0;
  const buys = pair.txns?.h24?.buys ?? 0;
  const sells = pair.txns?.h24?.sells ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 86400000 : undefined;
  step({
    phase: "Market",
    label: `$${pair.baseToken.symbol}`,
    detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`,
    source: "dexscreener",
    tone: liquidityUsd < 15000 ? "warn" : "neutral",
  });

  // 2) contract safety via GoPlus (EVM only)
  const gpChain = GOPLUS_CHAIN[chain];
  let gp: GoPlusSecurity | null = null;
  if (gpChain) {
    step({ phase: "Contract", label: "Safety scan", detail: "GoPlus: honeypot, mint authority, ownership, tax, holders…", tone: "neutral" });
    gp = await goplus(gpChain, address);
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety scan not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }

  const findings: TokenDossier["findings"] = [];
  const caps: [number, string][] = [];

  // ---- safety signals ----
  const honeypot = truthy(gp?.is_honeypot);
  const mintable = truthy(gp?.is_mintable);
  const ownerRenounced = !gp?.owner_address || /^0x0+$/.test(gp.owner_address) || gp.owner_address === "";
  const takeBack = truthy(gp?.can_take_back_ownership);
  const hiddenOwner = truthy(gp?.hidden_owner);
  const selfdestruct = truthy(gp?.selfdestruct);
  const pausable = truthy(gp?.transfer_pausable);
  const openSource = truthy(gp?.is_open_source);
  const cannotSellAll = truthy(gp?.cannot_sell_all);
  const buyTax = (num(gp?.buy_tax) ?? 0) * 100;
  const sellTax = (num(gp?.sell_tax) ?? 0) * 100;
  const holderCount = num(gp?.holder_count) ?? 0;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  const lpLocked =
    (gp?.lp_holders?.some((h) => h.is_locked === 1) ?? false) ||
    (gp?.lp_holders?.reduce((a, h) => a + (h.is_locked ? Number(h.percent) : 0), 0) ?? 0) > 0.5;

  if (gp) {
    if (honeypot) { caps.push([10, "honeypot_confirmed"]); findings.push({ claim: "Honeypot: the contract blocks selling. Buyers cannot exit.", tone: "bad", source: "goplus" }); }
    if (cannotSellAll) caps.push([15, "cannot_sell_all"]);
    if (mintable) { caps.push([35, "mint_authority_active"]); findings.push({ claim: "Supply is mintable. The owner can inflate supply at will.", tone: "bad", source: "goplus" }); }
    if (takeBack || hiddenOwner) { caps.push([35, "reclaimable_ownership"]); findings.push({ claim: hiddenOwner ? "Hidden owner detected." : "Ownership can be taken back after renouncement.", tone: "bad", source: "goplus" }); }
    if (selfdestruct) findings.push({ claim: "Contract can self-destruct.", tone: "bad", source: "goplus" });
    if (sellTax >= 20) findings.push({ claim: `Sell tax is ${sellTax.toFixed(0)}%.`, tone: "bad", source: "goplus" });
    if (ownerRenounced && !mintable && !takeBack) findings.push({ claim: "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });
    if (lpLocked) findings.push({ claim: "Liquidity is locked.", tone: "good", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15000) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });

  // ---- axes ----
  const axes: TokenAxis[] = [];

  // T1 Liquidity (24)
  let t1 = liquidityUsd < 2000 ? 2 : liquidityUsd < 10000 ? 6 : liquidityUsd < 50000 ? 12 : liquidityUsd < 250000 ? 18 : 22;
  if (lpLocked) t1 = clamp(t1 + 2, 0, 24);
  else if (gp) t1 = clamp(t1 - 3, 0, 24);
  axes.push({ key: "T1", label: "Liquidity & lock", score: t1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${gp ? (lpLocked ? ", LP locked" : ", LP not locked") : ""}.` });

  // T2 Contract safety (26)
  let t2 = 26;
  if (!gp) t2 = 9;
  else {
    if (!openSource) t2 -= 8;
    if (pausable) t2 -= 8;
    if (selfdestruct) t2 -= 10;
    if (!ownerRenounced) t2 -= 4;
    if (gp.is_proxy === "1") t2 -= 3;
  }
  t2 = clamp(t2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: t2, weight: 26, rationale: gp ? `${openSource ? "verified" : "unverified"} source, ${ownerRenounced ? "ownership renounced" : "owner active"}${pausable ? ", transfers pausable" : ""}.` : "On-chain safety not verifiable keyless on this chain." });

  // T3 Taxes & tradeability (12)
  const tax = buyTax + sellTax;
  let t3 = !gp ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (cannotSellAll) t3 = 0;
  axes.push({ key: "T3", label: "Taxes & tradeability", score: t3, weight: 12, rationale: gp ? `buy ${buyTax.toFixed(0)}% / sell ${sellTax.toFixed(0)}%${cannotSellAll ? ", cannot sell all" : ""}.` : "Tax not verifiable keyless on this chain." });

  // T4 Holder distribution (16)
  let t4 = holderCount < 50 ? 3 : holderCount < 500 ? 7 : holderCount < 5000 ? 11 : 14;
  if (topHolderPct != null) {
    if (topHolderPct > 50) t4 -= 8;
    else if (topHolderPct > 25) t4 -= 4;
    else if (topHolderPct > 10) t4 -= 2;
    else t4 += 2;
  }
  t4 = clamp(t4, 0, 16);
  axes.push({ key: "T4", label: "Holder distribution", score: t4, weight: 16, rationale: gp ? `${holderCount.toLocaleString()} holders${topHolderPct != null ? `, top holder ${topHolderPct.toFixed(0)}%` : ""}.` : "Holder data not verifiable keyless on this chain." });

  // T5 Trading authenticity (12)
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  let t5: number;
  if (vol24 < 500) t5 = 4;
  else if (volLiq > 25) t5 = 4;
  else if (volLiq > 8) t5 = 7;
  else if (volLiq < 0.02) t5 = 5;
  else t5 = 11;
  const total = buys + sells;
  if (total > 20 && sells / total > 0.8) t5 = clamp(t5 - 2, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: t5, weight: 12, rationale: `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });

  // T6 Maturity & presence (10)
  let t6 = ageDays == null ? 4 : ageDays < 1 ? 2 : ageDays < 7 ? 4 : ageDays < 30 ? 6 : ageDays < 180 ? 8 : 10;
  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((s) => ({ label: s.type, url: s.url })),
  ];
  if (socials.length) t6 = clamp(t6 + 1, 0, 10);
  axes.push({ key: "T6", label: "Maturity & presence", score: t6, weight: 10, rationale: `${ageDays != null ? (ageDays < 1 ? "<1 day" : Math.round(ageDays) + " days") + " old" : "age unknown"}${socials.length ? `, ${socials.length} linked socials` : ", no socials"}.` });

  // ---- verdict ----
  const raw = Math.round(axes.reduce((a, x) => a + x.score, 0));
  let capApplied: string | null = null;
  let score = raw;
  let verdict: string;
  if (caps.length) {
    const [ceiling, key] = caps.reduce((m, c) => (c[0] < m[0] ? c : m));
    score = Math.min(raw, ceiling);
    capApplied = key;
    verdict = ceiling <= 10 ? "AVOID" : band(score);
  } else {
    verdict = band(score);
  }

  const headline = buildHeadline(verdict, capApplied, { honeypot, mintable, ownerRenounced, lpLocked, liquidityUsd, gp: !!gp, chain });
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} · ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "AVOID" || verdict === "FAIL" ? "bad" : "warn" });

  return {
    address, chain, dexId: pair.dexId, symbol: pair.baseToken.symbol, name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl, priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
    mcap: fdv, liquidityUsd, vol24, ageDays,
    verdict, score, capApplied, headline, axes,
    safety: { honeypot, mintable, ownerRenounced, takeBack, hiddenOwner, selfdestruct, pausable, openSource, cannotSellAll, buyTax, sellTax, holderCount, topHolderPct, lpLocked },
    socials, findings, trace, live: true, goplusChecked: !!gp,
  };
}

function buildHeadline(
  verdict: string,
  cap: string | null,
  f: { honeypot: boolean; mintable: boolean; ownerRenounced: boolean; lpLocked: boolean; liquidityUsd: number; gp: boolean; chain: string },
): string {
  if (f.honeypot) return "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Supply is mintable, the owner can dilute holders to zero.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (verdict === "PASS") return `Clears the forensic bar: ${f.ownerRenounced ? "renounced" : "owned"}, ${f.lpLocked ? "LP locked" : "tradeable"}, with real depth.`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${f.liquidityUsd < 15000 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!f.gp) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}
