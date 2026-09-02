import { describe, expect, it, vi } from "vitest";
import { emptyEvidence, type BasicFact, type BasicFactPredicate } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import { clearanceCoverage } from "../src/lib/scanChecklist";
import type { CheckObservation, CollectContext } from "./adapters/types";
import { hydrateProjectTeamFromVerifiedFacts, isInstitutionalOrganizationSubject } from "./basicFactsProjection";
import { PersonCheckTracker } from "./checks";
import { organizationVerifiedBasicFacts, providerBackedRoles } from "./orchestrate";

// A fund brand account: provider-resolved X profile, a canonical official site,
// and a bio the router classifies as INVESTOR. No resolved person name, so the
// subject is an organization, not an individual investor.
function fundContext() {
  const evidence = emptyEvidence("@northstarvc");
  evidence.profile = {
    ...evidence.profile,
    display_name: "Northstar Ventures",
    bio: "Early-stage venture capital. We back founders building durable companies.",
    website: "https://northstar.example/",
    profile_collection_state: "resolved",
    profile_provider: "twitterapi",
    profile_captured_at: "2026-08-30T12:00:00.000Z",
    site_substance_status: "live",
  };
  evidence.roles = providerBackedRoles(evidence);
  const outcomes: CheckObservation[] = [];
  const ctx: CollectContext = {
    handle: "@northstarvc",
    evidence,
    emit: vi.fn(),
    recordCheck: (outcome) => outcomes.push(outcome),
  };
  return { ctx, evidence, outcomes };
}

function verifiedFact(
  predicate: BasicFactPredicate,
  value: string,
  source: Partial<BasicFact["sources"][number]> = {},
): BasicFact {
  return {
    factId: `fact-${predicate}-${value}`,
    subjectKey: "@northstarvc",
    predicate,
    value,
    normalizedValue: value.toLowerCase(),
    status: "verified",
    critical: true,
    questionId: `investor_org.${predicate}`,
    sources: [{
      url: `https://northstar.example/${predicate}`,
      title: "Northstar Ventures — Team",
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: `${value} — ${predicate} at Northstar Ventures.`,
      contentHash: predicate.padEnd(64, "0").slice(0, 64),
      capturedAt: "2026-08-30T12:00:00.000Z",
      provider: "public-web",
      artifactVerified: true,
      ...source,
    }],
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
  };
}

