import { describe, expect, it } from "vitest";
import { Audit, SubjectClass, getProfile, type Finding } from "./index";

function strongProject(handle = "@driftprotocol"): Audit {
  const audit = new Audit(handle, { subject_class: SubjectClass.PROJECT });
  audit.setIdentity("Confirmed");
  for (const [axis, weight] of Object.entries(getProfile(SubjectClass.PROJECT).axes)) {
    audit.setAxis(axis, weight, "strong verified baseline");
  }
  return audit;
}

function protocolIncident(overrides: Partial<Finding> = {}): Finding {
  return {
    finding_type: "ProtocolSecurityIncident",
    claim: "A verified $295M protocol security incident has no recorded return.",
    source_url: "https://defillama.com/protocol/drift",
    source_date: "2026-04-01",
    source_author: "defillama",
    verification_status: "Verified",
    independent_source_count: 1,
    polarity: -1,
    evidence_origin: "deterministic",
    artifact_verified: true,
    protocol_incident: {
      incident_date: "2026-04-01",
      observed_at: "2026-07-24T12:00:00.000Z",
      amount_usd: 295_000_000,
      reference_tvl_usd: 211_000_000,
      recovery_status: "no_recorded_full_return",
      returned_amount_usd: null,
    },
    finding_scope: {
      scope: "direct_subject",
      target_entity_key: "@driftprotocol",
      target_entity_type: "project",
      relationship_to_subject: "self",
    },
    ...overrides,
  };
}

describe("critical protocol-loss score ceiling", () => {
  it("forces a recent critical loss with no recorded recovery into FAIL without calling it fraud", () => {
    const audit = strongProject();
    audit.addFinding(protocolIncident());

    const report = audit.finalize();

    expect(report.governing_score).toBe(39);
    expect(report.composite_verdict).toBe("FAIL");
    expect(report.cap_applied).toBe("recent_critical_protocol_loss_without_recorded_recovery");
    expect(report.composite_verdict).not.toBe("AVOID");
  });

  it("also catches a $10M+ loss that is catastrophic relative to current TVL", () => {
    const audit = strongProject();
    audit.addFinding(protocolIncident({
      protocol_incident: {
        incident_date: "2026-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 20_000_000,
        reference_tvl_usd: 50_000_000,
        recovery_status: "no_recorded_full_return",
        returned_amount_usd: null,
      },
    }));

    expect(audit.finalize().governing_score).toBe(39);
  });

  it("keeps the ceiling when only part of the loss is recorded returned", () => {
    const audit = strongProject();
    audit.addFinding(protocolIncident({
      protocol_incident: {
        incident_date: "2026-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 295_000_000,
        reference_tvl_usd: 211_000_000,
        recovery_status: "no_recorded_full_return",
        returned_amount_usd: 127_500_000,
      },
    }));

    expect(audit.finalize().governing_score).toBe(39);
  });

  it.each([
    ["recorded recovery", {
      protocol_incident: {
        incident_date: "2026-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 295_000_000,
        reference_tvl_usd: 211_000_000,
        recovery_status: "recorded_full_return",
        returned_amount_usd: 295_000_000,
      },
    }],
    ["older than one year", {
      protocol_incident: {
        incident_date: "2024-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 295_000_000,
        reference_tvl_usd: 211_000_000,
        recovery_status: "no_recorded_full_return",
        returned_amount_usd: null,
      },
    }],
    ["small relative loss", {
      protocol_incident: {
        incident_date: "2026-04-01",
        observed_at: "2026-07-24T12:00:00.000Z",
        amount_usd: 9_000_000,
        reference_tvl_usd: 1_000_000_000,
        recovery_status: "no_recorded_full_return",
        returned_amount_usd: null,
      },
    }],
    ["model lead", { evidence_origin: "model_lead", artifact_verified: false }],
    ["related project", {
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@otherprotocol",
        target_entity_type: "project",
        relationship_to_subject: "venture",
      },
    }],
  ] as const)("%s does not trigger the final score ceiling", (_label, overrides) => {
    const audit = strongProject();
    audit.addFinding(protocolIncident(overrides as Partial<Finding>));

    const report = audit.finalize();

    expect(report.governing_score).toBe(100);
    expect(report.cap_applied).toBeNull();
  });
});
