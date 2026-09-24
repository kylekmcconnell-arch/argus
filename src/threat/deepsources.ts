// Supplemental keyless sources the base audit (src/token) doesn't tap. Both are
// free and CORS-open, called only by the threat scanner so the base module
// stays untouched until fold-in:
//   - RugCheck (Solana): full risk report — 30+ named risk patterns, insider
//     networks, LP locker identity. The Solana counterpart of GoPlus's depth.
//   - Honeypot.is deep fields (EVM): the parts the base audit discards — per-
//     holder sell analysis, supported summary flags, and honeypot reason.
import type { ProductAuthenticity } from "./types";
import { apiFetch } from "./net";
import { retryFetch, retryFetchWithFreshTimeout } from "../lib/retry";
import { arr, bool, num, rec, str } from "../lib/json";
import { largestInsiderClusterPercent, supplySharePercent } from "../token/sources";

// ---- RugCheck (Solana) ----
export interface RugcheckRisk {
  name: string;
  level: string; // info | warn | danger (API also uses low/medium/high/critical)
  description: string;
  score: number;
  value?: string;
}
export interface RugcheckReport {
  score: number; // normalized risk score, higher = riskier
  risks: RugcheckRisk[];
  rugged: boolean;
  insidersDetected: number; // wallets RugCheck's transfer graph marks as insiders
  insiderPct: number; // % of supply the LARGEST connected cluster holds
  lockerPct: number; // % of LP in known lockers
  lockerNames: string[];
}

export async function rugcheckReport(mint: string): Promise<RugcheckReport | null> {
  try {
    const res = await retryFetchWithFreshTimeout(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, 15_000);
    if (!res.ok) return null;
    const d = rec(await res.json());
    const supply = rec(d.token).supply;
    // Insider networks OVERLAP (one wallet sits in several), so summing their
    // sizes or token amounts invents supply that does not exist: two 40%
    // clusters read as 80%. The token lane (src/token/sources.ts) and
    // api/holders.ts take the single largest cluster, range-checked; the threat
    // lane reads the same payload the same way so the two can never disagree.
    const networks = arr(d.insiderNetworks).map(rec).map((network) => {
      const size = network.size ?? (Array.isArray(network.wallets) ? network.wallets.length : undefined);
      return {
        size: typeof size === "number" || typeof size === "string" ? num(size) : null,
        percent: supplySharePercent(network.tokenAmount, supply),
      };
    });
    const largestCluster = networks.reduce<{ size: number | null; percent: number | null } | null>(
      (best, network) => (network.percent != null && (best?.percent == null || network.percent > best.percent) ? network : best),
      null,
    );
    // RugCheck's own graph count is the wallet figure the cluster panel shows;
    // the largest cluster's size is the floor when the graph count is absent.
    const graphInsiders = d.graphInsidersDetected;
    const insidersDetected = typeof graphInsiders === "number" || typeof graphInsiders === "string"
      ? num(graphInsiders)
      : largestCluster?.size ?? 0;
    const lockers = Object.values(rec(d.lockers)).map(rec);
    const lpLockedUsd = lockers.reduce((total, locker) => total + num(locker.usdcLocked), 0);
    const marketLpUsd = num(d.totalMarketLiquidity);
    return {
      score: num(d.score_normalised ?? d.score),
      risks: arr(d.risks).map(rec).map((risk) => ({
        name: str(risk.name),
        level: str(risk.level) || "warn",
        description: str(risk.description),
        score: num(risk.score),
        value: risk.value ? str(risk.value) : undefined,
      })),
      rugged: bool(d.rugged),
      insidersDetected,
      insiderPct: Math.round(largestInsiderClusterPercent(networks) ?? 0),
      lockerPct: marketLpUsd > 0 ? Math.min(100, Math.round((lpLockedUsd / marketLpUsd) * 100)) : 0,
      lockerNames: [...new Set(lockers.map((locker) => str(locker.type) || "locker"))],
    };
  } catch {
    return null;
  }
}

// ---- Honeypot.is deep (EVM) ----
export interface HoneypotDeep {
  isHoneypot: boolean;
  reason: string | null;
  // per-holder sell analysis: the check nobody else runs. A selective honeypot
  // lets the sim wallet sell while real holders can't; this catches it.
  holdersAnalyzed: number;
  holdersFailed: number;
  siphoned: number; // wallets whose sells were siphoned (taxed ~100%)
  highTaxWallets: number;
  averageTax: number;
  flags: { code: string; text: string; severity: string }[];
}

const HP_CHAIN: Record<string, string> = { ethereum: "1", bsc: "56", base: "8453" };

