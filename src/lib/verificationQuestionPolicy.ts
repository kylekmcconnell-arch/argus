import type { Dossier } from "../data/dossier";

type CheckLike = {
  checkId?: string | null;
  label?: string | null;
  note?: string | null;
  provider?: string | null;
};

function normalizedHandle(value: string | null | undefined): string {
  return (value ?? "").replace(/^@/, "").trim().toLowerCase();
}

/**
 * True when the saved dossier already contains a provider-resolved account
 * bound to a concrete project/domain. A stale open-question ledger may remain
 * auditable, but it must not ask the reader to identify a subject we resolved.
 */
export function hasBoundProjectIdentity(
  dossier: Pick<Dossier, "handle" | "profile_collection_state" | "profile_provider" | "subjectOrientation">,
): boolean {
  const orientation = dossier.subjectOrientation;
  if (!orientation || orientation.kind !== "PROJECT" || !orientation.boundDomain) return false;
  if (dossier.profile_collection_state !== "resolved") return false;
  if (!/twitterapi/i.test(dossier.profile_provider ?? "")) return false;
  const auditedHandle = normalizedHandle(dossier.handle);
  return auditedHandle.length > 0 && auditedHandle === normalizedHandle(orientation.boundHandle);
}

/**
 * Coverage and attestation diagnostics remain visible in methodology. They are
 * not unanswered facts about the subject and therefore do not belong in the
 * reader's decision-changing question list.
 */
export function isReaderDecisionCheck(check: CheckLike): boolean {
  if (check.checkId === "trust-graph-connections") return false;
  const diagnostic = [check.label, check.note, check.provider].filter(Boolean).join(" ").toLowerCase();
  if (/active case projection|immutable report|incompletely attested|source-link check|integrity gate/.test(diagnostic)) {
    return false;
  }
  return true;
}
