// Token Threat Scanner — shared types. The scanner layers code-level review and
// deployer reputation on top of the existing market/safety audit (src/token/),
// then renders it the way a trap-warning should read: a risk score (higher =
// worse), a verdict bucket, a one-line action, and three severity tiers of
// plain-English second-person findings. Every scan is recorded so the module
// builds a track record ("receipts") and a deployer reputation memory.

import type { TokenDossier } from "../token/audit";

// ---- verdict model ----
// Risk points, 0–100, HIGHER = WORSE (inverse of the src/token score, which is
// a quality score). Bands: SAFE 0–15, CAUTION 16–39, DANGER ≥ 40. RUG is NOT a
// score band — it is reserved for a CONFIRMED trap (honeypot-class / already
// rugged), which forces risk to 100 regardless of the accumulated points.
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
  checked: boolean; // false when the chain has no per-token code (Solana SPL, Base B20) or fetch failed
  verified: boolean;
  // Set when the token is a chain-native asset standard with no per-token
  // bytecode at all: Base B20 assets carry a 1-byte 0xef marker and run on the
  // chain's precompile, so "no verified source" is not a finding - there is no
  // source to verify. The authority reads are the whole power surface.
  system?: "b20" | null;
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
  classification?: import("./classify").TokenClassification;
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
    launch: LaunchProvenance | null;
    product?: ProductAuthenticity | null;
    claims?: ClaimsLedger | null;
    verification: RegistryVerification | null;
    sellers: SellStructure | null;
    site: SiteSafety | null;
    // Optional so cached scans frozen before this lane existed still parse.
    posture?: TechnicalPosture | null;
  };
  scannedAt: number;
}

// ---- chart posture (generic technical read for major-venue-listed tickers) ----
// Deliberately vendor-anonymous: observations are plain chart language
// ("confirmed bullish breakout", "potential bearish reversal forming") and the
// upstream signal source is never named in any user-facing surface.
export interface TechnicalPosture {
  covered: boolean;
  stance: "bullish" | "bearish" | "mixed" | "neutral";
  readings: { timeframe: string; stance: string; observations: string[] }[];
  note: string | null;
}

// ---- linked-site safety (drainer / blacklist check on the token's website) ----
// Product authenticity: what the linked product's own client code says it is,
// set against what the copy claims. Read server-side by api/product-probe
// from the page and its bundles; "white-label" means a known third-party
// provider's fingerprint (error-code namespace, API host, SDK id) is in the
// bundle. null when the token links no website or the probe could not read it.
export interface ProductAuthenticity {
  url: string;
  host: string | null;
  privacyProduct: boolean;
  providers: { name: string; kind: string; evidence: string[] }[];
  backendHosts: string[];
  paasHosts: string[];
  originalityClaims: string[];
  contractsInApp: number;
  bundlesRead: number;
  read: "white-label" | "self-hosted" | "unknown";
  note: string;
  // The product's backend, probed: self-reported service name, quote
  // endpoints, and the error-code namespaces they answer with.
  api?: { base: string; service: string | null; endpoints: string[]; errorCodes: string[]; providers: string[] } | null;
}

// The project's own statements, typed (api/claims), and the verdict each
// earned against the evidence the scan holds. A claim the evidence
// contradicts is a finding in its own right - the copy and the code disagree.
export type ClaimKind = "router" | "original" | "fees-to-holders" | "dev-locked" | "no-snipers" | "no-custody" | "compliance" | "audit" | "doxxed" | "partnership";
export interface ProjectClaim {
  kind: ClaimKind;
  text: string;
  source: "website" | "bundle" | "telegram" | "on-chain description" | "aggregator";
  url: string | null;
  names: string[];
}
export interface ClaimVerdict {
  claim: ProjectClaim;
  status: "confirmed" | "contradicted" | "unrealised" | "unverifiable";
  evidence: string;
}
export interface ClaimsLedger {
  claims: ProjectClaim[];
  verdicts: ClaimVerdict[];
  sources: string[];
  unavailable: string[];
  telegramMembers: number | null;
}

export interface SiteSafety {
  hasX: boolean;
  hasWebsite: boolean;
  worst: "malicious" | "suspicious" | "clean" | "unknown";
  sites: { url: string; host: string; verdict: string; flags: string[]; sources: string[] }[];
  // Authenticity: is the scanned CA in the project's official X bio? (Enigma's
  // impersonation-defense rule.) null when no X handle is linked.
  xBio: { handle: string; status: "verified" | "mismatch" | "absent" | "unreadable"; note: string } | null;
  // Handle provenance: was the linked X account called something else before?
  // A renamed account wears an age and a following it did not earn under this
  // identity. "unknown" means the archive has no record, never that it is clean.
  // null when no X handle is linked.
  xHistory: {
    handle: string;
    status: "renamed" | "single" | "unknown";
    priorHandles: string[];
    handleReused: boolean;
    currentSince: string | null;
    // False alongside a record means the archive has never seen the account
    // under the name it uses today: the rename postdates the archive's own
    // coverage, which is the freshest form of this finding. Absent on scans
    // frozen before the lane looked the account up by id.
    currentNameInArchive?: boolean;
    lastRenameSeen: string | null;
    // The dated timeline the archive actually holds, per account id: every
    // screen name this account has worn and the window it was seen under each.
    // Carried in full so the report can show the sequence rather than one
    // sentence about it. More than one entry means the HANDLE changed hands.
    accounts: { id: string; names: { handle: string; firstSeen: string | null; lastSeen: string | null }[] }[];
    note: string;
  } | null;
}

