import { describe, expect, it } from "vitest";
import {
  deriveDecisionReadiness,
  PROVISIONAL_COVERAGE_FLOOR_PERCENT,
} from "./decisionReadiness";
import type { CheckStatus, ScanCheck } from "./scanChecklist";

const checks = (statuses: readonly CheckStatus[]): ScanCheck[] =>
  statuses.map((status, index) => ({ label: `Check ${index + 1}`, status }));

describe("deriveDecisionReadiness", () => {
  it("keeps an empty or entirely not-applicable report incomplete", () => {
    expect(deriveDecisionReadiness([])).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      applicable: 0,
      successful: 0,
      unresolved: 0,
      title: "Report not ready",
    });

    const result = deriveDecisionReadiness(checks(["not-applicable", "not-applicable"]));
    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      total: 2,
      applicable: 0,
      notApplicable: 2,
    });
    expect(result.guidance).toContain("No checks were available");
  });

  it("reports each unresolved reason and keeps thin coverage incomplete", () => {
    const result = deriveDecisionReadiness(checks([
      "confirmed",
      "unknown",
      "unknown",
      "unavailable",
      "stale",
      "not-applicable",
    ]));

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 20,
      total: 6,
      applicable: 5,
      successful: 1,
      unresolved: 4,
      unknown: 2,
      providerUnavailable: 1,
      stale: 1,
      notApplicable: 1,
    });
    expect(result.guidance).toContain("2 did not finish");
    expect(result.guidance).toContain("1 source unavailable");
    expect(result.guidance).toContain("Do not rely on the score or result yet");
  });

  it("marks substantial but unfinished coverage provisional at the policy floor", () => {
    const completed: CheckStatus[] = Array.from({ length: 7 }, () => "confirmed");
    const result = deriveDecisionReadiness(checks([
      ...completed,
      "unknown",
      "unavailable",
      "stale",
    ]));

    expect(PROVISIONAL_COVERAGE_FLOOR_PERCENT).toBe(70);
    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 70,
      applicable: 10,
      successful: 7,
      unresolved: 3,
      title: "Review with gaps",
    });
    expect(result.guidance).toContain("Treat the result as an early read");
  });

  it("requires every applicable check to have an observable outcome before becoming ready", () => {
    const result = deriveDecisionReadiness(checks([
      "confirmed",
      "finding",
      "checked-empty",
      "not-applicable",
    ]));

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      applicable: 3,
      successful: 3,
      unresolved: 0,
      findings: 1,
      checkedEmpty: 1,
      title: "Safety checks finished: review the warnings",
    });
    expect(result.guidance).toContain("1 warning needs your review");
    expect(result.guidance).toContain("not financial advice");
  });

  it("floors display coverage so an unresolved check never rounds up to 100%", () => {
    const almostComplete: CheckStatus[] = [
      ...Array.from({ length: 199 }, () => "confirmed" as const),
      "unknown",
    ];
    const result = deriveDecisionReadiness(checks(almostComplete));

    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 99,
      applicable: 200,
      successful: 199,
      unresolved: 1,
    });
  });

  it("does not confuse a completed finding with missing execution coverage", () => {
    const result = deriveDecisionReadiness(checks(["finding", "finding"]));

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      successful: 2,
      findings: 2,
      unknown: 0,
    });
  });

  it("counts a confirmed bounded outcome as ready even when its note preserves partial candidate coverage", () => {
    const result = deriveDecisionReadiness([{
      label: "Portfolio track record",
      status: "confirmed",
      note: "6 relationships verified; bounded candidate coverage remained partial because 1 cited source fetch failed",
      provider: "portfolio-web",
      sourceCount: 6,
    }]);

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      applicable: 1,
      successful: 1,
      unresolved: 0,
      providerUnavailable: 0,
    });
  });

  it("lets explicit decision questions govern readiness while preserving provider diagnostics", () => {
    const result = deriveDecisionReadiness([
      { label: "Verified identity and authority", status: "confirmed", decisionCritical: true },
      { label: "Track record", status: "confirmed", decisionCritical: true },
      { label: "Optional company database", status: "unavailable", decisionCritical: false },
      { label: "Profile image enrichment", status: "unknown", decisionCritical: false },
    ]);

    expect(result).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      total: 2,
      applicable: 2,
      successful: 2,
      unresolved: 0,
      providerUnavailable: 0,
    });
  });

  it("keeps all-check readiness semantics for legacy snapshots without criticality markers", () => {
    const result = deriveDecisionReadiness(checks(["confirmed", "unavailable"]));

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 50,
      applicable: 2,
      successful: 1,
      providerUnavailable: 1,
    });
  });

  it("never calls a zero-role, zero-axis report decision-ready", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding", "checked-empty"]),
      { roleCount: 0, decisionAxisTotal: 0, evidenceBackedAxes: 0 },
    );

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      successful: 3,
      applicable: 3,
      unresolved: 1,
      decisionBlockers: 1,
      title: "ARGUS could not identify what this account represents",
    });
    expect(result.guidance).toContain("Use the facts as research");
  });

  it("labels a resolved role with no governing axes as incomplete scoring, not failed routing", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding", "checked-empty"]),
      { roleCount: 1, decisionAxisTotal: 0, evidenceBackedAxes: 0 },
    );

    expect(result).toMatchObject({
      status: "incomplete",
      coveragePercent: 0,
      successful: 3,
      applicable: 3,
      unresolved: 1,
      decisionBlockers: 1,
      title: "The score is not ready",
    });
    expect(result.guidance).toContain("identified the subject");
    expect(result.guidance).toContain("scoring step did not finish");
    expect(result.guidance).not.toContain("could not identify");
  });

  it("requires qualifying support for every governing axis before becoming ready", () => {
    const result = deriveDecisionReadiness(
      checks(["confirmed", "finding"]),
      { roleCount: 1, decisionAxisTotal: 4, evidenceBackedAxes: 3 },
    );

    expect(result).toMatchObject({
      status: "provisional",
      coveragePercent: 75,
      unresolved: 1,
      decisionAxisTotal: 4,
      evidenceBackedAxes: 3,
      decisionBlockers: 1,
      title: "Review with gaps",
    });
    expect(result.guidance).toContain("1 part of the score does not have a saved source");
  });
});

