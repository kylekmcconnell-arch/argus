import type { ReactNode } from "react";
import type { ChapterId, HolderRow, PersonContacts, ReportIssue, Tone } from "./model";
import type { IntelligenceQuestion, IntelligenceSourceRef } from "../../intelligence/types";
import type { SocialActivitySnapshot } from "../../data/socialActivity";

/* The presentation contract every chapter reads. Adapters build it from one
   frozen report version; chapters never reach back into the scoring engine.
   Absent evidence is represented by an absent field, never a zero. */

export interface ScoreRowView {
  key: string;
  label: string;
  awarded: number;
  max: number;
  rationale: string;
  /** Recorded counter-evidence and open questions for this area. */
  review: string[];
  supportCount?: number;
  chapter?: ChapterId;
  applicability?: "not_applicable" | "deferred" | "unassessed";
  note?: string;
  band?: { min: number; max: number; tier?: string } | null;
}

export interface ScoreView {
  id: "company" | "person" | "token";
  eyebrow: string;
  score: number | null;
  verdict: string | null;
  verdictWord: string;
  tone: Tone;
  foot: string;
  rows: ScoreRowView[];
  arithmetic: string;
  provisional: boolean;
  /** A score that exists but is not published (INCOMPLETE, routing unresolved …). */
  withheldReason?: string;
  /** Token leg deferred or provisional under the applicability rules. */
  deferredReason?: string;
  /** What the other lens / scale says, when one exists. */
  scaleNote?: string;
  /** Report status and any preliminary signal when the result is not final. */
  status?: string | null;
}

export interface NextStep { id: string; title: string; detail?: string; chapter: ChapterId }

export interface LensView {
  key: "Investor" | "Trader" | "Founder";
  eyebrow: string;
  title: string;
  body: string;
  foundation: { text: string; sources: SourceCard[] } | null;
  uncertainty: { title: string; text: string; detail: ReactNode; chapter: ChapterId } | null;
  change: { text: string } | null;
  nextHeading: string;
  tasks: NextStep[];
}

export interface Metric { label: string; value: string; note?: string }

export interface SourceCard {
  id: string;
  title: string;
  tier: string;
  tone?: Tone;
  excerpt: string;
  url?: string | null;
  provider?: string;
  capturedAt?: string | null;
  evidenceState?: string;
}

export interface QuestionView {
  id: string;
  domain: string;
  prompt: string;
  state: IntelligenceQuestion["state"];
  materiality?: IntelligenceQuestion["materiality"];
}

export interface PersonCardView {
  key: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
  badge: { label: string; tone: Tone };
  text: string;
  contacts: PersonContacts;
  sourceUrl?: string | null;
  sourceLabel: string;
  developerProfiles?: Array<{ label: string; url: string; proofUrl?: string | null }>;
}

export interface ConnectionView {
  key: string;
  name: string;
  group: "People" | "Backers" | "Advisors" | "Assets" | "Identity";
  role: string;
  tier: string;
  detail: string;
  url?: string | null;
  source?: SourceCard | null;
}

export interface TimelineEvent { key: string; when: string; sort: string; label: string; text: string }

export interface ProductClaim { key: string; title: string; text: string; badge: { label: string; tone: Tone }; sourceUrl?: string | null; sourceLabel?: string }

export interface RepoView { name: string; language?: string | null; lastPush?: string | null; stars?: number | null; url?: string | null; fork?: boolean }

export interface TokenIdentity {
  symbol: string;
  chain: string;
  address: string;
  pairAddress?: string | null;
  coingeckoId?: string | null;
  xHandle?: string | null;
  website?: string | null;
}

export interface MarketView {
  capturedAt?: string | null;
  metrics: Metric[];
  holders: {
    addresses: HolderRow[];
    wallets: HolderRow[];
    walletsNote?: string | null;
    combinedAssessedPct?: number | null;
    largestLabel?: string | null;
    sourceUrl?: string | null;
  } | null;
  supply: {
    circulating?: number | null;
    total?: number | null;
    circulatingPct?: number | null;
    burnedPct?: number | null;
  } | null;
  facts: Metric[];
  lockNote?: string | null;
  trading: Array<{ label: string; value: string }>;
  tradingNote?: string | null;
  control: {
    facts: Metric[];
    note?: string | null;
    limitation?: string | null;
  } | null;
  cexCoverage?: string | null;
}

export interface SocialView {
  snapshot: SocialActivitySnapshot;
  handleHistory: { label: string; tone: Tone; note: string };
}

export interface EvidenceView {
  collection: { successful: number; applicable: number } | null;
  questions: QuestionView[];
  sources: SourceCard[];
  referenceCount: number;
  uniqueArtifacts: number;
  missingCaptureTime: number;
  criticalGaps: string[];
  providerIssues: string[];
  intelligenceSources?: IntelligenceSourceRef[];
}

export interface ReportView {
  subjectName: string;
  subjectKind: "project" | "person" | "token";
  handle?: string | null;
  avatarUrl?: string | null;
  eyebrow: string;
  productLabel?: string | null;
  summary: string;
  website?: string | null;
  xHandle?: string | null;
  token?: TokenIdentity | null;
  savedLine: string;
  savedAt?: string | null;
  version?: number;
  caseLabel?: string | null;
  auditId: string;
  primary: ScoreView | null;
  tokenScore: ScoreView | null;
  issues: ReportIssue[];
  lenses: LensView[];
  researchStatus: Array<{ lead: string; text: string }>;
  /** The required-check register: finished vs open, with each open check's saved note. */
  checkRail: {
    successful: number;
    applicable: number;
    open: Array<{ label: string; note?: string }>;
    legacyNote?: string | null;
  } | null;
  /** Unverified adverse leads that name the subject directly. Never scored, never hidden. */
  leadBanner: { title: string; body: string } | null;
  category?: { label: string; basis: string } | null;
  identity?: { label: string; tone: Tone } | null;
  metrics: Metric[];
  bands: Array<{ label: string; awarded: number; max: number; band: string }>;
  applicability?: { tokenAwarded: number; tokenMax: number; total: number; max: number; excluded?: string } | null;
  product: {
    heading: string;
    description: string;
    tags: string[];
    claims: ProductClaim[];
    repos: RepoView[];
    repoSummary?: string | null;
    repoHeading: string;
    repoNote?: string | null;
    auditStatus: string;
    timeline: TimelineEvent[];
    historyLead?: { title: string; text: string } | null;
  };
  people: {
    cards: PersonCardView[];
    verificationConflict?: string | null;
    continuity: Array<{ label: string; value: string }>;
    control: string;
    identityNote?: string | null;
    identity?: { label: string; tone: Tone } | null;
  };
  market: MarketView | null;
  social: SocialView | null;
  connections: {
    items: ConnectionView[];
    funding: { heading: string; detail: string; tags: string[]; note: string; sourceUrl?: string | null } | null;
    graph: { qualified: number; total: number; line: string; leadsNote?: string | null } | null;
  };
  evidence: EvidenceView;
  totals: { company?: string; token?: string };
}
