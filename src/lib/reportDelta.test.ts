import { describe, expect, it } from "vitest";
import type { BasicFact } from "../data/evidence";
import type { TokenDossier } from "../token/audit";
import { buildMaterialReportDelta, materialDeltaDiscovery, type PriorReportSnapshot } from "./reportDelta";

const prior = (payload: unknown): PriorReportSnapshot => ({
  reportVersionId: "11111111-1111-4111-8111-111111111111",
  version: 3,
  capturedAt: "2026-08-20T10:00:00.000Z",
  payload,
});

const token = (overrides: Partial<TokenDossier["safety"]> = {}, holdersAssessed = true): TokenDossier => ({
  address: "0x1111111111111111111111111111111111111111",
  chain: "ethereum",
  dexId: "uniswap",
  symbol: "ARG",
  name: "Argus",
  verdict: "CAUTION",
  score: 55,
  capApplied: null,
  headline: "Saved report",
  axes: [],
  safety: {
    available: true,
    contractPropertiesAssessed: true,
    simChecked: true,
    tradeabilityAssessed: true,
    honeypot: false,
    honeypotOnchain: false,
    serialScammerCreator: false,
    mintable: false,
    freezable: false,
    nonTransferable: false,
    ownerRenounced: true,
    takeBack: false,
    hiddenOwner: false,
    selfdestruct: false,
    pausable: false,
    openSource: true,
    cannotSellAll: false,
    metadataMutable: false,
    buyTax: 0,
    sellTax: 0,
    holderCount: 100,
    topHolderPct: 12,
    lpLocked: true,
    lpBurnedPct: 0,
    lpLockedPct: 80,
    lpTopUnlockedEoaPct: 20,
    lpAssessed: true,
    balanceMutable: false,
    transferHook: false,
    transferFee: false,
    proxy: false,
    slippageModifiable: false,
    blacklist: false,
    tradingCooldown: false,
    externalCall: false,
    ownerChangeBalance: false,
    creatorPercent: 0,
    ...overrides,
  },
  socials: [],
  projectX: null,
  deployer: null,
  topHolders: [],
  holdersAssessed,
  insiderPct: 0,
  bundleCount: 0,
  bundleRisk: "low",
  cg: null,
  graph: { nodes: [], edges: [] },
  findings: [],
  trace: [],
  live: true,
  safetyChecked: true,
} as TokenDossier);

const fact = (value: string): BasicFact => ({
  factId: `product:${value}`,
  subjectKey: "project:argus",
  predicate: "product",
  value,
  normalizedValue: value.toLowerCase(),
  status: "verified",
  critical: true,
  attributionScope: "direct_subject",
  evidence_origin: "deterministic",
  artifact_verified: true,
  provider: "public-web",
  sources: [{
    url: "https://argus.example/product",
    sourceClass: "official_subject",
    relation: "supports",
    excerpt: value,
    contentHash: "a".repeat(64),
    capturedAt: "2026-08-24T00:00:00.000Z",
    provider: "public-web",
    artifactVerified: true,
  }],
});

describe("buildMaterialReportDelta", () => {
  it("prioritizes an assessed contract-control change over lower-priority movements", () => {
    const before = token({ ownerRenounced: true, topHolderPct: 10 });
    const after = token({ ownerRenounced: false, topHolderPct: 35 });
    const delta = buildMaterialReportDelta("token", prior(before), after);
    expect(delta).toMatchObject({
      category: "contract_control",
      previous: { version: 3, value: "present" },
      current: { value: "absent" },
    });
    expect(delta?.consequence).toContain("increasing this specific control risk");
  });

  it("fails closed when contract properties were not assessed in both reports", () => {
    const before = token({ contractPropertiesAssessed: false, ownerRenounced: true });
    const after = token({ ownerRenounced: false });
    expect(buildMaterialReportDelta("token", prior(before), after)).toBeNull();
  });

  it("surfaces only a material LP-protection movement from comparable LP reads", () => {
    const before = token({ lpLockedPct: 80, lpBurnedPct: 0 });
    const after = token({ lpLockedPct: 30, lpBurnedPct: 0 });
    expect(buildMaterialReportDelta("token", prior(before), after)).toMatchObject({
      category: "liquidity_protection",
      previous: { value: "80.0% protected" },
      current: { value: "30.0% protected" },
    });
  });

  it("rejects score, verdict, and price movement when evidence did not materially change", () => {
    const before = { ...token(), score: 20, verdict: "FAIL", priceUsd: 0.01 };
    const after = { ...token(), score: 90, verdict: "PASS", priceUsd: 4.2 };
    expect(buildMaterialReportDelta("token", prior(before), after)).toBeNull();
  });

  it("compares direct, artifact-verified facts in person reports", () => {
    const before = { basicFacts: [fact("Private beta")] };
    const after = { basicFacts: [fact("Publicly available")] };
    expect(buildMaterialReportDelta("person", prior(before), after)).toMatchObject({
      category: "verified_fact",
      previous: { value: "Private beta" },
      current: { value: "Publicly available" },
    });
  });

  it("turns the frozen delta into the first-screen discovery with an exact prior-version receipt", () => {
    const delta = buildMaterialReportDelta(
      "token",
      prior(token({ mintable: false })),
      token({ mintable: true }),
    );
    expect(materialDeltaDiscovery(delta)).toMatchObject({
      id: "delta-contract-mintable",
      receipts: [{
        label: "Open previous report v3",
        href: "/?version=11111111-1111-4111-8111-111111111111",
      }],
    });
  });
});
