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
      verification: "verified",
      counterEligibleAxes: ["F1_identity_verifiability"],
      scope: "direct_subject",
    }];
    evidence.projectStrengthBands = {
      P1_team_and_identity: {
        tier: "solid",
        minScore: 12,
        maxScore: 13,
        reasons: ["Named team and legal operator"],
        anchorArtifactIds: [artifactId],
      },
    };
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
    expect(dossier.projectStrengthBands).toEqual(evidence.projectStrengthBands);
    expect(dossier.report.role_reports[0].axes.F1_identity_verifiability).toMatchObject({
      evidenceRefs: [artifactId],
      counterEvidenceRefs: [],
      gaps: [],
    });

    evidence.axisEvidenceCatalog[0].counterEligibleAxes?.push("F2_track_record");
    evidence.projectStrengthBands.P1_team_and_identity.reasons.push("Mutated after freeze");
    expect(dossier.axisEvidenceCatalog?.[0].counterEligibleAxes).toEqual(["F1_identity_verifiability"]);
    expect(dossier.projectStrengthBands?.P1_team_and_identity.reasons).toEqual([
      "Named team and legal operator",
    ]);
  });

  it("keeps model relationship leads visible without admitting them to the authoritative graph", () => {
    const evidence = emptyEvidence("@subject");
    evidence.roles = [SubjectClass.FOUNDER];
    evidence.associates.push(
      { associate_handle: "@verified_peer", relation: "github org", provider: "github", evidence_origin: "deterministic", artifact_verified: true },
      { associate_handle: "@model_peer", relation: "possible teammate", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
    );
    evidence.webTeam = [
      { name: "Verified Leader", handle: "@verified_leader", role: "CEO", source: "official project team page", sourceUrl: "https://project.example/team", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true, relationshipProvenance: "subject_official" },
      { name: "Superteam DE", handle: "@superteamde", role: "ecosystem", kind: "org", source: "official project page", provider: "team-page", evidence_origin: "deterministic", artifact_verified: true, relationshipProvenance: "subject_official" },
      { name: "Strategic Super R", handle: "@strategicsuperr", role: "VC", kind: "person", source: "self bio", provider: "twitterapi", evidence_origin: "deterministic", artifact_verified: true, relationshipProvenance: "claimant_self" },
      { name: "Model Lead", handle: "@model_leader", role: "CTO", source: "web search", provider: "grok", evidence_origin: "model_lead", artifact_verified: false },
      {
        name: "Verified Name",
        handle: "@model_link_candidate",
        linkedin: "linkedin.com/in/model-link-candidate",
        role: "COO",
        source: "official project team page",
        sourceUrl: "https://project.example/team",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        relationshipProvenance: "subject_official",
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
    expect(graphKeys.has("@superteamde")).toBe(true);
    expect(graphKeys.has("@strategicsuperr")).toBe(false);
    expect(graphKeys.has("venture:verified")).toBe(true);
    expect(graphKeys.has("@model_peer")).toBe(false);
    expect(graphKeys.has("@model_leader")).toBe(false);
    expect(graphKeys.has("<unknown>")).toBe(false);
    expect(graphKeys.has("venture:model")).toBe(false);
    expect(dossier.evidence.associates.map((associate) => associate.associate_key)).toEqual(
      expect.arrayContaining(["@verified_peer", "@model_peer"]),
    );
    expect(dossier.webTeam.map((member) => member.name)).toEqual(expect.arrayContaining(["Verified Leader", "Verified Name"]));
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("Superteam DE");
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("Strategic Super R");
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("Model Lead");
    expect(dossier.projectRelationships).toEqual([
      expect.objectContaining({ name: "Superteam DE", relationship: "ecosystem" }),
    ]);
    expect(dossier.graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ dst: "@superteamde", type: "ASSOCIATES_WITH", relation: "ecosystem" }),
    ]));
    expect(dossier.graph.edges).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ dst: "@strategicsuperr", type: "ASSOCIATES_WITH" }),
    ]));
    expect(dossier.webTeam.map((member) => member.name)).not.toContain("<UNKNOWN>");
    expect(dossier.webTeam.find((member) => member.name === "Verified Name")).toMatchObject({
      handle: undefined,
      linkedin: undefined,
    });
    expect(dossier.webTeamLeads).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Model Lead", evidence_origin: "model_lead", artifact_verified: false }),
      expect.objectContaining({ name: "Verified Name", handle: "@model_link_candidate", evidence_origin: "model_lead", artifact_verified: false }),
      expect.objectContaining({
        name: "Strategic Super R",
        relationship: "candidate",
        relationshipProvenance: "claimant_self",
        artifact_verified: false,
      }),
    ]));
    expect(dossier.webTeamLeads?.map((member) => member.name)).not.toContain("<UNKNOWN>");
    expect(dossier.ventureTeams?.map((team) => team.name)).toEqual(expect.arrayContaining(["Verified Venture", "Model Venture"]));
  });
});

