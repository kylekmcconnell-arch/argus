import type {
  CollectedEvidence,
  TokenApplicabilitySnapshot,
} from "../src/data/evidence";
import type { ScanCheck } from "../src/lib/scanChecklist";

const PRELAUNCH_TOKEN = /\b(?:token|coin)\b[\s\S]{0,45}\b(?:pre[- ]?launch|planned|upcoming|coming soon|will launch|will issue|not yet live|not launched|TGE)\b|\b(?:pre[- ]?launch|planned|upcoming|coming soon|will launch|will issue|not yet live|not launched|TGE)\b[\s\S]{0,45}\b(?:token|coin)\b/i;

const completed = (status: ScanCheck["status"] | undefined): boolean =>
  status === "confirmed" || status === "reported" || status === "finding" || status === "checked-empty";

// A first-party contract the adapter could not bind is a structured evidence
// record, not a phrase in a check note: applicability must not change when
// the adapter rewords its disclosure.
const unresolvedCandidateLine = (evidence: CollectedEvidence): string | null => {
  const candidate = evidence.unresolvedProjectToken;
  if (!candidate) return null;
  switch (candidate.state) {
    case "registry_conflict":
      return `The official X bio declares contract ${candidate.address}, but the identity-bound ${candidate.registry?.provider ?? "registry"} record lists ${candidate.registry?.address ?? "a different contract"}; the two were not reconciled.`;
    case "provider_unavailable":
      return `The official X bio declares contract ${candidate.address}, and the market and registry providers could not complete the read.`;
    default:
      return `The official X bio declares contract ${candidate.address}, and no exact-address market or identity-bound registry record confirms it.`;
  }
};

const continuityHasTokenLineage = (evidence: CollectedEvidence): boolean => {
  const continuity = evidence.entityContinuity;
  if (!continuity) return false;
  return Boolean(
    continuity.predecessorName
    || continuity.oldTicker
    || continuity.oldContract
    || continuity.migrationContract
    || continuity.replacementContract
    || continuity.tokenLineage.length > 0
    || continuity.events.some((event) => event.kind === "token_migration" || event.kind === "contract_replacement"),
  );
};

const prelaunchText = (evidence: CollectedEvidence): string => [
  evidence.profile.bio,
  evidence.profile.self_post_sample,
  evidence.subjectOrientation?.what,
  ...(evidence.basicFacts ?? []).flatMap((fact) => [
    String(fact.value ?? ""),
    ...(fact.sources ?? []).map((source) => source.excerpt),
  ]),
].filter(Boolean).join("\n");

/**
 * Decide whether token conduct applies before constructing the scorecard.
 * A completed identity search may prove there is no project token; it may not
 * manufacture a weak token-conduct score. Provider or identity ambiguity fails
 * closed as provisional instead of being normalized away.
 */
export function deriveTokenApplicability(
  evidence: CollectedEvidence,
  checks: readonly ScanCheck[],
  determinedAt = new Date().toISOString(),
): TokenApplicabilitySnapshot | undefined {
  if (!evidence.roles.some((role) => String(role) === "PROJECT")) return undefined;

  const tokenCheck = checks.find((check) => check.checkId === "project-token-identity");
  const continuity = evidence.entityContinuity;
  const evidenceLines: string[] = [];

  if (evidence.projectToken?.verified) {
    evidenceLines.push(`Canonical token ${evidence.projectToken.symbol} is bound to the official project identity.`);
    if (continuityHasTokenLineage(evidence)) {
      evidenceLines.push(continuity?.coverage.reason ?? "Historical token lineage was recovered before scoring.");
      return {
        state: "historical_token_lineage",
        axisTreatment: "assess",
        reason: "A current token and predecessor or migration evidence exist, so ARGUS assesses the complete token lineage.",
        evidence: evidenceLines,
        determinedAt,
      };
    }
    return {
      state: "verified_live_token",
      axisTreatment: "assess",
      reason: "A live canonical token is verified against the project's official identity.",
      evidence: evidenceLines,
      determinedAt,
    };
  }

  if (continuityHasTokenLineage(evidence)) {
    evidenceLines.push(continuity?.coverage.reason ?? "Historical token lineage was recovered before scoring.");
    return {
      state: "historical_token_lineage",
      axisTreatment: "assess",
      reason: "Historical, migrated, or abandoned token evidence exists, so token conduct remains applicable across the full lineage.",
      evidence: evidenceLines,
      determinedAt,
    };
  }

  if (PRELAUNCH_TOKEN.test(prelaunchText(evidence))) {
    evidenceLines.push("A bound first-party source describes a token as planned or not yet live.");
    if (tokenCheck?.note) evidenceLines.push(tokenCheck.note);
    return {
      state: "prelaunch_token_deferred",
      axisTreatment: "deferred",
      reason: "The project describes a future token, but no live token conduct surface exists yet; P3 is deferred without penalty.",
      evidence: evidenceLines,
      determinedAt,
    };
  }

  const unresolvedLine = unresolvedCandidateLine(evidence);
  if (!tokenCheck || !completed(tokenCheck.status) || unresolvedLine) {
    if (unresolvedLine) evidenceLines.push(unresolvedLine);
    if (tokenCheck?.note) evidenceLines.push(tokenCheck.note);
    return {
      state: "unresolved_token_identity",
      axisTreatment: "provisional",
      reason: "Token identity did not reach a completed, attributable result, so the project verdict remains provisional.",
      evidence: evidenceLines.length ? evidenceLines : ["No completed project-token identity result was frozen."],
      determinedAt,
    };
  }

  if (tokenCheck.note) evidenceLines.push(tokenCheck.note);
  evidenceLines.push("No canonical token is bound to the official project handle or domain.");
  return {
    state: "confirmed_tokenless",
    axisTreatment: "not_applicable",
    reason: "A completed identity-bound token search found no project token; token conduct is not applicable and the project score is normalized over the remaining axes.",
    evidence: evidenceLines,
    determinedAt,
  };
}
