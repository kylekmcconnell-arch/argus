import { describe, expect, it } from "vitest";
import type { Dossier } from "../data/dossier";
import { hasBoundProjectIdentity, isReaderDecisionCheck } from "./verificationQuestionPolicy";

describe("verification question policy", () => {
  it("treats an exact provider-resolved project/domain binding as resolved identity", () => {
    const dossier = {
      handle: "@anyonefdn",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      subjectOrientation: {
        kind: "PROJECT",
        what: "A privacy network.",
        audience: "internet users",
        boundHandle: "anyonefdn",
        boundDomain: "anyone.io",
        sourceUrls: ["https://anyone.io"],
      },
    } satisfies Pick<Dossier, "handle" | "profile_collection_state" | "profile_provider" | "subjectOrientation">;

    expect(hasBoundProjectIdentity(dossier)).toBe(true);
    expect(hasBoundProjectIdentity({ ...dossier, handle: "@namesake" })).toBe(false);
    expect(hasBoundProjectIdentity({ ...dossier, profile_collection_state: "unavailable" })).toBe(false);
  });

  it("keeps graph version diagnostics in methodology instead of Verify next", () => {
    expect(isReaderDecisionCheck({
      checkId: "trust-graph-connections",
      label: "Connection map connections",
      note: "The linked immutable report is not the active case projection.",
    })).toBe(false);
    expect(isReaderDecisionCheck({
      checkId: "independent-security-audit",
      label: "Independent security audit",
      note: "No independent audit was confirmed.",
    })).toBe(true);
  });
});
