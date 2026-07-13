import { describe, expect, it } from "vitest";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
import { presentPublicReport } from "../src/lib/reportPresentation";
import { PersonCheckTracker, type PersonCheckScope } from "./checks";

const byId = (tracker: PersonCheckTracker, roles: string[], id: string, scope?: PersonCheckScope) =>
  tracker.snapshot(roles, scope).find((check) => check.checkId === id);

describe("PersonCheckTracker", () => {
  it("does not turn an executed provider into a completed check", () => {
    const tracker = new PersonCheckTracker();
    tracker.provider("github", "GitHub", "executed");

    expect(byId(tracker, ["FOUNDER"], "code-footprint-github")?.status).toBe("unknown");
    expect(tracker.completeness(["FOUNDER"])).toBe("partial");
    expect(tracker.providers().runs).toMatchObject([{ id: "github", state: "executed" }]);
  });

  it("preserves a negative finding when another provider later returns clean data", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "promoted-token-performance",
      status: "finding",
      note: "verified contract is down 96% from ATH",
      provider: "coingecko",
      sourceCount: 1,
    });
    tracker.record({
      id: "promoted-token-performance",
      status: "confirmed",
      note: "current liquidity snapshot returned",
      provider: "dexscreener",
      sourceCount: 1,
    });

    const check = byId(tracker, ["KOL"], "promoted-token-performance");
    expect(check?.status).toBe("finding");
    expect(check?.note).toContain("down 96%");
    expect(check?.provider).toBe("coingecko,dexscreener");
    expect(check?.sourceCount).toBe(2);
  });

  it("lets verified portfolio evidence outrank an unavailable optional vendor", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "vc-portfolio-track-record",
      status: "unavailable",
      note: "optional company database not configured",
      provider: "crunchbase",
    });
    tracker.record({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      note: "two unique investments verified from fetched public sources",
      provider: "portfolio-web",
      sourceCount: 2,
    });

    expect(byId(tracker, ["INVESTOR"], "vc-portfolio-track-record")).toMatchObject({
      status: "confirmed",
      provider: "crunchbase,portfolio-web",
      sourceCount: 2,
    });
  });

  it("keeps unexecuted high-risk screens unknown and role-only checks out of scope", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "identity-resolution",
      status: "checked-empty",
      note: "no licensed identity match returned",
      provider: "peopledatalabs",
    });

    expect(byId(tracker, ["FOUNDER"], "identity-resolution")?.status).toBe("checked-empty");
    for (const id of [
      "profile-photo-authenticity",
      "news-press",
      "us-legal-history",
      "ofac-sanctions-name",
      "trust-graph-connections",
    ]) {
      expect(byId(tracker, ["FOUNDER"], id)?.status).toBe("unknown");
    }
    expect(byId(tracker, ["FOUNDER"], "promoted-token-performance")?.status).toBe("not-applicable");
    expect(byId(tracker, ["FOUNDER"], "vc-portfolio-track-record")?.status).toBe("not-applicable");
    expect(byId(tracker, ["FOUNDER"], "project-token-identity")?.status).toBe("not-applicable");
  });

  it("uses project-specific coverage instead of treating the person checklist as complete", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "profile-photo-authenticity",
      "code-footprint-github",
      "identity-continuity",
      "affiliations-associates",
      "news-press",
      "trust-graph-connections",
      "project-token-identity",
    ] as const) {
      tracker.record({ id, status: "confirmed", note: `${id} completed`, provider: "test-provider" });
    }

    const checks = tracker.snapshot(["PROJECT"], { resolvedRealName: false });
    expect(byId(tracker, ["PROJECT"], "project-token-identity")?.status).toBe("confirmed");
    for (const id of [
      "project-product-substance",
      "project-team-identity",
      "project-backing-partners",
      "project-traction-liveness",
      "project-transparency",
    ]) {
      expect(checks.find((check) => check.checkId === id)?.status).toBe("unknown");
    }
    expect(deriveDecisionReadiness(checks).status).not.toBe("ready");
  });

  it("presents a fully evidenced Jupiter-like project as final PASS, not provisional", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "code-footprint-github",
      "identity-continuity",
      "affiliations-associates",
      "project-token-identity",
      "project-product-substance",
      "project-team-identity",
      "project-backing-partners",
      "project-traction-liveness",
      "project-transparency",
      "news-press",
      "trust-graph-connections",
    ] as const) {
      tracker.record({
        id,
        status: "confirmed",
        note: id === "project-transparency"
          ? "governance, token economics, and an independent security audit were verified from cited sources"
          : `${id} completed from frozen cited evidence`,
        provider: "jupiter-canary",
        sourceCount: 1,
      });
    }

    const checks = tracker.snapshot(["PROJECT"], { resolvedRealName: false });
    const readiness = deriveDecisionReadiness(checks, {
      roleCount: 1,
      decisionAxisTotal: 6,
      evidenceBackedAxes: 6,
    });
    const completeness = tracker.completeness(["PROJECT"], { resolvedRealName: false });
    const presentation = presentPublicReport({
      verdict: "PASS",
      score: 90,
      completeness,
      attestation: "server_collected",
      checks,
      readiness: {
        ...readiness,
        roleCount: 1,
        neededEvidenceSummary: "No evidence checks remain open.",
      },
    });

    expect(readiness).toMatchObject({
      status: "ready",
      successful: 6,
      applicable: 6,
      coveragePercent: 100,
      unresolved: 0,
    });
    expect(completeness).toBe("complete");
    expect(presentation).toMatchObject({
      displayVerdict: "PASS",
      readinessLabel: "EVIDENCE COVERAGE COMPLETE",
      primaryScore: "90",
      scoreLabel: "SCORE",
      final: true,
    });
  });

  it("keeps profile-photo integrity out of scope for a project-only brand account", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "profile-photo-authenticity",
      status: "confirmed",
      note: "a profile image outcome was recorded before project routing completed",
      provider: "profile-photo",
    });

    expect(byId(tracker, ["PROJECT"], "profile-photo-authenticity")).toMatchObject({
      status: "not-applicable",
      note: "not applicable to a project-only brand account",
    });
  });

  it("keeps profile-photo integrity applicable when a project account also has a person role", () => {
    const tracker = new PersonCheckTracker();

    expect(byId(tracker, ["PROJECT", "FOUNDER"], "profile-photo-authenticity")).toMatchObject({
      status: "unknown",
      note: "server collector did not run a profile-photo integrity screen",
    });
    expect(byId(tracker, ["FOUNDER"], "profile-photo-authenticity")?.status).toBe("unknown");
  });

  it("records a genuinely unavailable provider without calling it successful", () => {
    const tracker = new PersonCheckTracker();
    tracker.record({
      id: "code-footprint-github",
      status: "unavailable",
      note: "GitHub provider is not configured",
      provider: "github",
    });

    expect(byId(tracker, ["FOUNDER"], "code-footprint-github")?.status).toBe("unavailable");
    expect(tracker.completeness(["FOUNDER"])).toBe("partial");
  });

  it("makes name-only screens applicable only after a real name is resolved", () => {
    const tracker = new PersonCheckTracker();

    expect(byId(tracker, ["FOUNDER"], "us-legal-history", { resolvedRealName: false })?.status).toBe("not-applicable");
    expect(byId(tracker, ["FOUNDER"], "ofac-sanctions-name", { resolvedRealName: false })?.status).toBe("not-applicable");
    expect(byId(tracker, ["FOUNDER"], "us-legal-history", { resolvedRealName: true })?.status).toBe("unknown");
  });

  it("preserves a partial provider run for the analyst snapshot", () => {
    const tracker = new PersonCheckTracker();
    tracker.provider("offchain-diligence", "News, legal, and sanctions", "partial", "one provider failed");

    expect(tracker.providers().runs).toContainEqual(expect.objectContaining({
      id: "offchain-diligence",
      state: "partial",
      detail: "one provider failed",
    }));
  });

  it("keeps a partial portfolio adapter run visible while treating a strong verified track record as a completed check", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "profile-photo-authenticity",
      "code-footprint-github",
      "identity-continuity",
      "affiliations-associates",
      "news-press",
      "trust-graph-connections",
    ] as const) {
      tracker.record({ id, status: "checked-empty", note: `${id} completed`, provider: "test-provider" });
    }
    tracker.record({
      id: "vc-portfolio-track-record",
      status: "confirmed",
      note: "6 relationships verified; bounded candidate coverage remained partial because 1 cited source fetch failed",
      provider: "portfolio-web",
      sourceCount: 6,
    });
    tracker.provider(
      "portfolio-verification",
      "Source-backed portfolio verification",
      "partial",
      "6 verified · 0 reported · 1 incomplete",
    );

    const scope = { resolvedRealName: false };
    const checks = tracker.snapshot(["INVESTOR"], scope);
    expect(checks.find((check) => check.checkId === "vc-portfolio-track-record")).toMatchObject({
      status: "confirmed",
      sourceCount: 6,
      note: expect.stringContaining("1 cited source fetch failed"),
    });
    expect(tracker.providers().runs).toContainEqual(expect.objectContaining({
      id: "portfolio-verification",
      state: "partial",
      detail: "6 verified · 0 reported · 1 incomplete",
    }));
    expect(tracker.completeness(["INVESTOR"], scope)).toBe("complete");
    expect(deriveDecisionReadiness(checks)).toMatchObject({
      status: "ready",
      coveragePercent: 100,
      unresolved: 0,
    });
  });

  it("keeps a not-applicable provider run explicitly skipped", () => {
    const tracker = new PersonCheckTracker();
    tracker.provider("onchain", "On-chain forensics (Helius)", "skipped", "no attributed Solana wallet");

    expect(tracker.providers().runs).toContainEqual(expect.objectContaining({
      id: "onchain",
      state: "skipped",
      detail: "no attributed Solana wallet",
    }));
    expect(tracker.completeness(["FOUNDER"])).toBe("partial");
  });

  it("does not mistake completed provider tranches for answered founder questions", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "code-footprint-github",
      "identity-continuity",
      "affiliations-associates",
      "news-press",
      "us-legal-history",
      "ofac-sanctions-name",
    ] as const) {
      tracker.record({ id, status: "checked-empty", note: `${id} completed`, provider: "test-provider" });
    }

    const readiness = deriveDecisionReadiness(tracker.snapshot(["FOUNDER"], { resolvedRealName: true }));
    expect(readiness).toMatchObject({ status: "incomplete", successful: 0, applicable: 6, coveragePercent: 0 });
  });

  it("reaches decision-ready founder coverage from investor questions, not optional provider bookkeeping", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "founder-identity-authority",
      "founder-company-relationships",
      "founder-track-record",
      "founder-control-conflicts",
      "founder-legal-regulatory",
      "founder-asset-distinction",
    ] as const) {
      tracker.record({ id, status: "checked-empty", note: `${id} completed`, provider: "test-provider" });
    }

    const checks = tracker.snapshot(["FOUNDER"], { resolvedRealName: true });
    const readiness = deriveDecisionReadiness(checks);

    expect(readiness).toMatchObject({ status: "ready", successful: 6, applicable: 6, coveragePercent: 100 });
    expect(tracker.completeness(["FOUNDER"], { resolvedRealName: true })).toBe("complete");
    expect(byId(tracker, ["FOUNDER"], "profile-photo-authenticity")?.decisionCritical).toBe(false);
    expect(byId(tracker, ["FOUNDER"], "trust-graph-connections")?.decisionCritical).toBe(false);
  });
});
