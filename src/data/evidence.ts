// Shared evidence shape — the bag a collector (live adapters OR a fixture) fills,
// from which the engine produces a verdict. Lives in src/ so both the client and
// the Node server import the same types.

import type { CandleSummary } from "../lib/priceHistory";
import type { EvmControlRealitySnapshot } from "./evmControlReality";
import type {
  SubjectClass,
  Venture,
  Testimonial,
  AdvisedProject,
  Wallet,
  Promotion,
  ClientEngagement,
  AssociateInput,
  Finding,
  IdentityConfidence,
  EvidenceOrigin,
} from "../engine";

// A single owned repo, summarized from the repos-list payload (no per-repo call).
export interface GithubRepoBrief {
  name: string;
  stars: number;
  language?: string;
  lastPush?: string; // ISO date of the most recent push
  fork: boolean;
  url: string;
}

// One evidence-graded cross-check of an X-bio claim against GitHub reality.
// Grades describe support, never assert fraud: "contradicted" means the bio and
// GitHub disagree on a checkable fact, not that the person is lying.
export interface GithubClaimCheck {
  claim: string;       // the bio claim being tested
  observation: string; // what GitHub shows
  grade: "consistent" | "unsupported" | "contradicted" | "context";
}

// A structured read of a resolved GitHub account: how old it is, how much of the
// work is original vs forked, what its stars/languages look like, and how the
// bio's self-claims hold up against it. Computed server-side during the audit.
export interface GithubAssessment {
  login: string;
  confidence: "gold" | "weak"; // carried from the twitter_username match
  createdAt?: string;          // account creation date (ISO)
  accountAgeYears?: number;
  publicRepos: number;
  originalCount: number;       // non-fork owned repos
  forkCount: number;
  forkRatio: number;           // forks / (originals + forks), 0 when no repos
  totalStarsOnOriginals: number;
  topLanguages: { language: string; repos: number }[];
  notableRepos: GithubRepoBrief[]; // top originals by stars
  lastActivity?: string;       // most recent push across owned repos (ISO)
  daysSinceActivity?: number;  // computed at collect time
  claimChecks: GithubClaimCheck[];
  summary: string;             // one-line evidence-graded headline
}

export interface SubjectProfile {
  handle: string;
  display_name: string;
  resolved_name?: string; // licensed/deterministic real name; display name remains untouched for UX
  avatar: string;
  avatar_url?: string; // real X profile photo URL, when resolved (else derive from handle)
  avatar_source_state?: "resolved" | "none"; // explicit twitterapi outcome; absence means collection was unavailable
  website?: string;    // independently resolved first-party site, when available
  /**
   * Additional official websites unique-ID bound to this same X profile
   * (twitterapi website + entity URLs from that exact profile record).
   * Includes the primary `website` when it came from that record. Never
   * search leads or model-suggested URLs.
   */
  official_websites?: string[];
  /** What the profile website actually served when fetched (sitecheck outcome).
   * "live" means a substantial product surface was observed on the domain. */
  site_substance_status?: "live" | "coming_soon" | "unreachable" | "access_blocked" | "unavailable" | "client_rendered";
  bio: string;
  /**
   * Bounded sample of the account's OWN recent original posts, frozen only to
   * classify a subject whose bio is empty. First-party content fetched from
   * the provider, so it is routing-eligible in exactly the way the bio is;
   * it is never treated as a verified claim about anything.
   */
  self_post_sample?: string;
  followers: string;
  joined: string;
  /** Raw ISO account creation time; `joined` is display-only and cannot be parsed. */
  account_created_at?: string;
  identity_confidence: IdentityConfidence;
  identity_note: string;
  /**
   * Exact account-to-person bridge established by a source that is not the
   * audited profile's attacker-controlled display name. This governs whether
   * a resolved name may join external career, legal, or portfolio records.
   */
  identity_binding?: "licensed_exact_social" | "independent_exact_handle";
  prior_handles?: string[]; // past X usernames for the same account id (rebrands)
  last_post_at?: string;    // ISO time of the most recent tweet (dormancy signal)
  days_since_post?: number; // days since that post, computed at collect time
  identity_emails?: string[]; // PDL-resolved emails — bridge to leaked GitHub commit emails
  githubAssessment?: GithubAssessment; // resolved GitHub account: quality/claims/history
  /** A placeholder handle is not provider evidence until this is `resolved`. */
  profile_collection_state?: "resolved" | "unavailable";
  /** Provider that returned the frozen profile, when collection succeeded. */
  profile_provider?: string;
  /** Capture time for the provider-returned profile. */
  profile_captured_at?: string;
  /**
   * Operational state of the exact official X handle. This is deliberately
   * separate from identity resolution: an official site can still prove which
   * account belongs to a project even when X has suspended that account.
   */
  x_account_status?: "active" | "suspended" | "unavailable";
  /** Public X profile URL used to establish the frozen account state. */
  x_account_status_source_url?: string;
  /** Capture time for the public account-state observation. */
  x_account_status_captured_at?: string;
}

