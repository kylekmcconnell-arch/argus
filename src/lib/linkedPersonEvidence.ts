import { isOrganizationAccount } from "./investorSubject.js";
import type { Dossier } from "../data/dossier.js";
import type { WebTeamMember } from "../data/evidence.js";
import { buildPersonInvestigation, type PersonInvestigation } from "./personInvestigation.js";
import { personResearchIdentity } from "./personResearch.js";
export interface LinkedPersonEvidence {
  reportVersionId: string; handle: string; capturedAt: string;
  investigation: PersonInvestigation;
  note: string;
}
/** Caller must first load the exact immutable version within the authenticated organization. */
export function linkedPersonEvidence(member: WebTeamMember, dossier: Dossier, reportVersionId: string, capturedAt: string): LinkedPersonEvidence | null {
  const identity = personResearchIdentity(member);
  if (!identity || !dossier || typeof dossier.handle !== "string" || identity !== `x:${dossier.handle.replace(/^@/, "").toLowerCase()}`) return null;
  if (typeof dossier.display_name !== "string" || typeof dossier.bio !== "string" || (dossier.resolved_name != null && typeof dossier.resolved_name !== "string")) return null;
  if (!Array.isArray(dossier.report?.roles) || dossier.report.roles.some(role => String(role) === "PROJECT") || isOrganizationAccount({ roles: dossier.report.roles, profile: dossier })) return null;
  if (!Array.isArray(dossier.basicFacts)) return null;
  const investigation = buildPersonInvestigation(dossier, dossier.basicFacts);
  if (!dossier.identity_binding && investigation.timeline.length === 0) return null;
  return { reportVersionId, handle: dossier.handle, capturedAt, investigation,
    note: "Earlier account-bound person evidence, not current employment confirmation. The company's role claim and this historical person report remain separate. Scores are not imported or averaged; no legal or wallet search leads are promoted." };
}
