import { describe, expect, it } from "vitest";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
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

  it("lets the frozen off-chain tranche raise a resolved founder to provisional coverage", () => {
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
    expect(readiness).toMatchObject({ status: "provisional", successful: 7, applicable: 9, coveragePercent: 77 });
  });

  it("reaches decision-ready coverage only after profile and trust-graph outcomes are frozen too", () => {
    const tracker = new PersonCheckTracker();
    for (const id of [
      "identity-resolution",
      "profile-photo-authenticity",
      "code-footprint-github",
      "identity-continuity",
      "affiliations-associates",
      "news-press",
      "us-legal-history",
      "ofac-sanctions-name",
      "trust-graph-connections",
    ] as const) {
      tracker.record({ id, status: "checked-empty", note: `${id} completed`, provider: "test-provider" });
    }

    const checks = tracker.snapshot(["FOUNDER"], { resolvedRealName: true });
    const readiness = deriveDecisionReadiness(checks);

    expect(readiness).toMatchObject({ status: "ready", successful: 9, applicable: 9, coveragePercent: 100 });
    expect(tracker.completeness(["FOUNDER"], { resolvedRealName: true })).toBe("complete");
  });
});
