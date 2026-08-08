import { describe, expect, it } from "vitest";
import type { SourceArtifact } from "../src/data/evidence";
import { getProfile, SubjectClass } from "../src/engine";
import {
  buildScoringEvidencePacket,
  deriveInvestorStrengthBands,
  extractScoringEvidenceCatalog,
  inspectAnalystScoringPreflight,
  validateAnalystVerdict,
  type AnalystAxis,
} from "./agent";

const NOW = "2026-07-11T12:00:00.000Z";
const investorAxes: AnalystAxis[] = Object.entries(getProfile(SubjectClass.INVESTOR).axes)
  .map(([axis, weight]) => ({ axis, weight, role: SubjectClass.INVESTOR }));

const organizationProfile = {
  handle: "@subjectcapital",
  display_name: "Subject Capital",
  bio: "We invest in early-stage software companies.",
  website: "https://subjectcapital.com",
  profile_collection_state: "resolved",
  profile_provider: "twitterapi",
  profile_captured_at: NOW,
};

const portfolioRelationship = (projectName = "Acme Protocol"): SourceArtifact => ({
  kind: "portfolio_relationship",
  provider: "portfolio-web",
  title: `Subject Capital invested in ${projectName}`,
  excerpt: `${projectName} appears on Subject Capital's official portfolio page.`,
  sourceUrl: `https://subjectcapital.com/portfolio/${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  capturedAt: NOW,
  contentHash: "a".repeat(64),
  sourceContentHash: "b".repeat(64),
  match: "relationship_confirmed",
  relationship: "invested_in",
  subjectName: "Subject Capital",
  subjectHandle: "@subjectcapital",
  projectName,
  projectDomain: `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "")}.com`,
  investorEntityName: "Subject Capital",
  investorEntityDomain: "subjectcapital.com",
  attribution: "direct_subject",
  sourceClass: "first_party_subject",
});

const fundScale = (): SourceArtifact => ({
  kind: "fund_scale",
  provider: "fund-scale-web",
  title: "Subject Capital closed a $500 million fund",
  excerpt: "Subject Capital announced a completed $500 million venture fund.",
  sourceUrl: "https://subjectcapital.com/fund-size",
  capturedAt: NOW,
  contentHash: "c".repeat(64),
  sourceContentHash: "d".repeat(64),
  match: "fund_scale_confirmed",
  subjectName: "Subject Capital",
  subjectHandle: "@subjectcapital",
  investorEntityName: "Subject Capital",
  investorEntityDomain: "subjectcapital.com",
  attribution: "direct_subject",
  sourceClass: "first_party_subject",
  fundName: "Subject Capital",
  fundSizeUsd: 500_000_000,
  fundVehicle: "Subject Venture Fund I",
  fundScaleMetric: "fund_vehicle",
  fundAmountQualifier: "exact",
  fundScaleBasis: "manager_reported",
  fundScaleTemporalState: "fixed_historical",
  fundScaleSourceCount: 1,
  fundScaleClaimId: "fund_scale_claim_v1_subject_fund_i",
});

function oneAxis(axis: string): AnalystAxis[] {
  return investorAxes.filter((candidate) => candidate.axis === axis);
}

function verdict(axis: AnalystAxis, score: number, artifactId: string) {
  return {
    axes: [{
      axis: axis.axis,
      score,
      rationale: `Source-bound evidence supports ${axis.axis}.`,
      primaryEvidenceRef: artifactId,
      additionalEvidenceRefs: [],
      counterEvidenceRefs: [],
      coverageRefs: [],
      gaps: [],
    }],
    headline: "The result is governed by the source-bound investor evidence.",
    identity_note: "The exact audited account is preserved.",
  };
}

describe("deterministic investor scoring calibration", () => {
  it("keeps social activity, notable follows, and ordinary affiliations out of I4 and I5", () => {
    const axes = [
      ...oneAxis("I4_testimonial_corroboration"),
      ...oneAxis("I5_reputation_fud"),
    ];
    const packet = buildScoringEvidencePacket({
      profile: organizationProfile,
      notableFollowers: [{ handle: "famousfounder", label: "Founder", provider: "twitterapi" }],
      recentActivity: [{ text: "Subject Capital posted a new investment thesis.", provider: "twitterapi", capturedAt: NOW }],
      associates: [{ associate_handle: "@partner", relation: "Partner at Subject Capital", artifact_verified: true }],
      checkOutcomes: [{
        checkId: "affiliations-associates",
        status: "confirmed",
        note: "One ordinary employment affiliation was confirmed.",
        provider: "peopledatalabs",
      }],
    }, axes);
    const parsed = JSON.parse(packet) as Record<string, unknown[]>;
    const catalog = extractScoringEvidenceCatalog(packet, axes);

    expect(parsed.notableFollowers).toEqual([]);
    expect(parsed.recentActivity).toEqual([]);
    expect(parsed.associates).toEqual([]);
    expect(parsed.checkOutcomes).toEqual([]);
    expect(catalog.every((artifact) => artifact.verification === "unavailable")).toBe(true);
    expect(inspectAnalystScoringPreflight(axes, packet).missingSubstantiveAxes)
      .toEqual(axes.map(({ axis }) => axis));
  });

  it("requires an exact person identity binding before legacy investor Basic Facts can score", () => {
    const axes = oneAxis("I1_identity_legitimacy");
    const personProfile = {
      handle: "@alice",
      display_name: "Alice Smith",
      resolved_name: "Alice Smith",
      bio: "Angel investor",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: NOW,
    };
    const fact = {
      predicate: "current_role",
      value: "Partner at Example Ventures",
      status: "verified",
      artifact_verified: true,
      evidence_origin: "deterministic",
      sources: [{
        url: "https://example.vc/team/alice",
        title: "Example Ventures team",
        excerpt: "Alice Smith is a partner at Example Ventures.",
        provider: "public-web",
        artifactVerified: true,
      }],
    };
    const unbound = buildScoringEvidencePacket({ profile: personProfile, basicFacts: [fact] }, axes);
    const bound = buildScoringEvidencePacket({
      profile: { ...personProfile, identity_binding: "independent_exact_handle" },
      basicFacts: [fact],
    }, axes);

    expect(JSON.parse(unbound).basicFacts).toEqual([]);
    expect(extractScoringEvidenceCatalog(unbound, axes).some((artifact) =>
      artifact.operation === "basicFacts:current_role")).toBe(false);
    expect(extractScoringEvidenceCatalog(bound, axes)).toContainEqual(expect.objectContaining({
      operation: "basicFacts:current_role",
      eligibleAxes: ["I1_identity_legitimacy"],
      verification: "verified",
    }));
  });

  it("caps a self-described institutional profile at emerging until organization identity is independently bound", () => {
    const axes = oneAxis("I1_identity_legitimacy");
    const packet = buildScoringEvidencePacket({ profile: organizationProfile }, axes);
    const catalog = extractScoringEvidenceCatalog(packet, axes);
    const profileArtifact = catalog.find((artifact) => artifact.section === "profile");
    const band = deriveInvestorStrengthBands(packet, axes).I1_identity_legitimacy;

    expect(profileArtifact).toBeDefined();
    expect(band).toMatchObject({ tier: "emerging", minScore: 6, maxScore: 10 });
    expect(validateAnalystVerdict(
      verdict(axes[0], axes[0].weight, profileArtifact!.artifactId),
      axes,
      catalog,
      undefined,
      { investorScoreBands: { I1_identity_legitimacy: band } },
    )).toBeNull();
  });

  it("caps portfolio inclusion below portfolio quality and rejects a maximum score", () => {
    const axes = oneAxis("I2_portfolio_quality");
    const packet = buildScoringEvidencePacket({
      profile: organizationProfile,
      sourceArtifacts: [portfolioRelationship()],
    }, investorAxes);
    const catalog = extractScoringEvidenceCatalog(packet, investorAxes);
    const band = deriveInvestorStrengthBands(packet, investorAxes).I2_portfolio_quality;
    const relationship = catalog.find((artifact) => artifact.operation === "sourceArtifacts:portfolio_relationship");

    expect(relationship).toBeDefined();
    expect(band).toMatchObject({ tier: "emerging", minScore: 10, maxScore: 17 });
    expect(band.reasons).toContain("portfolio inclusion is not portfolio quality");
    const reject = (reason: string) => expect(reason).toBe(
      "investor-scores-outside-evidence-strength-band:I2_portfolio_quality",
    );
    expect(validateAnalystVerdict(
      verdict(axes[0], axes[0].weight, relationship!.artifactId),
      axes,
      catalog,
      reject,
      { investorScoreBands: { I2_portfolio_quality: band } },
    )).toBeNull();
    expect(validateAnalystVerdict(
      verdict(axes[0], band.maxScore, relationship!.artifactId),
      axes,
      catalog,
      undefined,
      { investorScoreBands: { I2_portfolio_quality: band } },
    )).not.toBeNull();
  });

  it("does not let an investor artifact self-convert the audited handle into a project", () => {
    const axes = oneAxis("I2_portfolio_quality");
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@alice",
        display_name: "Alice Smith",
        bio: "Angel investor",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        profile_captured_at: NOW,
      },
      sourceArtifacts: [{
        ...portfolioRelationship("Alice Smith"),
        title: "Mallory Ventures invested in Alice Smith",
        sourceUrl: "https://mallory.example/deal/alice",
        subjectName: "Mallory Ventures",
        subjectHandle: "@mallory",
        investorEntityName: "Mallory Ventures",
        investorEntityDomain: "mallory.example",
        projectHandle: "@alice",
        projectDomain: "alice.example",
      }],
    }, axes);

    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(extractScoringEvidenceCatalog(packet, axes).some((artifact) =>
      artifact.operation === "sourceArtifacts:portfolio_relationship")).toBe(false);
    expect(deriveInvestorStrengthBands(packet, axes).I2_portfolio_quality)
      .toMatchObject({ tier: "none", minScore: 0, maxScore: 0 });
  });

  it("requires an exact person identity binding for a direct portfolio relationship", () => {
    const axes = oneAxis("I2_portfolio_quality");
    const profile = {
      handle: "@alice",
      display_name: "Alice Smith",
      resolved_name: "Alice Smith",
      bio: "Angel investor",
      profile_collection_state: "resolved",
      profile_provider: "twitterapi",
      profile_captured_at: NOW,
    };
    const relationship = {
      ...portfolioRelationship(),
      subjectName: "Alice Smith",
      subjectHandle: "@alice",
      investorEntityName: "Alice Smith",
      investorEntityDomain: undefined,
      projectHandle: "@acme",
      attribution: "direct_subject" as const,
    };
    const unbound = buildScoringEvidencePacket({ profile, sourceArtifacts: [relationship] }, axes);
    const bound = buildScoringEvidencePacket({
      profile: { ...profile, identity_binding: "independent_exact_handle" },
      sourceArtifacts: [relationship],
    }, axes);

    expect(JSON.parse(unbound).sourceArtifacts).toEqual([]);
    expect(extractScoringEvidenceCatalog(unbound, axes).some((artifact) =>
      artifact.operation === "sourceArtifacts:portfolio_relationship")).toBe(false);
    expect(extractScoringEvidenceCatalog(bound, axes)).toContainEqual(expect.objectContaining({
      operation: "sourceArtifacts:portfolio_relationship",
      eligibleAxes: ["I2_portfolio_quality"],
      verification: "verified",
    }));
  });

  it("caps one manager-reported fund close below the maximum", () => {
    const axes = oneAxis("I3_fund_scale_tier");
    const packet = buildScoringEvidencePacket({
      profile: organizationProfile,
      sourceArtifacts: [fundScale()],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet, axes);
    const scale = catalog.find((artifact) => artifact.operation === "sourceArtifacts:fund_scale");
    const band = deriveInvestorStrengthBands(packet, axes).I3_fund_scale_tier;

    expect(scale).toBeDefined();
    expect(band).toMatchObject({ tier: "solid", minScore: 11, maxScore: 12 });
    expect(validateAnalystVerdict(
      verdict(axes[0], axes[0].weight, scale!.artifactId),
      axes,
      catalog,
      undefined,
      { investorScoreBands: { I3_fund_scale_tier: band } },
    )).toBeNull();
  });

  it("does not let an unrelated outcome upgrade a bound portfolio inclusion", () => {
    const axes = oneAxis("I2_portfolio_quality");
    const packet = buildScoringEvidencePacket({
      profile: {
        handle: "@alice",
        display_name: "Alice Smith",
        resolved_name: "Alice Smith",
        bio: "Angel investor",
        profile_collection_state: "resolved",
        profile_provider: "twitterapi",
        identity_binding: "independent_exact_handle",
      },
      basicFacts: [{
        predicate: "investor",
        value: "Acme Protocol",
        status: "verified",
        artifact_verified: true,
      }, {
        predicate: "exit",
        value: "Unrelated Company completed an IPO",
        status: "verified",
        artifact_verified: true,
      }],
    }, axes);
    const band = deriveInvestorStrengthBands(packet, axes).I2_portfolio_quality;

    expect(band).toMatchObject({ tier: "emerging", minScore: 10, maxScore: 17 });
    expect(band.reasons).not.toContain("1 source-bound positive portfolio outcome");
  });

  it("keeps a bounded no-amount result unscored for I3", () => {
    const axes = oneAxis("I3_fund_scale_tier");
    const packet = buildScoringEvidencePacket({
      profile: organizationProfile,
      checkOutcomes: [{
        checkId: "investor-fund-scale",
        status: "finding",
        note: "A bounded source search found no verified AUM or fund-close amount.",
        provider: "fund-scale-web",
      }],
    }, axes);

    expect(JSON.parse(packet).checkOutcomes).toEqual([]);
    expect(deriveInvestorStrengthBands(packet, axes).I3_fund_scale_tier)
      .toMatchObject({ tier: "none", minScore: 0, maxScore: 0 });
    expect(inspectAnalystScoringPreflight(axes, packet)).toMatchObject({
      state: "insufficient_evidence",
      missingSubstantiveAxes: ["I3_fund_scale_tier"],
    });
  });

  it("caps one screened corroborated testimonial below the maximum", () => {
    const axes = oneAxis("I4_testimonial_corroboration");
    const packet = buildScoringEvidencePacket({
      testimonials: [{
        claimed_endorser_handle: "@founder",
        claimed_relationship: "portfolio founder",
        public_acknowledgment: "endorsement",
        relationship_corroborated: true,
        corroboration_verdict: "Corroborated",
        evidence_url: "https://x.com/founder/status/123",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
    }, axes);
    const catalog = extractScoringEvidenceCatalog(packet, axes);
    const testimonial = catalog.find((artifact) => artifact.section === "testimonials");
    const band = deriveInvestorStrengthBands(packet, axes).I4_testimonial_corroboration;

    expect(testimonial).toBeDefined();
    expect(band).toMatchObject({ tier: "emerging", minScore: 8, maxScore: 13 });
    expect(validateAnalystVerdict(
      verdict(axes[0], axes[0].weight, testimonial!.artifactId),
      axes,
      catalog,
      undefined,
      { investorScoreBands: { I4_testimonial_corroboration: band } },
    )).toBeNull();
  });

  it("keeps neutral financing press out of reputation scoring", () => {
    const axes = oneAxis("I5_reputation_fud");
    const packet = buildScoringEvidencePacket({
      profile: organizationProfile,
      sourceArtifacts: [{
        kind: "press",
        provider: "google-news",
        title: "Subject Capital leads Acme Protocol financing round",
        excerpt: "The firm participated in the startup's Series A financing.",
        sourceUrl: "https://news.example/subject-capital-acme-round",
        capturedAt: NOW,
        contentHash: "f".repeat(64),
        match: "exact_handle",
      }],
    }, axes);

    expect(JSON.parse(packet).sourceArtifacts).toEqual([]);
    expect(deriveInvestorStrengthBands(packet, axes).I5_reputation_fud)
      .toMatchObject({ tier: "none", minScore: 0, maxScore: 0 });
    expect(inspectAnalystScoringPreflight(axes, packet).missingSubstantiveAxes)
      .toEqual(["I5_reputation_fud"]);
  });
});
