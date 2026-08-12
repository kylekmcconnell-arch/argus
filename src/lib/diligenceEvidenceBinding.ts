import type {
  CompanyEnrichmentSnapshot,
  ProtocolTvlSnapshot,
} from "../data/evidence";
import { canonicalOfficialWebsite } from "./fundScaleEvidence";

function relatedHosts(left: string, right: string): boolean {
  return left === right || left.endsWith(`.${right}`) || right.endsWith(`.${left}`);
}

export function isExactDomainBoundCompanyEnrichment(
  company?: CompanyEnrichmentSnapshot | null,
  officialWebsite?: string | null,
): company is CompanyEnrichmentSnapshot {
  if (!company || company.identityMatch !== "official_domain") return false;
  if (company.matchMethod !== "exact_host" && company.matchMethod !== "parent_or_subdomain") return false;
  const requested = canonicalOfficialWebsite(company.requestedDomain)?.domain ?? null;
  const matched = canonicalOfficialWebsite(company.matchedDomain)?.domain ?? null;
  const official = canonicalOfficialWebsite(officialWebsite)?.domain ?? null;
  const source = canonicalOfficialWebsite(company.sourceUrl)?.domain ?? null;
  const methodMatchesReceipt = company.matchMethod === "exact_host"
    ? requested === matched
    : Boolean(requested && matched && requested !== matched && relatedHosts(requested, matched));
  return Boolean(
    requested
    && matched
    && official
    && source
    && Number.isFinite(Date.parse(company.capturedAt))
    && methodMatchesReceipt
    && relatedHosts(official, requested)
    && relatedHosts(official, matched)
    && relatedHosts(source, matched),
  );
}

export function isExactProtocolIdentityBinding(
  protocolTvl?: ProtocolTvlSnapshot | null,
  canonicalGeckoId?: string | null,
): protocolTvl is ProtocolTvlSnapshot {
  const providerId = protocolTvl?.geckoId?.trim().toLowerCase();
  const canonicalId = canonicalGeckoId?.trim().toLowerCase();
  return Boolean(providerId && canonicalId && providerId === canonicalId);
}
