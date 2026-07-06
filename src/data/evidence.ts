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
} from "../engine";

export interface SubjectProfile {
  handle: string;
  display_name: string;
  avatar: string;
  avatar_url?: string; // real X profile photo URL, when resolved (else derive from handle)
  bio: string;
  followers: string;
  joined: string;
  identity_confidence: IdentityConfidence;
  identity_note: string;
  prior_handles?: string[]; // past X usernames for the same account id (rebrands)
  last_post_at?: string;    // ISO time of the most recent tweet (dormancy signal)
  days_since_post?: number; // days since that post, computed at collect time
  identity_emails?: string[]; // PDL-resolved emails — bridge to leaked GitHub commit emails
}

export interface AxisInput {
  axis: string;
  score: number;
  rationale: string;
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
  headline: string;
  recentActivity: string[]; // recent post text, fuel for claim extraction
  notableFollowers: NotableFollower[]; // respected accounts that follow the subject
  contradictions: Contradiction[]; // internal contradictions across materials
  webTeam?: WebTeamMember[]; // people dug from the site + posts (the auto-pivot)
  // Second-hop: the people behind the subject's top ventures (subject → venture →
  // its team). `key` is the venture's canonical graph key so the edges attach to
  // the same node the venture already occupies.
  ventureTeams?: { key: string; name: string; people: { name: string; handle?: string; role?: string }[] }[];
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
  };
}