export interface AxisInput {
  axis: string;
  score: number;
  rationale: string;
  /** Exact frozen artifacts the analyst used to justify this score. */
  evidenceRefs?: string[];
  /** Credible artifacts that pull against the selected score. */
  counterEvidenceRefs?: string[];
  /** Material evidence gaps the analyst could not resolve. */
  gaps?: string[];
}

export type AxisEvidenceVerification =
  | "verified"
  | "reported"
  | "observed"
  | "checked_empty"
  | "unavailable";

/**
 * A content-addressed record from the exact, post-pruning packet shown to the
 * scoring analyst. `artifactId` is the durable join key used by the immutable
 * report, normalized provenance tables, and the report UI; `contentHash`
 * remains the integrity fingerprint of the bounded record itself.
 */
export interface AxisEvidenceRecord {
  artifactId: string;
  kind: "axis_evidence";
  provider: string;
  operation: string;
  section: string;
  title: string;
  excerpt?: string;
  sourceUrl?: string;
  capturedAt?: string;
  contentHash: string;
  eligibleAxes: string[];
  verification: AxisEvidenceVerification;
  /**
   * Axes for which the represented payload is a deterministically verified
   * score-limiting fact. Older frozen catalogs may omit this field; omission
   * must never be interpreted as negative or limiting evidence.
   */
  counterEligibleAxes?: string[];
  scope: "direct_subject" | "subject_context";
}

/** "assessed_null": a deterministic per-axis assessment completed and found no
 * verified positive record. The axis stays scoreable in the low band (0-39%)
 * instead of abstaining the subject; distinct from "none" (nothing assessed)
 * and "adverse" (verified negative evidence). */
export type ProjectStrengthTier = "none" | "assessed_null" | "adverse" | "emerging" | "solid" | "exceptional";

export interface ProjectStrengthBandRecord {
  tier: ProjectStrengthTier;
  minScore: number;
  maxScore: number;
  /**
   * Present only when unverified press widened the ceiling: the strongest
   * tier the axis reaches on verified records alone. minScore comes from this
   * tier while maxScore comes from `tier`, so persistence can re-derive the
   * split range exactly. Absent on fully verified bands and on older frozen
   * reports.
   */
  floorTier?: ProjectStrengthTier;
  reasons: string[];
  anchorArtifactIds: string[];
}

// A high-signal account (respected caller, founder, VC, or infra) that follows
// the subject. Follower QUALITY, not count: who vouches by following matters more
// than a raw number a bot farm can inflate.
export interface NotableFollower {
  handle: string;
  label: string;   // caller | trader | founder | investor | infra | high reach
  size: string;    // follower-count tier for display (e.g. "700K", "2.3M")
  count?: number;  // the follower's own follower count (drives high-reach + sort)
}

// An internal contradiction: a subject claim that conflicts with another claim
// or with the collected evidence. A GAP (missing data) is never a contradiction.
export interface Contradiction {
  claim: string;     // what the subject asserts
  conflict: string;  // the specific evidence that contradicts it
  severity: "low" | "medium" | "high";
  confidence: "low" | "medium" | "high";
}

export interface TraceStep {
  phase: string;
  label: string;
  detail: string;
  source?: string;
  tone: "neutral" | "good" | "warn" | "bad";
  // Machine-readable project-token announcement. The server resolves the
  // subject's token as early as it can and stamps it on a step; the client
  // runner sees it mid-stream and launches the browser-side token threat scan
  // IN PARALLEL with the rest of the collection, so the full audit carries the
  // threat report without extending the critical path.
  token?: { address: string; via: "evm" | "solana"; source: string };
}

/**
 * Canonical token identity and market context for a project/organization
 * account. This is separate from `promotions`: a project's own token is part of
 * its capital and product surface, not a KOL-style call.
 *
 * The collector may freeze this record only when a market registry's official
 * X handle matches the audited account or its official homepage matches the
 * provider-returned profile website. A name or ticker match alone is never
 * enough. CoinGecko is preferred when available; identity-bound DEX records
 * cover new or chain-native assets that have not reached CoinGecko yet.
 */
