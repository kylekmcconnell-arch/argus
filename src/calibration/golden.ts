// Golden set: labeled subjects with known expected verdicts. This is the
// calibration spine for evolving the model. When you change a weight or cap in
// profiles.ts, re-run `npm run calibrate` and see exactly which verdicts drift.
//
// Seed cases are the four curated dossiers; the rest are pure-evidence anchors
// that pin specific mechanics (caps, the identity gate, banding).

import { SubjectClass, VentureOutcome } from "../engine";
import { getProfile } from "../engine/profiles";
import {
  emptyEvidence,
  type BasicFactPredicate,
  type CollectedEvidence,
} from "./../data/evidence";
import { findSubject, toEvidence } from "./../data/subjects";

export type GroundTruth = "clean" | "harmful" | "insufficient-evidence" | "identity-fraud";

export interface GoldenCase {
  name: string;
  note: string;
  groundTruth: GroundTruth;
  evidence: CollectedEvidence;
  expect: {
    verdict: string;
    governing?: SubjectClass | null;
    cap?: string | null;
    score?: { min: number; max: number } | null;
  };
}

function fixtureEvidence(handle: string): CollectedEvidence {
  const f = findSubject(handle);
  if (!f) throw new Error(`golden: unknown fixture ${handle}`);
  return toEvidence(f);
}

// Minimal evidence builder for pure mechanic anchors.
function ev(
  handle: string,
  roles: SubjectClass[],
  identity: CollectedEvidence["profile"]["identity_confidence"],
  patch: Partial<CollectedEvidence>,
): CollectedEvidence {
  const base = emptyEvidence(handle);
  base.roles = roles;
  base.profile.identity_confidence = identity;
  return { ...base, ...patch };
}

function completeAxes(role: SubjectClass, ratio = 0.85): CollectedEvidence["axes"] {
  return Object.entries(getProfile(role).axes).map(([axis, weight]) => ({
    axis,
    score: Math.max(0, Math.min(weight, Math.round(weight * ratio))),
    rationale: `Golden control at ${Math.round(ratio * 100)}% of axis weight.`,
  }));
}

const PROJECT_FIXTURE_CAPTURED_AT = "2026-07-12T00:00:00.000Z";

