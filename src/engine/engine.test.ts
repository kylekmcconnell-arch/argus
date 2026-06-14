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

describe("ARGUS-P v2 engine (port fidelity)", () => {
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
    a.setAxis("I1_identity_legitimacy", 0);
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
    a.addClientEngagement({ client_name: "SomeProject", service_type: "market_making", manipulation_service_flag: true });
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
