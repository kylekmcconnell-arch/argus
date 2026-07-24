import { describe, expect, it } from "vitest";
import type { NormalizedSafety, TokenDossier } from "../token/audit";
import {
  clearanceCoverage,
  personChecks,
  reconcileInvestigationChecks,
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

  it("keeps visual profile-photo review leads visible without calling them adverse", () => {
    const summary = summarizeChecks([
      {
        checkId: "profile-photo-authenticity",
        label: "Profile-photo integrity",
        status: "finding",
      },
      {
        checkId: "trust-graph-connections",
        label: "Trust-graph connections",
        status: "finding",
      },
    ]);

    expect(summary.successful).toBe(2);
    expect(summary.findings).toBe(1);
  });

  it("does not turn an uncorroborated follow graph tie into an adverse finding", () => {
    const nonFollowing = summarizeChecks([{
      checkId: "affiliations-associates",
      label: "Affiliations & associates",
      status: "finding",
      note: "4 claimed relationships checked in the X follow graph · 1 did not follow the subject",
    }]);
    const contradicted = summarizeChecks([{
      checkId: "affiliations-associates",
      label: "Affiliations & associates",
      status: "finding",
      note: "1 claimed relationship was explicitly contradicted by the named party",
    }]);

    expect(nonFollowing.findings).toBe(0);
    expect(contradicted.findings).toBe(1);
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

describe("token OFAC address screen recording", () => {
  it("records a clean scan-time screen as confirmed with the screened counts", () => {
    const checks = tokenChecks(dossier({
      sanctionsScreen: { available: true, checked: 11, listSize: 700, sanctioned: [], completedAt: "2026-07-15T16:00:00.000Z" },
    }));
    const row = byLabel(checks, "OFAC sanctions screen");

    expect(row.status).toBe("confirmed");
    expect(row.checkId).toBe("ofac-sanctions-address");
    expect(row.note).toContain("11 addresses");
    expect(row.note).toContain("700-entry");
    expect(row.note).toContain("no matches");
    expect(row.completedAt).toBe("2026-07-15T16:00:00.000Z");
  });

  it("records an SDN hit as a finding, never a pass", () => {
    const checks = tokenChecks(dossier({
      sanctionsScreen: { available: true, checked: 11, sanctioned: ["0xdeadbeef00000000"], completedAt: "2026-07-15T16:00:00.000Z" },
    }));

    expect(byLabel(checks, "OFAC sanctions screen")).toMatchObject({ status: "finding" });
    expect(byLabel(checks, "OFAC sanctions screen").note).toContain("1 of 11");
  });

  it("records an unreachable list as unavailable instead of silently clean, and legacy dossiers stay unknown", () => {
    const unreachable = tokenChecks(dossier({
      sanctionsScreen: { available: false, checked: 11, sanctioned: [], completedAt: "2026-07-15T16:00:00.000Z" },
    }));
    const legacy = tokenChecks(dossier());

    expect(byLabel(unreachable, "OFAC sanctions screen")).toMatchObject({ status: "unavailable" });
    expect(byLabel(legacy, "OFAC sanctions screen")).toMatchObject({ status: "unknown" });
  });
});

describe("reconcileInvestigationChecks", () => {
  const TOKEN_ADDRESS = "0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf";
  const projectRows = (): ScanCheck[] => [
    { checkId: "project-token-identity", label: "Canonical project token", status: "confirmed", note: "$VVV matched this project through its official X account" },
    { checkId: "news-press", label: "News & press", status: "confirmed", note: "2 exact-name crypto press results frozen", provider: "google-news", sourceCount: 2 },
    { checkId: "code-footprint-github", label: "Code footprint (GitHub)", status: "confirmed", note: "github.com/veniceai resolved through its X handle field" },
    { checkId: "project-transparency", label: "Transparency and disclosures", status: "confirmed", note: "2 disclosures frozen" },
    { checkId: "trust-graph-connections", label: "Trust-graph connections", status: "checked-empty", note: "No connection to a prior authoritative ARGUS report was found" },
  ];
  const boundAccount = (overrides: Partial<{ checkRuns: ScanCheck[]; handle: string; address: string }> = {}) => ({
    checkRuns: overrides.checkRuns ?? projectRows(),
    handle: overrides.handle ?? "@askvenice",
    projectToken: { address: overrides.address ?? "0xACFE6019ed1A7Dc6f7B508C02d1b04ec88cC21bf" },
  });

  it("credits org-side outcomes through a confirmed canonical binding with provenance notes", () => {
    const rows = reconcileInvestigationChecks(tokenChecks(dossier()), TOKEN_ADDRESS, boundAccount());

    expect(byLabel(rows, "News & press").status).toBe("confirmed");
    expect(byLabel(rows, "News & press").note).toContain("recorded on the bound project account scan (@askvenice)");
    expect(byLabel(rows, "News & press").sourceCount).toBe(2);
    expect(byLabel(rows, "GitHub forensics").status).toBe("confirmed");
    expect(byLabel(rows, "Documents & audits").status).toBe("confirmed");
    expect(byLabel(rows, "Trust-graph reconciliation").status).toBe("checked-empty");
    // never credited: no recorded source exists for these
    expect(byLabel(rows, "Operator / funding trace").status).toBe("unknown");
    expect(byLabel(rows, "Deployer trail (EVM)").status).toBe("unknown");
  });

  it("credits nothing without a confirmed canonical binding", () => {
    const unbound = projectRows().map((row) =>
      row.checkId === "project-token-identity" ? { ...row, status: "unknown" as CheckStatus } : row);
    const rows = reconcileInvestigationChecks(tokenChecks(dossier()), TOKEN_ADDRESS, boundAccount({ checkRuns: unbound }));

    expect(byLabel(rows, "News & press").status).toBe("unknown");
    expect(byLabel(rows, "GitHub forensics").status).toBe("unknown");
  });

  it("credits nothing when the bound token address is a different asset", () => {
    const rows = reconcileInvestigationChecks(
      tokenChecks(dossier()),
      TOKEN_ADDRESS,
      boundAccount({ address: "0x1111111111111111111111111111111111111111" }),
    );

    expect(byLabel(rows, "News & press").status).toBe("unknown");
    expect(byLabel(rows, "Documents & audits").status).toBe("unknown");
  });

  it("never overwrites a recorded token outcome and never credits from an unrecorded source", () => {
    const sources = projectRows().map((row) =>
      row.checkId === "news-press" ? { ...row, status: "unknown" as CheckStatus } : row);
    const tokenRows = tokenChecks(dossier()).map((row) =>
      row.checkId === "documents-audits"
        ? { ...row, status: "finding" as CheckStatus, note: "token-side docs finding already recorded" }
        : row);
    const rows = reconcileInvestigationChecks(tokenRows, TOKEN_ADDRESS, boundAccount({ checkRuns: sources }));

    expect(byLabel(rows, "News & press").status).toBe("unknown");
    expect(byLabel(rows, "Documents & audits")).toMatchObject({
      status: "finding",
      note: "token-side docs finding already recorded",
    });
  });

  it("is a no-op without a project account", () => {
    const base = tokenChecks(dossier());
    expect(reconcileInvestigationChecks(base, TOKEN_ADDRESS, null)).toEqual(base);
    expect(reconcileInvestigationChecks(base, TOKEN_ADDRESS, undefined)).toEqual(base);
  });

  it("stores an explicit unavailable outcome when the embedded project audit fails", () => {
    const rows = reconcileInvestigationChecks(
      tokenChecks(dossier()),
      TOKEN_ADDRESS,
      null,
      {
        state: "failed",
        note: "Embedded project-account audit failed for @askvenice: invalid analyst response.",
      },
    );

    for (const label of [
      "News & press",
      "GitHub forensics",
      "Documents & audits",
      "Trust-graph reconciliation",
    ]) {
      expect(byLabel(rows, label)).toMatchObject({
        status: "unavailable",
        provider: "project-account-audit",
      });
      expect(byLabel(rows, label).note).toContain("invalid analyst response");
    }
  });
});

describe("token operator/funding trace (Arkham deployer risk)", () => {
  const at = "2026-07-16T00:00:00.000Z";

  it("records a clean trace as confirmed (no funding source surfaced)", () => {
    const checks = tokenChecks(dossier({ deployerRisk: { available: true, paths: [], completedAt: at } }));
    const row = byLabel(checks, "Operator / funding trace");
    expect(row.status).toBe("confirmed");
    expect(row.checkId).toBe("operator-funding-trace");
    expect(row.note).toContain("no flagged-entity funding source");
    expect(row.completedAt).toBe(at);
  });

  it("records inbound (backward) exposure to a flagged entity as a finding with entity + hops", () => {
    const checks = tokenChecks(dossier({
      deployerRisk: {
        available: true,
        paths: [{ seed: "0xbad", seedName: "Tornado.Cash", category: "mixer", direction: "backward", score: 9, usd: 72_000_000, hops: 1 }],
        completedAt: at,
      },
    }));
    const row = byLabel(checks, "Operator / funding trace");
    expect(row.status).toBe("finding");
    expect(row.note).toContain("Tornado.Cash");
    expect(row.note).toContain("1 hop");
  });

  it("treats outbound-only (forward) exposure as a clean funding source (the check is inbound-scoped)", () => {
    // Outbound exposure still surfaces as a report finding; the funding-source
    // check specifically covers inbound provenance, so it stays confirmed.
    const checks = tokenChecks(dossier({
      deployerRisk: {
        available: true,
        paths: [{ seed: "0xmix", seedName: "Some Mixer", category: "mixer", direction: "forward", score: 5, usd: 1000, hops: 2 }],
        completedAt: at,
      },
    }));
    expect(byLabel(checks, "Operator / funding trace").status).toBe("confirmed");
  });

  it("stays unknown (not recorded) when the trace was unavailable or a legacy dossier never ran it", () => {
    const unavailable = tokenChecks(dossier({ deployerRisk: { available: false, paths: [], completedAt: at } }));
    const legacy = tokenChecks(dossier());
    expect(byLabel(unavailable, "Operator / funding trace").status).toBe("unknown");
    expect(byLabel(legacy, "Operator / funding trace").status).toBe("unknown");
  });
});
