// Shared evidence shape — the bag a collector (live adapters OR a fixture) fills,
// from which the engine produces a verdict. Lives in src/ so both the client and
// the Node server import the same types.

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

export interface SubjectProfile {
  handle: string;
  display_name: string;
  resolved_name?: string; // licensed/deterministic real name; display name remains untouched for UX
  avatar: string;
  avatar_url?: string; // real X profile photo URL, when resolved (else derive from handle)
  avatar_source_state?: "resolved" | "none"; // explicit twitterapi outcome; absence means collection was unavailable
  website?: string;    // independently resolved first-party site, when available
  bio: string;
  followers: string;
  joined: string;
  identity_confidence: IdentityConfidence;
  identity_note: string;
  prior_handles?: string[]; // past X usernames for the same account id (rebrands)
  last_post_at?: string;    // ISO time of the most recent tweet (dormancy signal)
  days_since_post?: number; // days since that post, computed at collect time
  identity_emails?: string[]; // PDL-resolved emails — bridge to leaked GitHub commit emails
  /** A placeholder handle is not provider evidence until this is `resolved`. */
  profile_collection_state?: "resolved" | "unavailable";
  /** Provider that returned the frozen profile, when collection succeeded. */
  profile_provider?: string;
  /** Capture time for the provider-returned profile. */
  profile_captured_at?: string;
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
  scope: "direct_subject" | "subject_context";
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
}

// A provider artifact frozen into the report that was available to the analyst
// before scoring. These records are deliberately neutral about identity: a
// court-caption or sanctions-name match is a lead tied to a source, not proof
// that the named person is the audited subject.
export interface SourceArtifact {
  kind: "press" | "legal_case" | "sanctions_screen" | "profile_photo" | "trust_graph" | "portfolio_relationship" | "fund_scale";
  provider: "google-news" | "courtlistener" | "opensanctions" | "claude-vision" | "twitterapi" | "argus-graph" | "portfolio-web" | "fund-scale-web";
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
  provider: "claude-vision" | "twitterapi";
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
  projects?: { name: string; role?: string }[]; // their OTHER projects (serial-founder web)
  /** Discovery-only model rows stay visible but are excluded from governing scoring. */
  evidence_origin?: EvidenceOrigin;
  artifact_verified?: boolean;
  provider?: string;
  /** Tracks separately when a verified roster row received model-found identity links. */
  identity_link_evidence_origin?: EvidenceOrigin;
  projects_evidence_origin?: EvidenceOrigin;
}

export interface VentureTeamInput {
  key: string;
  name: string;
  people: { name: string; handle?: string; role?: string }[];
  evidence_origin?: EvidenceOrigin;
  artifact_verified?: boolean;
  provider?: string;
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
  headline: string;
  recentActivity: string[]; // recent post text, fuel for claim extraction
  notableFollowers: NotableFollower[]; // respected accounts that follow the subject
  contradictions: Contradiction[]; // internal contradictions across materials
  sourceArtifacts: SourceArtifact[]; // immutable off-chain sources collected before scoring
  portfolioLeads?: PortfolioLead[]; // cited discovery candidates; never governing evidence
  profileAuthenticity?: ProfileAuthenticityResult;
  trustGraphScreen?: TrustGraphScreen;
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
      followers: "—",
      joined: "—",
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
  };
}
