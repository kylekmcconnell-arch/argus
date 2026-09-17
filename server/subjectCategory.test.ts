import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact, type CollectedEvidence, type TokenApplicabilitySnapshot } from "../src/data/evidence";
import { subjectCategoryLabel } from "../src/lib/subjectCategory";
import { deriveSubjectCategory } from "./subjectCategory";

const applicability = (
  state: TokenApplicabilitySnapshot["state"],
  axisTreatment: TokenApplicabilitySnapshot["axisTreatment"],
): TokenApplicabilitySnapshot => ({
  state,
  axisTreatment,
  reason: "test",
  evidence: [],
  determinedAt: "2026-09-17T00:00:00.000Z",
});

const listingFact = (): BasicFact => ({
  factId: "fact-listing",
  subjectKey: "@subject",
  predicate: "public_security",
  value: "Example Corp common stock (NASDAQ: EXMP)",
  normalizedValue: "example corp common stock nasdaq exmp",
  status: "verified",
  critical: false,
  sources: [{
    url: "https://www.sec.gov/files/company_tickers_exchange.json",
    sourceClass: "regulatory_or_onchain",
    relation: "supports",
    excerpt: "EXMP · Example Corp · Nasdaq",
    contentHash: "hash",
    capturedAt: "2026-09-17T00:00:00.000Z",
    provider: "sec-registry",
    artifactVerified: true,
  }],
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
});

function evidenceWith(
  state: TokenApplicabilitySnapshot["state"] | null,
  axisTreatment: TokenApplicabilitySnapshot["axisTreatment"] = "assess",
): CollectedEvidence {
  const evidence = emptyEvidence("@subject");
  if (state) evidence.tokenApplicability = applicability(state, axisTreatment);
  return evidence;
}

describe("deriveSubjectCategory", () => {
  it("returns nothing without a token-applicability decision (non-company subjects carry no category)", () => {
    expect(deriveSubjectCategory(evidenceWith(null))).toBeUndefined();
  });

  it("a verified live token is a Web3 startup with a live token", () => {
    const category = deriveSubjectCategory(evidenceWith("verified_live_token"));
    expect(category).toMatchObject({ market: "web3", tokenStanding: "live_token" });
    expect(subjectCategoryLabel(category!)).toBe("Web3 startup · live token");
  });

  it("a first-party planned token is Web3 with a planned token", () => {
    const category = deriveSubjectCategory(evidenceWith("prelaunch_token_deferred", "deferred"));
    expect(category).toMatchObject({ market: "web3", tokenStanding: "token_planned" });
    expect(subjectCategoryLabel(category!)).toBe("Web3 startup · token planned");
  });

  it("confirmed tokenless with crypto vocabulary in the bound bio stays a Web3 startup", () => {
    const evidence = evidenceWith("confirmed_tokenless", "not_applicable");
    evidence.profile.bio = "Non-custodial DeFi lending. There is no token and no token is coming.";
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({ market: "web3", tokenStanding: "no_token" });
    expect(subjectCategoryLabel(category!)).toBe("Web3 startup · no token");
  });

  it("an identity-bound protocol record marks Web3 even without vocabulary", () => {
    const evidence = evidenceWith("confirmed_tokenless", "not_applicable");
    evidence.profile.bio = "We build settlement infrastructure.";
    evidence.protocolTvl = { slug: "x", name: "X", symbol: null, tvlUsd: 1, chains: [], chainBreakdown: [], geckoId: null, sourceUrl: "https://defillama.com/protocol/x", capturedAt: "2026-09-17T00:00:00.000Z" };
    expect(deriveSubjectCategory(evidence)).toMatchObject({ market: "web3", tokenStanding: "no_token" });
  });

  it("confirmed tokenless with no crypto surface and a verified listing is a non-Web3 listed company", () => {
    const evidence = evidenceWith("confirmed_tokenless", "not_applicable");
    evidence.profile.bio = "We make industrial paints.";
    evidence.basicFacts = [listingFact()];
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({
      market: "non_web3",
      tokenStanding: "no_token",
      publicListing: { value: "Example Corp common stock (NASDAQ: EXMP)", sourceUrl: "https://www.sec.gov/files/company_tickers_exchange.json" },
    });
    expect(subjectCategoryLabel(category!)).toBe("Non-Web3 · publicly listed");
  });

  it("confirmed tokenless with no crypto surface and no listing is a non-Web3 private company", () => {
    const evidence = evidenceWith("confirmed_tokenless", "not_applicable");
    evidence.profile.bio = "Family logistics business since 1987.";
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({ market: "non_web3", tokenStanding: "no_token" });
    expect(subjectCategoryLabel(category!)).toBe("Non-Web3 · private company");
  });

  it("an unresolved bio-declared contract proves Web3 context even though the token never bound", () => {
    const evidence = evidenceWith("unresolved_token_identity", "provisional");
    evidence.profile.bio = "The future of finance.";
    evidence.unresolvedProjectToken = {
      address: "0x1111111111111111111111111111111111111111",
      via: "evm",
      source: "official_bio",
      state: "no_market",
      capturedAt: "2026-09-17T00:00:00.000Z",
    };
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({ market: "web3", tokenStanding: "token_unverified" });
    expect(subjectCategoryLabel(category!)).toBe("Web3 startup · token unverified");
  });

  it("fails closed to undetermined when the token search never completed and nothing else speaks", () => {
    const evidence = evidenceWith("unresolved_token_identity", "provisional");
    evidence.profile.bio = "The future of finance.";
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({ market: "undetermined", tokenStanding: "token_unverified" });
    expect(subjectCategoryLabel(category!)).toBe("Category undetermined");
    expect(category!.basis.join(" ")).toContain("category stays open");
  });

  it("a listed Web3 company keeps both surfaces: Web3 market plus the verified listing", () => {
    const evidence = evidenceWith("verified_live_token");
    evidence.basicFacts = [listingFact()];
    const category = deriveSubjectCategory(evidence);
    expect(category).toMatchObject({ market: "web3", tokenStanding: "live_token" });
    expect(category!.publicListing?.value).toContain("NASDAQ");
    expect(subjectCategoryLabel(category!)).toBe("Web3 startup · live token · listed");
  });

  it("third-party coverage never recategorizes the subject: only bound first-party text counts", () => {
    const evidence = evidenceWith("confirmed_tokenless", "not_applicable");
    evidence.profile.bio = "We make industrial paints.";
    const fact = listingFact();
    fact.predicate = "product";
    fact.value = "Industrial coatings";
    fact.sources[0].sourceClass = "independent_press";
    fact.sources[0].excerpt = "Analysts compare the firm's loyalty points to a crypto token economy.";
    evidence.basicFacts = [fact];
    expect(deriveSubjectCategory(evidence)).toMatchObject({ market: "non_web3" });
  });
});
