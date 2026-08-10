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
import { fetchPriceHistory, type PriceHistory } from "../lib/priceHistory";
import { arkhamProviderEnabled } from "../lib/providerCapabilities.js";
import { detectScannerEvasion, scannerEvasionClaim } from "./scannerEvasion";
import { classifyMarketAddress } from "../lib/marketAddresses";
import { checkForClones, type CloneCheckResult } from "./cloneCheck";
import {
  dexByToken, dexByPair, pickPair, goplus, goplusSolana, honeypotIs, coingeckoToken, GOPLUS_CHAIN,
  GOPLUS_UNSORTED_HOLDER_CHAINS, blockscoutHolders, blockscoutContractSource, rugcheckReport,
  largestInsiderClusterPercent,
  type DexPair, type GoPlusSecurity, type SolanaSecurity, type HoneypotSim, type CgInfo, type ExplorerHolder,
  type ExplorerContractSource, type RugcheckReport,
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
  /** Whether ANY usable LP holder record was returned. Absent or false means
   *  the lock state is unknown, which is different from unlocked and must not
   *  be scored as if the liquidity were provably loose. Optional so reports
   *  frozen before this field existed also read as unmeasured. */
  lpAssessed?: boolean;
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
  /** Whether a source actually reported the creator's balance. Absent or false
   *  means the holding is unknown, which is not the same fact as a creator who
   *  holds nothing. Optional so reports frozen before this field existed also
   *  read as unmeasured. */
  creatorPercentAssessed?: boolean;
}

/**
 * Who a source says created the token, and how strongly.
 *
 * "deployer" means a source identified the wallet that signed the mint or
 * contract creation. "attributed" means a source names the address without that
 * proof: a metadata creator record, a current owner, a mint or update
 * authority. On a bridged or DAO token an authority is routinely a program
 * rather than a person, so an attributed address must never be presented as the
 * human who shipped the token.
 */
export type DeployerAttributionKind = "deployer" | "attributed";
export interface DeployerAttribution {
  address: string;
  /** Provider that answered: goplus, helius, rugcheck. */
  source: string;
  /** The record inside that provider, shown in the report. */
  method: string;
  kind: DeployerAttributionKind;
}

/**
 * What to call the wallet on screen. Only a source that saw the creation signed
 * earns the word "deployer"; a metadata creator, a current owner or a mint
 * authority is an attributed address, and on a bridged or DAO token that is
 * often a program rather than a person. Absent attribution is not proof of a
 * deployment either, so it takes the cautious label too.
 */
export function deployerRoleLabel(
  attribution: DeployerAttribution | null | undefined,
  form: "title" | "wallet" = "title",
): string {
  const proven = attribution?.kind === "deployer";
  const base = proven ? "Deployer" : "Creator or authority";
  return form === "wallet" ? `${base} wallet` : base;
}

export interface TokenDossier {
  address: string; chain: string; dexId: string; dexLabels?: string[]; pairAddress?: string; symbol: string; name: string;
  imageUrl?: string; priceUsd?: number; mcap?: number; fdv?: number; liquidityUsd?: number; vol24?: number; ageDays?: number;
  /**
   * Pool-creation instant from DexScreener, in unix milliseconds. Frozen so a
   * reopened report ages the deployer against the launch instead of against
   * today, the same reason `ageDays` alone was not enough: a day count computed
   * at scan time cannot be re-measured, and it rounds a wallet minted minutes
   * before its token down to zero.
   *
   * It is the closest instant ARGUS holds to the mint, not the mint itself. On a
   * launchpad the pool is created in the same breath as the mint; a token that
   * migrated pools later dates its launch to the migration, so everything built
   * from it says "launch" and never "mint". Null when DexScreener did not report
   * one, which is unmeasured and never a launch at the epoch.
   */
  pairCreatedAt?: number | null;
  priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
  /** Frozen GeckoTerminal series captured during the scan for snapshot-safe rendering. */
  priceHistory?: PriceHistory;
  verdict: string; score: number | null; capApplied: string | null; headline: string;
  axes: TokenAxis[];
  safety: NormalizedSafety;
  socials: { label: string; url: string }[];
  projectX: string | null;
  deployer: string | null;
  /** Which source named the deployer, and whether it proved the creation. */
  deployerAttribution?: DeployerAttribution;
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
  /** OFAC address-screen outcome recorded at scan time (deployer + top holders). */
  sanctionsScreen?: SanctionsScreenOutcome;
  /** Arkham funding/risk trace on the deployer wallet, recorded at scan time. */
  deployerRisk?: DeployerRiskOutcome;
  /** Other mints trading under the same ticker, and what the public records order. */
  cloneCheck?: CloneCheckResult;
  /**
   * Whether the holder distribution was usable. False means the provider's list
   * was self-inconsistent and every concentration number here is a suppressed
   * zero, not a measured one. Absent on reports frozen before this was recorded.
   */
  holdersAssessed?: boolean;
  /** Frozen server-side evidence/check context for a persisted report version. */
  versionContext?: ReportVersionContext;
  /** Snapshot framing inherited from a parent investigation facet. */
  viewVersionContext?: ReportVersionContext;
  /** Fresh persistence/cost capability inherited from a parent investigation. */
  viewPersistence?: ReportPersistenceContext;
  /** Transient persistence/cost capability for a scan completed in this tab. */
  persistence?: ReportPersistenceContext;
}

export interface SanctionsScreenOutcome {
  available: boolean;
  checked: number;
  listSize?: number;
  sanctioned: string[];
  completedAt: string;
  /**
   * Why an unavailable screen did not produce a result. "no_screenable_addresses"
   * means the chain yielded no deployer and no holder list, so there was nothing
   * to compare against the SDN list. That is a chain-coverage limit a rescan
   * cannot change, and it must never read as a clean screen.
   */
  reason?: "no_screenable_addresses" | "list_unavailable";
}

// A screener the audit calls to record its OFAC outcome. The browser default
// (screenAddressSanctions) posts to /api/sanctions; server audit paths inject a
// direct screener (api/_sanctions-core) so the screen and its AVOID cap run
// without a handler self-calling its own authenticated HTTP route.
export type ScreenSanctionsFn = (
  chain: string,
  addresses: readonly (string | null | undefined)[],
) => Promise<SanctionsScreenOutcome | undefined>;

