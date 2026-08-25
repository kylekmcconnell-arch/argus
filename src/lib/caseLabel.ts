/** Public case identity shown in report headers and case chips. */

export interface ReportIdentity {
  /** Stable label for the durable case. Same across rescans of one case. */
  caseLabel: string | null;
  /** Per-version audit fingerprint. Changes on every scan by design. */
  reportId: string | null;
}

const PA_PREFIX = /^PA-/i;
const HEX_ID = /^[0-9a-f]{20,}$/i;

/**
 * Format a durable case id as the public PA- label.
 *
 * Matches the existing audit_id style (`PA-` + 20 uppercase hex chars) so a
 * case UUID reads like the codes analysts already recognize. Does not mint
 * audit ids; those stay unique per scan.
 */
export function publicCaseLabel(caseId: string | null | undefined): string | null {
  const raw = typeof caseId === "string" ? caseId.trim() : "";
  if (!raw) return null;
  const compact = raw.replace(PA_PREFIX, "").replace(/-/g, "");
  if (!HEX_ID.test(compact)) return null;
  return `PA-${compact.slice(0, 20).toUpperCase()}`;
}

export function reportIdentity(input: {
  caseId?: string | null;
  auditId?: string | null;
}): ReportIdentity {
  const reportId = typeof input.auditId === "string" && input.auditId.trim()
    ? input.auditId.trim()
    : null;
  return {
    caseLabel: publicCaseLabel(input.caseId),
    reportId,
  };
}

/** Header slash: stable case label when a saved case exists, else the scan fingerprint. */
export function headerCaseLabel(input: {
  caseId?: string | null;
  auditId?: string | null;
}): string | null {
  const identity = reportIdentity(input);
  return identity.caseLabel ?? identity.reportId;
}
