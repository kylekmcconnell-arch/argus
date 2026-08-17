// Token Threat Scanner — shared types. The scanner layers code-level review and
// deployer reputation on top of the existing market/safety audit (src/token/),
// then renders it the way a trap-warning should read: a risk score (higher =
// worse), a verdict bucket, a one-line action, and three severity tiers of
// plain-English second-person findings. Every scan is recorded so the module
// builds a track record ("receipts") and a deployer reputation memory.

import type { TokenDossier } from "../token/audit";

// ---- verdict model ----
// Risk points, 0–100, HIGHER = WORSE (inverse of the src/token score, which is
// a quality score). SAFE ≈ 0–15, CAUTION ≈ 16–39, DANGER ≈ 40–69, RUG = 70+.
export type ThreatVerdict = "SAFE" | "CAUTION" | "DANGER" | "RUG" | "UNKNOWN";

export interface ThreatCall {
  verdict: ThreatVerdict;
  risk: number; // 0–100 risk points, higher = worse
  action: string; // one-line imperative: "DON'T TOUCH IT" / "no mechanical red flags"
  flags: string[]; // red: disqualifying traps, second-person plain English
  warnings: string[]; // amber: real risks that aren't by themselves disqualifying
  positives: string[]; // green: verified good news (shown even on a RUG verdict)
}

// ---- code review (the AI read layer) ----
export interface SourceFile {
  path: string;
  content: string;
}

export interface ContractSource {
  verified: boolean;
  origin: "sourcify" | "blockscout" | "etherscan" | null;
  contractName: string | null;
  compiler: string | null;
  files: SourceFile[];
}

export type FlagSeverity = "critical" | "high" | "medium" | "info";

// One code-level finding, always anchored to a file + line so the report can
// cite the exact source the way a human auditor would.
export interface CodeFlag {
  id: string;
  severity: FlagSeverity;
  title: string;
  detail: string; // plain English: what this means for someone holding the token
  file: string;
  line: number;
  excerpt: string;
}

// Mechanical pre-analysis of the source — computed before (and fed to) the AI
// pass, and useful on its own when no AI key is present.
export interface CodeStats {
  functions: number;
  gatedFunctions: number; // functions behind an access-control modifier
  dangerHits: number; // static red-flag pattern count
  isProxy: boolean;
  loc: number;
}

export interface CodeReview {
  checked: boolean; // false when the chain has no per-token code (Solana SPL) or fetch failed
  verified: boolean;
  origin: ContractSource["origin"];
  contractName: string | null;
  compiler: string | null;
  stats: CodeStats | null;
  flags: CodeFlag[];
  // Tax-destination + burn mechanics read from the source (null when unverified).
  tokenomics: import("./solidity").CodeTokenomics | null;
  // Server-side AI pass (Claude reading the actual source). Null when the API
  // is unreachable or unkeyed — the static flags above always still apply. The
  // AI may DISSENT from the mechanical verdict; that dissent is surfaced, not
  // averaged away. proxyOf is set when the read is of a proxy's implementation.
  ai: { summary: string; dissent: "cleaner" | "darker" | null; proxyOf?: string | null } | null;
}

// ---- deployer reputation ----
// What else the wallet that shipped this token has shipped, and what happened
// to it. Sources: GoPlus serial-honeypot flag + the local ledger of past scans
// (a deployer seen rugging before is remembered).
export interface DeployerRep {
  address: string | null;
  serialHoneypoter: boolean;
  priorScans: { address: string; symbol: string; verdict: ThreatVerdict; at: number }[];
  priorRugs: number;
}

// ---- transparent checklist ----
export type CheckStatus = "pass" | "warn" | "fail" | "na";
export interface ThreatCheck {
  key: string;
  category: "authority" | "liquidity" | "honeypot" | "holders" | "deployer" | "code" | "market";
  label: string;
  status: CheckStatus;
  detail: string;
}

// ---- the full scan ----
export interface ThreatScan {
  address: string;
  chain: string;
  symbol: string;
  name: string;
  dossier: TokenDossier; // the underlying market/safety audit (data layer)
  // What KIND of token this is (meme / utility / RWA / equity / security-like),
  // decided at the outset so the judge measures it against the right yardstick.
  classification: import("./classify").TokenClassification;
  call: ThreatCall;
  code: CodeReview;
  deployer: DeployerRep;
  tokenomics: import("./tokenomics").TokenomicsView;
  checks: ThreatCheck[];
  // Supplemental deep-source evidence (see deepsources.ts): RugCheck's Solana
  // risk report / Honeypot.is per-holder sell analysis. Kept raw for the UI.
  deep: {
    rugcheck: import("./deepsources").RugcheckReport | null;
    honeypot: import("./deepsources").HoneypotDeep | null;
    meta: import("./deepsources").GoPlusMeta | null;
    fingerprint: string | null;
    clones: { symbol: string; address: string; verdict: string }[];
    xchain: CrossChain | null;
    migration: MigrationInfo | null;
    nftlock: NftLockReport | null;
  };
  scannedAt: number;
}

