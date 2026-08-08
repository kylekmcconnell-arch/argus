// The holder collector can now SUPPRESS its concentration figures (unordered
// register, self-inconsistent register, or every row a pool). The projection
// gates on `topHolderPct !== null`, so a suppressed reading simply drops the
// concentration clause and the fact reads as if concentration were never a
// question. An absent figure must never read as a low one.
//
// It can also source those figures from a chain explorer rather than GoPlus.
// The fact carries exactly one source, titled and attributed to GoPlus, so an
// explorer number published under it cites a provider that did not produce it.
import { describe, expect, it } from "vitest";
import { SubjectClass } from "../src/engine";
import { emptyEvidence, type CollectedEvidence } from "../src/data/evidence";
import { projectProviderBackedBasicFacts } from "./basicFactsProjection";

function projectEvidence(holder: CollectedEvidence["holderProfile"]): CollectedEvidence {
  const evidence = emptyEvidence("@uniswap");
  evidence.roles = [SubjectClass.PROJECT];
  evidence.projectToken = {
    verified: true,
    verification: "official_x",
    name: "Uniswap",
    symbol: "UNI",
    coingeckoId: "uniswap",
    rank: 25,
    address: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
    chain: "ethereum",
    sourceUrl: "https://www.coingecko.com/en/coins/uniswap",
    capturedAt: "2026-07-22T00:00:00.000Z",
  };
  evidence.holderProfile = holder ? {
    ...holder,
    binding: holder.binding ?? {
      canonicalAddress: evidence.projectToken.address,
      chain: evidence.projectToken.chain,
      method: "canonical_token_address_chain",
    },
  } : holder;
  return evidence;
}

const base = {
  holderCount: 370_041,
  lpLockedOrBurnedPct: 85,
  assessedWalletCount: 10,
  top10PctIsFloor: false,
  sourceUrl: "https://gopluslabs.io/token-security/1/0x1f98",
  capturedAt: "2026-07-22T00:00:00.000Z",
};

const tokenomicsFact = (evidence: CollectedEvidence) =>
  evidence.basicFacts?.find((fact) => fact.predicate === "tokenomics" && String(fact.value).includes("holders"));

describe("a suppressed holder distribution says so", () => {
  it("states why concentration is missing instead of dropping the clause", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: null,
      top10Pct: null,
      assessedWalletCount: null,
      top10PctIsFloor: false,
      holdersAssessed: false,
      distributionSource: null,
      distributionNote: "GoPlus does not order its holder register on this chain and the chain explorer returned no distribution, so holder concentration is not reported.",
      contractFlags: [],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const fact = tokenomicsFact(evidence);
    expect(fact?.value).toContain("not measured");
    expect(fact?.sources[0].excerpt).toContain("does not order its holder register");
  });

  it("attributes an explorer-sourced concentration figure to the explorer", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: 4.17,
      top10Pct: 22,
      holdersAssessed: true,
      distributionSource: "explorer",
      distributionNote: "Holder concentration is the chain explorer's ordered register, since GoPlus does not order its holder rows on this chain.",
      distributionSourceUrl: "https://robinhoodchain.blockscout.com/api/v2/tokens/0xabc/holders",
      distributionCapturedAt: "2026-07-22T00:00:00.000Z",
      contractFlags: [],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const fact = tokenomicsFact(evidence);
    expect(fact?.sources[0].excerpt).toContain("chain explorer");
    expect(fact?.sources[0]).toMatchObject({
      url: "https://robinhoodchain.blockscout.com/api/v2/tokens/0xabc/holders",
      provider: "blockscout",
    });
  });

  it("publishes a short register as a floor across its assessed wallets", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: 4,
      top10Pct: 7,
      assessedWalletCount: 2,
      top10PctIsFloor: true,
      holdersAssessed: true,
      distributionSource: "goplus",
      distributionNote: "The register carried 2 usable wallet rows, so the combined share is a floor across those assessed wallets and not a top-10 total.",
      contractFlags: [],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const fact = tokenomicsFact(evidence);
    expect(fact?.value).toContain("at least 7% of supply across 2 assessed wallets");
    expect(fact?.value).not.toMatch(/top 10 wallets hold/i);
    expect(fact?.sources[0].excerpt).toContain("floor across those assessed wallets");
  });

  it("does not promote a legacy aggregate with no structural basis to top-10", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: 40,
      top10Pct: 70,
      assessedWalletCount: undefined,
      top10PctIsFloor: undefined,
      holdersAssessed: true,
      distributionSource: "goplus",
      distributionNote: "Legacy snapshot with no frozen row count.",
      contractFlags: [],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const fact = tokenomicsFact(evidence);
    expect(fact?.value).toContain("largest single wallet");
    expect(fact?.value).not.toMatch(/top 10|across \d+ assessed wallets/i);
  });
});

describe("GoPlus contract-control flags reach the report in the provider's own words", () => {
  it("projects the flags that fired, verbatim, as a disclosure-only fact", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: 4,
      top10Pct: 9,
      holdersAssessed: true,
      distributionSource: "goplus",
      distributionNote: null,
      contractFlags: [
        { key: "serial_scammer_creator", claim: "The wallet that deployed this token has created honeypot tokens before. This is a serial-scammer signal.", tone: "bad", source: "goplus" },
        { key: "mint_authority_active", claim: "Mint authority is live: supply can be minted.", tone: "warn", source: "goplus" },
      ],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const fact = evidence.basicFacts?.find((item) => item.predicate === "public_security");
    expect(fact?.value).toContain("serial-scammer signal");
    expect(fact?.value).toContain("Mint authority is live");
    // Disclosure only: a provider's flag must never floor a score by itself.
    expect(fact?.floorEligible).toBe(false);
    expect(fact?.providerProjection).toBe(true);
  });

  it("projects nothing at all when no flag fired, because empty is not clean", () => {
    const evidence = projectEvidence({
      ...base,
      topHolderPct: 4,
      top10Pct: 9,
      holdersAssessed: true,
      distributionSource: "goplus",
      distributionNote: null,
      contractFlags: [],
      creatorPct: null,
    });

    projectProviderBackedBasicFacts(evidence);

    const security = (evidence.basicFacts ?? []).filter((item) => item.predicate === "public_security");
    expect(security.some((item) => item.sources.some((s) => s.provider === "goplus"))).toBe(false);
  });
});