function projectFact(
  handle: string,
  predicate: BasicFactPredicate,
  value: string,
  sourceSlug: string,
  qualifier?: string,
): NonNullable<CollectedEvidence["basicFacts"]>[number] {
  const normalizedValue = value.toLowerCase().replace(/[^a-z0-9@$.'-]+/g, " ").trim();
  const contentHash = (predicate.length % 16).toString(16).repeat(64);
  return {
    factId: `golden-${predicate}-${normalizedValue.replace(/\s+/g, "-")}`,
    subjectKey: handle,
    predicate,
    value,
    normalizedValue,
    status: "verified",
    critical: ["official_identity", "product", "founder", "executive", "official_token"].includes(predicate),
    sources: [{
      url: `https://project-control.example/${sourceSlug}`,
      sourceClass: "official_subject",
      relation: "supports",
      excerpt: `${value} is the verified ${qualifier ?? predicate.replace(/_/g, " ")} for this synthetic calibration project.`,
      contentHash,
      capturedAt: PROJECT_FIXTURE_CAPTURED_AT,
      provider: "golden-fixture",
      artifactVerified: true,
    }],
    ...(qualifier ? { qualifier } : {}),
    evidence_origin: "deterministic",
    artifact_verified: true,
    provider: "public-web",
  };
}

function projectEvidence(
  handle: string,
  displayName: string,
  identity: CollectedEvidence["profile"]["identity_confidence"],
  patch: Partial<CollectedEvidence>,
): CollectedEvidence {
  const evidence = ev(handle, [SubjectClass.PROJECT], identity, patch);
  evidence.profile = {
    ...evidence.profile,
    display_name: displayName,
    bio: "A synthetic project calibration control with frozen evidence.",
    website: "https://project-control.example",
    profile_collection_state: "resolved",
    profile_provider: "twitterapi",
    profile_captured_at: PROJECT_FIXTURE_CAPTURED_AT,
    days_since_post: 1,
  };
  return evidence;
}

export const GOLDEN: GoldenCase[] = [
  // ── the four curated dossiers ──
  {
    name: "@0xlumen",
    note: "multi-role; advisor cap (paid advisor to a confirmed rug) governs",
    groundTruth: "harmful",
    evidence: fixtureEvidence("@0xlumen"),
    expect: { verdict: "FAIL", governing: SubjectClass.ADVISOR, cap: "advised_rug_with_allocation" },
  },
  {
    name: "@satoshi_builds",
    note: "two exits, returning backers, disclosed identity (+5)",
    groundTruth: "clean",
    evidence: fixtureEvidence("@satoshi_builds"),
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null },
  },
  {
    name: "@nova_capital",
    note: "contradicted testimonial caps the investor role",
    groundTruth: "harmful",
    evidence: fixtureEvidence("@nova_capital"),
    expect: { verdict: "FAIL", governing: SubjectClass.INVESTOR, cap: "contradicted_testimonial" },
  },
  {
    name: "@deltagrowth",
    note: "manipulation-as-a-service is a hard AVOID",
    groundTruth: "harmful",
    evidence: fixtureEvidence("@deltagrowth"),
    expect: { verdict: "AVOID", governing: SubjectClass.AGENCY, cap: "market_manipulation_services" },
  },

  // ── pure mechanic anchors ──
  {
    name: "anchor:serial-success",
    note: "two real exits, no caps -> PASS",
    groundTruth: "clean",
    evidence: ev("@anchor_ss", [SubjectClass.FOUNDER], "Confirmed", {
      ventures: [
        { project_name: "A", role: "founder", period: "2015-2018", outcome: VentureOutcome.ACQUISITION },
        { project_name: "B", role: "founder", period: "2019-2022", outcome: VentureOutcome.IPO },
      ],
      axes: [
        { axis: "F1_identity_verifiability", score: 11, rationale: "" },
        { axis: "F2_track_record", score: 26, rationale: "" },
        { axis: "F3_repeat_backing", score: 12, rationale: "" },
        { axis: "F4_build_substance", score: 13, rationale: "" },
        { axis: "F5_reputation_integrity", score: 16, rationale: "" },
        { axis: "F6_network_quality", score: 10, rationale: "" },
      ],
    }),
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null, score: { min: 85, max: 100 } },
  },
  {
    name: "anchor:prior-rug",
    note: "a confirmed rug as principal -> AVOID regardless of other scores",
    groundTruth: "harmful",
    evidence: ev("@anchor_rug", [SubjectClass.FOUNDER], "Confirmed", {
      ventures: [{ project_name: "RugCo", role: "founder", period: "2022", outcome: VentureOutcome.RUG }],
      axes: [
        { axis: "F1_identity_verifiability", score: 12, rationale: "" },
        { axis: "F2_track_record", score: 20, rationale: "" },
        { axis: "F3_repeat_backing", score: 12, rationale: "" },
        { axis: "F4_build_substance", score: 14, rationale: "" },
        { axis: "F5_reputation_integrity", score: 16, rationale: "" },
        { axis: "F6_network_quality", score: 10, rationale: "" },
      ],
    }),
    expect: { verdict: "AVOID", governing: SubjectClass.FOUNDER, cap: "prior_rug_as_principal", score: { min: 0, max: 10 } },
  },
  {
    name: "anchor:impersonation",
    note: "suspected impersonation blocks publication for any class",
    groundTruth: "identity-fraud",
    evidence: ev("@anchor_imp", [SubjectClass.INVESTOR], "SuspectedImpersonation", {
      axes: [
        { axis: "I1_identity_legitimacy", score: 10, rationale: "" },
        { axis: "I2_portfolio_quality", score: 20, rationale: "" },
        { axis: "I3_fund_scale_tier", score: 12, rationale: "" },
        { axis: "I4_testimonial_corroboration", score: 15, rationale: "" },
        { axis: "I5_reputation_fud", score: 20, rationale: "" },
      ],
    }),
    expect: { verdict: "UNVERIFIABLE_IDENTITY", score: null },
  },
  {
    name: "anchor:pseudonymous-pass",
    note: "pseudonymity is neutral; a strong pseudonymous founder still passes",
    groundTruth: "clean",
    evidence: ev("@anchor_pseudo", [SubjectClass.FOUNDER], "Unverified", {
      ventures: [
        { project_name: "Ship", role: "founder", period: "2020-2023", outcome: VentureOutcome.ACQUISITION },
      ],
      axes: [
        { axis: "F1_identity_verifiability", score: 9, rationale: "" },
        { axis: "F2_track_record", score: 24, rationale: "" },
        { axis: "F3_repeat_backing", score: 13, rationale: "" },
        { axis: "F4_build_substance", score: 14, rationale: "" },
        { axis: "F5_reputation_integrity", score: 16, rationale: "" },
        { axis: "F6_network_quality", score: 10, rationale: "" },
      ],
    }),
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null, score: { min: 80, max: 100 } },
  },

  // ── project / protocol calibration anchors ──
  {
    name: "project:established-operating-protocol",
    note: "named team, shipped audited product, canonical token, sustained usage, and transparent governance -> strong PASS without relying on brand reputation",
    groundTruth: "clean",
    evidence: projectEvidence("@established_protocol", "Established Protocol", "Confirmed", {
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Established Protocol",
        symbol: "EST",
        coingeckoId: "established-protocol-control",
        rank: 75,
        address: "0x0000000000000000000000000000000000000e57",
        chain: "ethereum",
        homepage: "https://project-control.example",
        sourceUrl: "https://project-control.example/token",
        capturedAt: PROJECT_FIXTURE_CAPTURED_AT,
        providers: ["coingecko", "dexscreener", "geckoterminal"],
        marketCapUsd: 750_000_000,
        volume24hUsd: 42_000_000,
        liquidityUsd: 85_000_000,
      },
      webTeam: [{
        name: "Avery Lin",
        handle: "@avery_builds",
        role: "Co-founder",
        source: "Official team page",
        sourceUrl: "https://project-control.example/team",
        evidence: "Avery Lin is listed as co-founder on the frozen official team page.",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
      }],
      basicFacts: [
        projectFact("@established_protocol", "founder", "Avery Lin", "team", "Co-founder"),
        projectFact("@established_protocol", "legal_entity", "Established Protocol Labs S.A.", "legal", "Operating entity"),
        projectFact("@established_protocol", "product", "Live on-chain exchange", "product"),
        projectFact("@established_protocol", "official_token", "$EST", "token"),
        projectFact("@established_protocol", "governance", "EST token-holder governance", "governance"),
        projectFact("@established_protocol", "tokenomics", "Published EST allocation and supply schedule", "tokenomics"),
        projectFact("@established_protocol", "audit", "Independent security review", "security"),
        projectFact("@established_protocol", "repository", "github.com/example/established-protocol", "code"),
        projectFact("@established_protocol", "traction", "$42M verified daily protocol volume", "metrics", "as of 2026-07-10"),
        projectFact("@established_protocol", "funding", "Bootstrapped with a disclosed treasury", "treasury"),
      ],
      recentActivity: [
        "Released the latest audited router upgrade.",
        "Published the monthly governance and treasury report.",
      ],
      axes: [
        { axis: "P1_team_and_identity", score: 14, rationale: "A named founder and official organization footprint are frozen in first-party evidence." },
        { axis: "P2_product_substance", score: 22, rationale: "The live product, active repository, shipped upgrade, and independent security review establish substantial execution." },
        { axis: "P3_token_conduct", score: 17, rationale: "The canonical token and its governance role are disclosed with no verified adverse conduct in the fixture." },
        { axis: "P4_backing_and_partners", score: 10, rationale: "The project is transparently bootstrapped; lack of a famous investor is not treated as adverse evidence." },
        { axis: "P5_traction_and_liveness", score: 13, rationale: "Sustained verified market activity and current releases establish real usage and liveness." },
        { axis: "P6_transparency_integrity", score: 11, rationale: "Governance, treasury, code, and security disclosures are current and source-backed." },
      ],
    }),
    expect: { verdict: "PASS", governing: SubjectClass.PROJECT, cap: null, score: { min: 85, max: 90 } },
  },
  {
    name: "project:early-stage-clean",
    note: "real team and working beta with limited operating history -> CAUTION, not FAIL or AVOID",
    groundTruth: "clean",
    evidence: projectEvidence("@early_project", "Early Project", "Probable", {
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Early Project",
        symbol: "EARLY",
        coingeckoId: "early-project-control",
        rank: null,
        address: "0x000000000000000000000000000000000000ea71",
        chain: "ethereum",
        homepage: "https://project-control.example",
        sourceUrl: "https://project-control.example/early-token",
        capturedAt: PROJECT_FIXTURE_CAPTURED_AT,
        providers: ["coingecko", "dexscreener"],
        volume24hUsd: 180_000,
        liquidityUsd: 900_000,
      },
      webTeam: [{
        name: "Morgan Reyes",
        role: "Founder",
        source: "Official project profile",
        sourceUrl: "https://project-control.example/early-team",
        evidence: "Morgan Reyes is named as founder on the official project profile.",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "team-page",
      }],
      basicFacts: [
        projectFact("@early_project", "founder", "Morgan Reyes", "early-team", "Founder"),
        projectFact("@early_project", "product", "Working public beta", "early-product"),
        projectFact("@early_project", "official_token", "$EARLY", "early-token"),
        projectFact("@early_project", "repository", "github.com/example/early-project", "early-code"),
        projectFact("@early_project", "funding", "Founder-funded public beta", "early-funding"),
      ],
      recentActivity: ["Opened the public beta and published the first release notes."],
      axes: [
        { axis: "P1_team_and_identity", score: 12, rationale: "A named founder and official project footprint establish solid identity; short history limits confidence rather than erasing those facts." },
        { axis: "P2_product_substance", score: 16, rationale: "A working public beta and source repository show real execution while the explicit beta stage limits demonstrated maturity." },
        { axis: "P3_token_conduct", score: 13, rationale: "The canonical token is disclosed with a short, still-emerging operating history." },
        { axis: "P4_backing_and_partners", score: 7, rationale: "Founder funding is source-backed, while institutional and counterparty relationships remain early." },
        { axis: "P5_traction_and_liveness", score: 7, rationale: "The product is active with early market use, but sustained traction is not yet established." },
        { axis: "P6_transparency_integrity", score: 8, rationale: "Core identity, product, token, and code disclosures establish an emerging transparency baseline." },
      ],
    }),
    expect: { verdict: "CAUTION", governing: SubjectClass.PROJECT, cap: null, score: { min: 63, max: 63 } },
  },
  {
    name: "project:verified-fraud-hard-stop",
    note: "strong product and traction cannot dilute a direct, independently verified fraud finding",
    groundTruth: "harmful",
    evidence: projectEvidence("@harmful_project", "Harmful Project", "Confirmed", {
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Harmful Project",
        symbol: "HARM",
        coingeckoId: "harmful-project-control",
        rank: 40,
        address: "0x000000000000000000000000000000000000bad0",
        chain: "ethereum",
        homepage: "https://project-control.example",
        sourceUrl: "https://project-control.example/harm-token",
        capturedAt: PROJECT_FIXTURE_CAPTURED_AT,
        providers: ["coingecko", "dexscreener"],
        volume24hUsd: 60_000_000,
        liquidityUsd: 100_000_000,
      },
      findings: [{
        finding_type: "InvestigatorCallout",
        claim: "Direct project fraud was established by two independent investigators.",
        source_url: "https://project-control.example/verified-investigation",
        source_date: "2026-07-12",
        verification_status: "Verified",
        independent_source_count: 2,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      axes: [
        { axis: "P1_team_and_identity", score: 14, rationale: "The operators and project identity are well established." },
        { axis: "P2_product_substance", score: 22, rationale: "A live, widely used product is verified." },
        { axis: "P3_token_conduct", score: 14, rationale: "The token is real and liquid, but conduct concerns remain material." },
        { axis: "P4_backing_and_partners", score: 11, rationale: "Multiple project relationships are independently confirmed." },
        { axis: "P5_traction_and_liveness", score: 13, rationale: "Market activity and product usage are substantial and current." },
        { axis: "P6_transparency_integrity", score: 5, rationale: "The verified fraud finding materially collapses integrity despite otherwise strong operations." },
      ],
    }),
    expect: { verdict: "AVOID", governing: SubjectClass.PROJECT, cap: "investigator_verified_fraud", score: { min: 0, max: 10 } },
  },

  // ── evidence-integrity controls ──
  {
    name: "control:model-rug-lead",
    note: "a model-extracted rug allegation is a lead, never a founder cap",
    groundTruth: "clean",
    evidence: ev("@model_rug_control", [SubjectClass.FOUNDER], "Confirmed", {
      ventures: [{
        project_name: "UnverifiedClaimCo",
        role: "founder",
        period: "2024",
        outcome: VentureOutcome.RUG,
        evidence_url: "https://example.com/unverified-claim",
        evidence_origin: "model_lead",
        artifact_verified: false,
      }],
      axes: completeAxes(SubjectClass.FOUNDER, 0.86),
    }),
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null, score: { min: 80, max: 100 } },
  },
  {
    name: "control:model-fraud-lead",
    note: "a model-written investigator allegation cannot self-verify shared fraud",
    groundTruth: "clean",
    evidence: ev("@model_fraud_control", [SubjectClass.INVESTOR], "Confirmed", {
      findings: [{
        finding_type: "InvestigatorCallout",
        claim: "Unverified model allegation",
        source_url: "https://example.com/model-lead",
        source_date: "2026-01-01",
        verification_status: "Verified",
        independent_source_count: 2,
        polarity: -1,
        evidence_origin: "model_lead",
        artifact_verified: false,
      }],
      axes: completeAxes(SubjectClass.INVESTOR, 0.86),
    }),
    expect: { verdict: "PASS", governing: SubjectClass.INVESTOR, cap: null, score: { min: 80, max: 100 } },
  },
  {
    name: "control:model-agency-lead",
    note: "model-discovered manipulation services require a fetched artifact",
    groundTruth: "clean",
    evidence: ev("@model_agency_control", [SubjectClass.AGENCY], "Confirmed", {
      clientEngagements: [{
        client_name: "ClaimedClient",
        service_type: "market_making",
        manipulation_service_flag: true,
        evidence_url: "https://example.com/model-service-lead",
        evidence_origin: "model_lead",
        artifact_verified: false,
      }],
      axes: completeAxes(SubjectClass.AGENCY, 0.86),
    }),
    expect: { verdict: "PASS", governing: SubjectClass.AGENCY, cap: null, score: { min: 80, max: 100 } },
  },
  {
    name: "anchor:verified-fraud",
    note: "two-source investigator fraud with a verified artifact is a shared AVOID",
    groundTruth: "harmful",
    evidence: ev("@verified_fraud", [SubjectClass.INVESTOR], "Confirmed", {
      findings: [{
        finding_type: "InvestigatorCallout",
        claim: "Fraud established by independent investigators",
        source_url: "https://example.com/verified-investigation",
        source_date: "2026-01-01",
        verification_status: "Verified",
        independent_source_count: 2,
        polarity: -1,
        evidence_origin: "deterministic",
        artifact_verified: true,
      }],
      axes: completeAxes(SubjectClass.INVESTOR, 0.9),
    }),
    expect: { verdict: "AVOID", governing: SubjectClass.INVESTOR, cap: "investigator_verified_fraud", score: { min: 0, max: 10 } },
  },
  {
    name: "anchor:verified-wallet-dump",
    note: "a self-attributed wallet selling into its own promotion must fail",
    groundTruth: "harmful",
    evidence: ev("@verified_wallet_dump", [SubjectClass.KOL], "Unverified", {
      wallets: [{
        address: "0x1111111111111111111111111111111111111111",
        chain: "ethereum",
        link_tier: "SelfDoxxed",
        sold_into_own_promo: true,
      }],
      axes: completeAxes(SubjectClass.KOL, 0.9),
    }),
    expect: { verdict: "FAIL", governing: SubjectClass.KOL, cap: "wallet_sold_into_promo", score: { min: 30, max: 35 } },
  },

  // ── abstention controls ──
  {
    name: "abstain:missing-founder-axis",
    note: "one unrun required axis means no score and no verdict",
    groundTruth: "insufficient-evidence",
    evidence: ev("@missing_axis", [SubjectClass.FOUNDER], "Confirmed", {
      axes: completeAxes(SubjectClass.FOUNDER, 0.95).slice(0, -1),
    }),
    expect: { verdict: "INCOMPLETE", governing: null, cap: null, score: null },
  },
  {
    name: "abstain:partial-second-role",
    note: "a complete founder track cannot hide an incomplete investor track",
    groundTruth: "insufficient-evidence",
    evidence: ev("@partial_multi", [SubjectClass.FOUNDER, SubjectClass.INVESTOR], "Confirmed", {
      axes: [
        ...completeAxes(SubjectClass.FOUNDER, 0.9),
        ...completeAxes(SubjectClass.INVESTOR, 0.9).slice(0, -1),
      ],
    }),
    expect: { verdict: "INCOMPLETE", governing: null, cap: null, score: null },
  },
  {
    name: "abstain:missing-project-axis",
    note: "an established-looking project with one unscored required axis must abstain",
    groundTruth: "insufficient-evidence",
    evidence: projectEvidence("@partial_project", "Partial Project", "Confirmed", {
      projectToken: {
        verified: true,
        verification: "official_domain",
        name: "Partial Project",
        symbol: "PART",
        coingeckoId: "partial-project-control",
        rank: 120,
        address: "0x0000000000000000000000000000000000000a17",
        chain: "ethereum",
        homepage: "https://project-control.example",
        sourceUrl: "https://project-control.example/partial-token",
        capturedAt: PROJECT_FIXTURE_CAPTURED_AT,
      },
      axes: [
        { axis: "P1_team_and_identity", score: 14, rationale: "Team evidence is complete." },
        { axis: "P2_product_substance", score: 21, rationale: "Product evidence is complete." },
        { axis: "P3_token_conduct", score: 16, rationale: "Token evidence is complete." },
        { axis: "P4_backing_and_partners", score: 10, rationale: "Backing evidence is complete." },
        { axis: "P5_traction_and_liveness", score: 12, rationale: "Traction evidence is complete." },
        // P6 is intentionally absent. Strong evidence elsewhere must not be
        // converted into a score when a required project axis did not run.
      ],
    }),
    expect: { verdict: "INCOMPLETE", governing: null, cap: null, score: null },
  },
];
