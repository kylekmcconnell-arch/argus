import { describe, expect, it } from "vitest";
import type { AdverseSignal } from "./adapters/x";
import { adverseSignalToFinding } from "./orchestrate";

describe("adverse finding entity attribution", () => {
  it("preserves a project target as a related investigative lead", () => {
    const signal: AdverseSignal = {
      category: "scam_accusation",
      claim: "A complaint page names the venture.",
      source: "candidate complaint index",
      source_url: "https://example.com/venture-complaint",
      target_entity_key: "@venture_account",
      target_entity_type: "project",
      relationship_to_subject: "venture",
      relationship_label: "founder at Venture Account",
    };

    expect(adverseSignalToFinding(signal)).toMatchObject({
      finding_type: "AdverseLead",
      claim: "@venture_account (scam accusation lead): A complaint page names the venture.",
      verification_status: "Rumor",
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@venture_account",
        target_entity_type: "project",
        relationship_to_subject: "venture",
        relationship_label: "founder at Venture Account",
      },
    });
  });

  it("marks only the audited target relationship as direct subject scope", () => {
    const signal: AdverseSignal = {
      category: "fud",
      claim: "A candidate source names the audited account.",
      source: "candidate source",
      target_entity_key: "@subject",
      target_entity_type: "person",
      relationship_to_subject: "self",
      relationship_label: "audited subject",
    };

    expect(adverseSignalToFinding(signal).finding_scope).toEqual({
      scope: "direct_subject",
      target_entity_key: "@subject",
      target_entity_type: "person",
      relationship_to_subject: "self",
      relationship_label: "audited subject",
    });
  });
});