// Arkham risk-path exposure recorded for the deployer wallet at scan time: who
// funded it and whether that money traces to a mixer / hacker / sanctioned
// entity. Arkham is a flat subscription, so this trace is $0 marginal per scan.
export interface DeployerRiskPath {
  seed: string;
  seedName?: string;
  seedType?: string;
  category?: string;
  direction: "backward" | "forward" | string;
  score: number;
  usd: number;
  hops: number;
  firstAt?: string;
  lastAt?: string;
}
export interface DeployerRiskBriefing {
  level: string;
  score: number;
  greatestCategory?: string;
  incomingUsd: number;
  outgoingUsd: number;
  hopDistance?: number;
  updatedAt?: string;
  categoryScores: { category: string; score: number }[];
}
export interface DeployerRiskOutcome {
  available: boolean;
  paths: DeployerRiskPath[];
  briefing?: DeployerRiskBriefing;
  completedAt: string;
}
export type ScreenDeployerRiskFn = (address: string) => Promise<DeployerRiskOutcome | undefined>;

// Concerning-funding categories. Arkham's risk briefing only returns sources
// that contribute to a risk score, so any returned path is already an exposure;
// these split the tone (hard vs soft) for the surfaced finding.
const SEVERE_RISK_CATEGORY = /sanction|hack|theft|exploit|ransom|scam|phish|stolen|fraud|terror/i;

// Browser default: GET the deployer's Arkham trace from the scan-time route.
// Only runs in a browser (relative fetch); the opts.screenDeployerRisk hook is
// reserved for a future server-side direct screener (mirrors screenSanctions),
// so server audits currently record the trace as "not run" rather than a throw.
export async function screenDeployerRisk(
  address: string | null | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<DeployerRiskOutcome | undefined> {
  if (!arkhamProviderEnabled()) return undefined;
  if (!address || address.length < 8) return undefined;
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin) return undefined;
  const completedAt = new Date().toISOString();
  try {
    const r = await fetchImpl(`/api/deployer-risk?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(18000) });
    if (!r.ok) return { available: false, paths: [], completedAt };
    const d = await r.json() as { available?: boolean; paths?: DeployerRiskPath[]; briefing?: DeployerRiskBriefing };
    if (d?.available !== true) return { available: false, paths: [], completedAt };
    return {
      available: true,
      paths: Array.isArray(d.paths) ? d.paths : [],
      briefing: d.briefing,
      completedAt,
    };
  } catch {
    return { available: false, paths: [], completedAt };
  }
}

// Resolver methods that identify the wallet which SIGNED the creation. Anything
// else the route can return (a metadata creator record, an update authority) is
// an attribution, so it is reported as one.
const SIGNED_THE_CREATION = new Set(["mint feePayer", "creation-tx fee payer"]);

// Browser default: ask ARGUS's own Solana deployer resolver. api/resolve-deployer
// reads the Helius DAS creators/authority and the mint's oldest-transaction fee
// payer, filtering the launchpad and system programs that are never a dev.
// Same shape as screenDeployerRisk: a relative URL only resolves in a browser,
// so a server or Node audit skips it and falls through to the keyless source.
export async function resolveDeployerViaRoute(
  mint: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DeployerAttribution | null> {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin) return null;
  try {
    const r = await fetchImpl(`/api/resolve-deployer?mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) return null;
    const d = await r.json() as { deployer?: unknown; via?: unknown };
    const address = typeof d?.deployer === "string" ? d.deployer.trim() : "";
    if (!address) return null;
    const via = typeof d?.via === "string" && d.via.trim() ? d.via.trim() : "resolver";
    return { address, source: "helius", method: via, kind: SIGNED_THE_CREATION.has(via) ? "deployer" : "attributed" };
  } catch {
    return null;
  }
}

// OFAC SDN address screen, recorded as a real check outcome for the checklist.
// Never throws: an unreachable screen records available:false so the checklist
// shows "unavailable" instead of silently claiming a clean pass.
//
// The screen calls a same-origin API route (/api/sanctions), which only
// resolves under the browser's authenticated fetch wrapper. In a raw server or
// Node audit (public API, drift sweep, benchmark) there is no origin, so the
// screen is skipped and returns undefined — recorded as "not run" rather than a
// failed attempt or, worse, a false clean. Server-side direct screening is a
// separate follow-up.
export async function screenAddressSanctions(
  chain: string,
  addresses: readonly (string | null | undefined)[],
  fetchImpl: typeof fetch = fetch,
): Promise<SanctionsScreenOutcome | undefined> {
  const unique = [...new Set(addresses.filter((a): a is string => typeof a === "string" && a.length > 8))].slice(0, 40);
  // No deployer and no holder list came back for this chain. Record that as an
  // explicit unscreenable outcome rather than silence: a screen that never ran
  // must be visible as a coverage limit, not hidden as a missing field.
  if (!unique.length) {
    return {
      available: false,
      checked: 0,
      sanctioned: [],
      completedAt: new Date().toISOString(),
      reason: "no_screenable_addresses",
    };
  }
  // Same-origin relative fetch only resolves in a browser. `globalThis` is
  // typed in both the DOM and Node libs (a bare `window` is not), so this is
  // the env-agnostic way to detect the browser without a DOM-lib dependency.
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  if (!origin) return undefined;
  const completedAt = new Date().toISOString();
  try {
    const r = await fetchImpl(
      `/api/sanctions?addresses=${encodeURIComponent(unique.join(","))}&chain=${encodeURIComponent(chain)}`,
      { signal: AbortSignal.timeout(9000) },
    );
    if (!r.ok) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" as const };
    const d = await r.json() as { available?: boolean; checked?: number; listSize?: number; sanctioned?: string[] };
    if (d?.available !== true) return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" as const };
    return {
      available: true,
      checked: typeof d.checked === "number" ? d.checked : unique.length,
      listSize: typeof d.listSize === "number" ? d.listSize : undefined,
      sanctioned: Array.isArray(d.sanctioned) ? d.sanctioned.filter((a): a is string => typeof a === "string") : [],
      completedAt,
    };
  } catch {
    return { available: false, checked: unique.length, sanctioned: [], completedAt, reason: "list_unavailable" as const };
  }
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
  let lpRowsSeen = 0;
  for (const h of gp?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    lpRowsSeen += 1;
    if (!Number.isFinite(pct)) continue;
    if (isBurnAddr(h.address) || isBurnTag(h.tag)) lpBurnedPct += pct;
    else if (h.is_locked === 1) lpLockedPct += pct;
    else if (h.is_contract !== 1) lpTopUnlockedEoaPct = Math.max(lpTopUnlockedEoaPct, pct);
  }
  const lpLocked = lpBurnedPct + lpLockedPct >= 50;
  const creatorShare = num(gp?.creator_percent);
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
    creatorPercent: (creatorShare ?? 0) * 100,
    creatorPercentAssessed: creatorShare != null && Number.isFinite(creatorShare),
    lpAssessed: lpRowsSeen > 0,
  };
}

