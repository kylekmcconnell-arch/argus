/**
 * One definition of how strong a piece of evidence is.
 *
 * "Verified" was being reconstructed independently in at least four places -
 * the scoring bands, the project check writer, the person report roster and
 * the key-facts panel - and the definitions had drifted apart. The panel
 * omitted `artifact_verified`, so a fact whose artifact was never fetched
 * could be counted as an answered question; the server omitted the
 * attribution check, so a fact ARGUS could not tie to the subject could mint
 * a score floor. One report therefore said four people were verified while
 * its own checks recorded that seven founder records had failed strict
 * verification, and its key facts said zero were confirmed (ARGUS-04/09 in
 * the 2026-09-18 report audit, issue #472).
 *
 * Every surface that publishes the word "verified", and every scoring floor,
 * now reads the tier from here. Nothing in this module fetches or mutates;
 * it only classifies what a collector already recorded.
 *
 * DOM-less on purpose: this file compiles under the server tsconfig too.
 */

/** Strongest first. A fact holds exactly one tier. */
export type EvidenceTier =
  /** Artifact-backed, verified or corroborated, subject-attributed, floor eligible. */
  | "strict_verified"
  /** Artifact-backed, but ceiling-only, projected from a provider record, or not tied to the subject. */
  | "source_reported"
  /** A model suggested it and nothing was fetched. */
  | "model_lead"
  /** Collected but never reached a usable state. */
  | "unverified";

/** Structural, so packet records, BasicFact and BasicFactView all fit. */
export interface EvidenceTierFact {
  status?: unknown;
  artifact_verified?: unknown;
  providerProjection?: unknown;
  floorEligible?: unknown;
  attributionScope?: unknown;
  evidence_origin?: unknown;
}

export interface TeamMemberTier {
  evidence_origin?: unknown;
  artifact_verified?: unknown;
}

const isModelLead = (origin: unknown): boolean => origin === "model_lead";

/**
 * An artifact was fetched and read, and the claim survived that read. This is
 * the retention bar: below it a record is investigator context, never
 * evidence ARGUS reasons from.
 */
export function isRetainedSourceFact(fact: EvidenceTierFact): boolean {
  return fact.artifact_verified === true
    && (fact.status === "verified" || fact.status === "corroborated");
}

/**
 * The bar for publishing the word "verified" and for minting a score floor.
 *
 * Beyond retention it additionally requires that the record is not a licensed
 * provider's own projection, is not marked ceiling-only, and is actually
 * attributed to the subject. A record ARGUS cannot tie to this subject is
 * real evidence about someone; it is not an answer about them.
 */
export function isStrictlyVerifiedFact(fact: EvidenceTierFact): boolean {
  return isRetainedSourceFact(fact)
    && fact.providerProjection !== true
    && fact.floorEligible !== false
    && fact.attributionScope !== "identity_unresolved";
}

export function factEvidenceTier(fact: EvidenceTierFact): EvidenceTier {
  if (isStrictlyVerifiedFact(fact)) return "strict_verified";
  if (isRetainedSourceFact(fact)) return "source_reported";
  if (isModelLead(fact.evidence_origin)) return "model_lead";
  return "unverified";
}

/**
 * A roster row backed by something ARGUS fetched, rather than a name a model
 * produced. This is deliberately NOT called "verified": it means a source
 * carried the person, not that their current role was independently
 * confirmed, which is a separate check.
 */
export function isSourceGroundedTeamMember(member: TeamMemberTier): boolean {
  return member.artifact_verified === true && !isModelLead(member.evidence_origin);
}

export function teamMemberEvidenceTier(member: TeamMemberTier): EvidenceTier {
  if (isSourceGroundedTeamMember(member)) return "source_reported";
  if (isModelLead(member.evidence_origin)) return "model_lead";
  return "unverified";
}

/** Reader-facing wording. Never says "verified" for anything below the strict bar. */
export function evidenceTierLabel(tier: EvidenceTier): string {
  switch (tier) {
    case "strict_verified": return "verified against a saved source";
    case "source_reported": return "source-grounded, current role not independently confirmed";
    case "model_lead": return "model lead, nothing fetched";
    default: return "not established";
  }
}
