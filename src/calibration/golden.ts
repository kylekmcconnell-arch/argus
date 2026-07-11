// Golden set: labeled subjects with known expected verdicts. This is the
// calibration spine for evolving the model. When you change a weight or cap in
// profiles.ts, re-run `npm run calibrate` and see exactly which verdicts drift.
//
// Seed cases are the four curated dossiers; the rest are pure-evidence anchors
// that pin specific mechanics (caps, the identity gate, banding).

import { SubjectClass, VentureOutcome } from "../engine";
import { getProfile } from "../engine/profiles";
import { emptyEvidence, type CollectedEvidence } from "./../data/evidence";
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
];
