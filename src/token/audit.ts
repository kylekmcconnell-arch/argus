// Token audit: contract / DexScreener URL -> a forensic rug verdict, computed
// live in the browser, keyless. Sources: DexScreener (market), GoPlus EVM +
// honeypot.is simulation (EVM safety), GoPlus Solana (Solana safety). Also
// surfaces the people behind the token (project X, deployer, top holders) and a
// unified Panoptes graph. The engine owns the bands and caps.

import type { RunnableTokenInput } from "../lib/resolveInput";
import type { ReportPersistenceContext, ReportVersionContext } from "../lib/reportVersion";
import type { TraceStep } from "../data/evidence";
import type { PanoptesNode, PanoptesEdge } from "../engine";
import { tokenEntityKey, walletEntityKey } from "../graph/network";
import {
  dexByToken, dexByPair, pickPair, goplus, goplusSolana, honeypotIs, coingeckoToken, GOPLUS_CHAIN,
  type DexPair, type GoPlusSecurity, type SolanaSecurity, type HoneypotSim, type CgInfo,
} from "./sources";

export interface TokenAxis { key: string; label: string; score: number; weight: number; rationale: string }
export interface Holder { address: string; percent: number; tag?: string; isContract?: boolean }

export interface NormalizedSafety {
  available: boolean;
  simChecked: boolean;
  honeypot: boolean;
  honeypotOnchain: boolean; // GoPlus / on-chain flag, independent of the honeypot.is simulation
  serialScammerCreator: boolean; // GoPlus honeypot_with_same_creator: the deployer has shipped honeypots before
  mintable: boolean;
  freezable: boolean;
  nonTransferable: boolean;
  ownerRenounced: boolean;
  takeBack: boolean;
  hiddenOwner: boolean;
  selfdestruct: boolean;
  pausable: boolean;
  openSource: boolean;
  cannotSellAll: boolean;
  metadataMutable: boolean;
  buyTax: number;
  sellTax: number;
  holderCount: number;
  topHolderPct: number | null;
  lpLocked: boolean;
  // LP-holder forensics: where the liquidity actually sits
  lpBurnedPct: number;        // sent to a null/dead address — permanently unpullable
  lpLockedPct: number;        // held in a locker / locked, excluding burns
  lpTopUnlockedEoaPct: number; // largest share in a single unlocked non-contract wallet (rug-ready)
  // Solana (Token-2022) risk vectors
  balanceMutable: boolean;    // controller can rewrite holder balances
  transferHook: boolean;      // a program runs on every transfer (can block sells)
  transferFee: boolean;       // built-in transfer tax
  // owner-power risk vectors (dangerous mainly while the owner is active)
  proxy: boolean;
  slippageModifiable: boolean;
  blacklist: boolean;
  tradingCooldown: boolean;
  externalCall: boolean;
  ownerChangeBalance: boolean;
  creatorPercent: number;
}

export interface TokenDossier {
  address: string; chain: string; dexId: string; pairAddress?: string; symbol: string; name: string;
  imageUrl?: string; priceUsd?: number; mcap?: number; liquidityUsd?: number; vol24?: number; ageDays?: number;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  verdict: string; score: number | null; capApplied: string | null; headline: string;
  axes: TokenAxis[];
  safety: NormalizedSafety;
  socials: { label: string; url: string }[];
  projectX: string | null;
  deployer: string | null;
  topHolders: Holder[];
  insiderPct: number;
  bundleCount: number;
  bundleRisk: "low" | "elevated" | "high";
  cg: CgInfo | null;
  graph: { nodes: PanoptesNode[]; edges: PanoptesEdge[] };
  findings: { claim: string; tone: "good" | "warn" | "bad"; source: string }[];
  trace: TraceStep[];
  live: boolean;
  safetyChecked: boolean;
  /** Frozen server-side evidence/check context for a persisted report version. */
  versionContext?: ReportVersionContext;
  /** Snapshot framing inherited from a parent investigation facet. */
  viewVersionContext?: ReportVersionContext;
  /** Fresh persistence/cost capability inherited from a parent investigation. */
  viewPersistence?: ReportPersistenceContext;
  /** Transient persistence/cost capability for a scan completed in this tab. */
  persistence?: ReportPersistenceContext;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const num = (s?: string | number | null) => (s == null || s === "" ? null : Number(s));
const t1 = (s?: string) => s === "1";
const solFlag = (x?: { status?: string }) => x?.status === "1";

function band(score: number): string {
  return score >= 70 ? "PASS" : score >= 40 ? "CAUTION" : "FAIL";
}

function handleFromUrl(url?: string): string | null {
  if (!url) return null;
  const m = url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i);
  return m ? "@" + m[1].toLowerCase() : null;
}

