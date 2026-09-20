// A withheld score must state its own cause, from the frozen record only.
// The Prologue case: the token side scored 89 while the linked project card
// read "N/A, not measured" with no reason given, which reads as a broken
// product rather than as the coverage limit it is.
import { describe, expect, it } from "vitest";

import { withheldScoreReason } from "./withheldScore";

type Arg = Parameters<typeof withheldScoreReason>[0];

const dossier = (over: {
  governing_score?: number | null;
  roles?: string[];
  profileState?: "resolved" | "unavailable";
  checkRuns?: Array<{ checkId?: string; label: string; status: string; note?: string }>;
  coverage?: { assessedAxes: number; totalAxes: number; missingAxes?: string[] };
}): Arg => ({
  report: {
    governing_score: over.governing_score ?? null,
    roles: over.roles ?? ["PROJECT"],
    ...(over.coverage
      ? { score_coverage: { ...over.coverage, assessedWeight: 0, totalWeight: 100, missingAxes: over.coverage.missingAxes ?? [], provisional: true } }
      : {}),
  },
  profile_collection_state: over.profileState ?? "resolved",
  ...(over.checkRuns ? { checkRuns: over.checkRuns } : {}),
} as unknown as Arg);

describe("withheldScoreReason", () => {
  it("prefers the scan's own frozen sentence about the scoring pass", () => {
    const withOutcome = {
      report: { governing_score: null, roles: ["PROJECT"] },
      profile_collection_state: "resolved",
      scoringOutcome: {
        state: "skipped",
        detail: "coverage preflight abstained; missing substantive evidence for P1_team_and_identity, P2_product_substance; no scorer call made",
        capturedAt: "2026-09-20T00:00:00.000Z",
      },
    } as unknown as Arg;
    const reason = withheldScoreReason(withOutcome);
    expect(reason).toContain("coverage preflight abstained");
    expect(reason).toContain("missing substantive evidence");
    expect(reason).toContain("still collected");
  });

  it("does not use the frozen sentence when the scoring pass actually executed", () => {
    const executed = {
      report: { governing_score: null, roles: [] },
      profile_collection_state: "resolved",
      scoringOutcome: { state: "executed", detail: "complete axis set returned", capturedAt: "2026-09-20T00:00:00.000Z" },
    } as unknown as Arg;
    expect(withheldScoreReason(executed)).toContain("no provider-backed evidence established what this subject is");
  });

  it("returns null when the report actually carries a score", () => {
    expect(withheldScoreReason(dossier({ governing_score: 72 }))).toBeNull();
  });

  it("handles a missing dossier without throwing", () => {
    expect(withheldScoreReason(null)).toBeNull();
    expect(withheldScoreReason(undefined)).toBeNull();
  });

  it("blames the provider read when the subject's own profile never resolved", () => {
    const reason = withheldScoreReason(dossier({ profileState: "unavailable", roles: [] }));
    expect(reason).toContain("could not be read from its provider");
    // It must read as a collection gap, never as a finding about the subject.
    expect(reason).toContain("not a finding about the subject");
  });

  it("does not claim a failed profile read when the field was never recorded", () => {
    // Older frozen reports omit profile_collection_state entirely. Absence of
    // the field is not evidence that the read failed.
    const legacy = { report: { governing_score: null, roles: [] } } as unknown as Arg;
    const reason = withheldScoreReason(legacy);
    expect(reason).not.toContain("could not be read from its provider");
    expect(reason).toContain("no provider-backed evidence established what this subject is");
  });

  it("explains an unresolved role, and says model candidates never route", () => {
    const reason = withheldScoreReason(dossier({ roles: [] }));
    expect(reason).toContain("no provider-backed evidence established what this subject is");
    expect(reason).toContain("leads only");
  });

  it("quotes the analyst check's own note when the decision review did not complete", () => {
    const reason = withheldScoreReason(dossier({
      checkRuns: [{ checkId: "ai-analyst", label: "AI analyst", status: "unavailable", note: "analyst provider is not configured" }],
    }));
    expect(reason).toContain("decision review");
    expect(reason).toContain("analyst provider is not configured");
    // The collected evidence is still there; the report must not imply otherwise.
    expect(reason).toContain("still collected");
  });

  it("reports zero measured dimensions when the analyst ran but nothing scored", () => {
    const reason = withheldScoreReason(dossier({ coverage: { assessedAxes: 0, totalAxes: 6 } }));
    expect(reason).toContain("none of the 6 scoring dimensions");
    expect(reason).toContain("does not publish a total it cannot support");
  });

  it("names the unmeasured dimensions when only some are missing", () => {
    const reason = withheldScoreReason(dossier({
      coverage: { assessedAxes: 3, totalAxes: 6, missingAxes: ["P3_token_conduct", "P4_backing_and_partners"] },
    }));
    expect(reason).toContain("P3_token_conduct");
    expect(reason).toContain("P4_backing_and_partners");
  });

  it("admits when the record does not explain the gap, instead of inventing one", () => {
    const reason = withheldScoreReason(dossier({ coverage: { assessedAxes: 3, totalAxes: 6, missingAxes: [] } }));
    expect(reason).toContain("does not state which step fell short");
  });
});