export interface ProjectTokenSnapshot {
  verified: true;
  verification: "official_x" | "official_domain";
  name: string;
  symbol: string;
  coingeckoId?: string;
  rank: number | null;
  address: string;
  chain: string;
  /**
   * Protocol chain footprint from DeFiLlama TVL data, attached only when the
   * DeFiLlama record joins this token by CoinGecko id (never by name), so a
   * name-alike protocol can never lend its footprint to a token.
   */
  deployedChains?: string[];
  homepage?: string;
  officialX?: string;
  /**
   * Legacy record-level citation. New reports should bind each claim through
   * `producerSources`, since identity, market, liquidity, and history can come
   * from different reads.
   */
  sourceUrl: string;
  /** Legacy record-level capture time. See `producerSources` for exact reads. */
  capturedAt: string;
  /**
   * Exact read that produced each part of the canonical-token snapshot.
   * Historical reports can omit this object. A missing member means that no
   * exact producer record was frozen for that part of the snapshot.
   */
  producerSources?: {
    identity: ProjectTokenProducerSource;
    market?: ProjectTokenProducerSource;
    liquidity?: ProjectTokenProducerSource;
    history?: ProjectTokenProducerSource;
  };
  providers?: Array<"coingecko" | "dexscreener" | "geckoterminal">;
  priceUsd?: number;
  marketCapUsd?: number;
  fdvUsd?: number;
  volume24hUsd?: number;
  /** CoinGecko-reported supply figures (partly project-self-reported; present the checkable ratio, never a vesting claim). */
  circulatingSupply?: number;
  totalSupply?: number;
  maxSupply?: number;
  liquidityUsd?: number;
  pairAddress?: string;
  /** CoinGecko lifetime high, captured with the canonical-token snapshot. */
  ath?: {
    priceUsd?: number;
    date?: string;
    drawdownPct?: number;
  };
  /**
   * Frozen GeckoTerminal candle window for the canonical pool. The shape is the
   * client's live price-history summary (src/lib/priceHistory.ts) so a frozen
   * series and a live refresh cannot describe the same candle differently, and
   * so the reported highs, lows and volume survive the freeze instead of being
   * validated and then thrown away.
   */
  history?: CandleSummary & {
    timeframe: "day" | "hour";
    poolAddress: string;
    /** Exact GeckoTerminal OHLCV endpoint used for the frozen series. */
    sourceUrl?: string;
    /** Capture time of the exact GeckoTerminal response. */
    capturedAt?: string;
  };
}

export interface ProjectTokenProducerSource {
  provider: "official_site" | "coingecko" | "dexscreener" | "geckoterminal";
  sourceUrl: string;
  /** Time ARGUS observed the exact provider response. */
  capturedAt: string;
  /** Provider-declared data update time, distinct from ARGUS observation time. */
  providerUpdatedAt?: string;
}

/**
 * Frozen public funding record for a project (backing / partners). Mirrors the
 * DeFiLlama `ProtocolFunding` value (see server/adapters/defiLlama.ts) plus the
 * capture timestamp, so the wiring layer can store `{ ...value, capturedAt }`
 * without importing a server-only type into the shared evidence bag.
 */
/** A verified venture's canonical token, frozen for a FOUNDER subject. */
export interface VentureTokenSnapshot extends ProjectTokenSnapshot {
  /** The verified venture this token belongs to (never the person). */
  ventureName: string;
}

export interface ProtocolFundingSnapshot {
  slug: string;
  name: string;
  /** CoinGecko identity from the protocol record, used to bind it to the canonical token. */
  geckoId?: string | null;
  rounds: Array<{
    date: string | null;
    round: string;
    amountUsd: number | null;
    leadInvestors: string[];
    otherInvestors: string[];
    valuationUsd: number | null;
  }>;
  totalRaisedUsd: number;
  leadInvestors: string[];
  sourceUrl: string;
  capturedAt: string;
}

/**
 * Frozen on-chain usage record for a project (total value locked). Mirrors the
 * DeFiLlama `ProtocolTvl` value plus the capture timestamp.
 */
export interface ProtocolTvlSnapshot {
  slug: string;
  name: string;
  symbol: string | null;
  tvlUsd: number;
  chains: string[];
  chainBreakdown: Array<{ chain: string; tvlUsd: number }>;
  geckoId: string | null;
  /** First date in the TVL series ("TVL history since YYYY"; the series can be backfilled, so this bounds, not proves, age). */
  firstRecordedAt?: string | null;
  /** TVL now vs ~30 days ago, signed percent; capital-commitment trend. Null when the series is too short. */
  change30dPct?: number | null;
  /** Downsampled weekly TVL points (~180 days, ends on the latest reading) for the report's trend chart. */
  trend?: Array<{ date: string; tvlUsd: number }>;
  /** Governance identifiers as listed by DeFiLlama (curated listing metadata). */
  governanceIds?: string[];
  /** Security incidents recorded in the same DeFiLlama document; frozen with the positives so evidence use is never selective. */
  hacks?: Array<{
    date: string | null;
    amountUsd: number | null;
    /** Explicit provider field; null means the provider record did not answer. */
    returnedFunds: boolean | null;
    returnedAmountUsd?: number | null;
    classification: string | null;
    technique?: string | null;
  }>;
  sourceUrl: string;
  capturedAt: string;
}

/**
 * One GoPlus contract-control or deployer-history flag, already worded by the
 * collector (server/adapters/tokenHolders.ts owns the sentences, so the project
 * lane and the token lane cannot describe the same provider flag differently).
 * Render `claim` as-is; a renderer that rewords it is asserting on GoPlus's
 * behalf.
 */
export interface ContractControlFlagSnapshot {
  key: string;
  claim: string;
  tone: "warn" | "bad";
  source: "goplus";
}