const isBurnAddr = (a?: string) => !!a && (/^0x0+$/.test(a) || /0*dead$/i.test(a.replace(/^0x/, "")));
const isBurnTag = (t?: string) => /null|burn|dead|0x0{4,}/i.test(t ?? "");

// --- normalize EVM safety from GoPlus + honeypot.is ---
function evmSafety(gp: GoPlusSecurity | null, sim: HoneypotSim | null): NormalizedSafety {
  const s = sim;
  const topHolderPct = gp?.holders?.length ? Number(gp.holders[0].percent) * 100 : null;
  // Classify where the liquidity sits: burned (permanent) vs locked vs sitting in
  // an unlocked wallet. Concentration in an unlocked CONTRACT (e.g. a pair/staking
  // contract, as PEPE shows) is not a rug signal — only an unlocked non-contract
  // wallet holding the LP is rug-ready.
  let lpBurnedPct = 0, lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of gp?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct;
    else if (h.is_locked === 1) lpLockedPct += pct;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  return {
    available: !!gp || !!s,
    simChecked: !!s,
    honeypot: t1(gp?.is_honeypot) || (s?.isHoneypot ?? false),
    honeypotOnchain: t1(gp?.is_honeypot) || t1(gp?.cannot_sell_all),
    serialScammerCreator: t1(gp?.honeypot_with_same_creator),
    mintable: t1(gp?.is_mintable),
    freezable: false,
    nonTransferable: false,
    ownerRenounced: !gp?.owner_address || /^0x0+$/.test(gp.owner_address || "") || gp.owner_address === "",
    takeBack: t1(gp?.can_take_back_ownership),
    hiddenOwner: t1(gp?.hidden_owner),
    selfdestruct: t1(gp?.selfdestruct),
    pausable: t1(gp?.transfer_pausable),
    openSource: t1(gp?.is_open_source),
    cannotSellAll: t1(gp?.cannot_sell_all),
    metadataMutable: false,
    buyTax: s?.simSuccess ? s.buyTax : (num(gp?.buy_tax) ?? 0) * 100,
    sellTax: s?.simSuccess ? s.sellTax : (num(gp?.sell_tax) ?? 0) * 100,
    holderCount: num(gp?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct, lpLockedPct, lpTopUnlockedEoaPct,
    balanceMutable: false, transferHook: false, transferFee: false,
    proxy: t1(gp?.is_proxy),
    slippageModifiable: t1(gp?.slippage_modifiable) || t1(gp?.personal_slippage_modifiable),
    blacklist: t1(gp?.is_blacklisted),
    tradingCooldown: t1(gp?.trading_cooldown),
    externalCall: t1(gp?.external_call),
    ownerChangeBalance: t1(gp?.owner_change_balance),
    creatorPercent: (num(gp?.creator_percent) ?? 0) * 100,
  };
}

function solanaSafety(sol: SolanaSecurity | null): NormalizedSafety {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct)) continue;
    if (h.is_locked === 1) lpLockedPct += pct;
    else lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpLockedPct >= 50;
  const mintable = solFlag(sol?.mintable);
  const freezable = solFlag(sol?.freezable);
  return {
    available: !!sol,
    simChecked: false,
    honeypot: !!sol?.non_transferable && sol.non_transferable === "1",
    honeypotOnchain: sol?.non_transferable === "1",
    serialScammerCreator: false, // GoPlus's same-creator honeypot flag is EVM-only

    mintable,
    freezable,
    nonTransferable: sol?.non_transferable === "1",
    ownerRenounced: !mintable && !freezable, // both authorities revoked
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: solFlag(sol?.closable),
    pausable: false,
    openSource: true, // n/a on Solana SPL; not penalised
    cannotSellAll: false,
    metadataMutable: solFlag(sol?.metadata_mutable),
    buyTax: 0,
    sellTax: 0,
    holderCount: num(sol?.holder_count) ?? 0,
    topHolderPct,
    lpLocked,
    lpBurnedPct: 0, lpLockedPct, lpTopUnlockedEoaPct,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false, slippageModifiable: false, blacklist: false, tradingCooldown: false,
    externalCall: false, ownerChangeBalance: false, creatorPercent: 0,
  };
}

