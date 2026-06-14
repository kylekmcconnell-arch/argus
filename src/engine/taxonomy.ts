// ARGUS-P v2 taxonomy — faithful TS port of argus_p/taxonomy.py
//
// The central correction in v2 is that a "person" is not one thing: a founder,
// a KOL, an investor, an agency, and a community member are evaluated against
// different evidence and different failure modes.

export enum SubjectClass {
  FOUNDER = "FOUNDER",
  KOL = "KOL",
  INVESTOR = "INVESTOR",
  ADVISOR = "ADVISOR",
  AGENCY = "AGENCY",
  MEMBER = "MEMBER",
}

// Classes are NOT mutually exclusive. A single subject can hold several roles
// at once (the common case: a builder who also invests and advises). Each held
// role is scored on its own track and the composite verdict is governed by the
// most severe role. Roles are never averaged together.

// Pseudonymity is NOT a flag. Risk lives in behaviour and outcomes (rugs,
// dumping into own promotion, paid-cabal-then-collapse, fabrication,
// impersonation), not in identity state. There is NO hard identity gate on
// pseudonymity. Only genuine impersonation / identity fraud blocks publication.
export const HARD_IDENTITY_GATE_CLASSES: Set<SubjectClass> = new Set();

// Reward for verifiable real-world identity, added to each role's score.
export const DOX_BONUS: Record<string, number> = { Confirmed: 5, Probable: 3 };

// --------------------------------------------------------------------------
// Founder / team controlled vocabularies
// --------------------------------------------------------------------------

export enum VentureOutcome {
  ACTIVE = "Active",
  PAUSED = "Paused",
  IPO = "IPO",
  ACQUISITION = "Acquisition",
  ACQUIHIRE = "Acquihire",
  ORDERLY_WINDDOWN = "OrderlyWindDown",
  FAILURE = "Failure",
  SILENT_SHUTDOWN = "SilentShutdown",
  RUG = "Rug",
  EXPLOIT = "Exploit",
  UNKNOWN = "Unknown",
}

// A public pause is NOT a silent shutdown: SilentShutdown requires evidence of
// abandonment, not merely the absence of a launch the analyst happened to find.
export const NON_TERMINAL = new Set<VentureOutcome>([
  VentureOutcome.ACTIVE,
  VentureOutcome.PAUSED,
  VentureOutcome.UNKNOWN,
]);

export const POSITIVE_OUTCOMES = new Set<VentureOutcome>([
  VentureOutcome.IPO,
  VentureOutcome.ACQUISITION,
]);
export const SEVERE_OUTCOMES = new Set<VentureOutcome>([VentureOutcome.RUG]);
export const NEGATIVE_OUTCOMES = new Set<VentureOutcome>([
  VentureOutcome.SILENT_SHUTDOWN,
  VentureOutcome.RUG,
]);

export enum FounderPattern {
  SERIAL_SUCCESS = "SerialSuccess",
  PROVEN_ONCE = "ProvenOnce",
  MIXED = "Mixed",
  SERIAL_FAILURE = "SerialFailure",
  RUG_HISTORY = "RugHistory",
  UNPROVEN = "Unproven",
  FIRST_VENTURE = "FirstVenture",
}

export function classifyFounderPattern(
  outcomes: (VentureOutcome | string)[],
): FounderPattern {
  const outs = outcomes.map((o) => o as VentureOutcome);
  const completed = outs.filter((o) => !NON_TERMINAL.has(o));

  if (outs.some((o) => SEVERE_OUTCOMES.has(o))) return FounderPattern.RUG_HISTORY;
  if (outs.length === 0) return FounderPattern.FIRST_VENTURE;
  if (completed.length === 0) return FounderPattern.UNPROVEN;

  const successes = completed.filter((o) => POSITIVE_OUTCOMES.has(o)).length;
  const failures = completed.filter(
    (o) => o === VentureOutcome.SILENT_SHUTDOWN || o === VentureOutcome.FAILURE,
  ).length;

  if (successes >= 2 && failures === 0) return FounderPattern.SERIAL_SUCCESS;
  if (successes === 1 && failures === 0) return FounderPattern.PROVEN_ONCE;
  if (successes === 0 && failures >= 2) return FounderPattern.SERIAL_FAILURE;
  if (successes >= 1 && failures >= 1) return FounderPattern.MIXED;
  return FounderPattern.UNPROVEN;
}

