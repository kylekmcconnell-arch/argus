import { describe, expect, it } from "vitest";
import { emptyEvidence, type BasicFact } from "../src/data/evidence";
import { SubjectClass } from "../src/engine";
import { deriveDecisionReadiness } from "../src/lib/decisionReadiness";
import { coverageQualifiedCompleteness, presentPublicReport } from "../src/lib/reportPresentation";
import { clearanceCoverage } from "../src/lib/scanChecklist";
import { PersonCheckTracker, type ChecklistCheckId, type PersonCheckScope } from "./checks";
import { strictOrganizationLegalEntity } from "./orchestrate";

const byId = (
  tracker: PersonCheckTracker,
  roles: readonly string[],
  id: string,
  scope: PersonCheckScope,
) => tracker.snapshot(roles, scope).find((check) => check.checkId === id);

function recordCompleted(
  tracker: PersonCheckTracker,
  ids: readonly ChecklistCheckId[],
): void {
  for (const id of ids) {
    tracker.record({
      id,
      status: "confirmed",
      note: `${id} completed from frozen evidence`,
      provider: "frozen-test-evidence",
      sourceCount: 1,
    });
  }
}

const INVESTMENT_FIRM_GATES = [
  "identity-resolution",
  "affiliations-associates",
  "vc-portfolio-track-record",
  "adverse-screen",
  "trust-graph-connections",
] as const satisfies readonly ChecklistCheckId[];

const OPERATING_COMPANY_GATES = [
  "project-token-identity",
  "entity-continuity",
  "project-product-substance",
  "project-team-identity",
  "project-backing-partners",
  "project-traction-liveness",
  "project-transparency",
  "trust-graph-connections",
] as const satisfies readonly ChecklistCheckId[];

