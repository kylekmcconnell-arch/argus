import { describe, it, expect } from "vitest";
import {
  buildScoringEvidencePacket,
  deriveProjectStrengthBands,
  inspectAnalystScoringPreflight,
  type AnalystAxis,
} from "./agent";
import { SubjectClass, getProfile } from "../src/engine";

// The empirically confirmed @ponsdotfamily shell: a young project with a
// resolved profile and live product site, but no bindable token and no verified
// backers. Before the assessed-null tier, P3/P4 banded "none" and the whole
// subject abstained INCOMPLETE with no methodology output at all.
const projectAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.PROJECT).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.PROJECT }));

function youngProjectSections(): Record<string, unknown> {
  return {
    profile: {
      handle: "@ponsdotfamily",
      display_name: "Pons",
      profile_collection_state: "resolved",
      identity_confidence: "Probable",
      bio: "Launch coins on Robinhood.",
      website: "https://ponsfamily.com/",
      profile_captured_at: "2026-07-19T15:00:00.000Z",
      last_post_at: "2026-07-19T14:00:00.000Z",
      days_since_post: 0,
    },
    basicFacts: [
      { predicate: "product", value: "Pons launchpad", status: "verified", artifact_verified: true, sources: [{ url: "https://ponsfamily.com/launchpad", excerpt: "Browse the newest fixed-supply tokens launched on Robinhood Chain.", provider: "public-web", artifactVerified: true }] },
    ],
    checkOutcomes: [
      { checkId: "project-product-substance", status: "confirmed", note: "live site with substantial product surface", provider: "site-fetch" },
      { checkId: "project-traction-liveness", status: "confirmed", note: "posting steady, site live", provider: "twitterapi" },
    ],
    recentActivity: [{ text: "Launch day on Robinhood chain.", value: "post", provider: "twitterapi" }],
  };
}

function preflightWith(sections: Record<string, unknown>) {
  const packet = buildScoringEvidencePacket(sections, projectAxes);
  return {
    pf: inspectAnalystScoringPreflight(projectAxes, packet),
    bands: deriveProjectStrengthBands(packet, projectAxes),
  };
}

describe("project abstention fix: assessed-null P3/P4 bands", () => {
  it("REGRESSION: without assessed outcomes the young project abstains on P3 and P4", () => {
    const { pf, bands } = preflightWith(youngProjectSections());
    expect(pf.state).toBe("insufficient_evidence");
    expect(pf.missingSubstantiveAxes).toContain("P3_token_conduct");
    expect(pf.missingSubstantiveAxes).toContain("P4_backing_and_partners");
    expect(bands.P3_token_conduct?.tier).toBe("none");
    expect(bands.P4_backing_and_partners?.tier).toBe("none");
  });

  it("FIX: assessed token-identity and backing outcomes band assessed_null and clear those axes", () => {
    const sections = youngProjectSections();
    (sections.checkOutcomes as unknown[]).push(
      { checkId: "project-token-identity", status: "finding", note: "assessed token identity: registry candidates were inspected and none bound to the official X account or website domain. A null result on this axis, not adverse conduct evidence.", provider: "coingecko" },
      { checkId: "project-backing-partners", status: "finding", note: "assessed backing and partners across the collected first-party record: no verified financial backer, investor, or advisor appears. A null result on this axis, not adverse evidence.", provider: "project-core-evidence" },
    );
    const { pf, bands } = preflightWith(sections);
    expect(pf.missingSubstantiveAxes).not.toContain("P3_token_conduct");
    expect(pf.missingSubstantiveAxes).not.toContain("P4_backing_and_partners");
    const p3 = bands.P3_token_conduct;
    const p4 = bands.P4_backing_and_partners;
    expect(p3?.tier).toBe("assessed_null");
    expect(p4?.tier).toBe("assessed_null");
    // Low band only, anchored by the assessment artifact, never widened.
    expect(p3?.minScore).toBe(0);
    expect(p3?.maxScore).toBeGreaterThan(0);
    expect(p4?.floorTier).toBeUndefined();
    expect(p3?.anchorArtifactIds.length).toBeGreaterThan(0);
  });

  it("keeps verified adverse evidence governing: limiting evidence still bands adverse, not assessed_null", () => {
    const sections = youngProjectSections();
    (sections.checkOutcomes as unknown[]).push(
      { checkId: "project-token-identity", status: "finding", note: "assessed token identity: nothing bound. A null result on this axis.", provider: "coingecko" },
    );
    // A verified token-collapse finding is counter-eligible for P3 and must
    // convert the band to adverse instead of the assessed-null substitution.
    sections.findings = [{
      finding_type: "TokenCollapse",
      claim: "Token promoted by the account collapsed 96 percent within a week of launch.",
      source: "https://dexscreener.example/pair",
      verification_status: "Verified",
      polarity: -1,
      artifact_verified: true,
      evidence_origin: "deterministic",
      provider: "dexscreener",
    }];
    const { bands } = preflightWith(sections);
    expect(bands.P3_token_conduct?.tier).not.toBe("assessed_null");
  });
});
