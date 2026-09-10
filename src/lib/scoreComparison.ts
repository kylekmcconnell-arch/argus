const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" ? v as Record<string,unknown> : {};
/** Explain known comparability changes; matching scores are never proof that
 * real-world quality stayed constant or that providers returned the same facts. */
export function scoreComparisonNote(previous: unknown, current: unknown, previousMethodology?: string | null, currentMethodology?: string | null): string {
  const before = object(object(previous).report);
  const after = object(object(current).report);
  const changes: string[] = [];
  if (!previousMethodology || !currentMethodology) changes.push("methodology comparability was not recorded");
  else if (previousMethodology !== currentMethodology) changes.push("the scoring methodology changed");
  if (before.governing_role !== after.governing_role) changes.push("the governing role changed");
  const coverage = (r: Record<string,unknown>) => {
    const roles = Array.isArray(r.role_reports) ? r.role_reports.map(object) : [];
    return object(roles.find(role => role.role === r.governing_role)?.score_coverage ?? r.score_coverage);
  };
  const b = coverage(before), a = coverage(after);
  if (b.assessedWeight !== a.assessedWeight || b.totalWeight !== a.totalWeight) changes.push("assessed scoring coverage changed");
  return changes.length ? `Compare with care: ${changes.join("; ")}. Source availability may also differ.` : "Same recorded methodology, governing role and scoring coverage. Source measurements may still differ; the score change alone does not establish improvement or deterioration.";
}
