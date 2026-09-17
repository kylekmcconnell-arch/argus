import type { CollectedEvidence, SubjectCategorySnapshot } from "../src/data/evidence";

// Market categorization: ARGUS assesses all startups and businesses, not only
// crypto. Every PROJECT report states whether the subject is a Web3 startup or
// a non-Web3 company, so a reader knows which metric families applied and why
// the inapplicable ones were scrapped and weight-adjusted away rather than
// zero-scored. The decision is deterministic and reuses evidence that is
// already frozen and identity-bound:
//   - the token-applicability decision (live / planned / none / unresolved),
//   - identity-bound crypto protocol records (DeFiLlama, CryptoRank, holder
//     register) that only exist after an exact identity join,
//   - crypto vocabulary in bound first-party text (bio, self posts, verified
//     official-site excerpts) — never in third-party coverage, which would let
//     a journalist's framing recategorize the subject.
// Fail-closed: when the token identity search did not complete and no other
// signal speaks, the category is `undetermined`, never a guessed "non-Web3".

/**
 * Crypto vocabulary that marks bound first-party text as Web3 context. A "no
 * token is coming" disclaimer still matches: a company talking about tokens is
 * positioning itself in Web3 even while declining one.
 */
const WEB3_VOCABULARY = /\b(?:crypto|web3|blockchain|on[- ]?chain|defi|cefi|tokens?|tokenomics|tokenized|memecoins?|nfts?|dao|dex|cex|stablecoins?|smart contracts?|airdrops?|tge|launchpad|staking|validators?|rollups?|zk[- ]?proofs?|solana|ethereum|evm|bitcoin|altcoins?)\b/i;

const boundFirstPartyText = (evidence: CollectedEvidence): string[] => [
  evidence.profile.bio,
  evidence.profile.self_post_sample,
  ...(evidence.basicFacts ?? []).flatMap((fact) =>
    (fact.sources ?? [])
      .filter((source) => source.sourceClass === "official_subject" && source.artifactVerified && source.relation === "supports")
      .map((source) => source.excerpt)),
].filter((text): text is string => Boolean(text));

const TOKEN_STANDING: Record<string, SubjectCategorySnapshot["tokenStanding"]> = {
  verified_live_token: "live_token",
  historical_token_lineage: "live_token",
  prelaunch_token_deferred: "token_planned",
  confirmed_tokenless: "no_token",
  unresolved_token_identity: "token_unverified",
};

/**
 * Derive the frozen Web3 / non-Web3 market category for a company subject.
 * Requires the token-applicability decision to exist (it is the anchor signal
 * and is itself PROJECT-gated), so a person or investor report never carries a
 * company category.
 */
export function deriveSubjectCategory(
  evidence: CollectedEvidence,
  determinedAt = new Date().toISOString(),
): SubjectCategorySnapshot | undefined {
  const applicability = evidence.tokenApplicability;
  if (!applicability) return undefined;

  const basis: string[] = [];
  const tokenStanding = TOKEN_STANDING[applicability.state] ?? "token_unverified";

  // Web3 signals, strongest first. Every one is identity-bound or first-party.
  let web3 = false;
  if (
    applicability.state === "verified_live_token"
    || applicability.state === "historical_token_lineage"
    || applicability.state === "prelaunch_token_deferred"
  ) {
    web3 = true;
    basis.push(
      applicability.state === "prelaunch_token_deferred"
        ? "The project describes a token as planned in bound first-party sources."
        : "A canonical token is bound to the official project identity.",
    );
  }
  // An unresolved bio-declared contract proves crypto context even though the
  // token itself never bound; an unresolved state WITHOUT a declared contract
  // proves nothing about the market either way.
  if (!web3 && applicability.state === "unresolved_token_identity" && evidence.unresolvedProjectToken) {
    web3 = true;
    basis.push("The official X bio declares a token contract, even though no market or registry record confirmed it.");
  }
  if (!web3 && (evidence.protocolTvl || evidence.protocolFunding || evidence.cryptoRankFunding || evidence.holderProfile)) {
    web3 = true;
    basis.push("An identity-bound crypto protocol record (TVL, funding index, or holder register) exists for this subject.");
  }
  if (!web3 && boundFirstPartyText(evidence).some((text) => WEB3_VOCABULARY.test(text))) {
    web3 = true;
    basis.push("Bound first-party text (bio, own posts, or verified official-site excerpts) uses crypto vocabulary.");
  }

  const listingFact = (evidence.basicFacts ?? []).find((fact) =>
    fact.predicate === "public_security"
    && (fact.status === "verified" || fact.status === "corroborated")
    && fact.artifact_verified === true
    && fact.value.trim());
  const publicListing = listingFact
    ? { value: listingFact.value.trim(), sourceUrl: listingFact.sources[0]?.url ?? "" }
    : undefined;
  if (publicListing) {
    basis.push(`A verified public security is on record: ${publicListing.value}.`);
  }

  if (web3) {
    return { market: "web3", tokenStanding, ...(publicListing ? { publicListing } : {}), basis, determinedAt };
  }

  // No Web3 signal. A completed tokenless search plus silence on every crypto
  // surface reads as a non-Web3 company; an INCOMPLETE token search with the
  // same silence stays undetermined rather than guessing.
  if (applicability.state === "confirmed_tokenless") {
    basis.push(
      publicListing
        ? "A completed identity-bound token search found no token, no crypto surface speaks, and the company trades as a listed security."
        : "A completed identity-bound token search found no token and no crypto surface speaks for this subject.",
    );
    return { market: "non_web3", tokenStanding: "no_token", ...(publicListing ? { publicListing } : {}), basis, determinedAt };
  }

  basis.push("The token identity search did not reach a completed result and no other market signal speaks, so the category stays open.");
  return { market: "undetermined", tokenStanding, ...(publicListing ? { publicListing } : {}), basis, determinedAt };
}
