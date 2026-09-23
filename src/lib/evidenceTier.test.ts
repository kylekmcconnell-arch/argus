import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  evidenceTierLabel,
  factEvidenceTier,
  isRetainedSourceFact,
  isSourceGroundedTeamMember,
  isStrictlyVerifiedFact,
} from "./evidenceTier";

const verified = {
  predicate: "founder",
  status: "verified",
  artifact_verified: true,
  sources: [{ url: "https://example.com/team", relation: "supports" }],
};

describe("the single evidence-tier definition", () => {
  it("requires a read artifact, so a claim nobody fetched is never verified", () => {
    // The key-facts panel omitted this check, so a fact whose artifact was
    // never fetched counted as an answered question (#472, ARGUS-04).
    const { artifact_verified: _dropped, ...unfetched } = verified;
    expect(isStrictlyVerifiedFact(unfetched)).toBe(false);
    expect(factEvidenceTier(unfetched)).toBe("unverified");
    expect(isStrictlyVerifiedFact(verified)).toBe(true);
    expect(factEvidenceTier(verified)).toBe("strict_verified");
  });

  it("requires the fact to be about this subject", () => {
    // The server omitted this check, so a record ARGUS could not tie to the
    // subject could still mint a score floor.
    const unresolved = { ...verified, attributionScope: "identity_unresolved" };
    expect(isStrictlyVerifiedFact(unresolved)).toBe(false);
    // It is still retained evidence, just not an answer about this subject.
    expect(isRetainedSourceFact(unresolved)).toBe(true);
    expect(factEvidenceTier(unresolved)).toBe("source_reported");
  });

  it("keeps a provider projection and a ceiling-only record below the bar", () => {
    expect(isStrictlyVerifiedFact({ ...verified, providerProjection: true })).toBe(false);
    expect(isStrictlyVerifiedFact({ ...verified, floorEligible: false })).toBe(false);
    for (const fact of [{ ...verified, providerProjection: true }, { ...verified, floorEligible: false }]) {
      expect(factEvidenceTier(fact)).toBe("source_reported");
    }
  });

  it("accepts corroborated as well as verified, and rejects every other status", () => {
    expect(isStrictlyVerifiedFact({ ...verified, status: "corroborated" })).toBe(true);
    for (const status of ["reported", "unavailable", "checked-empty", "unknown", ""]) {
      expect(isStrictlyVerifiedFact({ ...verified, status })).toBe(false);
    }
  });

  it("separates a model lead from evidence that was merely not verified", () => {
    expect(factEvidenceTier({ status: "reported", evidence_origin: "model_lead" })).toBe("model_lead");
    expect(factEvidenceTier({ status: "reported" })).toBe("unverified");
  });

  it("grounds a roster row on a fetched source, and never calls that row verified", () => {
    expect(isSourceGroundedTeamMember({ artifact_verified: true, evidence_origin: "deterministic" })).toBe(true);
    expect(isSourceGroundedTeamMember({ artifact_verified: true, evidence_origin: "model_lead" })).toBe(false);
    expect(isSourceGroundedTeamMember({ artifact_verified: false })).toBe(false);
    // The roster bar means a source carried the person, not that their
    // current role was independently confirmed (#472, ARGUS-04).
    expect(evidenceTierLabel("source_reported")).not.toContain("verified against");
    expect(evidenceTierLabel("strict_verified")).toContain("verified");
  });
});

describe("the definition stays in one place", () => {
  // Four sites had drifted apart before this module existed. If a local copy
  // reappears, this fails rather than letting the surfaces disagree again.
  const consumers = [
    "../../server/orchestrate.ts",
    "../../server/agent.ts",
    "../components/BasicFactsPanel.tsx",
    "../components/Report.tsx",
  ];

  it("has no consumer redefining the predicate locally", () => {
    for (const relative of consumers) {
      const source = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(source, relative).toContain("evidenceTier");
      expect(source, relative).not.toMatch(/(?:function|const)\s+isStrictlyVerifiedFact\s*(?:\(|=\s*\()/);
      expect(source, relative).not.toMatch(/(?:function|const)\s+isRetainedSourceFact\s*(?:\(|=\s*\()/);
    }
  });
});
