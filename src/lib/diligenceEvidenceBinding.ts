import type {
  CollectedEvidence,
  CompanyEnrichmentSnapshot,
  ProjectTokenSnapshot,
  ProtocolBindingReceipt,
  ProtocolFeesSnapshot,
  ProtocolFundingSnapshot,
  ProtocolTvlSnapshot,
} from "../data/evidence";
import { canonicalOfficialWebsite } from "./fundScaleEvidence";


export interface ProtocolBindingContext {
  projectToken?: ProjectTokenSnapshot | null;
  /** Compatibility bridge for frozen reports that retained the ID but not the full token object. */
  canonicalGeckoId?: string | null;
  officialHandle?: string | null;
  officialWebsites?: readonly (string | null | undefined)[];
}

export type ProtocolEvidenceRecord =
  | Pick<ProtocolTvlSnapshot, "slug" | "geckoId" | "binding">
  | Pick<ProtocolFundingSnapshot, "slug" | "geckoId" | "binding">
  | Pick<ProtocolFeesSnapshot, "slug" | "binding">;

export type ValidatedProtocolBindingReceipt =
  | (Extract<ProtocolBindingReceipt, { method: "matched_protocol_gecko_id" }> & {
      scope: "project_and_token";
    })
  | Extract<ProtocolBindingReceipt, { method: "matched_chain_contract" }>
  | Extract<ProtocolBindingReceipt, { method: "matched_official_x_and_domain" }>;

export type ProtocolBindingValidation =
  | {
      state: "matched";
      binding: ValidatedProtocolBindingReceipt;
      legacy: boolean;
      detail: string;
    }
  | {
      state: "unbound";
      reason:
        | "missing_receipt"
        | "slug_mismatch"
        | "canonical_identity_missing"
        | "canonical_identity_conflict"
        | "provider_identity_conflict"
        | "incomplete_receipt";
      detail: string;
    };

const PROTOCOL_CHAIN_ALIASES: Record<string, string> = {
  ethereum: "ethereum",
  eth: "ethereum",
  arbitrum: "arbitrum",
  arbitrumone: "arbitrum",
  base: "base",
  binancesmartchain: "bsc",
  bsc: "bsc",
  polygon: "polygon",
  polygonpos: "polygon",
  optimism: "optimism",
  optimisticethereum: "optimism",
  avalanche: "avalanche",
  avax: "avalanche",
  solana: "solana",
  robinhood: "robinhood",
  robinhoodchain: "robinhood",
};

const normalizedIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const normalizedHandle = (value: unknown): string | null => {
  const handle = normalizedIdentifier(value)?.replace(/^@/, "") ?? null;
  return handle && /^[a-z0-9_]{1,30}$/.test(handle) ? handle : null;
};

const normalizedProtocolChain = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
  return PROTOCOL_CHAIN_ALIASES[key] ?? null;
};

const normalizedOfficialDomain = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  return canonicalOfficialWebsite(
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim()) ? value.trim() : "https://" + value.trim(),
  )?.domain ?? null;
};

const EVM_PROTOCOL_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const SOLANA_PROTOCOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const validProtocolAddress = (chain: string, address: string): boolean =>
  chain === "solana"
    ? SOLANA_PROTOCOL_ADDRESS.test(address)
    : EVM_PROTOCOL_ADDRESS.test(address);

const sameProtocolAddress = (chain: string, left: string, right: string): boolean =>
  chain === "solana" ? left === right : left.toLowerCase() === right.toLowerCase();

const providerWithinOfficialDomain = (official: string, provider: string): boolean =>
  provider === official || provider.endsWith("." + official);

const unbound = (
  reason: Extract<ProtocolBindingValidation, { state: "unbound" }>["reason"],
  detail: string,
): ProtocolBindingValidation => ({ state: "unbound", reason, detail });

const matched = (
  binding: ValidatedProtocolBindingReceipt,
  detail: string,
  legacy = false,
): ProtocolBindingValidation => ({ state: "matched", binding, detail, legacy });

export function protocolBindingContextFromEvidence(
  evidence: Readonly<Pick<CollectedEvidence, "profile" | "projectToken">>,
): ProtocolBindingContext {
  return {
    projectToken: evidence.projectToken,
    canonicalGeckoId: evidence.projectToken?.coingeckoId,
    officialHandle: evidence.profile.handle,
    officialWebsites: [
      evidence.profile.website,
      ...(evidence.profile.official_websites ?? []),
    ],
  };
}

