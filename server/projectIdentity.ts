import type { BasicFact, CollectedEvidence } from "../src/data/evidence";
import { classifySubject, SubjectClass } from "../src/engine";
import { canonicalOfficialWebsite } from "../src/lib/fundScaleEvidence";

export interface VerifiedOfficialProjectIdentity {
  fact: BasicFact;
  website: {
    domain: string;
    canonicalUrl: string;
  };
}

/**
 * Recover a project identity from a previously verified first-party fact.
 *
 * Suspended X accounts have no live bio or website metadata. A fresh scan may
 * therefore begin on the person question set even though an earlier scan
 * already froze an exact official-site ↔ handle binding. Reusing that verified
 * fact must also restore the routing context that made the fact meaningful.
 */
export function verifiedOfficialProjectIdentity(
  evidence: CollectedEvidence,
  facts: readonly BasicFact[] = evidence.basicFacts ?? [],
): VerifiedOfficialProjectIdentity | null {
  if (evidence.profile.identity_confidence === "SuspectedImpersonation") return null;
  for (const fact of facts) {
    if (
      fact.predicate !== "official_identity"
      || fact.artifact_verified !== true
      || (fact.status !== "verified" && fact.status !== "corroborated")
    ) continue;
    const projectQuestion = fact.questionId?.startsWith("project.") === true;
    const projectValue = classifySubject(fact.value).applicable_classes.includes(SubjectClass.PROJECT);
    if (!projectQuestion && !projectValue) continue;
    for (const source of fact.sources) {
      if (
        source.sourceClass !== "official_subject"
        || source.relation !== "supports"
        || source.artifactVerified !== true
      ) continue;
      const website = canonicalOfficialWebsite(source.url);
      if (website) return { fact, website };
    }
  }
  return null;
}

export function hydrateOfficialProjectIdentityFromFacts(
  evidence: CollectedEvidence,
  facts: readonly BasicFact[] = evidence.basicFacts ?? [],
): VerifiedOfficialProjectIdentity | null {
  const recovered = verifiedOfficialProjectIdentity(evidence, facts);
  if (!recovered) return null;
  if (!canonicalOfficialWebsite(evidence.profile.website)) {
    evidence.profile.website = recovered.website.canonicalUrl;
  }
  const currentName = evidence.profile.display_name.trim();
  const handleName = evidence.profile.handle.replace(/^@/, "").toLowerCase();
  if (
    evidence.profile.profile_collection_state !== "resolved"
    || !currentName
    || currentName.toLowerCase() === handleName
  ) {
    evidence.profile.display_name = recovered.fact.value.trim();
  }
  evidence.profile.identity_confidence = "Confirmed";
  evidence.profile.identity_note = `${recovered.fact.value.trim()} is bound to ${recovered.website.domain} by a verified first-party identity artifact.`;
  if (!evidence.roles.includes(SubjectClass.PROJECT)) {
    evidence.roles = [...evidence.roles, SubjectClass.PROJECT];
  }
  return recovered;
}
