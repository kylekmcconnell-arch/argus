import type { Dossier } from "../data/dossier";
import { isOrganizationAccount } from "./investorSubject";

/** An embedded company score must come from this account and an organization methodology. */
export function projectAccountResultError(dossier: Dossier, expectedHandle: string): string | null {
  const normalize = (value: string) => value.replace(/^@/, "").toLowerCase();
  if (typeof dossier.handle !== "string" || normalize(dossier.handle) !== normalize(expectedHandle)) return "The returned account does not match the project's bound X account. No company score was attached.";
  if (!Array.isArray(dossier.report?.roles) || typeof dossier.bio !== "string" || typeof dossier.display_name !== "string") return "The company-audit result is incomplete. No company score was attached.";
  if (!isOrganizationAccount({ roles: dossier.report.roles, profile: dossier })
    || !dossier.report.roles.some(role => ["PROJECT", "INVESTOR", "AGENCY"].includes(String(role)))) {
    return "The account audit returned a person methodology for a project-account request. No person score was used as a company score. A correctly routed company assessment is required.";
  }
  return null;
}