/**
 * Revalidate a frozen protocol receipt at every consumer boundary. Discovery
 * names and slugs never establish identity. Legacy TVL/funding rows that predate
 * receipts remain admissible only through their exact canonical CoinGecko ID;
 * a legacy fee receipt additionally needs a same-slug validated protocol row.
 */
export function validateProtocolEvidenceBinding(
  context: ProtocolBindingContext,
  record: ProtocolEvidenceRecord | null | undefined,
  options: { corroboratedProtocolSlugs?: ReadonlySet<string> } = {},
): ProtocolBindingValidation {
  if (!record) return unbound("missing_receipt", "No protocol evidence row was frozen.");
  const recordSlug = normalizedIdentifier(record.slug);
  if (!recordSlug) return unbound("incomplete_receipt", "The protocol row has no usable provider slug.");
  const recordGeckoId = "geckoId" in record ? normalizedIdentifier(record.geckoId) : null;
  const token = context.projectToken?.verified === true ? context.projectToken : null;
  const canonicalGeckoId = normalizedIdentifier(token?.coingeckoId ?? context.canonicalGeckoId);
  const receipt = record.binding;

  if (!receipt) {
    if (canonicalGeckoId && recordGeckoId === canonicalGeckoId) {
      return matched({
        method: "matched_protocol_gecko_id",
        scope: "project_and_token",
        protocolSlug: recordSlug,
        canonicalGeckoId,
        providerGeckoId: recordGeckoId,
      }, "Legacy protocol row rebound through the exact canonical CoinGecko ID.", true);
    }
    return unbound(
      "missing_receipt",
      "The protocol row has no hard-anchor receipt and no backward-compatible exact CoinGecko join.",
    );
  }

  const receiptSlug = normalizedIdentifier(receipt.protocolSlug);
  if (!receiptSlug || receiptSlug !== recordSlug) {
    return unbound(
      "slug_mismatch",
      "The receipt protocol slug does not exactly match the saved provider row.",
    );
  }

  if (receipt.method === "matched_protocol_gecko_id") {
    if (receipt.scope && receipt.scope !== "project_and_token") {
      return unbound("incomplete_receipt", "The CoinGecko receipt declares an invalid evidence scope.");
    }
    const receiptCanonicalId = normalizedIdentifier(receipt.canonicalGeckoId);
    const receiptProviderId = normalizedIdentifier(receipt.providerGeckoId);
    if (!canonicalGeckoId || !receiptCanonicalId) {
      return unbound("canonical_identity_missing", "The CoinGecko receipt lacks a verified canonical token ID.");
    }
    if (receiptCanonicalId !== canonicalGeckoId) {
      return unbound("canonical_identity_conflict", "The receipt CoinGecko ID conflicts with the canonical token.");
    }
    if (recordGeckoId && recordGeckoId !== canonicalGeckoId) {
      return unbound("provider_identity_conflict", "The provider row CoinGecko ID conflicts with the canonical token.");
    }
    if (receiptProviderId && receiptProviderId !== canonicalGeckoId) {
      return unbound("provider_identity_conflict", "The receipt provider CoinGecko ID conflicts with the canonical token.");
    }
    const validatedProviderGeckoId = receiptProviderId ?? recordGeckoId;
    const corroboratedLegacyFee = !validatedProviderGeckoId
      && options.corroboratedProtocolSlugs?.has(recordSlug) === true;
    if (!validatedProviderGeckoId && !corroboratedLegacyFee) {
      return unbound(
        "incomplete_receipt",
        "The CoinGecko receipt preserves no provider-side ID and has no same-slug validated legacy protocol row.",
      );
    }
    return matched({
      ...receipt,
      scope: "project_and_token",
      protocolSlug: recordSlug,
      canonicalGeckoId,
      ...(validatedProviderGeckoId
        ? { providerGeckoId: validatedProviderGeckoId }
        : {}),
    }, "Protocol row rebound through the exact canonical CoinGecko ID.", !receipt.providerGeckoId);
  }

  if (receipt.method === "matched_chain_contract") {
    if (!token) {
      return unbound("canonical_identity_missing", "The chain-contract receipt has no verified canonical token.");
    }
    const tokenChain = normalizedProtocolChain(token.chain);
    const canonicalChain = normalizedProtocolChain(receipt.canonicalChain);
    const providerChain = normalizedProtocolChain(receipt.providerChain);
    const tokenAddress = token.address.trim();
    const canonicalAddress = receipt.canonicalAddress.trim();
    const providerAddress = receipt.providerAddress.trim();
    if (
      !tokenChain
      || !canonicalChain
      || !providerChain
      || !validProtocolAddress(tokenChain, tokenAddress)
      || !validProtocolAddress(canonicalChain, canonicalAddress)
      || !validProtocolAddress(providerChain, providerAddress)
    ) {
      return unbound("incomplete_receipt", "The chain-contract receipt lacks a valid supported-chain address triple.");
    }
    if (
      tokenChain !== canonicalChain
      || tokenChain !== providerChain
      || !sameProtocolAddress(tokenChain, tokenAddress, canonicalAddress)
    ) {
      return unbound("canonical_identity_conflict", "The receipt chain or canonical address conflicts with the verified token.");
    }
    if (!sameProtocolAddress(tokenChain, tokenAddress, providerAddress)) {
      return unbound("provider_identity_conflict", "The provider contract does not exactly match the verified token.");
    }
    return matched({
      ...receipt,
      protocolSlug: recordSlug,
      canonicalChain: tokenChain,
      canonicalAddress: tokenAddress,
      providerChain: tokenChain,
    }, "Protocol row rebound through the exact canonical chain and contract.");
  }

  const canonicalHandle = normalizedHandle(context.officialHandle);
  const receiptCanonicalHandle = normalizedHandle(receipt.canonicalHandle);
  const providerHandle = normalizedHandle(receipt.providerHandle);
  const canonicalDomains = new Set(
    (context.officialWebsites ?? [])
      .map(normalizedOfficialDomain)
      .filter((domain): domain is string => Boolean(domain)),
  );
  const receiptCanonicalDomain = normalizedOfficialDomain(receipt.canonicalDomain);
  const providerDomain = normalizedOfficialDomain(receipt.providerDomain);
  if (!canonicalHandle || canonicalDomains.size === 0) {
    return unbound("canonical_identity_missing", "The project receipt has no canonical official X-and-domain context.");
  }
  if (
    receipt.scope !== "project"
    || receiptCanonicalHandle !== canonicalHandle
    || providerHandle !== canonicalHandle
    || !receiptCanonicalDomain
    || !canonicalDomains.has(receiptCanonicalDomain)
  ) {
    return unbound("canonical_identity_conflict", "The receipt does not exactly match the frozen official project handle and domain.");
  }
  if (!providerDomain || !providerWithinOfficialDomain(receiptCanonicalDomain, providerDomain)) {
    return unbound("provider_identity_conflict", "The provider domain is outside the canonical official project domain.");
  }
  return matched({
    ...receipt,
    protocolSlug: recordSlug,
    canonicalHandle,
    canonicalDomain: receiptCanonicalDomain,
    providerHandle,
    providerDomain,
  }, "Protocol row rebound through the exact official X account and domain at project scope only.");
}

export function protocolBindingMethodLabel(binding: ValidatedProtocolBindingReceipt): string {
  if (binding.method === "matched_chain_contract") return "Exact chain + contract";
  if (binding.method === "matched_official_x_and_domain") return "Exact official X + domain · project only";
  return "Exact CoinGecko ID";
}

export function describeProtocolBinding(binding: ValidatedProtocolBindingReceipt): string {
  if (binding.method === "matched_chain_contract") {
    return "exact " + binding.canonicalChain + " contract " + binding.canonicalAddress;
  }
  if (binding.method === "matched_official_x_and_domain") {
    return "exact official X @" + binding.canonicalHandle + " plus " + binding.canonicalDomain
      + " (project scope only; no token linkage)";
  }
  return "exact CoinGecko ID " + binding.canonicalGeckoId;
}

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
  return validateProtocolEvidenceBinding(
    { canonicalGeckoId },
    protocolTvl,
  ).state === "matched";
}