function solanaSafety(sol: SolanaSecurity | null): NormalizedSafety {
  const topHolderPct = sol?.holders?.length ? Number(sol.holders[0].percent) * 100 : null;
  let lpLockedPct = 0, lpTopUnlockedEoaPct = 0;
  let lpRowsSeen = 0;
  for (const h of sol?.lp_holders ?? []) {
    const pct = Number(h.percent) * 100;
    // A share of a pool cannot exceed the pool. The free tier occasionally
    // returns a raw balance here instead of a ratio, which once published
    // "1 wallet 25532435%" about a top-100 token in an immutable report.
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) continue;
    lpRowsSeen += 1;
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
    lpBurnedPct: 0, lpLockedPct, lpTopUnlockedEoaPct, lpAssessed: lpRowsSeen > 0,
    balanceMutable: solFlag(sol?.balance_mutable_authority),
    transferHook: (sol?.transfer_hook?.length ?? 0) > 0,
    transferFee: Object.keys(sol?.transfer_fee ?? {}).length > 0,
    proxy: false, slippageModifiable: false, blacklist: false, tradingCooldown: false,
    // GoPlus has no creator balance on this chain. The audit fills it in from
    // RugCheck once a creator resolves; until then it stays unmeasured, because
    // a hardcoded 0 published "creator holds nothing" about every Solana token.
    externalCall: false, ownerChangeBalance: false, creatorPercent: 0, creatorPercentAssessed: false,
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
    externalCall: false, ownerChangeBalance: false, creatorPercent: 0, creatorPercentAssessed: false, lpAssessed: false,
  };
}

// In-session cache so re-opening a token (Radar -> report, back-nav, watchlist)
// is instant. Keyed by ref + skipSim; short TTL keeps live data fresh.
const _cache = new Map<string, { at: number; d: TokenDossier | null }>();
const CACHE_TTL = 60_000;

