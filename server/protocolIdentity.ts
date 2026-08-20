import type {
  CollectedEvidence,
  ProtocolBindingReceipt,
} from "../src/data/evidence";
import { canonicalOfficialWebsite } from "../src/lib/fundScaleEvidence";
import type { ProtocolIdentity } from "./adapters/defiLlama";
import { normalizeProtocolChain } from "./adapters/defiLlama";
import { verifiedOfficialProjectIdentity } from "./projectIdentity";

export interface CanonicalProjectProtocolAnchors {
  officialHandle: string | null;
  officialDomains: string[];
  token: {
    chain: string;
    address: string;
    coingeckoId: string | null;
  } | null;
}

export type ProtocolIdentityMatch =
  | { state: "matched"; binding: ProtocolBindingReceipt }
  | {
      state: "unbound";
      reason: "hard_anchor_conflict" | "partial_anchor" | "no_hard_anchor";
      detail: string;
    };

const normalizeHandle = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const handle = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9_]{1,30}$/.test(handle) ? handle : null;
};

const normalizeIdentifier = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
};

const providerWithinOfficialDomain = (official: string, provider: string): boolean =>
  provider === official || provider.endsWith(`.${official}`);

const addressesEqual = (chain: string, left: string, right: string): boolean =>
  chain === "solana" ? left === right : left.toLowerCase() === right.toLowerCase();

export function canonicalProjectProtocolAnchors(
  evidence: CollectedEvidence,
): CanonicalProjectProtocolAnchors {
  const domains = new Set<string>();
  const profile = evidence.profile;
  const capturedAt = Date.parse(profile.profile_captured_at ?? "");
  const providerProfileResolved = profile.profile_collection_state === "resolved"
    && profile.profile_provider === "twitterapi"
    && Number.isFinite(capturedAt);
  if (providerProfileResolved) {
    const profileWebsite = canonicalOfficialWebsite(profile.website);
    if (profileWebsite) domains.add(profileWebsite.domain);
    for (const website of profile.official_websites ?? []) {
      const scope = canonicalOfficialWebsite(website);
      if (scope) domains.add(scope.domain);
    }
  }

  const recovered = verifiedOfficialProjectIdentity(evidence);
  if (recovered) domains.add(recovered.website.domain);

  const token = evidence.projectToken?.verified
    ? {
        chain: normalizeProtocolChain(evidence.projectToken.chain) ?? evidence.projectToken.chain.trim().toLowerCase(),
        address: evidence.projectToken.address.trim(),
        coingeckoId: normalizeIdentifier(evidence.projectToken.coingeckoId),
      }
    : null;
  const officialHandle = providerProfileResolved || recovered
    ? normalizeHandle(profile.handle)
    : null;

  return {
    officialHandle,
    officialDomains: [...domains],
    token,
  };
}

/**
 * Admit a DeFiLlama protocol row only through a frozen non-name identity
 * bridge. Name, ticker and slug are discovery inputs and never close this join.
 *
 * Precedence is deliberate:
 *  1. chain + contract is immutable and strongest;
 *  2. CoinGecko id is accepted only when the provider does not also name a
 *     conflicting contract on the canonical chain;
 *  3. exact X + verified official domain binds project-level evidence only.
 */
export function matchProtocolIdentity(
  canonical: CanonicalProjectProtocolAnchors,
  provider: ProtocolIdentity,
): ProtocolIdentityMatch {
  const token = canonical.token;
  const canonicalChain = token ? normalizeProtocolChain(token.chain) : null;
  const contractsOnCanonicalChain = token && canonicalChain
    ? provider.contracts.filter((contract) => normalizeProtocolChain(contract.chain) === canonicalChain)
    : [];
  const exactContract = token && canonicalChain
    ? contractsOnCanonicalChain.find((contract) =>
        addressesEqual(canonicalChain, token.address, contract.address))
    : undefined;

  if (token && canonicalChain && exactContract) {
    return {
      state: "matched",
      binding: {
        method: "matched_chain_contract",
        scope: "project_and_token",
        protocolSlug: provider.slug,
        canonicalChain,
        canonicalAddress: token.address,
        providerChain: normalizeProtocolChain(exactContract.chain) ?? exactContract.chain,
        providerAddress: exactContract.address,
      },
    };
  }

  const canonicalGeckoId = normalizeIdentifier(token?.coingeckoId);
  const providerGeckoId = normalizeIdentifier(provider.geckoId);
  const exactGeckoId = Boolean(
    canonicalGeckoId
    && providerGeckoId
    && canonicalGeckoId === providerGeckoId,
  );
  const conflictingCanonicalChainContract = Boolean(
    token
    && canonicalChain
    && contractsOnCanonicalChain.length
    && !contractsOnCanonicalChain.some((contract) =>
      addressesEqual(canonicalChain, token.address, contract.address)),
  );

  if (exactGeckoId && conflictingCanonicalChainContract) {
    return {
      state: "unbound",
      reason: "hard_anchor_conflict",
      detail: "The protocol CoinGecko id matched, but its explicit contract on the canonical chain did not.",
    };
  }

  if (token && exactGeckoId && canonicalGeckoId && providerGeckoId) {
    return {
      state: "matched",
      binding: {
        method: "matched_protocol_gecko_id",
        scope: "project_and_token",
        protocolSlug: provider.slug,
        canonicalGeckoId,
        providerGeckoId,
      },
    };
  }

  const providerHandle = normalizeHandle(provider.officialX);
  const providerWebsite = canonicalOfficialWebsite(provider.website);
  const canonicalDomain = providerWebsite
    ? canonical.officialDomains.find((domain) => providerWithinOfficialDomain(domain, providerWebsite.domain))
    : undefined;
  if (
    canonical.officialHandle
    && providerHandle
    && canonical.officialHandle === providerHandle
    && providerWebsite
    && canonicalDomain
  ) {
    return {
      state: "matched",
      binding: {
        method: "matched_official_x_and_domain",
        scope: "project",
        protocolSlug: provider.slug,
        canonicalHandle: canonical.officialHandle,
        canonicalDomain,
        providerHandle,
        providerDomain: providerWebsite.domain,
      },
    };
  }

  const oneProjectAnchorMatched = Boolean(
    (canonical.officialHandle && providerHandle && canonical.officialHandle === providerHandle)
    || (providerWebsite && canonical.officialDomains.some((domain) => providerWithinOfficialDomain(domain, providerWebsite.domain))),
  );
  const oneTokenAnchorPresent = Boolean(
    (canonicalGeckoId && providerGeckoId)
    || (token && contractsOnCanonicalChain.length),
  );
  return {
    state: "unbound",
    reason: oneProjectAnchorMatched || oneTokenAnchorPresent ? "partial_anchor" : "no_hard_anchor",
    detail: oneProjectAnchorMatched || oneTokenAnchorPresent
      ? "Only part of a required hard-anchor pair matched; the protocol row remains unbound."
      : "No exact chain-contract, non-conflicting CoinGecko id, or official X-plus-domain bridge matched.",
  };
}
