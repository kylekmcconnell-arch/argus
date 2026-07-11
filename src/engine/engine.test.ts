// Mirrors argus_p/tests/test_profiles.py exactly. Proves the TS port is
// behaviourally identical to the Python engine you already trust.
import { describe, it, expect } from "vitest";
import {
  Audit,
  classifySubject,
  validateAxes,
  SubjectClass,
  VentureOutcome,
  FounderPattern,
  classifyFounderPattern,
  classifyTestimonial,
  TestimonialVerdict as TV,
} from "./index";

const FOUNDER_AXES = [
  "F1_identity_verifiability",
  "F2_track_record",
  "F3_repeat_backing",
  "F4_build_substance",
  "F5_reputation_integrity",
  "F6_network_quality",
];

function highScoringFounder(handle = "@graph_subject"): Audit {
  const audit = new Audit(handle, { subject_class: SubjectClass.FOUNDER });
  audit.setIdentity("Confirmed");
  for (const axis of FOUNDER_AXES) audit.setAxis(axis, 100, "strong baseline");
  return audit;
}

function trustGraphFinding(
  graphOverrides: Record<string, unknown> = {},
  findingOverrides: Record<string, unknown> = {},
) {
  return {
    finding_type: "TrustGraphConnection",
    claim: "The subject shares a frozen identity bridge with a failed report.",
    source_url: "",
    source_date: "2026-07-11",
    source_author: "ARGUS trust graph",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    content_hash: "a".repeat(64),
    trust_graph: {
      tie_key: "email:dev@example.com",
      tie_type: "Identity",
      tie_strength: "hard",
      subject_edge_types: ["IDENTITY_EMAIL"],
      other_edge_types: ["COMMIT_EMAIL"],
      other_report_version_id: "00000000-0000-4000-8000-000000000201",
      other_attestation: "server_collected",
      other_completeness: "complete",
      other_verdict: "FAIL",
      ...graphOverrides,
    },
    ...findingOverrides,
  };
}