// ---- GoPlus meta flags the base audit doesn't carry (EVM) ----
// Counterfeit / airdrop-scam / trust-list signals. `fake_token` means the
// contract impersonates an established token (a namesquat trap — the exact case
// the investigation methodology's token-disambiguation step warns about).
export interface LabeledHolder {
  address: string;
  percent: number; // 0–100
  tag: string;
  isLocked: boolean;
  isContract: boolean;
}
export interface GoPlusMeta {
  fakeToken: boolean;
  fakeTokenOf: string | null; // the real token address it impersonates, if given
  airdropScam: boolean;
  trustListed: boolean; // GoPlus's own allowlist of reputable tokens
  inCex: boolean;
  // Raw labeled holders + LP holders, so tokenomics.ts can separate the pool and
  // reward contracts from genuine holder concentration and read locker names.
  holders: LabeledHolder[];
  lpHolders: LabeledHolder[];
  totalSupply: number | null;
}
const GP_CHAIN: Record<string, string> = {
  ethereum: "1", bsc: "56", base: "8453", polygon: "137", arbitrum: "42161",
  optimism: "10", avalanche: "43114", fantom: "250", cronos: "25", zksync: "324",
  linea: "59144", scroll: "534352",
};
export async function goplusMeta(chain: string, address: string): Promise<GoPlusMeta | null> {
  const id = GP_CHAIN[chain];
  if (!id) return null;
  try {
    const res = await retryFetch(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${address}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const d = rec(await res.json());
    const result = rec(d.result);
    const row = rec(result[address.toLowerCase()] ?? Object.values(result)[0]);
    if (!Object.keys(row).length) return null;
    const ft = rec(row.fake_token);
    const mapH = (value: unknown): LabeledHolder => {
      const holder = rec(value);
      return {
        address: str(holder.address ?? holder.account),
        percent: num(holder.percent) * 100,
        tag: str(holder.tag),
        isLocked: holder.is_locked === 1 || holder.is_locked === "1",
        isContract: holder.is_contract === 1 || holder.is_contract === "1",
      };
    };
    const fakeTokenOf = typeof ft.true_token_address === "string" ? ft.true_token_address : null;
    const inCex = rec(row.is_in_cex);
    return {
      fakeToken: ft.value === 1 || ft.value === "1" || row.is_fake_token === 1,
      fakeTokenOf,
      airdropScam: row.is_airdrop_scam === "1" || row.is_airdrop_scam === 1,
      trustListed: row.trust_list === "1" || row.trust_list === 1,
      inCex: inCex.listed === "1" || inCex.listed === true,
      holders: arr(row.holders).map(mapH).filter((holder) => holder.address),
      lpHolders: arr(row.lp_holders).map(mapH).filter((holder) => holder.address),
      totalSupply: row.total_supply != null ? num(row.total_supply) : null,
    };
  } catch {
    return null;
  }
}

// ---- runtime-bytecode fingerprint (EVM) via api/bytecode.ts ----
// The fingerprint bridges byte-identical contracts: a fresh token that clones a
// known-AVOID rug lights up on its own. Server-side (needs RPC egress).
export interface Fingerprint {
  fingerprint: string; // "" for a system asset: nothing per-token to hash
  isToken: boolean;
  proxy: boolean;
  capabilities: { name: string; risk: string }[];
  // Base B20 assets have no per-token bytecode (1-byte 0xef marker); the
  // route reports the standard instead of a fingerprint.
  system: "b20" | null;
}
export async function codeFingerprint(chain: string, address: string): Promise<Fingerprint | null> {
  if (!GP_CHAIN[chain]) return null;
  try {
    const res = await apiFetch(`/api/bytecode?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = rec(await res.json());
    if (!d.available) return null;
    const system = str(d.system) === "b20" ? "b20" : null;
    if (!d.fingerprint && !system) return null;
    return {
      fingerprint: str(d.fingerprint ?? "").toLowerCase(),
      isToken: bool(d.isToken),
      proxy: bool(d.proxy),
      capabilities: arr(d.capabilities).map(rec).map((capability) => ({ name: str(capability.name), risk: str(capability.risk) })),
      system,
    };
  } catch {
    return null;
  }
}

// ---- on-chain burn history + cadence (EVM incl. Robinhood) via api/burns ----
export interface BurnHistory {
  count: number;
  burnedSupplyPct: number | null;
  cadence: "none" | "one-off" | "regular" | "irregular" | "stalled";
  ongoing: boolean;
  burnsLast30d: number;
  medianIntervalDays: number | null;
  lastBurnAt: number | null;
}
export async function burnHistory(chain: string, address: string): Promise<BurnHistory | null> {
  if (chain === "solana") return null;
  try {
    const res = await apiFetch(`/api/burns?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, {
      signal: AbortSignal.timeout(22000),
    });
    if (!res.ok) return null;
    const d = rec(await res.json());
    if (!d.available || !d.count) return null;
    const cadence = ["none", "one-off", "regular", "irregular", "stalled"].includes(str(d.cadence))
      ? str(d.cadence) as BurnHistory["cadence"]
      : "none";
    return {
      count: num(d.count), burnedSupplyPct: d.burnedSupplyPct != null ? num(d.burnedSupplyPct) : null, cadence,
      ongoing: bool(d.ongoing), burnsLast30d: num(d.burnsLast30d), medianIntervalDays: d.medianIntervalDays != null ? num(d.medianIntervalDays) : null,
      lastBurnAt: d.lastBurnAt != null ? num(d.lastBurnAt) : null,
    };
  } catch {
    return null;
  }
}

// Prior flagged tokens that share this fingerprint — the known-rug-clone check.
export async function knownRugClones(fingerprint: string, selfAddress: string): Promise<{ symbol: string; address: string; verdict: string }[]> {
  try {
    const res = await apiFetch(`/api/threat-receipts?fingerprint=${encodeURIComponent(fingerprint)}`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const d = (await res.json()) as { available?: boolean; receipts?: { symbol: string; address: string; verdict: string }[] };
    if (!d.available || !Array.isArray(d.receipts)) return [];
    return d.receipts
      .filter((r) => r.address.toLowerCase() !== selfAddress.toLowerCase() && (r.verdict === "RUG" || r.verdict === "DANGER"))
      .map((r) => ({ symbol: r.symbol, address: r.address, verdict: r.verdict }));
  } catch {
    return [];
  }
}

export async function honeypotDeep(chain: string, address: string): Promise<HoneypotDeep | null> {
  const chainID = HP_CHAIN[chain];
  if (!chainID) return null;
  try {
    const res = await retryFetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainID}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = rec(await res.json());
    const h = rec(d.holderAnalysis);
    const summaryFlags = arr(rec(d.summary).flags);
    const legacyFlags = arr(d.flags);
    const honeypotResult = rec(d.honeypotResult);
    return {
      isHoneypot: bool(honeypotResult.isHoneypot),
      reason: typeof honeypotResult.honeypotReason === "string" ? honeypotResult.honeypotReason : null,
      holdersAnalyzed: num(h.holders),
      holdersFailed: num(h.failed),
      siphoned: num(h.siphoned),
      highTaxWallets: num(h.highTaxWallets),
      averageTax: num(h.averageTax),
      flags: [...summaryFlags, ...legacyFlags].map((value) => {
        const flag = rec(value);
        return {
          code: str(flag.flag ?? value),
          text: str(flag.description ?? flag.flag ?? value),
          severity: str(flag.severity) || "medium",
        };
      }),
    };
  } catch {
    return null;
  }
}

// ---- product authenticity via api/product-probe ----
// The linked website's own client code names the provider behind a "private
// transfer" product; the copy rarely does. Only the first linked website is
// read; a token with no website has no product to authenticate.
export async function productAuthenticity(socials: { label: string; url: string }[]): Promise<ProductAuthenticity | null> {
  const site = socials.find((s) => /^(website|site|web|home)/i.test(s.label) && /^https?:\/\//i.test(s.url))
    ?? socials.find((s) => /^https?:\/\//i.test(s.url) && !/(x\.com|twitter\.com|t\.me|telegram|discord|github\.com|medium\.com|youtube\.com|instagram\.com|tiktok\.com)/i.test(s.url));
  if (!site) return null;
  try {
    const res = await apiFetch(`/api/product-probe?url=${encodeURIComponent(site.url)}`, { signal: AbortSignal.timeout(22000) });
    if (!res.ok) return null;
    const d = rec(await res.json());
    if (!d.available) return null;
    const list = (v: unknown) => arr(v).map(str).filter(Boolean);
    return {
      url: str(d.url), host: d.host == null ? null : str(d.host),
      privacyProduct: bool(d.privacyProduct),
      providers: arr(d.providers).map(rec).map((p) => ({ name: str(p.name), kind: str(p.kind), evidence: list(p.evidence) })),
      backendHosts: list(d.backendHosts), paasHosts: list(d.paasHosts), originalityClaims: list(d.originalityClaims),
      contractsInApp: Number(d.contractsInApp ?? 0) || 0, bundlesRead: Number(d.bundlesRead ?? 0) || 0,
      read: d.read === "white-label" || d.read === "self-hosted" ? d.read : "unknown",
      note: str(d.note),
    };
  } catch {
    return null;
  }
}