function emptySafety(): NormalizedSafety {
  return {
    available: false, simChecked: false, honeypot: false, honeypotOnchain: false, serialScammerCreator: false, mintable: false, freezable: false,
    nonTransferable: false, ownerRenounced: false, takeBack: false, hiddenOwner: false,
    selfdestruct: false, pausable: false, openSource: false, cannotSellAll: false,
    metadataMutable: false, buyTax: 0, sellTax: 0, holderCount: 0, topHolderPct: null, lpLocked: false,
    lpBurnedPct: 0, lpLockedPct: 0, lpTopUnlockedEoaPct: 0,
    balanceMutable: false, transferHook: false, transferFee: false,
    proxy: false, slippageModifiable: false, blacklist: false, tradingCooldown: false,
    externalCall: false, ownerChangeBalance: false, creatorPercent: 0,
  };
}

// In-session cache so re-opening a token (Radar -> report, back-nav, watchlist)
// is instant. Keyed by ref + skipSim; short TTL keeps live data fresh.
const _cache = new Map<string, { at: number; d: TokenDossier | null }>();
const CACHE_TTL = 60_000;

export async function auditToken(
  input: RunnableTokenInput,
  emit?: (s: TraceStep) => void,
  opts?: { skipSim?: boolean; force?: boolean },
): Promise<TokenDossier | null> {
  if (input.kind !== "token") return null;
  const cacheRef = input.via === "evm" ? input.ref.toLowerCase() : input.ref;
  const key = `${input.via}:${cacheRef}:${opts?.skipSim ? 1 : 0}`;
  const hit = opts?.force ? undefined : _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.d;
  const d = await runTokenAudit(input, emit, opts);
  _cache.set(key, { at: Date.now(), d });
  return d;
}