// ---- Migrate.fun migration (#5) ----
export interface MigrationInfo {
  migrated: boolean;
  isPostMigrationToken: boolean;
  projects: { projectId: string; role: string; counterpartMint: string; creator: string }[];
  note: string;
}

// ---- concentrated-liquidity (Uniswap V3) position custody ----
// A v3/v4 pool's liquidity is a position NFT, not an LP token — this proves who
// can actually withdraw it (burned / a genuinely exit-less locker contract / a
// plain wallet) rather than guessing from a locker-name tag. See api/nftlock.ts.
export interface NftPosition {
  tokenId: number;
  owner: string | null; // null only when ownerKind is "closed"
  ownerKind: "burned" | "eoa" | "contract" | "closed";
  ownerName: string | null; // verified contract name, when known
  amount: string; // raw liquidity units at mint — a relative size proxy, not live TVL
  locked: boolean | null; // true = no exit path found; false = one was found; null = unconfirmed
  reason: string;
}
export interface NftLockReport {
  available: boolean;
  manager: string | null;
  positions: NftPosition[];
  dominant: NftPosition | null; // the largest LIVE (non-closed) position by size
  note: string;
}

// ---- cross-chain / LayerZero OFT (#4) ----
export interface CrossChain {
  isOft: boolean;
  isAdapter: boolean; // lockbox adapter vs native OFT
  legs: { chain: string; address: string; liquidityUsd: number | null; self: boolean }[];
  totalLiquidityUsd: number; // sum over resolved legs
  resolvedLegs: number;
}

// ---- creator & insider clustering (#9, lazy/on-demand) ----
export interface InsiderCluster {
  available: boolean;
  clusters: { size: number; combinedPct: number; sharedFunders: string[]; includesCreator: boolean; wallets: string[] }[];
  largestPct: number;
  largestSize: number;
  includesCreator: boolean;
  note: string;
}

// ---- Behind the Ledger (lazy/on-demand) ----
// The deep transfer-graph read (api/behindledger.ts): where sold tokens
// actually came from - emission farms, presale/insider vaults, churn, or
// hop-wallet distribution - plus launch selling and LP flight.
export interface BehindLedgerReport {
  available: boolean;
  coverage: "full" | "partial";
  coveredDays: number;
  transferCount: number;
  attribution: {
    totalUserSold: number;
    botShuttled: number;
    farmPct: number;
    vaultPct: number;
    churnPct: number;
    hopPct: number;
    otherPct: number;
    earlyWindowSoldPct: number;
    earlyVaultSoldPct: number;
  };
  sellers: {
    address: string; sold: number; trades: number;
    farmPct: number; vaultPct: number; boughtPct: number; otherPct: number;
    hopFunded: boolean;
  }[];
  farms: { address: string; payouts: number; recipients: number; tokensOut: number; activeDays: number }[];
  vaults: { address: string; claimants: number; tokensOut: number }[];
  lp: { added: number; removed: number; removedLast3d: number } | null;
  findings: string[];
  note: string;
}

// ---- verdict-flip alerts ----
// Emitted by the re-check cron when a token we rated tradeable (SAFE/CAUTION)
// then loses its liquidity — "we said tradeable, its pool just got pulled."
export interface ThreatAlert {
  address: string;
  chain: string;
  symbol: string;
  type: "liquidity-collapse" | "confirmed-dead";
  wasVerdict: ThreatVerdict | string;
  liqThen: number;
  liqNow: number;
  priceDropPct: number;
  at: number;
}

// ---- receipts: the recorded track record ----
// Every scan is recorded with the liquidity AT flag time. Re-checking later
// turns flagged calls into receipts: "flagged at $32K liquidity, now $0, dead."
export interface Receipt {
  address: string;
  chain: string;
  symbol: string;
  verdict: ThreatVerdict;
  risk: number;
  flaggedAt: number;
  liqThen: number;
  liqNow?: number;
  priceDropPct?: number;
  status?: "alive" | "bleeding" | "dead";
  checkedAt?: number;
  deployer?: string | null;
  codeVerified?: boolean;
  flagCount?: number;
  codeFingerprint?: string | null;
}