/** Frozen float-control profile (GoPlus holder register) for the verified canonical token. Disclosure data, never a verdict. */
export interface HolderProfileSnapshot {
  /** Exact canonical token identity this sidecar was collected for. */
  binding?: {
    canonicalAddress: string;
    chain: string;
    method: "canonical_token_address_chain";
  };
  /** Largest single WALLET, percent of supply. Pools, contracts and locked addresses are excluded. */
  topHolderPct: number | null;
  /** Combined share for up to ten assessed wallets. Read the structural fields below before naming it a top-ten total. */
  top10Pct: number | null;
  /** Number of usable wallet rows included in top10Pct. At most ten. Absent on legacy reports. */
  assessedWalletCount?: number | null;
  /** True when top10Pct covers fewer than ten usable wallet rows. Absent on legacy reports. */
  top10PctIsFloor?: boolean;
  holderCount: number | null;
  lpLockedOrBurnedPct: number | null;
  /**
   * Whether the holder distribution was usable at all. False means
   * topHolderPct/top10Pct were SUPPRESSED, never that concentration is low.
   * Optional because reports frozen before the suppression shipped carry
   * neither this nor the fields below; treat an absent value as "assessed",
   * which is what those reports actually recorded.
   */
  holdersAssessed?: boolean;
  /** Which register the concentration figures came from; null while suppressed. */
  distributionSource?: "goplus" | "explorer" | null;
  /** Why the distribution is missing, or which register produced it when that is not GoPlus. */
  distributionNote?: string | null;
  /** Exact ordered holder endpoint when concentration came from an explorer. */
  distributionSourceUrl?: string;
  /** Capture time for the exact ordered holder endpoint. */
  distributionCapturedAt?: string;
  /** GoPlus flags that FIRED. An empty array means no flag fired, never "clean". */
  contractFlags?: ContractControlFlagSnapshot[];
  /** Creator/authority-wallet share of supply. Null when GoPlus reported none, never 0. */
  creatorPct?: number | null;
  /** GoPlus citation used for holder count, LP rows, and fired contract flags. */
  sourceUrl: string;
  /** Capture time for the GoPlus token-security response. */
  sourceCapturedAt?: string;
  capturedAt: string;
}

/** Frozen upcoming-unlock schedule (CryptoRank vesting events). The "next dump" disclosure; never a verdict. */
export interface TokenUnlocksSnapshot {
  nextUnlockDate: string;
  allocationName: string | null;
  percentOfSupply: number | null;
  unlockValueUsd: number | null;
  percentOfMcap: number | null;
  cumulativeUnlockedPercent: number | null;
  next90dPercentOfSupply: number | null;
  /** New reports bind the schedule through CryptoRank's exact contract map. */
  canonicalAddress?: string;
  /** Normalized chain proven on both sides of the contract-map join. */
  chain?: string;
  /** CryptoRank currency id selected only after the exact contract join. */
  currencyId?: number;
  /** Exact API endpoint used to establish the canonical contract mapping. */
  contractSourceUrl?: string;
  /** Exact API endpoint that returned the frozen vesting events. */
  eventsSourceUrl?: string;
  /** Provider percentage fields rejected during collection as malformed or outside [0, 100]. */
  percentageValidation?: {
    invalidFields: Array<"percentOfSupply" | "percentOfMcap" | "cumulativeUnlockedPercent" | "next90dPercentOfSupply">;
  };
  sourceUrl: string;
  capturedAt: string;
}

/** Frozen protocol fee totals (DeFiLlama /summary/fees). On-chain-derived usage: users actually paid these fees. */
export interface ProtocolFeesSnapshot {
  slug: string;
  total24hUsd: number | null;
  total30dUsd: number | null;
  /** Trailing-30d fees vs the prior 30d, signed percent. Growth-or-bleed trend; null when unreported. */
  change30dOver30dPct?: number | null;
  sourceUrl: string;
  capturedAt: string;
  /** Identity join performed by orchestration before this sidecar was admitted. */
  binding?: {
    canonicalGeckoId: string;
    protocolSlug: string;
    method: "matched_protocol_gecko_id";
  };
}

/**
 * Frozen independent-audit evidence. New `corroborated` entries were confirmed
 * on the auditor's own domain with explicit audit context and a canonical
 * non-name identity anchor. Legacy `selfAttested` is the union of unverified audit
 * leads from subject pages and curated audit-link URLs; `attestations` preserves
 * which origin produced each lead on new reports.
 */
export interface SecurityAuditsSnapshot {
  securityPageUrl: string | null;
  selfAttested: string[];
  attestations?: Array<{
    auditor: string;
    origin: "subject_page" | "curated_audit_link";
    sourceUrl: string;
  }>;
  corroborated: Array<{
    auditor: string;
    auditorUrl: string;
    excerpt: string;
    /** Present on records captured after canonical identity anchoring shipped. */
    matchedIdentityAnchor?:
      | { type: "official_domain"; value: string }
      | { type: "canonical_contract"; value: string };
  }>;
  capturedAt: string;
}

/**
 * Frozen keyed private-market enrichment (Monid/Akta). Mirrors the adapter's
 * `CompanyEnrichment` value (see server/adapters/monid.ts) plus the capture
 * timestamp. Used to fill funding, leadership, and firmographic gaps that free
 * public sources leave blank.
 */