export interface VentureRecord {
  outcome?: VentureOutcome | string;
  investors?: string[];
  acquirer?: string | null;
  current_backers?: string[];
}

export interface RepeatBackingResult {
  repeat_backers: string[];
  from_successful_exit: boolean;
  strength: "none" | "weak" | "strong";
}

const norm = (name: string) => String(name).trim().toLowerCase();

export function repeatBackingSignal(ventures: VentureRecord[]): RepeatBackingResult {
  const current = new Set<string>();
  const repeat = new Set<string>();
  let fromSuccess = false;

  for (const v of ventures) {
    if (v.outcome === VentureOutcome.ACTIVE) {
      for (const b of v.current_backers ?? []) current.add(norm(b));
    }
  }
  for (const v of ventures) {
    const priorParties = new Set<string>((v.investors ?? []).map(norm));
    if (v.acquirer) priorParties.add(norm(v.acquirer));
    const overlap = [...priorParties].filter((p) => current.has(p));
    if (overlap.length) {
      overlap.forEach((o) => repeat.add(o));
      if (POSITIVE_OUTCOMES.has(v.outcome as VentureOutcome)) fromSuccess = true;
    }
  }
  let strength: "none" | "weak" | "strong";
  if (repeat.size === 0) strength = "none";
  else if (fromSuccess) strength = "strong";
  else strength = "weak";

  return {
    repeat_backers: [...repeat].sort(),
    from_successful_exit: fromSuccess,
    strength,
  };
}

// --------------------------------------------------------------------------
// Investor controlled vocabularies
// --------------------------------------------------------------------------

export enum FundTier {
  ANGEL = "Angel",
  SUPER_ANGEL = "SuperAngel",
  LAUNCHPAD = "Launchpad",
  MICRO_VC = "MicroVC",
  VC_TIER3 = "VC_Tier3",
  VC_TIER2 = "VC_Tier2",
  VC_TIER1 = "VC_Tier1",
  UNKNOWN = "Unknown",
}

export const TIER_RANK: Record<FundTier, number> = {
  [FundTier.ANGEL]: 1,
  [FundTier.SUPER_ANGEL]: 2,
  [FundTier.LAUNCHPAD]: 2,
  [FundTier.MICRO_VC]: 3,
  [FundTier.VC_TIER3]: 4,
  [FundTier.VC_TIER2]: 5,
  [FundTier.VC_TIER1]: 6,
  [FundTier.UNKNOWN]: 0,
};

export enum TestimonialVerdict {
  CORROBORATED = "Corroborated",
  PARTIAL = "PartiallyCorroborated",
  UNCONFIRMED = "Unconfirmed",
  CONTRADICTED = "Contradicted",
}

// --------------------------------------------------------------------------
// Shared evidence-status vocabulary (carried from v1, unchanged)
// --------------------------------------------------------------------------

export const IDENTITY_CONFIDENCE = [
  "Confirmed",
  "Probable",
  "Unverified",
  "SuspectedImpersonation",
] as const;
export type IdentityConfidence = (typeof IDENTITY_CONFIDENCE)[number];

export const VERIFICATION_STATUS = ["Verified", "Reported", "Rumor"] as const;
export const WALLET_LINK_TIERS = ["SelfDoxxed", "InvestigatorAttributed", "Inferred"] as const;
export const PROMO_DISCLOSURE = ["Disclosed", "Undisclosed", "Unknown"] as const;
