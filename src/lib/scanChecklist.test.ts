import { describe, expect, it } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";
import {
  clearanceCoverage,
  personChecks,
  summarizeChecks,
  tokenChecks,
  type CheckStatus,
  type ScanCheck,
} from "./scanChecklist";

const safety = (overrides: Partial<NormalizedSafety> = {}): NormalizedSafety => ({
  available: true,
  simChecked: true,
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
  holderCount: 2,
  topHolderPct: 20,
  lpLocked: true,
  lpBurnedPct: 0,
  lpLockedPct: 100,
  lpTopUnlockedEoaPct: 0,
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
});

const dossier = (overrides: Partial<TokenDossier> = {}): TokenDossier => ({
  chain: "ethereum",
  safety: safety(),
  topHolders: [
    { address: "0xholder1", percent: 20 },
    { address: "0xholder2", percent: 10 },
  ],
  insiderPct: 30,
  bundleCount: 2,
  bundleRisk: "low",
  deployer: "0x1234567890abcdef",
  cg: {
    listed: true,
    rank: 10,
    mcapUsd: 1_000_000,
    marketCount: 10,
    cexCount: 2,
    cexNames: ["Example One", "Example Two"],
    homepage: null,
    twitter: null,
    image: null,
    description: null,
  },
  ...overrides,
} as TokenDossier);

function byLabel(checks: ScanCheck[], label: string): ScanCheck {
  const check = checks.find((candidate) => candidate.label === label);
  if (!check) throw new Error(`Missing check: ${label}`);
  return check;
}

describe("summarizeChecks", () => {
  it("separates successful execution from unknown, unavailable, and stale coverage", () => {
    const statuses: CheckStatus[] = [
      "confirmed",
      "finding",
      "checked-empty",
      "not-applicable",
      "unknown",
      "unavailable",
      "stale",
    ];
    const summary = summarizeChecks(statuses.map((status) => ({ label: status, status })));

    expect(summary).toEqual({
      total: 7,
      inScope: 6,
      successful: 3,
      unknownOrFailed: 3,
      findings: 1,
      checkedEmpty: 1,
      notApplicable: 1,
      unavailable: 1,
      stale: 1,
      unknown: 1,
    });
  });
});

describe("tokenChecks", () => {
  it("does not claim a funding trace or lazy panel ran just because a deployer exists", () => {
    const checks = tokenChecks(dossier());

    expect(byLabel(checks, "Operator / funding trace")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "Operator / funding trace").note).toContain("deployer 0x123…cdef resolved");
    expect(byLabel(checks, "Deployer trail (EVM)")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "Bytecode fingerprint (EVM)")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "OFAC sanctions screen")).toMatchObject({ status: "unknown" });
  });

  it("does not turn missing holder data into a clean clustering result", () => {
    const checks = tokenChecks(dossier({
      safety: safety({ available: false, simChecked: false, holderCount: 0, topHolderPct: null }),
      topHolders: [],
      insiderPct: 0,
      bundleCount: 0,
      bundleRisk: "low",
    }));

    expect(byLabel(checks, "Contract safety")).toMatchObject({ status: "unavailable" });
    expect(byLabel(checks, "Holder distribution")).toMatchObject({ status: "unavailable" });
    expect(byLabel(checks, "Wallet clustering")).toMatchObject({ status: "unavailable" });
  });

  it("does not infer clean clustering from default zero values", () => {
    const checks = tokenChecks(dossier({
      insiderPct: 0,
      bundleCount: 0,
      bundleRisk: "low",
    }));

    expect(byLabel(checks, "Wallet clustering")).toMatchObject({ status: "unknown" });
  });

  it("surfaces retained contract controls as findings instead of confirmed success", () => {
    const checks = tokenChecks(dossier({
      safety: safety({ ownerRenounced: false, pausable: true, proxy: true }),
    }));

    expect(byLabel(checks, "Contract safety")).toMatchObject({ status: "finding" });
    expect(byLabel(checks, "Contract safety").note).toContain("owner active");
    expect(byLabel(checks, "Contract safety").note).toContain("transfers can be paused");
  });

  it("uses checked-empty only for an explicit completed not-found response", () => {
    const notListed = tokenChecks(dossier({
      cg: {
        listed: false,
        rank: null,
        mcapUsd: null,
        marketCount: 0,
        cexCount: 0,
        cexNames: [],
        homepage: null,
        twitter: null,
        image: null,
        description: null,
      },
    }));
    const noOutcome = tokenChecks(dossier({ cg: null }));

    expect(byLabel(notListed, "Market intelligence")).toMatchObject({ status: "checked-empty" });
    expect(byLabel(noOutcome, "Market intelligence")).toMatchObject({ status: "unknown" });
  });
});

