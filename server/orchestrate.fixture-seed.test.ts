import { describe, expect, it } from "vitest";
import { assembleDossier } from "../src/data/dossier";
import { emptyEvidence, type CollectedEvidence } from "../src/data/evidence";
import { findSubject, toEvidence } from "../src/data/subjects";
import { getProfile, SubjectClass, VentureOutcome } from "../src/engine";
import { downgradeFixtureEvidenceForLive } from "./orchestrate";

const scoreEveryAxis = (evidence: CollectedEvidence): void => {
  evidence.axes = evidence.roles.flatMap((role) => Object.entries(getProfile(role).axes).map(([axis, score]) => ({
    axis,
    score,
    rationale: "fresh analyst score for cap-isolation test",
  })));
};

describe("live fixture discovery-claim downgrade", () => {
  it("keeps a seeded verified InvestigatorCallout out of caps and the publishable ledger", () => {
    const fixture = findSubject("@deltagrowth");
    expect(fixture).toBeDefined();
    const curated = toEvidence(fixture!);
    const callout = curated.findings.find((finding) => finding.finding_type === "InvestigatorCallout");
    expect(callout).toMatchObject({
      verification_status: "Verified",
      independent_source_count: 2,
    });

    const discovery = downgradeFixtureEvidenceForLive(curated);
    expect(discovery.axes).toEqual([]);
    expect(discovery.headline).toBe("");
    expect(discovery.profile.identity_confidence).toBe("Unverified");
    expect(discovery.findings[0]).toMatchObject({
      finding_type: "InvestigatorCallout",
      verification_status: "Rumor",
      independent_source_count: 0,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });

    // Supply a complete fresh analyst score so this assertion isolates the
    // deterministic cap gate rather than relying on INCOMPLETE to hide it.
    discovery.axes = curated.axes;
    const report = assembleDossier(discovery, true).report;
    expect(report.cap_applied).toBeNull();
    expect(report.publishable_findings).toEqual([]);
    expect(report.investigative_leads).toEqual(expect.arrayContaining([
      expect.objectContaining({ finding_type: "InvestigatorCallout" }),
    ]));

    // A collector can still promote the same claim after independently
    // fetching and validating its artifact in this run.
    discovery.findings[0] = {
      ...discovery.findings[0],
      verification_status: "Verified",
      independent_source_count: 2,
      evidence_origin: "deterministic",
      artifact_verified: true,
    };
    const reverified = assembleDossier(discovery, true).report;
    expect(reverified.cap_applied).toBe("investigator_verified_fraud");
    expect(reverified.publishable_findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ finding_type: "InvestigatorCallout" }),
    ]));
  });

  it("neutralizes every seeded role-cap artifact while retaining lookup identity", () => {
    const seed = emptyEvidence("@fixture_caps");
    seed.profile.identity_confidence = "Confirmed";
    seed.profile.display_name = "Fixture Person";
    seed.profile.resolved_name = "Fixture Person";
    seed.profile.bio = "stale fixture biography";
    seed.profile.followers = "999K";
    seed.profile.website = "https://stale.example";
    seed.roles = [
      SubjectClass.FOUNDER,
      SubjectClass.KOL,
      SubjectClass.INVESTOR,
      SubjectClass.ADVISOR,
      SubjectClass.AGENCY,
    ];
    seed.ventures = [{
      project_name: "Seed Rug",
      role: "founder",
      period: "2024",
      outcome: VentureOutcome.RUG,
      evidence_url: "https://example.com/seed-rug",
      investors: ["Seed Capital"],
    }];
    seed.testimonials = [{
      claimed_endorser_handle: "@denier",
      claimed_relationship: "advisor",
      sentiment: "negative",
      fud_present: true,
      evidence_url: "https://example.com/denial",
    }];
    seed.advised = [{
      project_name: "Seed Advisory",
      project_handle: "@seed_advisory",
      claimed_role: "advisor",
      project_outcome: VentureOutcome.RUG,
      paid_or_allocated: true,
      public_acknowledgment: "endorsement",
      relationship_corroborated: true,
      evidence_url: "https://example.com/advisory-rug",
    }];
    seed.wallets = [{
      address: "0xseed",
      chain: "base",
      link_tier: "SelfDoxxed",
      sold_into_own_promo: true,
      scam_adjacent_flow: true,
    }];
    seed.promotions = [{
      ticker: "SEED",
      contract_address: "0xseedtoken",
      chain: "base",
      paid_promo: true,
      outcome_was_rug: true,
    }];
    seed.clientEngagements = [{
      client_name: "Seed Client",
      service_type: "market_making",
      client_outcome: VentureOutcome.RUG,
      manipulation_service_flag: true,
      evidence_url: "https://example.com/manipulation",
    }];
    seed.associates = [{
      associate_handle: "@stale_associate",
      relation: "fixture-only relationship",
      in_cabal_kb: true,
    }];
    scoreEveryAxis(seed);

    const curated = assembleDossier(seed, false).report;
    expect(curated.role_reports.every((role) => role.cap_applied !== null)).toBe(true);

    const discovery = downgradeFixtureEvidenceForLive(seed);
    expect(discovery.profile).toEqual({
      handle: "@fixture_caps",
      display_name: "fixture_caps",
      avatar: "F",
      bio: "",
      followers: "—",
      joined: "—",
      identity_confidence: "Unverified",
      identity_note: "Fixture discovery seed only; identity requires a fresh provider re-check.",
    });
    expect(discovery.associates).toEqual([]);
    expect(discovery.clientEngagements[0]).toMatchObject({
      client_name: "Seed Client",
      service_type: "market_making",
      client_outcome: VentureOutcome.UNKNOWN,
      manipulation_service_flag: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    scoreEveryAxis(discovery);
    const live = assembleDossier(discovery, true);
    expect(live.report.role_reports.every((role) => role.cap_applied === null)).toBe(true);
    expect(live.evidence.ventures[0]).toMatchObject({
      project_name: "Seed Rug",
      outcome: VentureOutcome.UNKNOWN,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    expect(live.evidence.testimonials[0]).toMatchObject({
      claimed_endorser_handle: "@denier",
      corroboration_verdict: "Unconfirmed",
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    expect(live.evidence.advised[0]).toMatchObject({
      project_name: "Seed Advisory",
      project_handle: "@seed_advisory",
      project_outcome: VentureOutcome.UNKNOWN,
      paid_or_allocated: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    expect(live.evidence.wallets[0]).toMatchObject({
      address: "0xseed",
      chain: "base",
      link_tier: "Inferred",
      sold_into_own_promo: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    expect(live.evidence.promotions[0]).toMatchObject({
      ticker: "SEED",
      contract_address: "0xseedtoken",
      paid_promo: undefined,
      outcome_was_rug: undefined,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
  });
});
