import { describe, expect, it } from "vitest";
import type { Dossier } from "../data/dossier";
import { reportChecks, reportCompleteness } from "./reports";

const legacyDossier = {
  report: { identity_confidence: "Confirmed", roles: ["FOUNDER"] },
  display_name: "Example Founder",
  handle: "@example",
  evidence: { associates: [] },
} as unknown as Dossier;

describe("person report synchronization", () => {
  it("prefers server-frozen check runs over evidence-derived guesses", () => {
    const dossier = {
      ...legacyDossier,
      checkRuns: [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "checked-empty" as const,
        note: "licensed resolver returned no match",
        provider: "peopledatalabs",
      }],
      completeness_state: "partial" as const,
    };

    expect(reportChecks("person", dossier)).toEqual(dossier.checkRuns);
    expect(reportCompleteness("person", dossier)).toBe("partial");
  });

  it("keeps legacy dossiers compatible by deriving their checklist", () => {
    const checks = reportChecks("person", legacyDossier);

    expect(checks.length).toBeGreaterThan(1);
    expect(checks.find((check) => check.label === "Profile-photo authenticity")?.status).toBe("unknown");
    expect(reportCompleteness("person", legacyDossier, checks)).toBe("partial");
  });
});
