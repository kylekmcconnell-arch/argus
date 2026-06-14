// Golden set: labeled subjects with known expected verdicts. This is the
// calibration spine for evolving the model. When you change a weight or cap in
// profiles.ts, re-run `npm run calibrate` and see exactly which verdicts drift.
//
// Seed cases are the four curated dossiers; the rest are pure-evidence anchors
// that pin specific mechanics (caps, the identity gate, banding).

import { SubjectClass, VentureOutcome } from "../engine";
import { emptyEvidence, type CollectedEvidence } from "./../data/evidence";
import { findSubject, toEvidence } from "./../data/subjects";

export interface GoldenCase {
  name: string;
  note: string;
  evidence: CollectedEvidence;
  expect: { verdict: string; governing?: SubjectClass; cap?: string | null };
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

export const GOLDEN: GoldenCase[] = [
  // ── the four curated dossiers ──
  {
    name: "@0xlumen",
    note: "multi-role; advisor cap (paid advisor to a confirmed rug) governs",
    evidence: fixtureEvidence("@0xlumen"),
    expect: { verdict: "FAIL", governing: SubjectClass.ADVISOR, cap: "advised_rug_with_allocation" },
  },
  {
    name: "@satoshi_builds",
    note: "two exits, returning backers, disclosed identity (+5)",
    evidence: fixtureEvidence("@satoshi_builds"),
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null },
  },
  {
    name: "@nova_capital",
    note: "contradicted testimonial caps the investor role",
    evidence: fixtureEvidence("@nova_capital"),
    expect: { verdict: "FAIL", governing: SubjectClass.INVESTOR, cap: "contradicted_testimonial" },
  },
  {
    name: "@deltagrowth",
    note: "manipulation-as-a-service is a hard AVOID",
    evidence: fixtureEvidence("@deltagrowth"),
    expect: { verdict: "AVOID", governing: SubjectClass.AGENCY, cap: "market_manipulation_services" },
  },

  // ── pure mechanic anchors ──
  {
    name: "anchor:serial-success",
    note: "two real exits, no caps -> PASS",
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
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null },
  },
  {
    name: "anchor:prior-rug",
    note: "a confirmed rug as principal -> AVOID regardless of other scores",
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
    expect: { verdict: "AVOID", governing: SubjectClass.FOUNDER, cap: "prior_rug_as_principal" },
  },
  {
    name: "anchor:impersonation",
    note: "suspected impersonation blocks publication for any class",
    evidence: ev("@anchor_imp", [SubjectClass.INVESTOR], "SuspectedImpersonation", {
      axes: [
        { axis: "I1_identity_legitimacy", score: 10, rationale: "" },
        { axis: "I2_portfolio_quality", score: 20, rationale: "" },
        { axis: "I3_fund_scale_tier", score: 12, rationale: "" },
        { axis: "I4_testimonial_corroboration", score: 15, rationale: "" },
        { axis: "I5_reputation_fud", score: 20, rationale: "" },
      ],
    }),
    expect: { verdict: "UNVERIFIABLE_IDENTITY" },
  },
  {
    name: "anchor:pseudonymous-pass",
    note: "pseudonymity is neutral; a strong pseudonymous founder still passes",
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
    expect: { verdict: "PASS", governing: SubjectClass.FOUNDER, cap: null },
  },
];