describe("personChecks", () => {
  it("treats roles and a resolved name as eligibility, not proof of execution", () => {
    const checks = personChecks({
      identityConfidence: "Confirmed",
      realName: true,
      roles: ["KOL", "INVESTOR"],
      hasAssociates: false,
    });

    expect(byLabel(checks, "Identity resolution")).toMatchObject({ status: "confirmed" });
    expect(byLabel(checks, "Promoted-token performance")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "Portfolio track record")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "US legal history")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "OFAC sanctions (name)")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "Affiliations & associates")).toMatchObject({ status: "unknown" });
  });

  it("marks role-specific checks not applicable when the role is absent", () => {
    const checks = personChecks({ roles: ["FOUNDER"], hasAssociates: false });

    expect(byLabel(checks, "Identity resolution")).toMatchObject({ status: "unknown" });
    expect(byLabel(checks, "Promoted-token performance")).toMatchObject({ status: "not-applicable" });
    expect(byLabel(checks, "Portfolio track record")).toMatchObject({ status: "not-applicable" });
    expect(byLabel(checks, "Canonical project token")).toMatchObject({ status: "not-applicable" });
  });

  it("exposes the six project diligence lanes when PROJECT is held", () => {
    const checks = personChecks({ roles: ["PROJECT"], hasAssociates: false });

    for (const label of [
      "Canonical project token",
      "Product and website substance",
      "Project team identity",
      "Backing and partners",
      "Traction and liveness",
      "Transparency and disclosures",
    ]) {
      expect(byLabel(checks, label)).toMatchObject({ status: "unknown" });
    }
  });
});

describe("clearanceCoverage (full-clearance coverage policy)", () => {
  const row = (checkId: string, status: CheckStatus, decisionCritical = true): ScanCheck => ({
    label: checkId,
    status,
    decisionCritical,
    checkId,
  });

  it("grants clearance at the floor when every safety screen is recorded", () => {
    const checks = [
      row("identity-resolution", "confirmed"),
      row("ofac-sanctions-name", "checked-empty"),
      row("trust-graph-connections", "checked-empty"),
      row("news-press", "confirmed"),
      row("us-legal-history", "checked-empty"),
      row("affiliations-associates", "confirmed"),
      row("career-enrichment", "unavailable"),
      row("basic-facts-research", "unknown"),
    ];
    const coverage = clearanceCoverage(checks);
    expect(coverage.recorded).toBe(6);
    expect(coverage.applicable).toBe(8);
    expect(coverage.recordedPercent).toBe(75);
    expect(coverage.openNeverWaive).toEqual([]);
    expect(coverage.sufficient).toBe(true);
  });

  it("never waives an open sanctions screen regardless of coverage", () => {
    const checks = [
      row("identity-resolution", "confirmed"),
      row("ofac-sanctions-name", "unavailable"),
      ...Array.from({ length: 10 }, (_, index) => row(`enrichment-${index}`, "confirmed" as CheckStatus)),
    ];
    const coverage = clearanceCoverage(checks);
    expect(coverage.recordedPercent).toBeGreaterThanOrEqual(90);
    expect(coverage.openNeverWaive).toEqual(["ofac-sanctions-name"]);
    expect(coverage.sufficient).toBe(false);
  });

  it("never waives an unresolved founder asset distinction", () => {
    const checks = [
      row("identity-resolution", "confirmed"),
      row("ofac-sanctions-name", "checked-empty"),
      row("trust-graph-connections", "checked-empty"),
      row("founder-asset-distinction", "unavailable"),
      ...Array.from({ length: 8 }, (_, index) => row(`enrichment-${index}`, "confirmed" as CheckStatus)),
    ];
    const coverage = clearanceCoverage(checks);
    expect(coverage.openNeverWaive).toEqual(["founder-asset-distinction"]);
    expect(coverage.sufficient).toBe(false);
  });

  it("withholds clearance below the coverage floor even with safety screens recorded", () => {
    const checks = [
      row("identity-resolution", "confirmed"),
      row("ofac-sanctions-name", "checked-empty"),
      row("trust-graph-connections", "checked-empty"),
      row("gap-1", "unknown"),
      row("gap-2", "unknown"),
      row("gap-3", "unavailable"),
    ];
    // 3/6 = 50% < 75% floor: too many gaps.
    expect(clearanceCoverage(checks).sufficient).toBe(false);
  });

  it("keeps the strict everything-recorded rule for legacy rows without check ids", () => {
    const legacy = (status: CheckStatus): ScanCheck => ({ label: "legacy", status });
    expect(clearanceCoverage([legacy("confirmed"), legacy("confirmed"), legacy("confirmed"), legacy("unknown")]).sufficient).toBe(false);
    expect(clearanceCoverage([legacy("confirmed"), legacy("confirmed")]).sufficient).toBe(true);
  });
});