async function runTokenAudit(
  input: RunnableTokenInput,
  emit?: (s: TraceStep) => void,
  opts?: { skipSim?: boolean; force?: boolean },
): Promise<TokenDossier | null> {
  if (input.kind !== "token") return null;
  const trace: TraceStep[] = [];
  const step = (s: TraceStep) => { trace.push(s); emit?.(s); };

  step({ phase: "P0 · Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener…`, tone: "neutral" });

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
  const pc24 = pair.priceChange?.h24 ?? 0;
  const ageDays = pair.pairCreatedAt ? (Date.now() - pair.pairCreatedAt) / 86400000 : undefined;
  // Trading-authenticity signals. High volume-to-liquidity churn is normal for
  // thin meme tokens, so it is NOT wash trading on its own — the signature is
  // heavy churn with the price going nowhere (volume that does not move price).
  const volLiq = liquidityUsd > 0 ? vol24 / liquidityUsd : 0;
  const washSignature = volLiq >= 15 && Math.abs(pc24) < 10 && buys + sells >= 50;
  step({ phase: "Market", label: `$${pair.baseToken.symbol}`, detail: `liquidity $${Math.round(liquidityUsd).toLocaleString()}, 24h vol $${Math.round(vol24).toLocaleString()}, mcap $${Math.round(fdv).toLocaleString()}`, source: "dexscreener", tone: liquidityUsd < 15000 ? "warn" : "neutral" });

  // ---- safety (chain-specific) ----
  const gpChain = GOPLUS_CHAIN[chain];
  let safety = emptySafety();
  let gpEvm: GoPlusSecurity | null = null;
  let sol: SolanaSecurity | null = null;
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders…", tone: "neutral" });
    sol = await goplusSolana(address);
    safety = solanaSafety(sol);
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders…" : "GoPlus + honeypot.is buy/sell simulation…", tone: "neutral" });
    const [gp, sim] = await Promise.all([goplus(gpChain, address), opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address)]);
    gpEvm = gp;
    safety = evmSafety(gp, sim);
  } else {
    step({ phase: "Contract", label: "Limited", detail: `On-chain safety not available for ${chain} keyless; scored on market data only.`, tone: "warn" });
  }

  const findings: TokenDossier["findings"] = [];
  const caps: [number, string][] = [];
  const s = safety;

  // ---- Phase 1 Step 2: corroborate against an independent market source ----
  // Fetched before scoring so broad market presence can temper a single-source
  // honeypot flag. (Skipped on the fast Radar scan to avoid CoinGecko limits.)
  let cg: CgInfo | null = null;
  if (!opts?.skipSim) {
    step({ phase: "Corroborate", label: "CoinGecko cross-check", detail: "Independent listing, CEX markets, market-cap vs FDV…", tone: "neutral" });
    cg = await coingeckoToken(chain, address);
  }
  // Independent evidence that holders can actually sell: a honeypot cannot
  // produce genuine sell transactions against deep liquidity, and cannot be
  // listed on many centralized venues. Both signals are keyless.
  const provablySellable = sells >= 10 && liquidityUsd >= 250_000;
  const broadlyTraded = (cg?.cexCount ?? 0) >= 5 || provablySellable;

  if (s.available) {
    if (s.honeypot) {
      // honeypot.is can false-positive on complex / older contracts. If only the
      // simulation flagged it (GoPlus on-chain check disagrees) AND the token is
      // demonstrably sellable (real sells against deep liquidity, or many CEX
      // markets), treat it as a simulation artifact, not a disqualifying cap.
      const simOnly = !s.honeypotOnchain && !s.cannotSellAll;
      if (simOnly && broadlyTraded) {
        const why = (cg?.cexCount ?? 0) >= 5
          ? `${cg!.cexCount} centralized markets`
          : `${sells} on-chain sells against $${Math.round(liquidityUsd).toLocaleString()} liquidity in 24h`;
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it — treated as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
      } else {
        caps.push([10, "honeypot_confirmed"]);
        findings.push({ claim: s.nonTransferable ? "Non-transferable token: holders cannot move it." : "Honeypot: the contract blocks selling.", tone: "bad", source: s.honeypotOnchain ? "goplus" : "sim" });
      }
    }
    if (s.cannotSellAll) caps.push([15, "cannot_sell_all"]); // honeypot-class — never relaxed

    // ---- legitimacy-weighted AUTHORITY caps ----
    // A live mint / freeze / reclaimable-ownership authority is a rug setup on an
    // anon memecoin, but a GOVERNED ops mechanism on a real project (emissions,
    // upgrades). The thing a rug can't fake is real centralized-exchange listings —
    // Coinbase / Kraken / Binance run diligence a scam doesn't pass. So we weigh the
    // authority caps against CEX presence: 3+ real CEX markets => the capability is a
    // disclosed finding, not a disqualifier; 1-2 => soften to a CAUTION ceiling;
    // unlisted => the full hard cap stands (conservative for the unknown). The
    // capability is ALWAYS shown as a finding — this changes the score, not the
    // transparency. Honeypot / non-transferable / serial-scammer caps are unaffected.
    // "Established" = real CEX presence a rug can't buy, with market-cap floors so a
    // couple of low-tier listings can't game it: broad listings (5+), or a few
    // listings on a material cap, or a single listing on a large cap.
    const cexN = cg?.cexCount ?? 0;
    const mcap = fdv;
    const established = cexN >= 5 || (cexN >= 3 && mcap >= 10_000_000) || (cexN >= 1 && mcap >= 100_000_000);
    const authorityTone = established ? "warn" : "bad";
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup — confirm the controller." : "";
    if (s.mintable) {
      if (!established) caps.push([35, "mint_authority_active"]);
      findings.push({ claim: `Mint authority is live: supply can be minted.${govNote}`, tone: authorityTone, source: chain === "solana" ? "goplus-sol" : "goplus" });
    }
    if (s.freezable) {
      if (!established) caps.push([35, "freeze_authority_active"]);
      findings.push({ claim: `Freeze authority is live: the team can freeze token accounts.${govNote}`, tone: authorityTone, source: "goplus-sol" });
    }
    if (s.takeBack || s.hiddenOwner) {
      // A hidden owner is a deception (never relaxed); reclaimable-after-renounce is an authority flag (relaxable when established).
      if (s.hiddenOwner) { caps.push([35, "reclaimable_ownership"]); findings.push({ claim: "Hidden owner detected.", tone: "bad", source: "goplus" }); }
      else { if (!established) caps.push([35, "reclaimable_ownership"]); findings.push({ claim: `Ownership can be reclaimed after renouncement.${govNote}`, tone: authorityTone, source: "goplus" }); }
    }
    if (s.selfdestruct) findings.push({ claim: "Contract can self-destruct / be closed.", tone: "bad", source: "goplus" });
    // The deployer's OTHER tokens include honeypots — a serial-scammer signal that a
    // clean-looking contract can't wash off. Independent of this token's own flags.
    if (s.serialScammerCreator) { caps.push([25, "serial_scammer_creator"]); findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before — a serial scammer.", tone: "bad", source: "goplus" }); }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Sell simulation passed (buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%).`, tone: "good", source: "honeypot.is" });
    if (s.ownerRenounced && !s.mintable && !s.takeBack && !s.freezable) findings.push({ claim: chain === "solana" ? "Mint and freeze authority revoked." : "Ownership renounced; no mint or take-back.", tone: "good", source: "goplus" });

    // ---- owner-power risk vectors ----
    // These are dangerous mainly while the owner is active. A renounced contract
    // cannot exercise them, so blue chips that merely *have* the capability
    // (PEPE ships a blacklist + anti-whale, but is renounced) are not penalized.
    const ownerActive = !s.ownerRenounced;
    if (s.ownerChangeBalance && ownerActive) {
      // GoPlus over-flags this on some upgradeable governance tokens (e.g. LDO).
      // A token broadly traded on many venues with deep liquidity is not under an
      // active balance-rewrite threat, so corroboration downgrades the hard cap.
      if (broadlyTraded) {
        findings.push({ claim: "GoPlus flags an owner-modify-balance capability, but broad CEX listing and deep liquidity indicate it is a governance/upgrade artifact, not an active threat.", tone: "warn", source: "argus" });
      } else {
        caps.push([20, "owner_can_modify_balance"]);
        findings.push({ claim: "Owner can modify holder balances directly — they can zero your wallet.", tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? "Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders." : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: "Tax is modifiable: a low tax now can be raised toward 100% after you buy.", tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: "Owner can blacklist addresses — your wallet can be blocked from selling.", tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: "Trading cooldown is enforceable — sells can be delayed.", tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls — behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    if (s.creatorPercent >= 5) findings.push({ claim: `Creator still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: "goplus" });

    // ---- Solana (Token-2022) vectors ----
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else { caps.push([20, "balance_mutable_authority"]); findings.push({ claim: "Balance-mutable authority is active — the controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" }); }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured — a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }

    // ---- LP-holder forensics: where the liquidity actually sits ----
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) — permanently removed, it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet — it can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet — removable at will.`, tone: "warn", source: "goplus" });
    else findings.push({ claim: "Liquidity does not appear locked or burned.", tone: "warn", source: "goplus" });
  }
  if (liquidityUsd < 15000) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  // ---- manipulation & price-action signals ----
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}% — a wash-trading / fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h — the token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 100000) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity — a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });

  // CoinGecko-derived corroboration findings (cg was fetched above).
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({ claim: "Not listed on CoinGecko — no independent market-data corroboration.", tone: "warn", source: "coingecko" });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap — large unlock / dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }

  // ---- insider / bundle-snipe concentration ----
  // Non-contract, non-locked wallets holding a large combined share are the
  // signature of a bundled launch or a coordinated early snipe.
  const rawHolders = (chain === "solana" ? sol?.holders ?? [] : gpEvm?.holders ?? []) as Array<{ address?: string; account?: string; percent?: string; is_contract?: number | string; is_locked?: number; tag?: string }>;
  const eoaHolders = rawHolders.filter(
    (h) => !(h.is_contract === 1 || h.is_contract === "1") && h.is_locked !== 1 && !/lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(h.tag || ""),
  );
  // Free-tier GoPlus sometimes returns a short, self-inconsistent holder list
  // whose percentages sum past 100%. When that happens the distribution data is
  // untrustworthy, so we suppress the concentration signal rather than report a
  // nonsensical figure.
  const topSum = eoaHolders.slice(0, 15).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && topSum <= 101;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  const bundleCount = holdersReliable ? eoaHolders.filter((h) => Number(h.percent) * 100 >= 1).length : 0;
  const bundleRisk: "low" | "elevated" | "high" =
    !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-contract wallets hold ~${insiderPct}% — possible bundled launch or coordinated snipe.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus",
    });
  }

  // ---- axes ----
  const axes: TokenAxis[] = [];

  let aT1 = liquidityUsd < 2000 ? 2 : liquidityUsd < 10000 ? 6 : liquidityUsd < 50000 ? 12 : liquidityUsd < 250000 ? 18 : 22;
  let lpNote = "";
  if (s.lpBurnedPct >= 50) { aT1 = clamp(aT1 + 3, 0, 24); lpNote = ", LP burned"; }
  else if (s.lpLockedPct >= 50) { aT1 = clamp(aT1 + 2, 0, 24); lpNote = ", LP locked"; }
  else if (s.available && s.lpTopUnlockedEoaPct >= 80) { aT1 = clamp(aT1 - 6, 0, 24); lpNote = ", LP in one unlocked wallet"; }
  else if (s.available && s.lpTopUnlockedEoaPct >= 50) { aT1 = clamp(aT1 - 4, 0, 24); lpNote = ", LP mostly in one wallet"; }
  else if (s.available) { aT1 = clamp(aT1 - 3, 0, 24); lpNote = ", LP not locked"; }
  axes.push({ key: "T1", label: "Liquidity & lock", score: aT1, weight: 24, rationale: `$${Math.round(liquidityUsd).toLocaleString()} pooled${lpNote}.` });

  let aT2 = 26;
  if (!s.available) aT2 = 9;
  else if (chain === "solana") {
    if (s.metadataMutable) aT2 -= 8;
    if (!s.ownerRenounced) aT2 -= 6;
    if (s.transferHook) aT2 -= 8;
  } else {
    if (!s.openSource) aT2 -= 8;
    if (s.pausable) aT2 -= 8;
    if (s.selfdestruct) aT2 -= 10;
    if (!s.ownerRenounced) aT2 -= 4;
    // upgradeable / externally-mutable logic erodes contract safety
    if (s.proxy) aT2 -= s.ownerRenounced ? 3 : 6;
    if (s.externalCall) aT2 -= 3;
    if (!s.ownerRenounced && (s.blacklist || s.tradingCooldown)) aT2 -= 3;
  }
  aT2 = clamp(aT2, 0, 26);
  axes.push({ key: "T2", label: "Contract safety", score: aT2, weight: 26, rationale: s.available ? (chain === "solana" ? `${s.ownerRenounced ? "authorities revoked" : "mint/freeze authority active"}${s.metadataMutable ? ", metadata mutable" : ""}.` : `${s.openSource ? "verified" : "unverified"} source, ${s.ownerRenounced ? "ownership renounced" : "owner active"}${s.pausable ? ", pausable" : ""}.`) : "On-chain safety not verifiable keyless on this chain." });

  const tax = s.buyTax + s.sellTax;
  let aT3 = !s.available ? 6 : tax === 0 ? 12 : tax <= 10 ? 10 : tax <= 20 ? 7 : tax <= 40 ? 3 : 0;
  if (s.cannotSellAll || s.nonTransferable) aT3 = 0;
  // a modifiable tax with an active owner is a trap even when the tax reads low now
  if (s.slippageModifiable && !s.ownerRenounced) aT3 = clamp(aT3 - 5, 0, 12);
  if (s.transferFee) aT3 = clamp(aT3 - 5, 0, 12);
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? (chain === "solana" ? "no transfer tax detected." : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.`) : "Tax not verifiable keyless." });

  const topPct = holdersReliable ? s.topHolderPct : null;
  let aT4 = s.holderCount < 50 ? 3 : s.holderCount < 500 ? 7 : s.holderCount < 5000 ? 11 : 14;
  if (topPct != null) {
    if (topPct > 50) aT4 -= 8;
    else if (topPct > 25) aT4 -= 4;
    else if (topPct > 10) aT4 -= 2;
    else aT4 += 2;
  }
  if (bundleRisk === "high") aT4 = clamp(aT4 - 8, 0, 16);
  else if (bundleRisk === "elevated") aT4 = clamp(aT4 - 4, 0, 16);
  if (s.creatorPercent >= 15) aT4 = clamp(aT4 - 5, 0, 16);
  else if (s.creatorPercent >= 5) aT4 = clamp(aT4 - 2, 0, 16);
  aT4 = clamp(aT4, 0, 16);
  const t4Note = !s.available
    ? "Holder data not verifiable keyless."
    : !holdersReliable
      ? `${s.holderCount.toLocaleString()} holders; distribution not reliably reported by the free data tier.`
      : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% in ${bundleCount} fresh wallets` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });

  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (washSignature) aT5 = 2; // churn without price movement = manufactured volume
  else if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%) — wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });

  const socials = [
    ...(pair.info?.websites ?? []).map((w) => ({ label: "site", url: w.url })),
    ...(pair.info?.socials ?? []).map((x) => ({ label: x.type, url: x.url })),
  ];
  // Fold in CoinGecko's OFFICIAL links when the DexScreener pair info didn't carry
  // them (common for established tokens like $UNI). Without this the investigation
  // finds no website/X and gives up, even though the project is obviously known.
  const hasWebsite = socials.some((x) => /^https?:\/\//i.test(x.url) && !/x\.com|twitter\.com|t\.me|discord|github/i.test(x.url));
  const hasTwitter = socials.some((x) => /x\.com|twitter/i.test(x.url) || /twitter|^x$/i.test(x.label));
  if (cg?.homepage && !hasWebsite) socials.push({ label: "site", url: cg.homepage });
  if (cg?.twitter && !hasTwitter) socials.push({ label: "twitter", url: `https://x.com/${cg.twitter}` });
  let aT6 = ageDays == null ? 4 : ageDays < 1 ? 2 : ageDays < 7 ? 4 : ageDays < 30 ? 6 : ageDays < 180 ? 8 : 10;
  if (socials.length) aT6 = clamp(aT6 + 1, 0, 10);
  if (cg?.cexCount) aT6 = clamp(aT6 + 2, 0, 10);
  axes.push({ key: "T6", label: "Maturity & presence", score: aT6, weight: 10, rationale: `${ageDays != null ? (ageDays < 1 ? "<1 day" : Math.round(ageDays) + " days") + " old" : "age unknown"}${socials.length ? `, ${socials.length} socials` : ", no socials"}${cg?.cexCount ? `, ${cg.cexCount} CEX listings` : cg && !cg.listed ? ", not on CoinGecko" : ""}.` });

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
  } else verdict = band(score);

  // ---- people & provenance ----
  const projectX =
    handleFromUrl((pair.info?.socials ?? []).find((x) => /twitter|x/i.test(x.type))?.url) ||
    handleFromUrl((pair.info?.websites ?? []).map((w) => w.url).find((u) => /x\.com|twitter\.com/i.test(u))) ||
    (cg?.twitter ? "@" + cg.twitter : null); // CoinGecko's official X account (blue-chip fallback)
  const deployer = chain === "solana" ? sol?.creators?.[0]?.address ?? null : gpEvm?.creator_address || (gpEvm?.owner_address && !/^0x0+$/.test(gpEvm.owner_address) ? gpEvm.owner_address : null) || null;
  const topHolders: Holder[] = rawHolders.slice(0, 10).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || undefined,
    isContract: h.is_contract === 1 || h.is_contract === "1",
  })).filter((h) => h.address);

  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployer, topHolders, socials);

  const headline = buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} · ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });

  return {
    address, chain, dexId: pair.dexId, pairAddress: pair.pairAddress, symbol: pair.baseToken.symbol, name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? undefined, priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
    mcap: fdv, liquidityUsd, vol24, ageDays, priceChange: pair.priceChange,
    verdict, score, capApplied, headline, axes, safety: s, socials,
    projectX, deployer, topHolders, insiderPct, bundleCount, bundleRisk, cg, graph, findings, trace, live: true, safetyChecked: s.available,
  };
}