export async function auditToken(
  input: RunnableTokenInput,
  emit?: (s: TraceStep) => void,
  opts?: { skipSim?: boolean; force?: boolean; screenSanctions?: ScreenSanctionsFn; screenDeployerRisk?: ScreenDeployerRiskFn },
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
  opts?: { skipSim?: boolean; force?: boolean; screenSanctions?: ScreenSanctionsFn; screenDeployerRisk?: ScreenDeployerRiskFn },
): Promise<TokenDossier | null> {
  if (input.kind !== "token") return null;
  const trace: TraceStep[] = [];
  const step = (s: TraceStep) => { trace.push(s); emit?.(s); };

  step({ phase: "P0 · Intake", label: "Resolve token", detail: `Resolving ${input.ref.slice(0, 42)} on DexScreener…`, tone: "neutral" });

  let pair: DexPair | null = null;
  // Every pool for this token, not just the deepest one: each pool address is
  // market infrastructure that must be excluded from holder concentration.
  let allPairs: DexPair[] = [];
  if (input.via === "dexscreener") {
    const m = input.ref.match(/dexscreener\.com\/([a-z0-9]+)\/([a-zA-Z0-9]+)/i);
    if (m) pair = await dexByPair(m[1], m[2]);
    if (!pair && m) {
      allPairs = await dexByToken(m[2]);
      pair = pickPair(allPairs, m[2]);
    }
  } else {
    allPairs = await dexByToken(input.ref);
    pair = pickPair(allPairs, input.ref);
  }
  if (!pair || !pair.baseToken) {
    step({ phase: "P0 · Intake", label: "Not found", detail: "No DEX pair found for this contract.", tone: "warn" });
    return null;
  }

  const address = pair.baseToken.address;
  const chain = pair.chainId;
  const liquidityUsd = pair.liquidity?.usd ?? 0;
  // `mcap` is the circulating value when DexScreener provides it. Preserve FDV
  // separately so the report does not label one as the other.
  const fdv = pair.marketCap ?? pair.fdv ?? 0;
  const fullyDilutedValuation = pair.fdv ?? pair.marketCap ?? 0;
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
  let explorerHolders: ExplorerHolder[] | null = null;
  let contractSource: ExplorerContractSource | null = null;
  let deployerAttribution: DeployerAttribution | null = null;
  // The whole RugCheck report for a Solana mint, kept for the passes below: its
  // labelled accounts feed the concentration exclusion, and its rugged flag and
  // connected clusters are findings in their own right.
  let rugcheck: RugcheckReport | null = null;
  // Who measured the LP lock. GoPlus is the default; on Solana it returns no LP
  // rows at all, and a claim sourced from RugCheck has to say RugCheck.
  let lpLockSource: "goplus" | "rugcheck" = "goplus";
  if (chain === "solana") {
    step({ phase: "Contract", label: "Solana safety", detail: "GoPlus Solana: mint authority, freeze authority, transfer hooks, holders…", tone: "neutral" });
    sol = await goplusSolana(address);
    safety = solanaSafety(sol);
    // GoPlus returns an empty creators array for every Solana mint, which left
    // the token with no deployer, no deployer forensics, and a creator holding
    // hardcoded to zero. ARGUS's own resolver answers first; RugCheck is the
    // keyless fallback and the only free source for the creator's balance.
    const goplusCreator = (sol?.creators ?? []).map((c) => c?.address).find((a): a is string => typeof a === "string" && a.trim().length > 0)?.trim() ?? null;
    // The resolver route spends metered Helius credits per mint, so the fast
    // bulk scan (Radar sweeps 16 tokens at a time) takes the keyless answer
    // only. RugCheck is free, so the creator's balance is measured either way.
    const routeResolver = goplusCreator || opts?.skipSim ? Promise.resolve(null) : resolveDeployerViaRoute(address).catch(() => null);
    const [routed, rug] = await Promise.all([
      routeResolver,
      rugcheckReport(address).catch((): RugcheckReport | null => null),
    ]);
    rugcheck = rug;
    deployerAttribution = goplusCreator
      // GoPlus's Solana creators come from token metadata, which the minting
      // program writes; it is an attribution, not proof of who signed.
      ? { address: goplusCreator, source: "goplus", method: "metadata creator", kind: "attributed" }
      : routed
        ?? (rug?.creator ? { address: rug.creator, source: "rugcheck", method: "creator field", kind: "attributed" } : null);
    // The balance belongs to RugCheck's creator. Attaching it to an address the
    // resolver named instead would report one wallet's holding under another's
    // name, so it is only recorded when both sources point at the same address.
    if (deployerAttribution && rug?.creator === deployerAttribution.address && rug.creatorPercent != null) {
      safety = { ...safety, creatorPercent: rug.creatorPercent, creatorPercentAssessed: true };
    }
    // GoPlus returns no lp_holders rows for a Solana mint, so the lock read as
    // unchecked on every token on this chain. RugCheck answers the same
    // question inside the report this scan already downloaded. It only fills a
    // gap: a lock GoPlus did measure stays GoPlus's reading, and an
    // out-of-range figure was discarded upstream and leaves the lock unmeasured.
    if (!safety.lpAssessed && rug?.lpLockedPct != null) {
      safety = { ...safety, lpLockedPct: rug.lpLockedPct, lpLocked: rug.lpLockedPct >= 50, lpAssessed: true };
      lpLockSource = "rugcheck";
      step({
        phase: "Contract",
        label: "LP lock",
        detail: `RugCheck reports ${rug.lpLockedPct.toFixed(1)}% of the liquidity locked. GoPlus returned no LP holder records for this mint.`,
        source: "rugcheck",
        tone: rug.lpLockedPct >= 50 ? "good" : "warn",
      });
    }
    step(deployerAttribution
      ? {
          phase: "Contract",
          label: deployerRoleLabel(deployerAttribution),
          detail: `${deployerAttribution.address} via ${deployerAttribution.source} ${deployerAttribution.method}${safety.creatorPercentAssessed ? `, holding ${safety.creatorPercent.toFixed(2)}% of supply` : ", holdings not reported"}.`,
          source: deployerAttribution.source,
          tone: "neutral",
        }
      : { phase: "Contract", label: "Deployer unresolved", detail: "No source named a creator for this mint, so deployer forensics could not run.", tone: "warn" });
  } else if (gpChain) {
    step({ phase: "Contract", label: opts?.skipSim ? "Safety scan" : "Safety + simulation", detail: opts?.skipSim ? "GoPlus: honeypot, mint, ownership, tax, holders…" : "GoPlus + honeypot.is buy/sell simulation…", tone: "neutral" });
    const [gp, sim, explorer, source] = await Promise.all([
      goplus(gpChain, address),
      opts?.skipSim ? Promise.resolve(null) : honeypotIs(gpChain, address),
      // Where GoPlus cannot order holders, the chain's own explorer is the
      // only correct distribution source. Runs in parallel: no added latency.
      GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) ? blockscoutHolders(chain, address) : Promise.resolve(null),
      // What the deployer wrote about their own contract. Free, and the only
      // place an intent to defeat safety scanners is ever stated outright.
      blockscoutContractSource(chain, address),
    ]);
    gpEvm = gp;
    explorerHolders = explorer;
    contractSource = source;
    safety = evmSafety(gp, sim);
    const evmCreator = gp?.creator_address?.trim();
    const evmOwner = gp?.owner_address?.trim();
    deployerAttribution = evmCreator
      ? { address: evmCreator, source: "goplus", method: "contract creator", kind: "deployer" }
      // The current owner is whoever holds the contract NOW, which after a
      // transfer or a multisig handover is not the wallet that deployed it.
      : evmOwner && !/^0x0+$/.test(evmOwner)
        ? { address: evmOwner, source: "goplus", method: "current owner", kind: "attributed" }
        : null;
    // The largest-holder figure must come from the ordered source, and must go
    // silent rather than report an unordered sample as if it were measured.
    if (explorerHolders?.length) {
      safety = { ...safety, topHolderPct: explorerHolders[0].percent };
    } else if (GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain)) {
      safety = { ...safety, topHolderPct: null };
    }
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
        findings.push({ claim: `honeypot.is reported a failed sell simulation, but the GoPlus on-chain check and ${why} contradict it. ARGUS treats this as a simulation artifact, not a honeypot.`, tone: "warn", source: "argus" });
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
    const govNote = established ? " On a token with real centralized-exchange listings this is typically a governed emissions/ops mechanism, not a rug setup. Confirm the controller." : "";
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
    // A deployer who documents defeating a scanner has tuned the very checks
    // above until they went quiet, so their clean result proves less than it
    // appears. Capped below PASS, not to AVOID: evasion of a detector is not
    // by itself proof the contract steals, and the quote says what it says.
    for (const evasion of detectScannerEvasion(contractSource?.sourceCode)) {
      const concealed = evasion.kind === "concealment";
      findings.push({ claim: scannerEvasionClaim(evasion), tone: concealed ? "bad" : "warn", source: "contract source" });
      // Only concealment limits the score. Removing the flagged behaviour is
      // the deployer answering a false positive, and the scanner's clean
      // reading afterwards is correct.
      if (concealed) caps.push([55, "documented_scanner_concealment"]);
    }
    if (s.serialScammerCreator) { caps.push([25, "serial_scammer_creator"]); findings.push({ claim: "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", tone: "bad", source: "goplus" }); }
    if (s.sellTax >= 20) findings.push({ claim: `Sell tax is ${s.sellTax.toFixed(0)}%.`, tone: "bad", source: s.simChecked ? "sim" : "goplus" });
    if (s.simChecked && !s.honeypot) findings.push({ claim: `Buying and selling worked in the test (${s.buyTax.toFixed(0)}% buy fee / ${s.sellTax.toFixed(0)}% sell fee).`, tone: "good", source: "honeypot.is" });
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
        findings.push({ claim: "Owner can modify holder balances directly; they can zero your wallet.", tone: "bad", source: "goplus" });
      }
    }
    if (s.proxy) findings.push({ claim: ownerActive ? "Upgradeable proxy with an active owner: the contract logic can be swapped out from under holders." : "Upgradeable proxy contract (logic is replaceable), though ownership is renounced.", tone: ownerActive ? "bad" : "warn", source: "goplus" });
    if (s.slippageModifiable && ownerActive) findings.push({ claim: "Tax is modifiable: a low tax now can be raised toward 100% after you buy.", tone: "bad", source: "goplus" });
    if (s.blacklist && ownerActive) findings.push({ claim: "Owner can blacklist addresses, so your wallet can be blocked from selling.", tone: "warn", source: "goplus" });
    if (s.tradingCooldown && ownerActive) findings.push({ claim: "Trading cooldown is enforceable, so sells can be delayed.", tone: "warn", source: "goplus" });
    if (s.externalCall) findings.push({ claim: "Contract makes external calls, so behavior can change via an external dependency.", tone: "warn", source: "goplus" });
    // The percent is measured against whichever address a source called the
    // creator, and when that is an attribution the same report already says the
    // wallet was never shown to have signed anything. RugCheck names GRASS's
    // mint authority as its creator, and that wallet holds 25.9% of supply, so
    // the flat wording would call a live project's authority account its dev.
    // The holding is the finding; the role is only claimed when a source proved it.
    const creatorHolder = deployerAttribution && deployerAttribution.kind !== "deployer" ? "The creator or authority wallet" : "Creator";
    if (s.creatorPercent >= 5) findings.push({ claim: `${creatorHolder} still holds ~${s.creatorPercent.toFixed(0)}% of supply.`, tone: s.creatorPercent >= 15 ? "bad" : "warn", source: chain === "solana" ? "rugcheck" : "goplus" });

    // ---- Solana (Token-2022) vectors ----
    if (chain === "solana") {
      if (s.balanceMutable) {
        if (broadlyTraded) findings.push({ claim: "A balance-mutable authority exists, but broad market presence indicates it is not an active threat.", tone: "warn", source: "argus" });
        else { caps.push([20, "balance_mutable_authority"]); findings.push({ claim: "Balance-mutable authority is active. The controller can rewrite your token balance.", tone: "bad", source: "goplus-sol" }); }
      }
      if (s.transferHook) findings.push({ claim: "Transfer hook active: an external program runs on every transfer and can block sells.", tone: "bad", source: "goplus-sol" });
      if (s.transferFee) findings.push({ claim: "A Token-2022 transfer fee is configured: a built-in tax on every transfer.", tone: "warn", source: "goplus-sol" });
    }

    // ---- LP-holder forensics: where the liquidity actually sits ----
    // A lock RugCheck measured is RugCheck's assessment of the pool, not an LP
    // holder list ARGUS read itself, so the claim names it and the source field
    // says so. Only the locked and the not-locked readings can come from there:
    // a burn or a single unlocked wallet is a GoPlus LP row.
    const lockedByRugcheck = lpLockSource === "rugcheck";
    if (s.lpBurnedPct >= 50) findings.push({ claim: `Liquidity is burned (~${s.lpBurnedPct.toFixed(0)}%) and permanently removed; it cannot be pulled.`, tone: "good", source: "goplus" });
    else if (s.lpLockedPct >= 50) findings.push({ claim: lockedByRugcheck ? `RugCheck reports liquidity is locked (~${s.lpLockedPct.toFixed(0)}%). This is RugCheck's reading of the pool, since GoPlus returns no LP holder records on this chain.` : `Liquidity is locked (~${s.lpLockedPct.toFixed(0)}%).`, tone: "good", source: lpLockSource });
    else if (s.lpTopUnlockedEoaPct >= 80) findings.push({ claim: `All liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) sits in a single unlocked wallet and can be pulled at any time.`, tone: "bad", source: "goplus" });
    else if (s.lpTopUnlockedEoaPct >= 50) findings.push({ claim: `Most liquidity (~${s.lpTopUnlockedEoaPct.toFixed(0)}%) is in one unlocked wallet and removable at will.`, tone: "warn", source: "goplus" });
    // No usable LP record is not the same fact as an unlocked pool. Asserting
    // the latter told readers that USDC's liquidity "does not appear locked".
    else if (s.lpAssessed) findings.push({ claim: lockedByRugcheck ? `RugCheck reports only ~${s.lpLockedPct.toFixed(0)}% of the LP locked, so the liquidity is not lock protected. This is RugCheck's reading of the pool, since GoPlus returns no LP holder records on this chain.` : "Liquidity does not appear locked or burned.", tone: "warn", source: lpLockSource });
    else findings.push({ claim: "LP lock was not measured: the free data tier returned no LP holder records for this chain. Not scored either way.", tone: "warn", source: "goplus" });
  }

  // ---- RugCheck's own assessments of a Solana mint ----
  // These come from the report the Solana scan already downloaded. Each one is
  // RugCheck's reading rather than something ARGUS reproduced on-chain, so the
  // claim names RugCheck and the source field says rugcheck.
  if (rugcheck?.rugged) {
    findings.push({
      claim: "RugCheck flags this token as rugged. That is RugCheck's own verdict on the mint, not an on-chain event ARGUS reproduced.",
      tone: "bad",
      source: "rugcheck",
    });
    step({ phase: "Contract", label: "Rugged flag", detail: "RugCheck flags this mint as rugged.", source: "rugcheck", tone: "bad" });
  }
  // Connected clusters OVERLAP: one wallet can sit in several, so adding them
  // up invents supply that does not exist. The single largest cluster is the
  // honest "share in one hidden hand", and the claim says it is the largest so
  // it can never be read as a total.
  const insiderClusterPct = rugcheck ? largestInsiderClusterPercent(rugcheck.insiderNetworks) : null;
  const linkedWallets = rugcheck?.graphInsidersDetected ?? null;
  // On a mega-holder token the transfer graph balloons and a large linked set
  // is ordinary market plumbing, so the cluster only reads as a finding on the
  // thin base a bundled launch actually has.
  const megaHolderBase = s.holderCount >= 50_000;
  if (!megaHolderBase && insiderClusterPct != null && linkedWallets != null && linkedWallets >= 15) {
    if (insiderClusterPct >= 30) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} wallets to a common funding source, and its largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "bad",
        source: "rugcheck",
      });
    } else if (insiderClusterPct >= 12) {
      findings.push({
        claim: `RugCheck traces ${linkedWallets.toLocaleString()} connected wallets, whose largest single cluster holds ~${insiderClusterPct.toFixed(0)}% of supply. Clusters overlap, so this is the biggest one rather than a total.`,
        tone: "warn",
        source: "rugcheck",
      });
    }
  }
  if (liquidityUsd < 15000) findings.push({ claim: `Thin liquidity ($${Math.round(liquidityUsd).toLocaleString()}). Easy to drain or move.`, tone: "warn", source: "dexscreener" });
  if (ageDays != null && ageDays < 7) findings.push({ claim: `Pair is ${ageDays < 1 ? "under a day" : Math.round(ageDays) + " days"} old.`, tone: "warn", source: "dexscreener" });
  // ---- manipulation & price-action signals ----
  if (washSignature) findings.push({ claim: `Volume is ${volLiq.toFixed(0)}x liquidity in 24h while the price moved only ${pc24.toFixed(1)}%: a wash-trading or fake-volume signature.`, tone: "bad", source: "dexscreener" });
  if (pc24 <= -60) findings.push({ claim: `Down ${Math.abs(pc24).toFixed(0)}% in 24h. The token appears to have already dumped.`, tone: "bad", source: "dexscreener" });
  else if (pc24 >= 300 && liquidityUsd < 100000) findings.push({ claim: `Up ${pc24.toFixed(0)}% in 24h on thin liquidity. This is a vertical pump with high reversal risk.`, tone: "warn", source: "dexscreener" });

  // CoinGecko-derived corroboration findings (cg was fetched above).
  if (!opts?.skipSim) {
    if (cg && !cg.listed) {
      findings.push({ claim: "Not listed on CoinGecko. No independent market-data corroboration is available.", tone: "warn", source: "coingecko" });
    } else if (cg) {
      findings.push({ claim: `Corroborated on CoinGecko${cg.rank ? ` (rank #${cg.rank})` : ""}, ${cg.cexCount} centralized market${cg.cexCount === 1 ? "" : "s"}.`, tone: "good", source: "coingecko" });
      if (cg.mcapUsd && fdv && fdv > cg.mcapUsd * 3) {
        findings.push({ claim: `FDV is ${(fdv / cg.mcapUsd).toFixed(1)}x circulating market cap, creating a large unlock or dilution overhang.`, tone: "warn", source: "coingecko" });
      }
    }
  }

  // ---- holder concentration ----
  // A holder snapshot can measure concentration. It cannot establish how the
  // wallets acquired their supply, whether they coordinated, or whether one
  // person controls them. Launch timing and funding evidence live in separate
  // transaction-grounded checks and must never be inferred from this snapshot.
  // On a chain whose GoPlus holder order is untrusted, an explorer list is the
  // only acceptable input; with no explorer result the distribution stays empty
  // rather than falling back to a sample that would understate concentration.
  const evmHolders = explorerHolders
    ? explorerHolders.map((holder) => ({
        address: holder.address,
        percent: String(holder.percent / 100),
        is_contract: holder.isContract ? 1 : 0,
      }))
    : GOPLUS_UNSORTED_HOLDER_CHAINS.has(chain) ? [] : gpEvm?.holders ?? [];
  const rawHolders = (chain === "solana" ? sol?.holders ?? [] : evmHolders) as Array<{ address?: string; account?: string; percent?: string; is_contract?: number | string; is_locked?: number; tag?: string }>;
  // The pool is the market, not a holder, and an exchange hot wallet is
  // thousands of customers. Counting either inverts what concentration means:
  // on a fresh launchpad token the pool IS the top holder, so every one of them
  // reads as dangerously concentrated while the real wallet split goes unsaid.
  const poolAddresses = [
    ...(pair?.pairAddress ? [pair.pairAddress] : []),
    ...allPairs.map((candidate) => candidate.pairAddress).filter((value): value is string => Boolean(value)),
  ];
  // RugCheck labels the pools and exchange accounts it knows, which is the only
  // free way to recognise a venue whose address is not in ARGUS's own map. The
  // classifier trusts the structured type and never the name, so an account
  // whose chosen name merely says "pool" still counts as a wallet that can dump.
  const knownAccounts = rugcheck?.knownAccounts;
  const marketRows: Array<{ address: string; percent: number; label: string; kind: string; labelledByRugcheck: boolean }> = [];
  const walletRows = rawHolders.filter((h) => {
    const address = h.address ?? h.account ?? "";
    const market = classifyMarketAddress(address, { poolAddresses, knownAccounts });
    if (!market) return true;
    const percent = Number(h.percent) * 100;
    marketRows.push({
      address,
      percent: Number.isFinite(percent) ? percent : 0,
      label: market.label,
      kind: market.kind,
      labelledByRugcheck: Boolean(knownAccounts?.[address]?.type),
    });
    return false;
  });
  const eoaHolders = walletRows.filter(
    (h) => !(h.is_contract === 1 || h.is_contract === "1") && h.is_locked !== 1 && !/lock|burn|null|dead|pool|\blp\b|amm|cex|exchange/i.test(h.tag || ""),
  );
  // Free-tier GoPlus sometimes returns a short, self-inconsistent holder list
  // whose percentages sum past 100%. When that happens the distribution data is
  // untrustworthy, so we suppress the concentration signal rather than report a
  // nonsensical figure.
  const topSum = eoaHolders.slice(0, 15).reduce((a, h) => a + Number(h.percent) * 100, 0);
  const holdersReliable = rawHolders.length > 0 && topSum <= 101;
  // Top-holder concentration must also read the wallet list, not the pool.
  const topWalletPct = eoaHolders.length ? Number(eoaHolders[0].percent) * 100 : null;
  const concentrationTopPct = topWalletPct ?? s.topHolderPct;
  const insiderPct = holdersReliable ? Math.round(topSum) : 0;
  // Material wallets, largest first. The register's own order is not trusted
  // for arithmetic, so the few-wallet ceiling sorts before it sums.
  const materialWalletPcts = holdersReliable
    ? eoaHolders
      .map((h) => Number(h.percent) * 100)
      .filter((pct) => Number.isFinite(pct) && pct >= 1)
      .sort((a, b) => b - a)
    : [];
  const bundleCount = materialWalletPcts.length;
  // The ceiling asks what the three largest material wallets hold BETWEEN
  // them, not how many material wallets exist. Counting them instead let a
  // 61%-across-three-wallets token escape the cap on a fourth 1% wallet, and
  // fired the cap on three 17% wallets whose sub-1% dust reached 60%.
  const topThreeMaterialPct = Math.round(
    materialWalletPcts.slice(0, 3).reduce((total, pct) => total + pct, 0),
  );
  const bundleRisk: "low" | "elevated" | "high" =
    !holdersReliable ? "low" : insiderPct >= 45 ? "high" : insiderPct >= 25 ? "elevated" : "low";
  if (s.available && bundleRisk !== "low") {
    findings.push({
      claim: `Concentrated supply: ${bundleCount} non-market wallets each hold at least 1% and up to 15 of the largest non-market wallets hold ~${insiderPct}% combined. This holder snapshot does not establish whether the wallets coordinated.`,
      tone: bundleRisk === "high" ? "bad" : "warn",
      source: chain === "solana" ? "goplus-sol" : "goplus",
    });
  }

  // Market maturity and liquidity cannot neutralize a holder who can move the
  // asset alone. These are concentration ceilings, not claims that the wallets
  // share ownership. A majority holder prevents a positive or caution verdict;
  // a holder above 25%, or at least 60% split across no more than three material
  // wallets, prevents PASS while leaving intent unresolved.
  if (holdersReliable && topWalletPct != null) {
    if (topWalletPct >= 50) caps.push([39, "single_wallet_majority_supply"]);
    else if (topWalletPct >= 25) caps.push([69, "single_wallet_concentration"]);
  }
  if (holdersReliable && topThreeMaterialPct >= 60) {
    caps.push([69, "few_wallet_concentration"]);
  }
  // Name what was excluded and why. A reader comparing ARGUS to an explorer
  // must be able to see that the biggest line item was left out deliberately.
  if (marketRows.length) {
    const named = marketRows
      .slice(0, 3)
      .map((row) => `${row.label} (${row.percent.toFixed(1)}%)`)
      .join(", ");
    // Whoever named the venue owns the claim. When the exclusion rests on
    // RugCheck's account labels the reader is told that, because it is
    // RugCheck's assessment of the account and not ARGUS's own address map.
    const viaRugcheck = marketRows.some((row) => row.labelledByRugcheck);
    findings.push({
      claim: `Excluded from concentration: ${named}. These are the market itself, not wallets that can dump.${viaRugcheck ? " The labelled venues are RugCheck's own account labels." : ""}`,
      tone: "good",
      source: viaRugcheck ? "rugcheck" : chain === "solana" ? "goplus-sol" : "goplus",
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
  else if (s.available && s.lpAssessed) { aT1 = clamp(aT1 - 3, 0, 24); lpNote = ", LP not locked"; }
  // No usable LP record: the lock is UNKNOWN. Scoring it as loose told readers
  // that USDC's liquidity "does not appear locked or burned" and docked it.
  else if (s.available) { lpNote = ", LP lock not measured"; }
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
  // On Solana the buy/sell tax fields do not exist, so reporting them as 0% was
  // an assertion nothing measured. A Token-2022 transfer fee is the equivalent
  // charge and it IS in the payload, so that is what gets reported.
  const solanaTaxRationale = s.transferFee
    ? "a Token-2022 transfer fee is configured on this mint."
    : "no Token-2022 transfer fee is configured.";
  axes.push({ key: "T3", label: "Taxes & tradeability", score: aT3, weight: 12, rationale: s.available ? (chain === "solana" ? solanaTaxRationale : `buy ${s.buyTax.toFixed(0)}% / sell ${s.sellTax.toFixed(0)}%${s.simChecked ? " (simulated)" : ""}.`) : "Tax not verifiable keyless." });

  const topPct = holdersReliable ? concentrationTopPct : null;
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
      : `${s.holderCount.toLocaleString()} holders${topPct != null ? `, top holder ${topPct.toFixed(0)}%` : ""}${bundleRisk !== "low" ? `, ~${insiderPct}% across ${bundleCount} non-market wallets holding at least 1% each` : ""}.`;
  axes.push({ key: "T4", label: "Holder distribution", score: aT4, weight: 16, rationale: t4Note });

  let aT5 = vol24 < 500 ? 4 : volLiq > 25 ? 4 : volLiq > 8 ? 7 : volLiq < 0.02 ? 5 : 11;
  const total = buys + sells;
  if (washSignature) aT5 = 2; // churn without price movement = manufactured volume
  else if (total > 20 && sells / total > 0.8) aT5 = clamp(aT5 - 2, 0, 12);
  if (pc24 <= -60) aT5 = clamp(aT5 - 3, 0, 12);
  axes.push({ key: "T5", label: "Trading authenticity", score: aT5, weight: 12, rationale: washSignature ? `vol/liquidity ${volLiq.toFixed(1)}x but price flat (${pc24.toFixed(1)}%): wash-trade signature.` : `24h vol/liquidity ${volLiq.toFixed(2)}x, ${buys} buys / ${sells} sells.` });

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
  const deployer = deployerAttribution?.address ?? null;
  // What the report is allowed to call this wallet. Only a source that saw the
  // creation signed earns the word "deployer"; everything else is an address a
  // source attributes, which can be a program holding an authority.
  const deployerRole = deployerRoleLabel(deployerAttribution, "wallet");
  const topHolders: Holder[] = rawHolders.slice(0, 10).map((h) => ({
    address: h.address ?? h.account ?? "",
    percent: Number(h.percent) * 100,
    tag: h.tag || undefined,
    isContract: h.is_contract === 1 || h.is_contract === "1",
  })).filter((h) => h.address);

  // ---- Deployer forensics: OFAC is required; provider funding risk is optional.
  const screenFn = opts?.screenSanctions ?? screenAddressSanctions;
  const deployerRiskFn = opts?.screenDeployerRisk ?? screenDeployerRisk;
  const deployerRiskEnabled = Boolean(opts?.screenDeployerRisk) || arkhamProviderEnabled();
  step({
    phase: "Screen",
    label: "Deployer forensics",
    detail: deployerRiskEnabled
      ? "Screening deployer and top holders against OFAC, and tracing funding provenance."
      : "Screening deployer and top holders against OFAC.",
    tone: "neutral",
  });
  const [sanctionsScreen, deployerRisk, priceHistory] = await Promise.all([
    screenFn(chain, [deployer, ...topHolders.map((h) => h.address)]),
    // Best-effort enrichment: a deployer-risk failure must never break a scan
    // (unlike OFAC, it carries no verdict cap), so it always degrades to undefined.
    deployer && deployerRiskEnabled
      ? deployerRiskFn(deployer).catch(() => undefined)
      : Promise.resolve(undefined),
    fetchPriceHistory(address, chain, pair.pairAddress).catch(() => null),
  ]);
  if (deployerRisk?.available && deployerRisk.paths.length) {
    // Every path Arkham returns is already a risk exposure. Surface both
    // directions: backward = the deployer was FUNDED BY a flagged entity;
    // forward = the deployer SENT funds TO one. Both belong in the report.
    for (const p of deployerRisk.paths.slice(0, 3)) {
      const severe = SEVERE_RISK_CATEGORY.test(p.category ?? "");
      const who = p.seedName || p.category || "a flagged entity";
      const hopStr = p.hops ? `, ${p.hops} hop${p.hops === 1 ? "" : "s"} away` : "";
      const amt = p.usd >= 1 ? `~$${Math.round(p.usd).toLocaleString()} ` : "";
      findings.push({
        claim: p.direction === "backward"
          ? `${deployerRole} received ${amt}traceable to ${who}${hopStr}. ${severe ? "This is a serious funding-provenance risk." : "Worth scrutiny on where the launch capital came from."}`
          : `${deployerRole} sent ${amt}to ${who}${hopStr}. ${severe ? "This is a serious counterparty risk." : "Worth scrutiny on where the funds moved."}`,
        tone: severe ? "bad" : "warn",
        source: "arkham",
      });
    }
    const lead = deployerRisk.paths[0];
    step({ phase: "Finalize", label: "Funding trace", detail: `${deployerRole} ${lead.direction === "backward" ? "funded via" : "exposed to"} ${lead.seedName || lead.category || "a flagged entity"}${lead.hops ? ` (${lead.hops} hop${lead.hops === 1 ? "" : "s"})` : ""}.`, tone: SEVERE_RISK_CATEGORY.test(lead.category ?? "") ? "bad" : "warn" });
  }
  if (sanctionsScreen?.available && sanctionsScreen.sanctioned.length) {
    findings.push({
      claim: sanctionsScreen.sanctioned.length === 1
        ? `OFAC SDN hit: screened address ${sanctionsScreen.sanctioned[0].slice(0, 10)}… is on the US Treasury sanctions list. Touching this token is a legal-exposure risk.`
        : `OFAC SDN hit: ${sanctionsScreen.sanctioned.length} screened addresses are on the US Treasury sanctions list. Touching this token is a legal-exposure risk.`,
      tone: "bad",
      source: "ofac",
    });
    // A sanctioned deployer or holder is the hardest AVOID signal there is; it
    // overrides any market score. Recompute the verdict so the headline can
    // never render PASS over a confirmed sanctions hit.
    score = Math.min(score, 5);
    capApplied = "ofac_sanctioned_address";
    verdict = "AVOID";
    step({ phase: "Finalize", label: "OFAC sanctions", detail: `${sanctionsScreen.sanctioned.length} sanctioned address(es): verdict forced to AVOID.`, tone: "bad" });
  }

  // Ticker collisions. A buyer who typed a ticker instead of pasting an address
  // is the person this check is for, so it runs on every audit and its result is
  // frozen into the report rather than recomputed at read time.
  const cloneCheck = await checkForClones({
    mint: address,
    symbol: pair.baseToken.symbol,
    chain,
    pairCreatedAt: pair.pairCreatedAt ?? null,
    liquidityUsd,
  }).catch(() => null);
  if (cloneCheck?.checked && cloneCheck.clones.length) {
    // Only "later" is a claim about this mint. "earliest" and "only" are floors
    // on what a capped search listed, so neither is published as reassurance.
    if (cloneCheck.audited === "later") {
      findings.push({ claim: cloneCheck.note, tone: "bad", source: "dexscreener" });
    } else {
      findings.push({
        claim: `${cloneCheck.clones.length} other ${cloneCheck.clones.length === 1 ? "mint trades" : "mints trade"} under the ticker $${pair.baseToken.symbol}. Verify you hold the address in this report before buying.`,
        tone: "warn",
        source: "dexscreener",
      });
    }
    step({
      phase: "Finalize",
      label: "Ticker collision",
      detail: cloneCheck.note,
      tone: cloneCheck.audited === "later" ? "bad" : "warn",
    });
  }

  const graph = buildGraph(chain, address, pair.baseToken.symbol, verdict, projectX, deployerAttribution, topHolders, socials);

  const headline = buildHeadline(verdict, capApplied, s, liquidityUsd, projectX);
  step({ phase: "Finalize", label: "Verdict", detail: `${verdict} · ${score}/100${capApplied ? ` (cap: ${capApplied})` : ""}`, tone: verdict === "PASS" ? "good" : verdict === "CAUTION" ? "warn" : "bad" });

  return {
    address, chain, dexId: pair.dexId, dexLabels: pair.labels ?? [], pairAddress: pair.pairAddress, symbol: pair.baseToken.symbol, name: pair.baseToken.name,
    imageUrl: pair.info?.imageUrl ?? cg?.image ?? undefined, priceUsd: pair.priceUsd ? Number(pair.priceUsd) : undefined,
    mcap: fdv, fdv: fullyDilutedValuation, liquidityUsd, vol24, ageDays,
    // Keep the raw instant, not just the day count derived from it above. The
    // operator trace ages the deployer wallet against this launch, and a wallet
    // minutes older than the token it launched is 0 days old in every direction.
    pairCreatedAt: pair.pairCreatedAt ?? null,
    priceChange: pair.priceChange,
    ...(priceHistory ? { priceHistory } : {}),
    // The pool exclusion has to reach the number a reader actually sees. Leaving
    // the raw provider top holder on the dossier put "top holder 37%" on the same
    // page as the finding explaining that the 37% line is the pool itself.
    verdict, score, capApplied, headline, axes, safety: { ...s, topHolderPct: concentrationTopPct }, socials,
    holdersAssessed: holdersReliable,
    projectX, deployer, ...(deployerAttribution ? { deployerAttribution } : {}),
    topHolders, insiderPct, bundleCount, bundleRisk, cg, graph, findings, trace, live: true, safetyChecked: s.available,
    sanctionsScreen,
    deployerRisk,
    ...(cloneCheck ? { cloneCheck } : {}),
  };
}

function buildGraph(chain: string, address: string, symbol: string, verdict: string, projectX: string | null, attribution: DeployerAttribution | null, holders: Holder[], socials: { label: string; url: string }[]): { nodes: PanoptesNode[]; edges: PanoptesEdge[] } {
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
  if (attribution) {
    const k = walletEntityKey(chain, attribution.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: "wallet:" + attribution.address.slice(0, 8), chain, address: attribution.address });
    // The edge states what the evidence supports. An address a provider merely
    // names as creator or authority has not been shown to deploy anything, and
    // this graph is reconciled across reports, so the weaker claim travels.
    edges.push({ src: center, dst: k, type: attribution.kind === "deployer" ? "DEPLOYED_BY" : "ATTRIBUTED_CREATOR", source: attribution.source });
  }
  holders.slice(0, 4).forEach((h) => {
    // Roles and short labels are display metadata; the identity is always the
    // chain plus the complete address. The same wallet therefore stays the same
    // node whether it later appears as a holder, deployer or funder.
    const k = walletEntityKey(chain, h.address);
    nodes.push({ type: "Identity", subtype: "Wallet", key: k, label: (h.tag || "holder") + ":" + h.address.slice(0, 8), chain, address: h.address, concentration: h.percent });
    edges.push({
      src: center,
      dst: k,
      type: "HELD_BY",
      ...(h.percent > 25 ? { risk: "high_concentration" } : {}),
    });
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
  if (cap === "ofac_sanctioned_address") return "A screened address is on the US Treasury OFAC sanctions list. Touching this token is a legal-exposure risk. Do not touch.";
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