describe("organization legal and sanctions completeness", () => {
  it("arms the organization screen only from one strict direct legal-entity passage", () => {
    const evidence = emptyEvidence("@theformsvc");
    evidence.profile.display_name = "TheForms Capital";
    evidence.profile.bio = "We back infrastructure founders.";
    evidence.roles = [SubjectClass.INVESTOR];
    const fact: BasicFact = {
      factId: "fact:theforms-legal-entity",
      subjectKey: "@theformsvc",
      predicate: "legal_entity",
      value: "TheForms Capital LLC",
      normalizedValue: "theforms capital llc",
      status: "verified",
      critical: true,
      sources: [{
        url: "https://theforms.example/legal",
        title: "Legal notice",
        sourceClass: "official_subject",
        relation: "supports",
        excerpt: "TheForms Capital LLC is the incorporated company that operates this investment firm.",
        contentHash: "a".repeat(64),
        capturedAt: "2026-08-06T00:00:00.000Z",
        provider: "public-web",
        artifactVerified: true,
      }],
      questionId: "investor_org.legal_entity",
      evidence_origin: "deterministic",
      artifact_verified: true,
      provider: "public-web",
      discoveryProvider: "grounded",
    };
    evidence.basicFacts = [fact];

    expect(strictOrganizationLegalEntity(evidence)).toMatchObject({
      name: "TheForms Capital LLC",
      fact: { factId: "fact:theforms-legal-entity" },
      sourceCount: 1,
    });

    evidence.basicFacts = [{
      ...fact,
      questionId: "investor.legal_entity",
      sources: [{ ...fact.sources[0], sourceClass: "independent_press" }],
    }];
    expect(strictOrganizationLegalEntity(evidence)).toBeNull();
  });

  it("does not let a fully covered investment-firm report borrow person-only clearance", () => {
    const tracker = new PersonCheckTracker();
    recordCompleted(tracker, INVESTMENT_FIRM_GATES);
    const roles = ["INVESTOR"];
    const scope = { resolvedRealName: false, organizationSubject: true };
    const checks = tracker.snapshot(roles, scope);

    expect(byId(tracker, roles, "us-legal-history", scope)).toMatchObject({
      status: "not-applicable",
      note: "person-name screen does not clear an organization subject",
    });
    expect(byId(tracker, roles, "ofac-sanctions-name", scope)).toMatchObject({
      status: "not-applicable",
      note: "person-name screen does not clear an organization subject",
    });
    expect(byId(tracker, roles, "organization-registration", scope)).toMatchObject({
      status: "unknown",
      decisionCritical: true,
      note: expect.stringContaining("no strict frozen legal_entity fact"),
    });
    expect(byId(tracker, roles, "organization-sanctions", scope)).toMatchObject({
      status: "unknown",
      decisionCritical: true,
      note: expect.stringContaining("no completed OFAC sanctions screen"),
    });

    expect(clearanceCoverage(checks).openNeverWaive).toEqual([
      "organization-registration",
      "organization-sanctions",
    ]);
    expect(tracker.completeness(roles, scope)).toBe("partial");
    expect(deriveDecisionReadiness(checks).status).not.toBe("ready");

    const presentation = presentPublicReport({
      verdict: "PASS",
      score: 95,
      completeness: "complete",
      attestation: "server_collected",
      checks,
    });
    expect(presentation.final).toBe(false);
    expect(presentation.displayVerdict).not.toBe("PASS");
  });

  it("requires a positive legal-entity binding but accepts a completed exact-entity sanctions miss", () => {
    const tracker = new PersonCheckTracker();
    recordCompleted(tracker, INVESTMENT_FIRM_GATES);
    const roles = ["INVESTOR"];
    const scope = { resolvedRealName: false, organizationSubject: true };

    tracker.record({
      id: "organization-registration",
      status: "checked-empty",
      note: "a bounded registry search returned no exact legal-entity match; this does not identify the operator",
      provider: "frozen-registry-receipt",
    });
    tracker.record({
      id: "organization-sanctions",
      status: "checked-empty",
      note: "the exact registered entity was screened and no sanctions-list match was returned",
      provider: "frozen-sanctions-receipt",
    });

    const unbound = tracker.snapshot(roles, scope);
    expect(clearanceCoverage(unbound).openNeverWaive).toEqual(["organization-registration"]);
    expect(tracker.completeness(roles, scope)).toBe("partial");
    expect(presentPublicReport({
      verdict: "PASS",
      score: 95,
      completeness: "complete",
      attestation: "server_collected",
      checks: unbound,
    }).final).toBe(false);

    tracker.record({
      id: "organization-registration",
      status: "confirmed",
      note: "a frozen official registry record binds the audited firm to its exact legal entity",
      provider: "frozen-registry-record",
      sourceCount: 1,
    });

    const bound = tracker.snapshot(roles, scope);
    expect(clearanceCoverage(bound).openNeverWaive).toEqual([]);
    expect(tracker.completeness(roles, scope)).toBe("complete");
  });

  it("does not make generic PROJECT clearance depend on an unwired entity screen", () => {
    const tracker = new PersonCheckTracker();
    recordCompleted(tracker, OPERATING_COMPANY_GATES);
    const roles = ["PROJECT"];
    // PROJECT is structurally organization-scoped even when an older caller
    // does not yet pass the explicit organizationSubject flag.
    const scope = { resolvedRealName: false };

    expect(byId(tracker, roles, "organization-registration", scope)).toMatchObject({
      status: "unknown",
      decisionCritical: false,
    });
    expect(byId(tracker, roles, "organization-sanctions", scope)).toMatchObject({
      status: "unknown",
      decisionCritical: false,
    });
    expect(tracker.completeness(roles, scope)).toBe("complete");
  });

  it("keeps organization rows out of scope for an individual investor", () => {
    const tracker = new PersonCheckTracker();
    const roles = ["INVESTOR"];
    const scope = { resolvedRealName: true, organizationSubject: false };

    expect(byId(tracker, roles, "organization-registration", scope)).toMatchObject({
      status: "not-applicable",
      decisionCritical: false,
    });
    expect(byId(tracker, roles, "organization-sanctions", scope)).toMatchObject({
      status: "not-applicable",
      decisionCritical: false,
    });
    expect(byId(tracker, roles, "us-legal-history", scope)?.status).toBe("unknown");
    expect(byId(tracker, roles, "ofac-sanctions-name", scope)?.status).toBe("unknown");
  });

  it("preserves registration semantics after successful checks are stored as state=complete", () => {
    const persisted = (registrationStatus: "checked-empty" | "confirmed") => [
      {
        check_id: "organization-registration",
        state: "complete",
        stale_at: null,
        metadata: {
          status: registrationStatus,
          decisionCritical: true,
          notApplicable: false,
        },
      },
      {
        check_id: "organization-sanctions",
        state: "complete",
        stale_at: null,
        metadata: {
          status: "checked-empty",
          decisionCritical: true,
          notApplicable: false,
        },
      },
    ];

    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: persisted("checked-empty"),
    })).toBe("partial");
    expect(coverageQualifiedCompleteness({
      completeness: "complete",
      attestation: "server_collected",
      checks: persisted("confirmed"),
    })).toBe("complete");
  });
});
