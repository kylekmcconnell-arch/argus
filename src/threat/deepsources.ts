// Supplemental keyless sources the base audit (src/token) doesn't tap. Both are
// free and CORS-open, called only by the threat scanner so the base module
// stays untouched until fold-in:
//   - RugCheck (Solana): full risk report — 30+ named risk patterns, insider
//     networks, LP locker identity. The Solana counterpart of GoPlus's depth.
//   - Honeypot.is deep fields (EVM): the parts the base audit discards — per-
//     holder sell analysis (failed sellers, siphoned wallets), max buy/sell
//     caps, and the human-readable honeypot reason.

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
  insidersDetected: number; // wallets in detected insider networks
  insiderPct: number; // % of supply those networks hold
  lockerPct: number; // % of LP in known lockers
  lockerNames: string[];
}

export async function rugcheckReport(mint: string): Promise<RugcheckReport | null> {
  try {
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const networks: any[] = d.insiderNetworks ?? [];
    const insidersDetected = networks.reduce((a, n) => a + (n.size ?? n.wallets?.length ?? 0), 0);
    const supply = Number(d.token?.supply ?? 0);
    const insiderTokens = networks.reduce((a, n) => a + Number(n.tokenAmount ?? 0), 0);
    const lockers = Object.values((d.lockers ?? {}) as Record<string, any>);
    const lpLockedUsd = lockers.reduce((a: number, l: any) => a + Number(l.usdcLocked ?? 0), 0);
    const marketLpUsd = Number(d.totalMarketLiquidity ?? 0);
    return {
      score: Number(d.score_normalised ?? d.score ?? 0),
      risks: (d.risks ?? []).map((r: any) => ({
        name: String(r.name ?? ""),
        level: String(r.level ?? "warn"),
        description: String(r.description ?? ""),
        score: Number(r.score ?? 0),
        value: r.value ? String(r.value) : undefined,
      })),
      rugged: !!d.rugged,
      insidersDetected,
      insiderPct: supply > 0 ? Math.round((insiderTokens / supply) * 100) : 0,
      lockerPct: marketLpUsd > 0 ? Math.min(100, Math.round((lpLockedUsd / marketLpUsd) * 100)) : 0,
      lockerNames: [...new Set(lockers.map((l: any) => String(l.type ?? "locker")))],
    };
  } catch {
    return null;
  }
}

// ---- Honeypot.is deep (EVM) ----
export interface HoneypotDeep {
  isHoneypot: boolean;
  reason: string | null;
  maxBuyPct: number | null; // max buy as % of supply, when enforced
  maxSellPct: number | null;
  // per-holder sell analysis: the check nobody else runs. A selective honeypot
  // lets the sim wallet sell while real holders can't; this catches it.
  holdersAnalyzed: number;
  holdersFailed: number;
  siphoned: number; // wallets whose sells were siphoned (taxed ~100%)
  highTaxWallets: number;
  averageTax: number;
  flags: { text: string; severity: string }[];
}

const HP_CHAIN: Record<string, string> = { ethereum: "1", bsc: "56", base: "8453" };

// ---- GoPlus meta flags the base audit doesn't carry (EVM) ----
// Counterfeit / airdrop-scam / trust-list signals. `fake_token` means the
// contract impersonates an established token (a namesquat trap — the exact case
// the investigation methodology's token-disambiguation step warns about).
export interface GoPlusMeta {
  fakeToken: boolean;
  fakeTokenOf: string | null; // the real token address it impersonates, if given
  airdropScam: boolean;
  trustListed: boolean; // GoPlus's own allowlist of reputable tokens
  inCex: boolean;
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
    const res = await fetch(`https://api.gopluslabs.io/api/v1/token_security/${id}?contract_addresses=${address}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as { result?: Record<string, any> };
    const row = d.result?.[address.toLowerCase()] ?? (d.result ? Object.values(d.result)[0] : undefined);
    if (!row) return null;
    const ft = row.fake_token;
    return {
      fakeToken: ft?.value === 1 || ft?.value === "1" || row.is_fake_token === 1,
      fakeTokenOf: ft?.true_token_address ?? null,
      airdropScam: row.is_airdrop_scam === "1" || row.is_airdrop_scam === 1,
      trustListed: row.trust_list === "1" || row.trust_list === 1,
      inCex: row.is_in_cex?.listed === "1" || row.is_in_cex?.listed === true,
    };
  } catch {
    return null;
  }
}

// ---- runtime-bytecode fingerprint (EVM) via api/bytecode.ts ----
// The fingerprint bridges byte-identical contracts: a fresh token that clones a
// known-AVOID rug lights up on its own. Server-side (needs RPC egress).
export interface Fingerprint {
  fingerprint: string;
  isToken: boolean;
  proxy: boolean;
  capabilities: { name: string; risk: string }[];
}
export async function codeFingerprint(chain: string, address: string): Promise<Fingerprint | null> {
  if (!GP_CHAIN[chain]) return null;
  try {
    const res = await fetch(`/api/bytecode?address=${encodeURIComponent(address)}&chain=${encodeURIComponent(chain)}`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    if (!d.available || !d.fingerprint) return null;
    return {
      fingerprint: String(d.fingerprint).toLowerCase(),
      isToken: !!d.isToken,
      proxy: !!d.proxy,
      capabilities: Array.isArray(d.capabilities) ? d.capabilities.map((c: any) => ({ name: String(c.name), risk: String(c.risk) })) : [],
    };
  } catch {
    return null;
  }
}

// Prior flagged tokens that share this fingerprint — the known-rug-clone check.
export async function knownRugClones(fingerprint: string, selfAddress: string): Promise<{ symbol: string; address: string; verdict: string }[]> {
  try {
    const res = await fetch(`/api/threat-receipts?fingerprint=${encodeURIComponent(fingerprint)}`, {
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
    const res = await fetch(`https://api.honeypot.is/v2/IsHoneypot?address=${address}&chainID=${chainID}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const d = (await res.json()) as any;
    const h = d.holderAnalysis ?? {};
    const pctOf = (x: any) => {
      const n = Number(x?.tokenPercent ?? x?.percent ?? NaN);
      return Number.isFinite(n) ? n * (n <= 1 ? 100 : 1) : null;
    };
    return {
      isHoneypot: !!d.honeypotResult?.isHoneypot,
      reason: d.honeypotResult?.honeypotReason ?? null,
      maxBuyPct: pctOf(d.simulationResult?.maxBuy),
      maxSellPct: pctOf(d.simulationResult?.maxSell),
      holdersAnalyzed: Number(h.holders ?? 0),
      holdersFailed: Number(h.failed ?? 0),
      siphoned: Number(h.siphoned ?? 0),
      highTaxWallets: Number(h.highTaxWallets ?? 0),
      averageTax: Number(h.averageTax ?? 0),
      flags: (d.flags ?? []).map((f: any) => ({
        text: String(f.description ?? f.flag ?? f),
        severity: String(f.severity ?? "medium"),
      })),
    };
  } catch {
    return null;
  }
}