describe("ARGUS-P v2 engine (port fidelity)", () => {
  it("mints a distinct immutable audit id for repeated subjects", () => {
    const first = new Audit("@same_subject", { subject_class: SubjectClass.FOUNDER });
    const second = new Audit("@same_subject", { subject_class: SubjectClass.FOUNDER });
    expect(first.audit_id).not.toBe(second.audit_id);
    expect(first.audit_id).toMatch(/^PA-/);
  });

  it("all axis weights sum to 100", () => {
    expect(validateAxes()).toEqual({});
  });

  it("FOUNDER serial-success with repeat backing -> PASS", () => {
    const a = new Audit("@serial_founder", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addVenture({ project_name: "ExitCo", role: "founder", period: "2017-2020", outcome: VentureOutcome.ACQUISITION, acquirer: "BigCorp", deal_type: "strategic", deal_value_usd: 120e6, investors: ["Sequoia", "a16z"] });
    a.addVenture({ project_name: "NewCo", role: "founder", period: "2023-present", outcome: VentureOutcome.ACTIVE, current_backers: ["a16z", "Paradigm"] });
    const fs = a.founderSummary();
    expect(fs.pattern).toBe(FounderPattern.PROVEN_ONCE);
    expect(fs.repeat_backing.strength).toBe("strong");
    for (const [ax, s] of [["F1_identity_verifiability", 11], ["F2_track_record", 24], ["F3_repeat_backing", 14], ["F4_build_substance", 12], ["F5_reputation_integrity", 17], ["F6_network_quality", 10]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.verdict).toBe("PASS");
    expect(r.score_total!).toBeGreaterThanOrEqual(70);
  });

  it("FOUNDER with prior rug -> cap 10 -> AVOID", () => {
    const a = new Audit("@rugger", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addVenture({ project_name: "RugCo", role: "founder", period: "2022", outcome: VentureOutcome.RUG });
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) {
      a.setAxis(ax, 8);
    }
    const r = a.finalize();
    expect(a.founderSummary().pattern).toBe(FounderPattern.RUG_HISTORY);
    expect(r.verdict).toBe("AVOID");
    expect(r.score_total!).toBeLessThanOrEqual(10);
  });

  it("FOUNDER who operates manipulation tooling -> cap 10 -> AVOID", () => {
    const a = new Audit("@toolmaker", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addFinding({ finding_type: "ManipulationTooling", claim: "operates a token bundler + wallet mixer", source_url: "https://smithii.example/bundler", source_date: "", verification_status: "Verified", independent_source_count: 2, polarity: -1 });
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) {
      a.setAxis(ax, 9);
    }
    const r = a.finalize();
    expect(r.cap_applied).toBe("operates_manipulation_tooling");
    expect(r.verdict).toBe("AVOID");
    expect(r.score_total!).toBeLessThanOrEqual(10);
  });

  it("FOUNDER with only a REPORTED (unverified) tooling finding -> not capped", () => {
    const a = new Audit("@maybe_toolmaker", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addFinding({ finding_type: "ManipulationTooling", claim: "alleged bundler ties", source_url: "", source_date: "", verification_status: "Reported", independent_source_count: 1, polarity: -1 });
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) {
      a.setAxis(ax, 9);
    }
    const r = a.finalize();
    expect(r.cap_applied).not.toBe("operates_manipulation_tooling");
    expect(r.score_total!).toBeGreaterThan(10);
  });

  it("model-discovered adverse claims cannot self-verify into a hard cap", () => {
    const a = new Audit("@model_lead", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addFinding({
      finding_type: "InvestigatorCallout",
      claim: "a model says many investigators documented a rug",
      source_url: "https://example.com/model-suggested-page",
      source_date: "",
      verification_status: "Verified",
      independent_source_count: 99,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) {
      a.setAxis(ax, 10);
    }
    const r = a.finalize();
    expect(r.cap_applied).not.toBe("investigator_verified_fraud");
    expect(r.verdict).not.toBe("AVOID");
  });

  it("model-discovered manipulation tooling cannot fire founder or agency caps", () => {
    const founder = new Audit("@model_tool_lead", { subject_class: SubjectClass.FOUNDER });
    founder.setIdentity("Confirmed");
    founder.addFinding({
      finding_type: "ManipulationTooling",
      claim: "possible bundler connection",
      source_url: "https://example.com/model-suggested-tool",
      source_date: "",
      verification_status: "Verified",
      independent_source_count: 5,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) founder.setAxis(ax, 10);
    expect(founder.finalize().cap_applied).not.toBe("operates_manipulation_tooling");

    const agency = new Audit("@model_agency_lead", { subject_class: SubjectClass.AGENCY });
    agency.setIdentity("Confirmed");
    agency.addClientEngagement({
      client_name: "Candidate Tool",
      service_type: "possible_manipulation_tooling:bundler",
      manipulation_service_flag: true,
      evidence_url: "https://example.com/model-suggested-tool",
      evidence_origin: "model_lead",
      artifact_verified: false,
    });
    for (const ax of ["AG1_identity_legitimacy", "AG2_client_outcomes", "AG3_service_integrity", "AG4_reputation_fud"]) agency.setAxis(ax, 18);
    expect(agency.finalize().cap_applied).not.toBe("market_manipulation_services");
  });

  it("caps an exact hard trust-graph predicate only when its source report is qualified", () => {
    const audit = highScoringFounder();
    audit.addFinding(trustGraphFinding() as never);

    const result = audit.finalize();

    expect(result.cap_applied).toBe("trust_graph_hard_link");
    expect(result.score_total).toBe(10);
    expect(result.verdict).toBe("AVOID");
  });

  it("downgrades an exact medium trust-graph predicate without treating it as hard identity proof", () => {
    const audit = highScoringFounder();
    audit.addFinding(trustGraphFinding({
      tie_key: "@shared-founder",
      tie_type: "Person",
      tie_strength: "medium",
      subject_edge_types: ["ASSOCIATES_WITH"],
      other_edge_types: ["TEAM"],
    }) as never);

    const result = audit.finalize();

    expect(result.cap_applied).toBe("trust_graph_medium_link");
    expect(result.score_total).toBe(69);
    expect(result.verdict).toBe("CAUTION");
  });

  it.each([
    ["weak tie", { tie_key: "holder:0x1234", tie_strength: "weak" }, {}],
    ["weak key mislabeled medium", { tie_key: "holder:0x1234", tie_strength: "medium" }, {}],
    ["medium key mislabeled hard", { tie_key: "@shared-founder", tie_strength: "hard" }, {}],
    ["generic company collision", { tie_key: "examplelabs", tie_type: "Company", tie_strength: "medium", subject_edge_types: ["FOUNDED"], other_edge_types: ["TEAM"] }, {}],
    ["person lead without a qualified relationship", { tie_key: "@shared-founder", tie_type: "Person", tie_strength: "medium", subject_edge_types: ["MENTIONED"], other_edge_types: ["TEAM"] }, {}],
    ["partial source report", { other_completeness: "partial" }, {}],
    ["failed source collection", { other_completeness: "failed" }, {}],
    ["analyst-submitted source", { other_attestation: "analyst_submitted" }, {}],
    ["legacy source", { other_attestation: "legacy_unattested" }, {}],
    ["non-adverse source verdict", { other_verdict: "CAUTION" }, {}],
    ["missing source-side edge", { other_edge_types: [] }, {}],
    ["blank subject-side edge", { subject_edge_types: [""] }, {}],
    ["unverified artifact", {}, { artifact_verified: false }],
    ["model-generated predicate", {}, { evidence_origin: "model_lead" }],
    ["malformed artifact hash", {}, { content_hash: "not-a-sha" }],
  ])("does not cap from an unqualified trust-graph predicate: %s", (_label, graphOverrides, findingOverrides) => {
    const audit = highScoringFounder(`@unqualified_${String(_label).replace(/\W+/g, "_")}`);
    audit.addFinding(trustGraphFinding(graphOverrides, findingOverrides) as never);

    const result = audit.finalize();

    expect(result.cap_applied).toBeNull();
    expect(result.score_total).toBe(100);
    expect(result.verdict).toBe("PASS");
  });

  it("a partial axis set finalizes INCOMPLETE with no score", () => {
    const a = new Audit("@partial", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.setAxis("F1_identity_verifiability", 0, "only one axis returned");
    const r = a.finalize();
    expect(r.role_reports[0].verdict).toBe("INCOMPLETE");
    expect(r.role_reports[0].score_total).toBeNull();
    expect(r.role_reports[0].axes).toHaveProperty("F1_identity_verifiability");
    expect(r.composite_verdict).toBe("INCOMPLETE");
    expect(r.governing_score).toBeNull();
  });

  it("one incomplete requested role makes the composite incomplete", () => {
    const a = new Audit("@mixed_completeness", { roles: [SubjectClass.FOUNDER, SubjectClass.MEMBER] });
    a.setIdentity("Confirmed");
    for (const ax of ["F1_identity_verifiability", "F2_track_record", "F3_repeat_backing", "F4_build_substance", "F5_reputation_integrity", "F6_network_quality"]) a.setAxis(ax, 10);
    a.setAxis("ME1_identity", 5);
    const r = a.finalize();
    expect(r.role_reports.find((role) => role.role === SubjectClass.FOUNDER)?.verdict).not.toBe("INCOMPLETE");
    expect(r.role_reports.find((role) => role.role === SubjectClass.MEMBER)?.verdict).toBe("INCOMPLETE");
    expect(r.composite_verdict).toBe("INCOMPLETE");
    expect(r.governing_role).toBeNull();
  });

  it("KOL pseudonymous wallet sold into promo -> cap 35 (not gated)", () => {
    const a = new Audit("@anon_caller", { subject_class: SubjectClass.KOL });
    a.setIdentity("Unverified");
    a.addWallet({ address: "0xdead", chain: "base", link_tier: "InvestigatorAttributed", sold_into_own_promo: true });
    for (const [ax, s] of [["K1_identity_roster", 8], ["K2_call_performance", 20], ["K3_disclosure_deletion", 10], ["K4_onchain_conduct", 5], ["K5_cabal_fud", 10]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.score_total).not.toBeNull();
    expect(r.cap_applied).toBe("wallet_sold_into_promo");
    expect(r.score_total!).toBeLessThanOrEqual(35);
  });

  it("INVESTOR pseudonymous -> scored, not gated", () => {
    const a = new Audit("@anon_fund", { subject_class: SubjectClass.INVESTOR });
    a.setIdentity("Unverified");
    for (const [ax, s] of [["I1_identity_legitimacy", 5], ["I2_portfolio_quality", 18], ["I3_fund_scale_tier", 9], ["I4_testimonial_corroboration", 12], ["I5_reputation_fud", 16]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.verdict).not.toBe("UNVERIFIABLE_IDENTITY");
    expect(r.score_total).not.toBeNull();
  });

  it("impersonation blocks publication", () => {
    const a = new Audit("@imposter_fund", { subject_class: SubjectClass.INVESTOR });
    a.setIdentity("SuspectedImpersonation");
    for (const ax of ["I1_identity_legitimacy", "I2_portfolio_quality", "I3_fund_scale_tier", "I4_testimonial_corroboration", "I5_reputation_fud"]) a.setAxis(ax, 0);
    expect(a.finalize().verdict).toBe("UNVERIFIABLE_IDENTITY");
  });

  it("doxxing bonus applied (+5)", () => {
    const a = new Audit("@doxxed_fund", { subject_class: SubjectClass.INVESTOR });
    a.setIdentity("Confirmed");
    for (const [ax, s] of [["I1_identity_legitimacy", 12], ["I2_portfolio_quality", 16], ["I3_fund_scale_tier", 9], ["I4_testimonial_corroboration", 12], ["I5_reputation_fud", 14]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.role_reports[0].dox_bonus).toBe(5);
    expect(r.score_total).toBe(r.role_reports[0].raw_total! + 5);
  });

  it("4 unconfirmed testimonials -> I4 capped low, no cap trigger", () => {
    const a = new Audit("@thin_fund", { subject_class: SubjectClass.INVESTOR });
    a.setIdentity("Confirmed");
    for (let i = 0; i < 4; i++) {
      a.addTestimonial({ claimed_endorser_handle: "@famous_founder", claimed_relationship: "portfolio", public_acknowledgment: "none", follows_subject: false });
    }
    const [score, summary, cap] = a.corroborationAxis("I4_testimonial_corroboration");
    expect(score).toBeLessThanOrEqual(5);
    expect(summary.unconfirmed).toBe(4);
    expect(cap).toBeNull();
  });

  it("contradicted testimonial cap = 15", () => {
    const a = new Audit("@liar_fund", { subject_class: SubjectClass.INVESTOR });
    a.setIdentity("Confirmed");
    a.addTestimonial({ claimed_endorser_handle: "@real_founder", claimed_relationship: "advisor_to_subject", fud_present: true, sentiment: "negative" });
    for (const [ax, s] of [["I1_identity_legitimacy", 12], ["I2_portfolio_quality", 18], ["I3_fund_scale_tier", 10], ["I4_testimonial_corroboration", 0], ["I5_reputation_fud", 15]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.cap_applied).toBe("contradicted_testimonial");
    expect(r.score_total!).toBeLessThanOrEqual(15);
  });

  it("agency manipulation services -> AVOID", () => {
    const a = new Audit("@bot_agency", { subject_class: SubjectClass.AGENCY });
    a.setIdentity("Confirmed");
    a.addClientEngagement({ client_name: "SomeProject", service_type: "market_making", manipulation_service_flag: true, evidence_url: "https://example.com/verified-service-page", evidence_origin: "deterministic", artifact_verified: true });
    for (const [ax, s] of [["AG1_identity_legitimacy", 10], ["AG2_client_outcomes", 15], ["AG3_service_integrity", 5], ["AG4_reputation_fud", 15]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(r.verdict).toBe("AVOID");
    expect(r.score_total!).toBeLessThanOrEqual(10);
  });

  it("testimonial corroborator unit checks", () => {
    expect(classifyTestimonial({ public_acknowledgment: "endorsement", relationship_corroborated: true })).toBe(TV.CORROBORATED);
    expect(classifyTestimonial({ follows_subject: true })).toBe(TV.PARTIAL);
    expect(classifyTestimonial({})).toBe(TV.UNCONFIRMED);
    expect(classifyTestimonial({ fud_present: true })).toBe(TV.CONTRADICTED);
  });

  it("founder pattern classifier", () => {
    expect(classifyFounderPattern([VentureOutcome.ACQUISITION, VentureOutcome.IPO])).toBe(FounderPattern.SERIAL_SUCCESS);
    expect(classifyFounderPattern([VentureOutcome.SILENT_SHUTDOWN, VentureOutcome.FAILURE])).toBe(FounderPattern.SERIAL_FAILURE);
  });

  it("router classifies bios", () => {
    const res = classifySubject("GP and Founder at SomeFund VC, Web3 investor");
    expect(res.subject_class).toBe(SubjectClass.INVESTOR);
    expect(res.applicable_classes).toEqual(expect.arrayContaining([SubjectClass.INVESTOR, SubjectClass.FOUNDER]));
    const res2 = classifySubject("degen, alpha calls, gems", { kb_hit: true });
    expect(res2.subject_class).toBe(SubjectClass.KOL);
  });

  it("ADVISOR advised a rug with allocation -> capped", () => {
    const a = new Audit("@advisor_x", { subject_class: SubjectClass.ADVISOR });
    a.setIdentity("Confirmed");
    a.addAdvisedProject({ project_name: "RugProj", project_outcome: VentureOutcome.RUG, paid_or_allocated: true, public_acknowledgment: "endorsement", relationship_corroborated: true });
    for (const [ax, s] of [["AD1_identity_verifiability", 10], ["AD2_advised_outcomes", 5], ["AD3_relationship_corroboration", 20], ["AD4_advisory_conduct", 8], ["AD5_reputation_fud", 10]] as [string, number][]) {
      a.setAxis(ax, s);
    }
    const r = a.finalize();
    expect(["AVOID", "FAIL"]).toContain(r.composite_verdict);
    expect(r.governing_score!).toBeLessThanOrEqual(25);
  });

  it("3 unacknowledged advisory claims collapse AD3", () => {
    const a = new Audit("@ghost_advisor", { subject_class: SubjectClass.ADVISOR });
    a.setIdentity("Confirmed");
    for (let i = 0; i < 3; i++) a.addAdvisedProject({ project_name: "BigName", public_acknowledgment: "none", follows_subject: false });
    const [score, summary] = a.advisoryCorroborationAxis("AD3_relationship_corroboration");
    expect(score).toBeLessThanOrEqual(7);
    expect(summary.unconfirmed).toBe(3);
  });

  it("MULTI-ROLE builder + investor + advisor, pseudonymous", () => {
    const a = new Audit("@multi_subject", { roles: [SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.ADVISOR] });
    a.setIdentity("Unverified");
    a.addVenture({ project_name: "PausedCo", role: "founder", period: "2023-2024", outcome: VentureOutcome.PAUSED });
    a.addVenture({ project_name: "BuildCo", role: "founder", period: "2024-present", outcome: VentureOutcome.ACTIVE });
    for (const [ax, s] of [["F1_identity_verifiability", 5], ["F2_track_record", 16], ["F3_repeat_backing", 6], ["F4_build_substance", 11], ["F5_reputation_integrity", 14], ["F6_network_quality", 8]] as [string, number][]) a.setAxis(ax, s);
    for (const [ax, s] of [["I1_identity_legitimacy", 6], ["I2_portfolio_quality", 18], ["I3_fund_scale_tier", 9], ["I4_testimonial_corroboration", 12], ["I5_reputation_fud", 16]] as [string, number][]) a.setAxis(ax, s);
    for (const [ax, s] of [["AD1_identity_verifiability", 5], ["AD2_advised_outcomes", 18], ["AD3_relationship_corroboration", 15], ["AD4_advisory_conduct", 14], ["AD5_reputation_fud", 10]] as [string, number][]) a.setAxis(ax, s);
    const r = a.finalize();
    const rolesSeen = Object.fromEntries(r.role_reports.map((rr) => [rr.role, rr.verdict]));
    expect(new Set(Object.keys(rolesSeen))).toEqual(new Set(["FOUNDER", "INVESTOR", "ADVISOR"]));
    expect(rolesSeen.INVESTOR).not.toBe("UNVERIFIABLE_IDENTITY");
    expect(["Unproven", "ProvenOnce", "SerialSuccess", "Mixed"]).toContain(r.founder_summary!.pattern);
    expect(["PASS", "CAUTION", "FAIL"]).toContain(r.composite_verdict);
    expect(r.role_reports.every((rr) => rr.score_total !== null)).toBe(true);
  });
});
