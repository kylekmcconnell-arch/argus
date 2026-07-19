// Preserves the original argus_p profile behaviors while testing the TS-only
// project and evidence-integrity extensions separately.
import { describe, it, expect } from "vitest";
import {
  Audit,
  classifySubject,
  validateAxes,
  normalizeHandle,
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

  it("records the real report finalization time instead of the Unix epoch", () => {
    const audit = new Audit("@timestamped", { subject_class: SubjectClass.FOUNDER });
    const before = Date.now();

    const report = audit.finalize();

    const finalizedAt = Date.parse(report.finalized_at);
    expect(Number.isFinite(finalizedAt)).toBe(true);
    expect(finalizedAt).toBeGreaterThanOrEqual(before);
    expect(finalizedAt).toBeLessThanOrEqual(Date.now());
    expect(report.finalized_at).not.toBe("1970-01-01T00:00:00.000Z");
    expect(audit.finalize().finalized_at).toBe(report.finalized_at);
  });

  it("persists PROJECT graph subjects as projects while keeping people typed as people", () => {
    const project = new Audit("@protocol", { subject_class: SubjectClass.PROJECT });
    const person = new Audit("@founder", { subject_class: SubjectClass.FOUNDER });
    const mixedPerson = new Audit("@founder_project", {
      roles: [SubjectClass.FOUNDER, SubjectClass.PROJECT],
    });

    expect(project.toPanoptes().nodes.find((node) => node.subject)).toMatchObject({
      type: "Company",
      subtype: "Project",
      key: "@protocol",
      roles: [SubjectClass.PROJECT],
    });
    expect(person.toPanoptes().nodes.find((node) => node.subject)).toMatchObject({
      type: "Person",
      key: "@founder",
      roles: [SubjectClass.FOUNDER],
    });
    expect(mixedPerson.toPanoptes().nodes.find((node) => node.subject)).toMatchObject({
      type: "Person",
      key: "@founder_project",
      roles: [SubjectClass.FOUNDER, SubjectClass.PROJECT],
    });
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

  it("keeps a model lead with a candidate URL out of publishable subject findings", () => {
    const audit = highScoringFounder("@scoped_subject");
    audit.addFinding({
      finding_type: "AdverseLead",
      claim: "A search model surfaced a candidate complaint page.",
      source_url: "https://example.com/candidate-only",
      source_date: "",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@scoped_subject",
        target_entity_type: "person",
        relationship_to_subject: "self",
      },
    });

    const result = audit.finalize();

    expect(result.publishable_findings).toEqual([]);
    expect(result.investigative_leads).toHaveLength(1);
    expect(result.investigative_leads[0]).toMatchObject({
      finding_type: "AdverseLead",
      evidence_origin: "model_lead",
      finding_scope: { scope: "direct_subject", target_entity_key: "@scoped_subject" },
    });
  });

  it("cannot cap or publish a verified adverse finding scoped to an associate", () => {
    const audit = highScoringFounder("@primary_subject");
    audit.addFinding({
      finding_type: "InvestigatorCallout",
      claim: "Investigators documented conduct by @associate_only.",
      source_url: "https://example.com/associate-evidence",
      source_date: "2026-07-11",
      verification_status: "Verified",
      independent_source_count: 3,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate_only",
        target_entity_type: "person",
        relationship_to_subject: "associate",
        relationship_label: "recorded collaborator",
      },
    });

    const result = audit.finalize();

    expect(result.cap_applied).toBeNull();
    expect(result.score_total).toBe(100);
    expect(result.publishable_findings).toEqual([]);
    expect(result.investigative_leads).toHaveLength(1);
  });

  it("fails closed when a row claims direct scope but targets another handle", () => {
    const audit = highScoringFounder("@primary_subject_2");
    audit.addFinding({
      finding_type: "DeceptionFinding",
      claim: "This claim is actually about somebody else.",
      source_url: "https://example.com/other-person",
      source_date: "2026-07-11",
      verification_status: "Verified",
      independent_source_count: 2,
      polarity: -1,
      evidence_origin: "deterministic",
      artifact_verified: true,
      finding_scope: {
        scope: "direct_subject",
        target_entity_key: "@different_person",
        target_entity_type: "person",
        relationship_to_subject: "self",
      },
    });

    const result = audit.finalize();

    expect(result.cap_applied).toBeNull();
    expect(result.publishable_findings).toEqual([]);
    expect(result.investigative_leads).toHaveLength(1);
    expect(audit.toPanoptes().nodes.some((node) => node.type === "DeceptionFinding")).toBe(false);
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
    // Slice keeps each per-case handle within the 30-char handle bound.
    const audit = highScoringFounder(`@unq_${String(_label).replace(/\W+/g, "_")}`.slice(0, 31));
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

  it("preserves immutable axis lineage while legacy axis calls remain valid", () => {
    const a = new Audit("@lineage", { subject_class: SubjectClass.FOUNDER });
    const evidenceRefs = [`art_v1_${"a".repeat(64)}`];
    const counterEvidenceRefs = [`art_v1_${"b".repeat(64)}`];
    const gaps = ["One prior venture outcome remains unresolved."];

    a.setAxis("F1_identity_verifiability", 10, "Resolved identity.", {
      evidenceRefs,
      counterEvidenceRefs,
      gaps,
    });
    a.setAxis("F2_track_record", 12, "Legacy-compatible call.");
    evidenceRefs.length = 0;
    counterEvidenceRefs.length = 0;
    gaps[0] = "mutated";

    const axes = a.finalize().role_reports[0].axes;
    expect(axes.F1_identity_verifiability).toMatchObject({
      evidenceRefs: [`art_v1_${"a".repeat(64)}`],
      counterEvidenceRefs: [`art_v1_${"b".repeat(64)}`],
      gaps: ["One prior venture outcome remains unresolved."],
    });
    expect(axes.F2_track_record).not.toHaveProperty("evidenceRefs");
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

  it("uses the lowest-scoring role when multiple roles share the same verdict band", () => {
    const a = new Audit("@multi_role", { roles: [SubjectClass.FOUNDER, SubjectClass.INVESTOR] });
    a.setIdentity("Confirmed");
    for (const [axis, score] of [
      ["F1_identity_verifiability", 12], ["F2_track_record", 22], ["F3_repeat_backing", 10],
      ["F4_build_substance", 12], ["F5_reputation_integrity", 13], ["F6_network_quality", 10],
      ["I1_identity_legitimacy", 15], ["I2_portfolio_quality", 15], ["I3_fund_scale_tier", 10],
      ["I4_testimonial_corroboration", 10], ["I5_reputation_fud", 20],
    ] as [string, number][]) a.setAxis(axis, score);

    const report = a.finalize();
    expect(report.role_reports.find((role) => role.role === SubjectClass.FOUNDER)?.score_total).toBe(84);
    expect(report.role_reports.find((role) => role.role === SubjectClass.INVESTOR)?.score_total).toBe(75);
    expect(report.composite_verdict).toBe("PASS");
    expect(report.governing_role).toBe(SubjectClass.INVESTOR);
    expect(report.governing_score).toBe(75);
  });

  it("does not render employment or operating affiliations as founded companies", () => {
    const audit = new Audit("@operator", { subject_class: SubjectClass.MEMBER });
    audit.addVenture({ project_name: "Paradigm", role: "CTO", period: "2022-2025", outcome: VentureOutcome.UNKNOWN });
    const graph = audit.toPanoptes();
    expect(graph.edges).toContainEqual(expect.objectContaining({ dst: "paradigm", type: "WORKED_ON", role: "CTO" }));
    expect(graph.edges).not.toContainEqual(expect.objectContaining({ dst: "paradigm", type: "FOUNDED" }));
  });

  it("keeps employment-like venture titles out of founder and investment edges", () => {
    const audit = new Audit("@operator", { subject_class: SubjectClass.MEMBER });
    for (const [project_name, role] of [
      ["Fund A", "Venture Partner"],
      ["Bank B", "Capital Markets Lead"],
      ["Protocol C", "Product Owner"],
      ["Studio D", "Content Creator"],
      ["Fund E", "GP Operations"],
    ]) audit.addVenture({ project_name, role, period: "", outcome: VentureOutcome.UNKNOWN });
    const graph = audit.toPanoptes();

    expect(graph.edges.filter((edge) => edge.type === "WORKED_ON")).toHaveLength(5);
    expect(graph.edges.some((edge) => edge.type === "FOUNDED" || edge.type === "INVESTED_IN")).toBe(false);
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

  it("does not double-count identity as a project disclosure bonus", () => {
    const a = new Audit("@named_protocol", { subject_class: SubjectClass.PROJECT });
    a.setIdentity("Confirmed");
    for (const [axis, score] of [
      ["P1_team_and_identity", 11],
      ["P2_product_substance", 17],
      ["P3_token_conduct", 13],
      ["P4_backing_and_partners", 7],
      ["P5_traction_and_liveness", 12],
      ["P6_transparency_integrity", 9],
    ] as [string, number][]) a.setAxis(axis, score);

    const report = a.finalize();

    expect(report.role_reports[0].dox_bonus).toBe(0);
    expect(report.governing_score).toBe(69);
    expect(report.composite_verdict).toBe("CAUTION");
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

  it("classifies a fund whose bio backs builders without VC keywords as INVESTOR", () => {
    // The real @a16zcrypto bio: no "venture/capital/fund" keyword, and the
    // entrepreneurs it backs are "building" (that must not misfire as FOUNDER).
    const res = classifySubject("We back bold entrepreneurs building the next internet.");
    expect(res.applicable_classes).toContain(SubjectClass.INVESTOR);
    expect(res.applicable_classes).not.toContain(SubjectClass.FOUNDER);
  });

  it("still classifies a real builder bio as FOUNDER when the subject is the one building", () => {
    const res = classifySubject("building a new L2. previously eng at coinbase.");
    expect(res.applicable_classes).toContain(SubjectClass.FOUNDER);
    expect(res.applicable_classes).not.toContain(SubjectClass.INVESTOR);
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

describe("handle normalization and associate keying", () => {
  it("normalizeHandle never truncates a hyphenated identifier to its tail", () => {
    // Pre-fix, the unanchored tail regex mapped "ethereum-optimism" to
    // "@optimism", silently bridging the trust graph to an unrelated account.
    expect(() => normalizeHandle("ethereum-optimism")).toThrow(/cannot normalize/);
    expect(() => normalizeHandle("matter-labs")).toThrow(/cannot normalize/);
    expect(() => normalizeHandle("Display Name @realhandle")).toThrow(/cannot normalize/);
  });

  it("normalizeHandle keeps accepting bare handles, @handles, and profile URLs", () => {
    expect(normalizeHandle("plainhandle")).toBe("@plainhandle");
    expect(normalizeHandle("@Cypher_Eth")).toBe("@cypher_eth");
    expect(normalizeHandle("https://x.com/Cypher_Eth")).toBe("@cypher_eth");
    expect(normalizeHandle("  @padded  ")).toBe("@padded");
  });

  it("addAssociate keys hyphenated GitHub org logins by full name without collisions", () => {
    const a = new Audit("@org_subject", { subject_class: SubjectClass.FOUNDER });
    a.addAssociate({ associate_handle: "solana-labs", relation: "github org" });
    a.addAssociate({ associate_handle: "matter-labs", relation: "github org" });
    const keys = a.getAssociates().map((as) => as.associate_key);
    expect(keys).toEqual(["solana-labs", "matter-labs"]);
    // Neither key may be an X-handle-shaped "@labs" that a prior audit of the
    // real @labs account would falsely reconcile with.
    expect(keys.some((k) => k.startsWith("@"))).toBe(false);
    const graph = a.toPanoptes();
    expect(graph.nodes.filter((n) => n.key === "solana-labs" || n.key === "matter-labs")).toHaveLength(2);
  });

  it("addAssociate with short-tailed org logins does not crash finalize", () => {
    const a = new Audit("@finalize_survivor", { subject_class: SubjectClass.FOUNDER });
    a.setIdentity("Confirmed");
    a.addAssociate({ associate_handle: "company-x", relation: "github org" });
    a.addAssociate({ associate_handle: "web-3", relation: "github org" });
    a.addAssociate({ associate_handle: "x", relation: "github org" });
    const report = a.finalize();
    expect(report.audit_id).toMatch(/^PA-/);
    expect(a.getAssociates().map((as) => as.associate_key)).toEqual(["company-x", "web-3", "x"]);
  });

  it("addAssociate still normalizes X-handle-shaped associates to @keys", () => {
    const a = new Audit("@handle_subject", { subject_class: SubjectClass.FOUNDER });
    a.addAssociate({ associate_handle: "@Cypher_Eth", relation: "co-investor" });
    a.addAssociate({ associate_handle: "vexnode", relation: "co-deployer" });
    expect(a.getAssociates().map((as) => as.associate_key)).toEqual(["@cypher_eth", "@vexnode"]);
  });

  it("addAssociate rejects a blank identifier instead of minting an empty graph key", () => {
    const a = new Audit("@blank_guard", { subject_class: SubjectClass.FOUNDER });
    expect(() => a.addAssociate({ associate_handle: "   ", relation: "github org" })).toThrow(/cannot normalize/);
  });
});
