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
    expect(dossier).not.toHaveProperty("axisCitationVersion");
    expect(dossier).not.toHaveProperty("axisEvidenceCatalog");
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

  it("freezes scorer artifacts and carries axis references into the report", () => {
    const evidence = emptyEvidence("@subject");
    evidence.roles = [SubjectClass.FOUNDER];
    const artifactId = `art_v1_${"a".repeat(64)}`;
    evidence.axisCitationVersion = 1;
    evidence.axisEvidenceCatalog = [{
      artifactId,
      kind: "axis_evidence",
      provider: "twitterapi",
      operation: "profile",
      section: "profile",
      title: "Resolved X profile",
      contentHash: "b".repeat(64),
      eligibleAxes: ["F1_identity_verifiability"],
      verification: "observed",
      scope: "direct_subject",
    }];
    evidence.axes = [{
      axis: "F1_identity_verifiability",
      score: 10,
      rationale: "The resolved profile supports the identity score.",
      evidenceRefs: [artifactId],
      counterEvidenceRefs: [],
      gaps: [],
    }];

    const dossier = assembleDossier(evidence, true);

    expect(dossier.axisCitationVersion).toBe(1);
    expect(dossier.axisEvidenceCatalog).toEqual(evidence.axisEvidenceCatalog);
    expect(dossier.report.role_reports[0].axes.F1_identity_verifiability).toMatchObject({
      evidenceRefs: [artifactId],
      counterEvidenceRefs: [],
      gaps: [],
    });
  });

  it("keeps model relationship leads visible without admitting them to the authoritative graph", () => {
    const evidence = emptyEvidence("@subject");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.associates.push(
      { associate_handle: "@verified_peer", relation: "github org", provider: "github", evidence_origin: "deterministic", artifact_verified: true },
      { associate_handle: "@model_peer", relation: "possible teammate", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
    );
    evidence.webTeam = [
      { name: "Verified Leader", handle: "@verified_leader", role: "CEO", source: "team page", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
      { name: "Model Lead", handle: "@model_leader", role: "CTO", source: "web search", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      {
        name: "Verified Name",
        handle: "@model_link_candidate",
        linkedin: "linkedin.com/in/model-link-candidate",
        role: "COO",
        source: "team page",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        identity_link_evidence_origin: "model_lead",
      },
      { name: "<UNKNOWN>", role: "<UNKNOWN>", source: "team page", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
    ];
    evidence.ventureTeams = [
      { key: "venture:verified", name: "Verified Venture", people: [{ name: "Verified Builder", handle: "@verified_builder" }], provider: "team-page", evidence_origin: "deterministic", artifact_verified: true },
      { key: "venture:model", name: "Model Venture", people: [{ name: "Model Builder", handle: "@model_builder" }], provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
    ];

    const dossier = assembleDossier(evidence, true);
    const graphKeys = new Set(dossier.graph.nodes.map((node) => String(node.key)));

    expect(graphKeys.has("@verified_peer")).toBe(true);
    expect(graphKeys.has("@verified_leader")).toBe(true);
    expect(graphKeys.has("venture:verified")).toBe(true);
    expect(graphKeys.has("@model_peer")).toBe(false);
    expect(graphKeys.has("@model_leader")).toBe(false);
    expect(graphKeys.has("<unknown>")).toBe(false);
    expect(graphKeys.has("venture:model")).toBe(false);
    expect(dossier.evidence.associates.map((associate) => associate.associate_key)).toEqual(
      expect.arrayContaining(["@verified_peer", "@model_peer"]),
    );
    expect(dossier.webTeam.map((member) => member.name)).toEqual(expect.arrayContaining(["Verified Leader", "Verified Name"]));
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("Model Lead");
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("<UNKNOWN>");
    expect(dossier.webTeam.find((member) => member.name === "Verified Name")).toMatchObject({
      handle: undefined,
      linkedin: undefined,
    });
    expect(dossier.webTeamLeads).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Model Lead", evidence_origin: "model_lead", artifact_verified: false }),
      expect.objectContaining({ name: "Verified Name", handle: "@model_link_candidate", evidence_origin: "model_lead", artifact_verified: false }),
    ]));
    expect(dossier.webTeamLeads?.map((member) => member.name)).not.toContain("<UNKNOWN>");
    expect(dossier.ventureTeams?.map((team) => team.name)).toEqual(expect.arrayContaining(["Verified Venture", "Model Venture"]));
  });
});