describe("investigation token readiness end to end", () => {
  // The $VVV shape: a keyless token audit (5 recorded outcomes) whose
  // investigation also ran the OFAC address screen and bound the token to a
  // fully scanned project account. Reconciliation must lift readiness out of
  // "incomplete" without waiving the genuinely un-run deployer-side checks.
  it("reaches ready once the never-waive screens record and org-side outcomes reconcile", async () => {
    const { tokenChecks, reconcileInvestigationChecks } = await import("./scanChecklist");
    const dossier = {
      chain: "base",
      deployer: "0xc9c88391e50eeadb43647fac514fa26f8dfd7e7f",
      topHolders: [{ address: "0xholder1", percent: 20 }],
      insiderPct: 20,
      bundleCount: 1,
      bundleRisk: "low",
      safety: {
        available: true, simChecked: true, honeypot: false, cannotSellAll: false,
        buyTax: 0, sellTax: 0, holderCount: 140755, topHolderPct: 12,
        ownerRenounced: true, mintable: false, freezable: false, nonTransferable: false,
        takeBack: false, hiddenOwner: false, selfdestruct: false, pausable: false,
        openSource: true, metadataMutable: false, lpLocked: true, lpBurnedPct: 0,
        lpLockedPct: 100, lpTopUnlockedEoaPct: 0, balanceMutable: false,
        transferHook: false, transferFee: false, proxy: false, slippageModifiable: false,
        blacklist: false, tradingCooldown: false, externalCall: false,
        ownerChangeBalance: false, serialScammerCreator: false, honeypotOnchain: false,
        creatorPercent: 0,
      },
      cg: { listed: true, rank: 120, mcapUsd: 520_000_000, marketCount: 60, cexCount: 42, cexNames: [], homepage: null, twitter: null, image: null, description: null },
      sanctionsScreen: { available: true, checked: 11, listSize: 700, sanctioned: [], completedAt: "2026-07-15T16:00:00.000Z" },
    };
    const projectAccount = {
      handle: "@askvenice",
      projectToken: { address: "0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf" },
      checkRuns: [
        { checkId: "project-token-identity", label: "Canonical project token", status: "confirmed" as const },
        { checkId: "news-press", label: "News & press", status: "confirmed" as const, note: "2 press results frozen" },
        { checkId: "code-footprint-github", label: "Code footprint (GitHub)", status: "confirmed" as const, note: "github.com/veniceai resolved" },
        { checkId: "project-transparency", label: "Transparency and disclosures", status: "confirmed" as const, note: "2 disclosures frozen" },
        { checkId: "trust-graph-connections", label: "Trust-graph connections", status: "checked-empty" as const, note: "no prior-report connection" },
      ],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = reconcileInvestigationChecks(tokenChecks(dossier as any), "0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf", projectAccount);
    const readiness = deriveDecisionReadiness(rows);

    expect(readiness.applicable).toBe(13);
    expect(readiness.successful).toBe(10);
    expect(readiness.status).toBe("ready");

    // Without the reconciliation the same scan is stuck below the provisional
    // floor: the historical "5 of 13" defect.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unreconciled = deriveDecisionReadiness(tokenChecks({ ...dossier, sanctionsScreen: undefined } as any));
    expect(unreconciled.successful).toBe(5);
    expect(unreconciled.status).toBe("incomplete");
  });
});