// ---- sell structure (who has actually been selling) ----
export interface SellStructure {
  available: boolean;
  truncated: boolean;
  launchBlock: number | null;
  sellerCount: number;
  devSold: boolean | null;
  soldToPoolTotalPct: number | null;
  badSellerCount: number;
  topSellers: {
    wallet: string;
    soldPct: number | null;
    boughtPct: number | null;
    realizedExitPct: number;
    sameBlockSniper: boolean;
    isDeployer: boolean;
    deployerSeeded: boolean;
    flags: string[];
  }[];
  // Recent 24h trade tape (GeckoTerminal, keyless, per-wallet USD) - the direct
  // "who is selling right now" answer, independent of the Etherscan history path.
  recentTape: {
    sells: number;
    buys: number;
    sellUsd: number;
    buyUsd: number;
    distinctSellers: number;
    distinctBuyers: number;
    topSellers: { wallet: string; usd: number; isDeployer: boolean; isCreator: boolean }[];
    note: string;
  } | null;
  note: string;
}

// ---- registry verification (wallet badge systems) ----
export interface RegistryVerification {
  level: "registry-verified" | "listed" | "unknown";
  jupiterVerified: boolean | null; // Solana only; what Phantom's badge derives from
  organicScoreLabel: string | null;
  cgListed: boolean;
  goplusTrusted: boolean;
  sources: string[];
  note: string;
}

// ---- launch provenance (fair launch vs launchpad, graduation, LP custody) ----
// HOW the token came to market changes how every other signal reads: a
// graduated pump.fun token's LP is protocol-owned (can't be pulled — "lock
// unconfirmed" is a false alarm), while an on-curve token has no LP at all yet.
// The bonding/quote pair sets what the floor is denominated in, and platforms
// that pay the creator ongoing fees make "what does the creator DO with them"
// (LP add / buyback-burn = bullish; dump = bearish) a first-class signal.
export interface LaunchProvenance {
  kind: "launchpad" | "fair-launch" | "unknown";
  attribution?: { state: "confirmed" | "candidate" | "unresolved"; basis: string; candidate: string | null };
  venue: string | null; // e.g. "pump.fun", "bonk.fun", "bags", "virtuals", "pons"
  // Bonding-curve state. null = not curve-based or unknown.
  onCurve: boolean | null;
  graduated: boolean | null;
  curveProgressPct: number | null;
  // The bonding / current pool quote asset and what it implies.
  quote: string | null;
  quoteNote: string | null;
  // Where the LP actually sits given the venue's mechanics — the rug crux.
  lpDisposition: "burned" | "protocol-owned" | "locked" | "creator-held" | "curve" | "unknown";
  lpNote: string | null;
  // Platform-paid creator fee revenue: is it being claimed, and what is the
  // creator doing with it?
  creatorFees: {
    platformPays: boolean;
    // What the venue pays the creator in. "token" or "mixed" means every fee
    // claim hands the creator fresh supply of the launched token: a structural
    // fact about the venue, disclosed as a note and never scored on its own.
    // Optional so cached scans frozen before this field existed still parse.
    asset?: "quote" | "token" | "mixed" | "none" | "unknown";
    claimCount: number | null; // observed claims (null = couldn't observe)
    claimedUsd: number | null;
    claimedTokens?: number | null; // observed claims in the launched token
    quoteClaims?: { count: number; eth: number; tokenPayouts: number } | null; // quote-asset venues (Pons v2)
    usage: "lp-add" | "buyback-burn" | "buyback" | "hold" | "dump" | "unknown";
    note: string;
  } | null;
  // Launch-window snipe read: buyers in the first block(s)/slot(s).
  snipe: {
    window: string; // human description of the window measured
    buyers: number;
    sameBlockBuyers: number;
    pctOfSupply: number | null;
    note: string;
  } | null;
  notes: string[];
  // The launcher's own metadata description, when the token contract carries
  // one (Pons v2 description()). The project's pitch, read for claims.
  description?: string | null;
}

// ---- Migrate.fun migration (#5) ----
export interface MigrationInfo {
  migrated: boolean;
  isPostMigrationToken: boolean;
  projects: { projectId: string; role: string; counterpartMint: string; creator: string }[];
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

// ---- buyer cohort / Common Coins (on-demand, RAVN-style) ----
// What OTHER tokens do this token's top holders also hold? A shared set of
// obscure bags across many "separate" wallets is a coordinated cohort.
export interface CohortOverlap {
  available: boolean;
  cohortSize: number;
  threshold: number;
  commonCoins: {
    address: string;
    symbol: string;
    heldBy: number;      // how many of the analyzed holders hold it
    pctOfCohort: number; // heldBy / cohortSize
    mcap: number | null;
    liqUsd: number | null;
  }[];
  // Wallet reputation, banked from our own scans over time (RAVN's moat, ours).
  reputation?: {
    holdersWithHistory: number;
    holdersWithDeadBags: number;
    topOffenders: { wallet: string; held: number; dead: number; deadSymbols: string[] }[];
  };
  note: string;
}

// ---- wallet taxonomy (age / fresh / dormant / CEX-funded) ----
export interface WalletTaxonomy {
  available: boolean;
  analyzed: number;
  cohorts: Record<"fresh" | "recent" | "aged" | "dormant" | "cexFunded" | "unknown", { n: number; pct: number }>;
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