function buildGraph(chain: string, address: string, symbol: string, verdict: string, projectX: string | null, deployer: string | null, holders: Holder[], socials: { label: string; url: string }[]): { nodes: PanoptesNode[]; edges: PanoptesEdge[] } {
  const center = tokenEntityKey(chain, address);
  const nodes: PanoptesNode[] = [{
    type: "Token",
    key: center,
    label: "$" + symbol,
    symbol,
    chain,
    address,
    subject: true,
    was_rug: verdict === "AVOID",
  }];
  const edges: PanoptesEdge[] = [];
  if (projectX) {
    nodes.push({ type: "Person", key: projectX });
    edges.push({ src: center, dst: projectX, type: "TEAM" });
  }
  if (deployer) {
    const k = walletEntityKey(chain, deployer);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + deployer.slice(0, 8), chain, address: deployer });
    edges.push({ src: center, dst: k, type: "DEPLOYED_BY" });
  }
  holders.slice(0, 4).forEach((h) => {
    // Roles and short labels are display metadata; the identity is always the
    // chain plus the complete address. The same wallet therefore stays the same
    // node whether it later appears as a holder, deployer or funder.
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({ src: center, dst: k, type: "HELD_BY", verdict: h.percent > 25 ? "Contradicted" : undefined });
  });
  socials.slice(0, 3).forEach((x) => {
    // Key by the real DESTINATION (@handle or domain) — nodes keyed by the
    // generic label ("site", "twitter") collapsed across audits and fake-bridged
    // every token into one blob cabal.
    const xh = x.url.match(/(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{2,30})/i)?.[1];
    const key = xh ? "@" + xh : x.url.match(/^https?:\/\/(?:www\.)?([^/]+)/i)?.[1];
    if (!key || (projectX && key.toLowerCase() === projectX.toLowerCase())) return;
    nodes.push({ type: "Company", key });
    edges.push({ src: center, dst: key, type: "LINKS" });
  });
  return { nodes, edges };
}

