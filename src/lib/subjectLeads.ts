import type { Finding } from "../engine/audit";

export const SUBJECT_LEAD_RELATIONSHIP = "About this subject";

export function normalizedEntityHandle(value?: string | null): string | null {
  if (!value) return null;
  const match = value.trim().match(/^@?([A-Za-z0-9_]{1,30})$/);
  return match ? match[1].toLowerCase() : null;
}

export function findingTarget(finding: Finding): string | null {
  return finding.finding_scope?.target_entity_key
    ?? finding.claim.match(/@([A-Za-z0-9_]{1,30})/)?.[0]
    ?? null;
}

/**
 * The caption a lead row carries. Derived once, so the split that decides which
 * card a lead lands in can never disagree with the label printed on the row.
 */
export function leadRelationshipLabel(lead: Finding, subject: string): string {
  const scope = lead.finding_scope;
  if (scope?.relationship_to_subject === "associate") return "About an associate";
  if (scope?.relationship_to_subject === "venture") return "About a venture";
  if (scope?.relationship_to_subject === "self") return SUBJECT_LEAD_RELATIONSHIP;
  const target = normalizedEntityHandle(findingTarget(lead));
  return target !== null && target !== normalizedEntityHandle(subject)
    ? "About a related company"
    : SUBJECT_LEAD_RELATIONSHIP;
}

export function leadArtifactConfirmed(lead: Finding): boolean {
  return lead.verification_status === "Verified"
    && lead.artifact_verified === true
    && lead.evidence_origin !== "model_lead";
}

function actionableLeadSource(sourceUrl?: string): boolean {
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl.trim());
    if (
      (url.protocol !== "https:" && url.protocol !== "http:")
      || !url.hostname
      || url.username
      || url.password
    ) return false;
    const path = url.pathname.toLowerCase();
    return path !== "/search"
      && !path.startsWith("/search/")
      && !url.searchParams.has("q")
      && !url.searchParams.has("query");
  } catch {
    return false;
  }
}

export function actionableInvestigativeLead(finding: Finding): boolean {
  if (finding.artifact_verified === true && finding.evidence_origin !== "model_lead") return true;
  return actionableLeadSource(finding.source_url);
}

const X_HOST = /^(www\.)?(x\.com|twitter\.com)$/i;
const X_NOISE = /^(home|explore|notifications|messages|i|intent|search|hashtag|settings|share|status|about|tos|privacy)$/i;

/** Speaker handle when the candidate source is an X profile or status URL. */
export function speakerHandleFromLead(lead: Finding): string | null {
  const fromAuthor = normalizedEntityHandle(lead.source_author);
  if (fromAuthor) return fromAuthor;
  try {
    const parsed = new URL(lead.source_url.trim());
    if (!X_HOST.test(parsed.hostname)) return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const handle = (parts[0] ?? "").replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(handle) || X_NOISE.test(handle)) return null;
    return handle.toLowerCase();
  } catch {
    return null;
  }
}

export function isPublishableSubjectFinding(finding: Finding, subject: string): boolean {
  if (finding.evidence_origin === "model_lead" || finding.artifact_verified === false) return false;
  if (finding.independent_source_count < 1) return false;
  if (finding.verification_status !== "Verified" && finding.verification_status !== "Reported") return false;
  const scope = finding.finding_scope;
  if (!scope) {
    return !/Lead$/i.test(finding.finding_type);
  }
  return scope.scope === "direct_subject"
    && scope.relationship_to_subject === "self"
    && normalizedEntityHandle(scope.target_entity_key) === normalizedEntityHandle(subject);
}

export function visibleInvestigativeLeads(
  report: { handle: string; investigative_leads?: Finding[]; publishable_findings?: Finding[] },
): { subjectLeads: Finding[]; relatedEntityLeads: Finding[]; subjectAdverseLeads: Finding[] } {
  const quarantinedLegacyFindings = (report.publishable_findings ?? []).filter((finding) =>
    !isPublishableSubjectFinding(finding, report.handle));
  const investigativeLeads = [...(report.investigative_leads ?? []), ...quarantinedLegacyFindings]
    .filter((finding, index, all) => all.findIndex((candidate) =>
      candidate.finding_type === finding.finding_type
      && candidate.claim === finding.claim
      && candidate.source_url === finding.source_url,
    ) === index)
    .filter(actionableInvestigativeLead);
  const subjectLeads = investigativeLeads.filter((lead) =>
    leadRelationshipLabel(lead, report.handle) === SUBJECT_LEAD_RELATIONSHIP);
  const relatedEntityLeads = investigativeLeads.filter((lead) =>
    leadRelationshipLabel(lead, report.handle) !== SUBJECT_LEAD_RELATIONSHIP);
  return {
    subjectLeads,
    relatedEntityLeads,
    subjectAdverseLeads: subjectLeads.filter((lead) => lead.polarity < 0),
  };
}