export interface CompanyEnrichmentSnapshot {
  name: string;
  uuid: string;
  identityMatch?: "official_domain" | "name_only";
  /** Official project/venture domain ARGUS asked Monid to resolve. */
  requestedDomain?: string;
  /** Website domain carried by the selected Monid company record. */
  matchedDomain?: string;
  /** Deterministic rule that selected the company before paid enrichment. */
  matchMethod?: "exact_host" | "parent_or_subdomain" | "exact_name" | "domain_label";
  funding?: {
    totalRaisedUsd: number | null;
    rounds: Array<{
      date: string | null;
      round: string;
      amountUsd: number | null;
      leadInvestors: string[];
      otherInvestors: string[];
    }>;
    leadInvestors: string[];
  };
  management?: Array<{
    name: string;
    title: string;
    priorCompanies: string[];
    linkedin: string | null;
    startYear: string | null;
  }>;
  firmographic?: {
    legalName: string | null;
    foundedYear: string | null;
    headcountRange: string | null;
    ownership: string | null;
  };
  sourceUrl: string;
  capturedAt: string;
}

// A provider artifact frozen into the report that was available to the analyst
// before scoring. These records are deliberately neutral about identity: a
// court-caption or sanctions-name match is a lead tied to a source, not proof
// that the named person is the audited subject.
export interface SourceArtifact {
  kind: "press" | "legal_case" | "sanctions_screen" | "profile_photo" | "trust_graph" | "portfolio_relationship" | "fund_scale";
  provider: "google-news" | "courtlistener" | "opensanctions" | "claude-vision" | "grok-vision" | "twitterapi" | "argus-graph" | "portfolio-web" | "fund-scale-web";
  title: string;
  /** External source when one exists. Internal frozen evidence may be hash-only. */
  sourceUrl?: string;
  capturedAt: string;
  contentHash: string;
  /** Fingerprint of a provider dataset/index when the source URL is mutable. */
  sourceContentHash?: string;
  publishedAt?: string;
  excerpt?: string;
  match: "exact_name" | "exact_handle" | "candidate" | "no_match" | "observed" | "risk_signal" | "screened_clear" | "relationship_confirmed" | "fund_scale_confirmed";
  /** Explicit failed/partial collection state when `match` alone is ambiguous. */
  coverageState?: "unavailable";
  /** Structured relationship fields are present only for portfolio evidence. */
  relationship?: "invested_in";
  subjectName?: string;
  subjectHandle?: string;
  projectName?: string;
  projectHandle?: string;
  projectDomain?: string;
  sourceClass?: "first_party_subject" | "first_party_investor" | "first_party_project" | "public_primary" | "independent_press" | "other_public";
  investorEntityName?: string;
  investorEntityHandle?: string;
  investorEntityDomain?: string;
  /** Frozen provider-profile proof that binds the fund handle to its official domain. */
  investorDomainSourceUrl?: string;
  investorDomainSourceContentHash?: string;
  investorDomainCapturedAt?: string;
  investorDomainSourceKind?: "provider_profile";
  investorDomainProfileName?: string;
  investorDomainProfileWebsite?: string;
  attribution?: "direct_subject" | "affiliated_fund";
  /** Source that grounds person→fund affiliation separately from the deal page. */
  attributionSourceUrl?: string;
  attributionSourceContentHash?: string;
  attributionCapturedAt?: string;
  attributionSourceKind?: "provider_profile" | "verified_venture";
  /** Present only on source-fetched, identity-bound fund-size artifacts. */
  fundName?: string;
  fundSizeUsd?: number;
  fundVehicle?: string;
  fundScaleMetric?: "regulatory_aum" | "reported_aum" | "fund_vehicle" | "first_close" | "final_close";
  fundAmountQualifier?: "exact" | "at_least" | "approximate";
  fundScaleBasis?: "regulatory" | "manager_reported" | "press_corroborated";
  fundScaleAsOf?: string;
  fundScaleTemporalState?: "current" | "historical" | "fixed_historical" | "unknown";
  fundScaleSourceCount?: number;
  fundScaleClaimId?: string;
}

/**
 * Model-discovered portfolio candidates. These stay outside scoring and the
 * trust graph until a collector fetches a cited page and verifies the relation.
 */
export interface PortfolioLead {
  projectName: string;
  projectHandle?: string;
  projectDomain?: string;
  investorEntityName?: string;
  investorEntityHandle?: string;
  attribution?: "direct_subject" | "affiliated_fund";
  relationship: "invested_in";
  stage?: string;
  year?: string;
  ticker?: string;
  contract?: string;
  chain?: string;
  sources: { url: string; title?: string }[];
  evidence_origin: "model_lead";
  artifact_verified: false;
  provider: "grok";
}

export type ProfilePhotoClassification =
  | "real_candid"
  | "studio_or_stock"
  | "ai_generated"
  | "celebrity_or_public_figure"
  | "logo_or_cartoon"
  | "no_photo"
  | "unclear";

