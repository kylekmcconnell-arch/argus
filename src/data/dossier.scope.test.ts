import { describe, expect, it } from "vitest";
import { SubjectClass } from "../engine";
import { assembleDossier } from "./dossier";
import { emptyEvidence } from "./evidence";

describe("dossier finding scope", () => {
  it("retains related adverse leads in the immutable report without publishing them as subject findings", () => {
    const evidence = emptyEvidence("@subject");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.findings.push({
      finding_type: "AdverseLead",
      claim: "@associate (scam accusation lead): candidate complaint.",
      source_url: "https://example.com/associate-candidate",
      source_date: "",
      source_author: "candidate index",
      verification_status: "Reported",
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "model_lead",
      artifact_verified: false,
      finding_scope: {
        scope: "related_entity",
        target_entity_key: "@associate",
        target_entity_type: "person",
        relationship_to_subject: "associate",
        relationship_label: "recorded collaborator",
      },
    });

    const dossier = assembleDossier(evidence, true);

    expect(dossier.report.publishable_findings).toEqual([]);
    expect(dossier.report.investigative_leads).toEqual([
      expect.objectContaining({
        finding_type: "AdverseLead",
        finding_scope: expect.objectContaining({
          target_entity_key: "@associate",
          relationship_to_subject: "associate",
        }),
      }),
    ]);
  });
});
