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
 * True when subject orientation binds the audited handle to a concrete project
 * and official domain. Orientation is itself built only from bound artifacts;
 * older saved dossiers do not always retain the profile-provider metadata.
 */
export function hasBoundProjectIdentity(
  dossier: Pick<Dossier, "handle" | "profile_collection_state" | "profile_provider" | "subjectOrientation">,
): boolean {
  const orientation = dossier.subjectOrientation;
  if (!orientation || orientation.kind !== "PROJECT" || !orientation.boundDomain) return false;
  const auditedHandle = normalizedHandle(dossier.handle);
  return auditedHandle.length > 0 && auditedHandle === normalizedHandle(orientation.boundHandle);
}

/** True when the bound orientation already explains what the project does. */
export function hasBoundProjectDescription(
  dossier: Pick<Dossier, "handle" | "profile_collection_state" | "profile_provider" | "subjectOrientation">,
): boolean {
  if (!hasBoundProjectIdentity(dossier)) return false;
  const description = dossier.subjectOrientation?.what.replace(/\s+/g, " ").trim() ?? "";
  return description.length >= 24;
}

/**
 * Coverage and attestation diagnostics remain visible in methodology. They are
 * not unanswered facts about the subject and therefore do not belong in the
 * reader's decision-changing question list.
 *
 * The test is the diagnostic note, never the check id. Excluding every
 * trust-graph row outright silenced a genuinely unfinished decision-critical
 * check: the report told the reader that Known connections had to finish before
 * it was ready, then filled "What is still open" with lower-priority research
 * instead of naming the one check that was actually blocking.
 */
export function isReaderDecisionCheck(check: CheckLike): boolean {
  const diagnostic = [check.label, check.note, check.provider].filter(Boolean).join(" ").toLowerCase();
  if (/active case projection|immutable report|incompletely attested|source-link check|integrity gate/.test(diagnostic)) {
    return false;
  }
  return true;
}