/** Frozen result from the exact profile-image bytes inspected before scoring. */
export interface ProfileAuthenticityResult {
  provider: "claude-vision" | "grok-vision" | "twitterapi";
  capturedAt: string;
  imageUrl?: string;
  /** Exact bytes inspected, retained with the immutable report for replay. */
  imageData?: string;
  mediaType?: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  imageContentHash?: string;
  classification: ProfilePhotoClassification;
  confidence?: number;
  isRealPerson?: boolean;
  flag: boolean;
  tells: string[];
  note: string;
}

export interface FrozenTrustGraphTie {
  key: string;
  label: string;
  type: string;
  strength: "hard" | "medium" | "weak";
  subjectEdgeTypes: string[];
  otherEdgeTypes: string[];
}

export interface FrozenTrustGraphConnection {
  other: string;
  otherReportVersionId?: string;
  otherAttestation?: "server_collected" | "analyst_submitted" | "legacy_unattested";
  otherCompleteness?: "complete" | "partial" | "failed";
  otherVerdict?: string;
  qualified: boolean;
  direct: boolean;
  ties: FrozenTrustGraphTie[];
}

/** Organization-scoped graph reconciliation frozen before analyst scoring. */
export interface TrustGraphScreen {
  provider: "argus-graph";
  capturedAt: string;
  status: "clear" | "risk" | "incomplete";
  contributionCount: number;
  qualifiedContributionCount: number;
  sourceContentHash: string;
  severity?: "avoid" | "caution";
  line: string;
  connections: FrozenTrustGraphConnection[];
  riskEntities?: { key: string; label: string }[];
}

export type BasicFactPredicate =
  | "official_identity"
  | "current_role"
  | "prior_role"
  | "education"
  | "product"
  | "founder"
  | "executive"
  | "founded"
  | "launched"
  | "exit"
  | "track_record"
  | "official_token"
  | "public_security"
  | "network"
  | "legal_entity"
  | "legal_regulatory_event"
  | "security_incident"
  | "funding"
  | "investor"
  | "partnership"
  | "governance"
  | "control"
  | "conflict_of_interest"
  | "tokenomics"
  | "vesting"
  | "treasury"
  | "audit"
  | "repository"
  | "traction";

/**
 * Normalize formatting that cannot change the meaning of one atomic fact.
 * A leading `$` is conventional ticker notation, so `JUP` and `$JUP` are the
 * same official token. Dollar signs remain significant for every other
 * predicate, including funding and traction amounts.
 */
export function canonicalBasicFactComparisonValue(predicate: string, value: string): string {
  const normalized = value.trim().toLowerCase();
  return predicate.trim().toLowerCase() === "official_token"
    ? normalized.replace(/^\$+\s*/, "")
    : normalized;
}

export type BasicFactStatus =
  | "verified"
  | "corroborated"
  | "conflicted"
  | "lead"
  | "unresolved"
  | "not_applicable";

export interface BasicFactSource {
  url: string;
  title?: string;
  sourceClass: "official_subject" | "official_counterparty" | "regulatory_or_onchain" | "independent_press" | "other_public";
  relation: "supports" | "contradicts";
  excerpt: string;
  contentHash: string;
  capturedAt: string;
  provider: string;
  artifactVerified: true;
}

/** A source-fetched foundational answer. Model agreement alone never creates one. */
export interface BasicFact {
  factId: string;
  subjectKey: string;
  predicate: BasicFactPredicate;
  value: string;
  normalizedValue: string;
  status: BasicFactStatus;
  critical: boolean;
  sources: BasicFactSource[];
  /**
   * True for facts re-derived every run from live provider snapshots (market
   * captures, TVL, fees). Excluded from knowledge-base reuse and write-back:
   * a reused copy is both stale and a duplicate that compounds across scans.
   */
  providerProjection?: boolean;
  qualifier?: string;
  /** Stable role-aware research question that produced the verified answer. */
  questionId?: string;
  /** Preserved only when the fetched passage states the event status verbatim. */
  eventStatus?: string;
  /** Exact person, project, or legal entity to which the source attributes an event. */
  attributedEntity?: string;
  /** Whether that exact attributed entity is the audited subject or only related context. */
  attributionScope?: "direct_subject" | "related_entity" | "identity_unresolved";
  evidence_origin: "deterministic";
  artifact_verified: true;
  provider: "public-web";
  discoveryProvider?: "claude-web-search" | "grok" | "grounded" | "argus-identity-bootstrap" | "security-audits";
  /**
   * Omitted/true: a strict single-passage fact, eligible to set enforced score
   * FLOORS exactly as today. false: completed via the relaxed web-corroboration
   * recall path (>=2 independent, non-wire, non-self fetched witnesses agreeing
   * on the same anchored claim). A recall fact counts for COVERAGE and readiness
   * but is excluded from score floors, so corroboration can never manufacture a
   * minimum score (preserves the H2 no-floor-from-soft-evidence invariant), and
   * it is surfaced as "web-corroborated", never a strict "confirmed" green.
   */
  floorEligible?: boolean;
}

