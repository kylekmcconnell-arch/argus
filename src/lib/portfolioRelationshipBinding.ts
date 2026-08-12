import type { SourceArtifact } from "../data/evidence";
import { canonicalOfficialWebsite } from "./fundScaleEvidence";
import { isOrganizationAccount } from "./investorSubject";

const SHA256_HEX = /^[a-f0-9]{64}$/i;

export type PortfolioRelationshipBinding = "audited_project" | "direct_subject" | "affiliated_fund";

export interface PortfolioBindingSubject {
  roles: readonly unknown[];
  profile: {
    handle: string;
    display_name: string;
    resolved_name?: string;
    bio: string;
    website?: string;
    profile_collection_state?: "resolved" | "unavailable";
    profile_provider?: string;
    identity_binding?: "licensed_exact_social" | "independent_exact_handle";
  };
}

function normalizedHandle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,30}$/.test(handle) ? handle : null;
}

function completeHttpReceipt(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !url.username
      && !url.password
      && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function credibleDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return canonicalOfficialWebsite(`https://${value.trim().replace(/^https?:\/\//i, "")}`)?.domain ?? null;
}

function hasProjectRole(evidence: Readonly<PortfolioBindingSubject>): boolean {
  return evidence.roles.some((role) => String(role).toUpperCase() === "PROJECT");
}

function directSubjectIsBound(
  artifact: Readonly<SourceArtifact>,
  evidence: Readonly<PortfolioBindingSubject>,
): boolean {
  const audited = normalizedHandle(evidence.profile.handle);
  if (!audited || normalizedHandle(artifact.subjectHandle) !== audited) return false;
  if (
    evidence.profile.profile_collection_state !== "resolved"
    || evidence.profile.profile_provider !== "twitterapi"
  ) return false;
  // An explicit person identity bridge wins over methodology roles. A person can
  // legitimately hold both PROJECT and INVESTOR roles without becoming an
  // organization for portfolio attribution.
  if (evidence.profile.identity_binding) return true;
  if (!isOrganizationAccount(evidence)) return false;
  const profileDomain = canonicalOfficialWebsite(evidence.profile.website)?.domain;
  const artifactDomain = credibleDomain(artifact.investorEntityDomain);
  return Boolean(profileDomain && artifactDomain && profileDomain === artifactDomain);
}

/**
 * One shared gate for every surface that calls an investment relationship
 * verified. Names, logos, and a collector-set match enum are insufficient.
 * Both ends need stable identity receipts and affiliated-fund attribution needs
 * its own frozen bridge.
 */
export function portfolioRelationshipBinding(
  artifact: Readonly<SourceArtifact>,
  evidence: Readonly<PortfolioBindingSubject>,
): PortfolioRelationshipBinding | null {
  if (
    artifact.kind !== "portfolio_relationship"
    || artifact.match !== "relationship_confirmed"
    || artifact.relationship !== "invested_in"
    || !artifact.projectName?.trim()
    || !completeHttpReceipt(artifact.sourceUrl)
    || !SHA256_HEX.test(artifact.contentHash)
    || !SHA256_HEX.test(artifact.sourceContentHash ?? "")
    || !credibleDomain(artifact.projectDomain)
  ) return null;

  const audited = normalizedHandle(evidence.profile.handle);
  if (!audited) return null;
  if (normalizedHandle(artifact.projectHandle) === audited) {
    return hasProjectRole(evidence) ? "audited_project" : null;
  }
  if (!directSubjectIsBound(artifact, evidence)) return null;
  if (artifact.attribution === "direct_subject") return "direct_subject";
  if (
    artifact.attribution === "affiliated_fund"
    && artifact.investorEntityName?.trim()
    && credibleDomain(artifact.investorEntityDomain)
    && completeHttpReceipt(artifact.attributionSourceUrl)
    && SHA256_HEX.test(artifact.attributionSourceContentHash ?? "")
    && completeHttpReceipt(artifact.investorDomainSourceUrl)
    && SHA256_HEX.test(artifact.investorDomainSourceContentHash ?? "")
  ) return "affiliated_fund";
  return null;
}

export function isStrictPortfolioRelationship(
  artifact: Readonly<SourceArtifact>,
  evidence: Readonly<PortfolioBindingSubject>,
): boolean {
  return portfolioRelationshipBinding(artifact, evidence) !== null;
}