describe("dossier webTeam · claimant-only relationship boundary", () => {
  it("keeps reverse-bio claims unconfirmed until stronger project-side proof resolves the same identity", () => {
    const evidence = emptyEvidence("@projecthandle");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.webTeam = [
      {
        name: "Alice",
        handle: "@alice",
        role: "co-founder, coo",
        source: "web search",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
      {
        name: "Alice",
        handle: "@alice",
        role: "co-founder, coo",
        kind: "person",
        evidence: 'their current X bio states "Co-founder, COO @projecthandle"',
        source: "reverse-bio twitterapi",
        sourceUrl: "https://x.com/alice",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "twitterapi",
        identity_link_evidence_origin: "deterministic",
        handleProvenance: "subject_first_party",
        relationshipProvenance: "claimant_self",
      },
      {
        name: "Some Org",
        handle: "@SomeOrg",
        role: "fund",
        kind: "org",
        source: "reverse-bio twitterapi",
        sourceUrl: "https://x.com/SomeOrg",
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "twitterapi",
        identity_link_evidence_origin: "deterministic",
        handleProvenance: "subject_first_party",
        relationshipProvenance: "claimant_self",
      },
    ];

    const claimantOnly = assembleDossier(evidence, true);
    expect(claimantOnly.webTeam).toEqual([]);
    expect(claimantOnly.projectRelationships).toBeUndefined();
    expect(claimantOnly.graph.nodes.map((node) => String(node.key).toLowerCase())).not.toEqual(
      expect.arrayContaining(["@alice", "@someorg"]),
    );
    expect(claimantOnly.webTeamLeads).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "Alice",
        handle: "@alice",
        relationship: "candidate",
        relationshipProvenance: "claimant_self",
        artifact_verified: false,
      }),
      expect.objectContaining({
        name: "Some Org",
        handle: "@SomeOrg",
        relationship: "candidate",
        relationshipProvenance: "claimant_self",
        artifact_verified: false,
      }),
    ]));

    const projectConfirmed = {
      ...evidence,
      webTeam: [
        ...evidence.webTeam,
        {
          ...evidence.webTeam[1],
          source: "official project team page",
          sourceUrl: "https://projecthandle.example/team",
          provider: "team-page",
          relationshipProvenance: "subject_official" as const,
        },
      ],
    };
    const confirmed = assembleDossier(projectConfirmed, true);
    expect(confirmed.webTeam).toEqual([
      expect.objectContaining({
        name: "Alice",
        handle: "@alice",
        relationship: "core_team",
        relationshipProvenance: "subject_official",
        artifact_verified: true,
      }),
    ]);
    expect(confirmed.webTeamLeads?.map((member) => member.name)).not.toContain("Alice");
  });

  it("suppresses model aliases when stable handles and LinkedIn profiles use different URL forms", () => {
    const evidence = emptyEvidence("@multihopper");
    evidence.roles = [SubjectClass.PROJECT];
    evidence.webTeam = [
      {
        name: "Kuj Crypto",
        handle: "@kujcrypto",
        linkedin: "https://www.linkedin.com/in/alexander-kujavsky-90a80b90/",
        role: "cofounder",
        kind: "person",
        source: "official project team page",
        sourceUrl: "https://multihopper.example/team",
        provider: "team-page",
        evidence_origin: "deterministic",
        artifact_verified: true,
        relationshipProvenance: "subject_official",
      },
      {
        name: "Alexander Kujavsky",
        handle: "https://x.com/kujcrypto/status/12345?ref=team",
        role: "cofounder",
        kind: "person",
        source: "search candidate",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
      {
        name: "Alex Kujavesky",
        linkedin: "linkedin.com/in/alexander-kujavsky-90a80b90?trk=public_profile",
        role: "CBO",
        kind: "person",
        source: "search candidate",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
      },
    ];

    const dossier = assembleDossier(evidence, true);
    expect(dossier.webTeam).toEqual([
      expect.objectContaining({
        name: "Kuj Crypto",
        handle: "@kujcrypto",
        relationship: "core_team",
      }),
    ]);
    expect(dossier.webTeamLeads?.map((member) => member.name) ?? []).not.toEqual(
      expect.arrayContaining(["Alexander Kujavsky", "Alex Kujavesky"]),
    );
  });
});