/** Unverified answer and candidate source. It is never scoreable. */
export interface BasicFactLead {
  subject: string;
  predicate: BasicFactPredicate;
  value: string;
  qualifier?: string;
  /** Stable role-aware research question this candidate attempts to answer. */
  questionId?: string;
  /** Model-suggested event status; never survives unless the fetched passage states it. */
  eventStatus?: string;
  /** Model-suggested attribution; never survives unless the fetched passage states it. */
  attributedEntity?: string;
  excerpt: string;
  sourceUrl: string;
  sourceTitle?: string;
  candidateUrls?: string[];
  /** Whether a model proposed the row or ARGUS derived a bounded candidate. */
  evidence_origin: "model_lead" | "deterministic_bootstrap";
  artifact_verified: false;
  provider: "claude-web-search" | "grok" | "grounded" | "argus-identity-bootstrap" | "security-audits";
}

export interface BasicFactQuestionLedgerEntry {
  /** Stable role-aware question identifier, for example `person.current_role`. */
  questionId: string;
  audience: "person" | "project" | "investor";
  batch: "identity" | "track_record" | "structure_risk";
  predicate: BasicFactPredicate;
  question: string;
  critical: boolean;
  status: "answered" | "unanswered";
  /** Content-addressed facts or deterministic collector records that answer it. */
  answerRefs: string[];
  /** Providers/search passes asked this exact question, without implying success. */
  providerRuns: Array<{
    phase: "primary" | "repair";
    provider: "claude-web-search" | "grok" | "grounded" | "sec-registry" | "test" | "none";
    state: "succeeded" | "partial" | "completed_empty" | "failed" | "skipped";
  }>;
}

// A person behind the project, dug from the website (web/LinkedIn), the account's
// own posts (role-word scan), or its X content. Named-only people are kept — a
// real name with a role is signal even without an X handle to audit.
export interface WebTeamMember {
  name: string;
  handle?: string;
  role: string;
  linkedin?: string;
  evidence?: string;
  source: string; // where it came from: web/LinkedIn search, post role-scan, X content
  /** Exact fetched page that directly supports the person's project role. */
  sourceUrl?: string;
  projects?: { name: string; role?: string }[]; // their OTHER projects (serial-founder web)
  github?: GithubAssessment; // resolved from this member's X handle (gold match only)
  /** Developer profiles linked directly from this person's own X profile. */
  developerProfiles?: Array<{
    provider: "github" | "huggingface";
    url: string;
    sourceUrl: string;
  }>;
  /** Discovery-only model rows stay visible but are excluded from governing scoring. */
  evidence_origin?: EvidenceOrigin;
  artifact_verified?: boolean;
  provider?: string;
  /** Tracks separately when a verified roster row received model-found identity links. */
  identity_link_evidence_origin?: EvidenceOrigin;
  projects_evidence_origin?: EvidenceOrigin;
  /**
   * Set only at the moment this member's handle is bound from the subject
   * account's OWN posts, following edge, or amplification edge (never the
   * website/team-page or a search lead). Deliberately separate from
   * `identity_link_evidence_origin`: the "account doesn't vouch for its team"
   * path flattens that field to `model_lead` for every member, first-party or
   * not, so a gate keyed on it could be silently erased. This marker survives
   * that flattening and is the only thing the avatar/follower enrichment
   * collector gates on.
   */
  handleProvenance?: "subject_first_party";
  /** Trusted-fetch X avatar for a first-party-bound member only; never a bare offered URL. */
  avatarUrl?: string;
  /** sha256 of the fetched avatar image bytes. */
  avatarContentHash?: string;
  avatarCapturedAt?: string;
  followers?: number;
  accountStatus?: "active" | "suspended" | "unavailable";
  enrichmentProvider?: string;
  enrichmentSourceUrl?: string;
}

export interface VentureTeamInput {
  key: string;
  name: string;
  people: { name: string; handle?: string; role?: string }[];
  evidence_origin?: EvidenceOrigin;
  artifact_verified?: boolean;
  provider?: string;
}

/** Registry record for the project's official domain (RDAP, free and keyless). */
export interface DomainRegistrationSnapshot {
  domain: string;
  /** Exact official hostname supplied to the RDAP collector before registrable-domain reduction. */
  hostname?: string;
  registeredAt: string;
  ageMonths: number;
  source: string;
  capturedAt: string;
}

/** When a project's public surfaces first existed, bracketed by two independent dates. */
export interface LaunchWindowSnapshot {
  earliest: string;
  earliestSource: "domain" | "account";
  latest: string;
  latestSource: "domain" | "account";
  gapMonths: number;
  summary: string;
}

