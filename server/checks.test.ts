import { describe, expect, it } from "vitest";
import { PersonCheckTracker } from "./checks";

const byId = (tracker: PersonCheckTracker, roles: string[], id: string) =>
  tracker.snapshot(roles).find((check) => check.checkId === id);

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
});