function buildHeadline(verdict: string, cap: string | null, s: NormalizedSafety, liq: number, projectX: string | null): string {
  if (s.honeypot) return s.nonTransferable ? "Non-transferable: holders are locked in. Do not touch." : "Honeypot: buyers cannot sell. Do not touch.";
  if (cap === "mint_authority_active") return "Mint authority is live, the team can dilute holders to zero.";
  if (cap === "freeze_authority_active") return "Freeze authority is live, the team can freeze your tokens at any time.";
  if (cap === "reclaimable_ownership") return "Ownership can be reclaimed after renouncement, a classic rug setup.";
  if (cap === "owner_can_modify_balance") return "Owner can rewrite holder balances, they can zero your wallet at will.";
  if (cap === "balance_mutable_authority") return "A balance-mutable authority can rewrite your token balance at will.";
  if (verdict === "PASS") return `Clears the forensic bar: ${s.ownerRenounced ? "authorities revoked" : "owned"}, ${s.lpLocked ? "LP locked" : "tradeable"}, with real depth${projectX ? `. Team: ${projectX}` : "."}`;
  if (verdict === "CAUTION") return `Tradeable but with reservations${liq < 15000 ? "; liquidity is thin" : ""}. Size accordingly.`;
  if (!s.available) return "Scored on market data only; on-chain contract safety could not be verified keyless on this chain.";
  return "Falls short on the forensic checks. Treat as high risk.";
}