export interface CollectedEvidence {
  profile: SubjectProfile;
  roles: SubjectClass[];
  ventures: Venture[];
  testimonials: Testimonial[];
  advised: AdvisedProject[];
  wallets: Wallet[];
  promotions: Promotion[];
  clientEngagements: ClientEngagement[];
  associates: AssociateInput[];
  findings: Finding[];
  axes: AxisInput[];
  /** Present on new live reports whose model scores carry strict artifact refs. */
  axisCitationVersion?: 1;
  /** Frozen registry from the exact scorer packet; never reconstructed later. */
  axisEvidenceCatalog?: AxisEvidenceRecord[];
  /** Deterministic PROJECT maturity bands derived from that same frozen packet. */
  projectStrengthBands?: Record<string, ProjectStrengthBandRecord>;
  headline: string;
  recentActivity: string[]; // recent post text, fuel for claim extraction
  notableFollowers: NotableFollower[]; // respected accounts that follow the subject
  contradictions: Contradiction[]; // internal contradictions across materials
  sourceArtifacts: SourceArtifact[]; // immutable off-chain sources collected before scoring
  portfolioLeads?: PortfolioLead[]; // cited discovery candidates; never governing evidence
  profileAuthenticity?: ProfileAuthenticityResult;
  trustGraphScreen?: TrustGraphScreen;
  /** Verified project-owned token identity and frozen market snapshot. */
  projectToken?: ProjectTokenSnapshot;
  /**
   * Fixed-block direct RPC observations for the verified canonical EVM token.
   * This lane is point-in-time context only and has no v1 scoring impact.
   */
  evmControlReality?: EvmControlRealitySnapshot;
  /** Frozen public funding rounds + lead investors (DeFiLlama). Feeds P4. */
  protocolFunding?: ProtocolFundingSnapshot;
  /**
   * A FOUNDER subject's verified-venture canonical token, resolved with the
   * same official-X / official-domain binding a project audit uses but scoped
   * to the venture's own bridge keys. Deliberately NOT projectToken: a person
   * must never inherit the PROJECT role or project-market facts from a
   * venture's token.
   */
  ventureToken?: VentureTokenSnapshot;
  /** Frozen total value locked + per-chain usage (DeFiLlama). Feeds P5. */
  protocolTvl?: ProtocolTvlSnapshot;
  /** Frozen protocol fee totals (DeFiLlama). A second dated usage metric for P5. */
  protocolFees?: ProtocolFeesSnapshot;
  /** Frozen float-control profile for the verified canonical token (GoPlus holder register). */
  holderProfile?: HolderProfileSnapshot;
  /** Frozen upcoming-unlock schedule for the verified canonical token (CryptoRank; dormant until keyed). */
  tokenUnlocks?: TokenUnlocksSnapshot;
  /** Frozen independent-audit evidence (auditor-domain corroborated vs self-attested). */
  securityAudits?: SecurityAuditsSnapshot;
  /** Frozen keyed private-market enrichment (Monid/Akta): funding, leadership, firmographic. */
  companyEnrichment?: CompanyEnrichmentSnapshot;
  /** Required foundational answers backed by independently fetched pages. */
  basicFacts?: BasicFact[];
  /** Search-model suggestions retained separately until source verification succeeds. */
  basicFactLeads?: BasicFactLead[];
  /** Role-specific questions and their verified answer/gap state for this scan. */
  basicFactQuestionLedger?: BasicFactQuestionLedgerEntry[];
  /** Evidence-aware delegation plan frozen with the scan for auditability. */
  researchPlan?: import("../lib/researchDirector").ResearchPlan;
  /**
   * Roles the subject's own employment record has CLOSED, with the date it
   * ends. A founder who quietly stopped listing a venture is a finding no
   * team page shows; the record states the end date and nothing about why.
   */
  employmentDepartures?: { company: string; summary: string; ended?: string }[];
  /**
   * Whether each named founder/C-level leader still lists this project as a
   * current role, and the end date when they do not. Paid, bounded lookup.
   */
  leaderDepartures?: { name: string; role: string; linkedin?: string; state: "current" | "departed" | "absent"; summary: string; ended?: string }[];
  /** Official-domain registration record, and the launch window it brackets with the account age. */
  domainRegistration?: DomainRegistrationSnapshot;
  launchWindow?: LaunchWindowSnapshot;
  webTeam?: WebTeamMember[]; // people dug from the site + posts (the auto-pivot)
  // Second-hop: the people behind the subject's top ventures (subject → venture →
  // its team). `key` is the venture's canonical graph key so the edges attach to
  // the same node the venture already occupies.
  ventureTeams?: VentureTeamInput[];
}

export function emptyEvidence(handle: string): CollectedEvidence {
  const u = handle.replace(/^@/, "");
  return {
    profile: {
      handle: handle.startsWith("@") ? handle : "@" + u,
      display_name: u,
      avatar: u.slice(0, 1).toUpperCase(),
      bio: "",
      followers: "N/A",
      joined: "N/A",
      identity_confidence: "Unverified",
      identity_note: "No identity resolution available.",
      profile_collection_state: "unavailable",
    },
    roles: [],
    ventures: [],
    testimonials: [],
    advised: [],
    wallets: [],
    promotions: [],
    clientEngagements: [],
    associates: [],
    findings: [],
    axes: [],
    webTeam: [],
    headline: "",
    recentActivity: [],
    notableFollowers: [],
    contradictions: [],
    sourceArtifacts: [],
    portfolioLeads: [],
    basicFacts: [],
    basicFactLeads: [],
    basicFactQuestionLedger: [],
  };
}