describe("organization verified basic facts (fund / agency brand accounts)", () => {
  it("routes the fixture as an institutional INVESTOR organization", () => {
    const { evidence } = fundContext();
    expect(evidence.roles).toEqual([SubjectClass.INVESTOR]);
    expect(isInstitutionalOrganizationSubject(evidence)).toBe(true);
  });

  it("confirms the fund's brand identity from a verified official_identity bound to its official site", () => {
    const { ctx, evidence, outcomes } = fundContext();
    evidence.basicFacts = [verifiedFact("official_identity", "Northstar Ventures")];

    organizationVerifiedBasicFacts(ctx);

    expect(evidence.profile.identity_confidence).toBe("Confirmed");
    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "identity-resolution",
      status: "confirmed",
      provider: "twitterapi/basic-facts-web/site-fetch",
      note: expect.stringContaining("fund brand identity confirmed"),
    }));
    // A brand binding alone says nothing about who runs the fund.
    expect(outcomes).not.toContainEqual(expect.objectContaining({ id: "affiliations-associates" }));
  });

  it("records identity and affiliations from verified general-partner records and puts them on the roster", () => {
    const { ctx, evidence, outcomes } = fundContext();
    evidence.basicFacts = [
      verifiedFact("executive", "Dana Whitfield", { excerpt: "Dana Whitfield, General Partner at Northstar Ventures." }),
      verifiedFact("founder", "Marcus Bell", { excerpt: "Marcus Bell founded Northstar Ventures in 2016." }),
    ];

    hydrateProjectTeamFromVerifiedFacts(evidence);
    organizationVerifiedBasicFacts(ctx);

    expect(evidence.webTeam).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Dana Whitfield", provider: "basic-facts", artifact_verified: true }),
      expect.objectContaining({ name: "Marcus Bell", role: "Founder", artifact_verified: true }),
    ]));
    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "identity-resolution",
      status: "confirmed",
      provider: "basic-facts-web",
      note: expect.stringContaining("2 founder or executive records verified"),
    }));
    expect(outcomes).toContainEqual(expect.objectContaining({
      id: "affiliations-associates",
      status: "confirmed",
      provider: "basic-facts-web",
      sourceCount: 2,
    }));
    // One official-source record is Probable; Confirmed needs independent domains.
    expect(evidence.profile.identity_confidence).toBe("Probable");
  });

  it("closes the never-waive identity gate for a fund on the same evidence PROJECT already accepts", () => {
    const { ctx, evidence } = fundContext();
    evidence.basicFacts = [verifiedFact("executive", "Dana Whitfield")];
    const tracker = new PersonCheckTracker();
    ctx.recordCheck = (outcome) => tracker.record(outcome);
    for (const id of ["affiliations-associates", "vc-portfolio-track-record", "adverse-screen", "trust-graph-connections", "organization-registration", "organization-sanctions"] as const) {
      tracker.record({ id, status: "confirmed", note: `${id} frozen`, provider: "test", sourceCount: 1 });
    }
    const scope = { resolvedRealName: false, organizationSubject: true };

    const before = clearanceCoverage(tracker.snapshot(evidence.roles, scope));
    expect(before.openNeverWaive).toEqual(["identity-resolution"]);
    expect(before.sufficient).toBe(false);

    organizationVerifiedBasicFacts(ctx);

    const after = clearanceCoverage(tracker.snapshot(evidence.roles, scope));
    expect(after.openNeverWaive).toEqual([]);
    expect(after.sufficient).toBe(true);
  });

  it("does not let the account's own projected self-description confirm its identity", () => {
    const { ctx, evidence, outcomes } = fundContext();
    evidence.basicFacts = [{
      ...verifiedFact("official_identity", "Northstar Ventures"),
      providerProjection: true,
      floorEligible: false,
    }];

    organizationVerifiedBasicFacts(ctx);

    expect(outcomes).toEqual([]);
    expect(evidence.profile.identity_confidence).toBe("Unverified");
  });

  it("does not confirm a brand identity without a canonical official site or a provider-resolved profile", () => {
    const { ctx, evidence, outcomes } = fundContext();
    evidence.profile.website = "https://linktr.ee/northstarvc";
    evidence.basicFacts = [verifiedFact("official_identity", "Northstar Ventures")];

    organizationVerifiedBasicFacts(ctx);

    expect(outcomes).toEqual([]);
  });

  it("leaves PROJECT accounts and individual investors to their own paths", () => {
    const project = fundContext();
    project.evidence.profile.bio = "The protocol for onchain venture capital. Built for founders.";
    project.evidence.projectToken = { verified: true } as typeof project.evidence.projectToken;
    project.evidence.basicFacts = [verifiedFact("executive", "Dana Whitfield")];
    expect(providerBackedRoles(project.evidence)).toContain(SubjectClass.PROJECT);
    organizationVerifiedBasicFacts(project.ctx);
    expect(project.outcomes).toEqual([]);

    const individual = fundContext();
    individual.evidence.profile.resolved_name = "Dana Whitfield";
    individual.evidence.basicFacts = [verifiedFact("executive", "Dana Whitfield")];
    expect(isInstitutionalOrganizationSubject(individual.evidence)).toBe(false);
    hydrateProjectTeamFromVerifiedFacts(individual.evidence);
    organizationVerifiedBasicFacts(individual.ctx);
    expect(individual.evidence.webTeam).toEqual([]);
    expect(individual.outcomes).toEqual([]);
  });
});
