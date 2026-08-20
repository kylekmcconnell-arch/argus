import { describe, expect, it } from "vitest";
import {
  canonicalizeCoreTeamRecords,
  canonicalizeTeamRecords,
  classifyProjectRelationship,
  isScoreableBackingRelationship,
  samePersonName,
} from "./teamRelationships";

describe("project relationship ontology", () => {
  it("keeps operating people on team and routes affiliations elsewhere", () => {
    expect(classifyProjectRelationship({
      name: "JRA",
      role: "COO & cofounder",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "subject_official",
      source: "Official project team page",
    })).toBe("core_team");
    expect(classifyProjectRelationship({
      name: "Ovidiu Dan",
      role: "BD manager",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "subject_official",
      source: "Official project team page",
    })).toBe("core_team");
    expect(classifyProjectRelationship({ name: "Superteam DE", role: "ecosystem", kind: "org", artifact_verified: true })).toBe("ecosystem");
    expect(classifyProjectRelationship({ name: "SSR", role: "VC", kind: "person", artifact_verified: true })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Named Seed Backer",
      role: "seed investor",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "subject_official",
    })).toBe("backer");
    expect(classifyProjectRelationship({ name: "Lovable", role: "VC", kind: "org", evidence_origin: "model_lead" })).toBe("candidate");
    expect(classifyProjectRelationship({
      name: "Claimant",
      role: "cofounder",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "claimant_self",
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Search VC",
      role: "VC",
      kind: "org",
      evidence_origin: "model_lead",
      relationship: "backer",
    })).toBe("candidate");
  });

  it("requires bound relationship proof for material relationships and every operating role", () => {
    expect(classifyProjectRelationship({
      name: "Unbound Founder",
      role: "founder",
      kind: "person",
      artifact_verified: true,
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Unbound Executive",
      role: "CEO",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Unbound Fund",
      role: "VC fund",
      kind: "org",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Named Fund",
      role: "VC fund",
      kind: "org",
      artifact_verified: true,
      relationshipProvenance: "counterparty",
    })).toBe("backer");
    expect(classifyProjectRelationship({
      name: "Unbound Integration Shop",
      role: "integration partner",
      kind: "org",
      artifact_verified: true,
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Claimed Partner",
      role: "partner",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Confirmed Partner",
      role: "partner",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "subject_official",
    })).toBe("partner");

    expect(classifyProjectRelationship({
      name: "External Engineer",
      role: "engineer",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("associate");
    expect(classifyProjectRelationship({
      name: "Official Engineer",
      role: "engineer",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "subject_official",
    })).toBe("core_team");
    expect(classifyProjectRelationship({
      name: "Confirmed Core",
      role: "community liaison",
      kind: "person",
      artifact_verified: true,
      relationship: "core_team",
      relationshipProvenance: "independent",
    })).toBe("core_team");
  });

  it("keeps affiliation, advisory, and former-team wording out of the core roster", () => {
    expect(classifyProjectRelationship({
      name: "Affiliate",
      role: "team affiliation",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("team_affiliation");
    expect(classifyProjectRelationship({
      name: "Advisor",
      role: "engineering advisor to the team",
      kind: "person",
      artifact_verified: true,
      relationshipProvenance: "third_party",
    })).toBe("advisor");
    expect(classifyProjectRelationship({
      name: "Former Builder",
      role: "former team member and engineer",
      kind: "person",
      artifact_verified: true,
      relationship: "core_team",
      relationshipProvenance: "subject_official",
    })).toBe("associate");
  });

  it("requires confirmed relationship authority before a backer or partner can support P4", () => {
    const base = {
      name: "Strategic Super R",
      role: "VC",
      kind: "person" as const,
      evidence_origin: "deterministic",
      artifact_verified: true,
    };
    expect(isScoreableBackingRelationship({
      ...base,
      relationship: "associate",
      relationshipProvenance: "subject_official",
    })).toBe(false);
    expect(isScoreableBackingRelationship({
      ...base,
      relationship: "backer",
      relationshipProvenance: "claimant_self",
    })).toBe(false);
    expect(isScoreableBackingRelationship({
      ...base,
      relationship: "backer",
      relationshipProvenance: "subject_official",
    })).toBe(true);
    expect(isScoreableBackingRelationship({
      ...base,
      relationship: "partner",
      relationshipProvenance: "counterparty",
    })).toBe(true);
  });

  it("uses name similarity only as a lead and merges aliases only across a stable identifier", () => {
    expect(samePersonName("Alex Kujavesky", "Alexander Kujavsky")).toBe(true);
    const merged = canonicalizeTeamRecords([
      { name: "Alex Kujavesky", role: "CBO", linkedin: "linkedin.com/in/alexander-kujavsky-90a80b90", evidence_origin: "model_lead" },
      { name: "Alexander Kujavsky", role: "cofounder", linkedin: "https://linkedin.com/in/alexander-kujavsky-90a80b90", artifact_verified: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].artifact_verified).toBe(true);

    expect(canonicalizeTeamRecords([
      { name: "Alex Kujavsky", role: "founder" },
      { name: "Alexander Kujavsky", role: "founder" },
    ])).toHaveLength(2);
    expect(canonicalizeTeamRecords([
      { name: "Alex Kujavsky", role: "founder", handle: "@alex_one" },
      { name: "Alexander Kujavsky", role: "founder", handle: "@alex_two" },
    ])).toHaveLength(2);
    expect(canonicalizeTeamRecords([
      { name: "Alex Kujavsky", role: "founder", linkedin: "https://example.com/in/alexander-kujavsky-90a80b90" },
      { name: "Alexander Kujavsky", role: "founder", linkedin: "https://linkedin.com/in/alexander-kujavsky-90a80b90" },
    ])).toHaveLength(2);

    const bridged = canonicalizeTeamRecords([
      { name: "Kuj Crypto", role: "CBO", handle: "@kujcrypto" },
      { name: "Alexander Kujavsky", role: "cofounder", linkedin: "linkedin.com/in/alexander-kujavsky-90a80b90" },
      { name: "Alex Kujavsky", role: "cofounder", handle: "@kujcrypto", linkedin: "linkedin.com/in/alexander-kujavsky-90a80b90" },
    ]);
    expect(bridged).toHaveLength(1);
  });

  it("produces one core roster and excludes orgs, VCs, advisors, and leads", () => {
    const roster = canonicalizeCoreTeamRecords([
      {
        name: "Enigma", role: "CEO founder", handle: "@enigmafund", kind: "person",
        artifact_verified: true, relationshipProvenance: "subject_official",
        source: "Official project team page",
      },
      {
        name: "JRA", role: "COO cofounder", handle: "@jra_xyz", kind: "person",
        artifact_verified: true, relationshipProvenance: "subject_official",
        source: "Official project team page",
      },
      {
        name: "Kuj", role: "CBO cofounder", handle: "@kujcrypto", kind: "person",
        artifact_verified: true, relationshipProvenance: "subject_official",
        source: "Official project team page",
      },
      {
        name: "Martin", role: "lead developer", kind: "person",
        artifact_verified: true, relationshipProvenance: "subject_official",
        source: "Official project team page",
      },
      {
        name: "Ovidiu", role: "BD manager", kind: "person",
        artifact_verified: true, relationshipProvenance: "subject_official",
        source: "Official project team page",
      },
      { name: "Superteam DE", role: "ecosystem", handle: "@superteamde", kind: "org", artifact_verified: true },
      { name: "Strategic Super R", role: "VC", handle: "@strategicsuperR", kind: "person", artifact_verified: true },
      { name: "Lovable", role: "VC", handle: "@lovable_dev", kind: "org", artifact_verified: true },
      { name: "Search Person", role: "CTO", handle: "@candidate", evidence_origin: "model_lead" },
    ]);
    expect(roster.map((member) => member.name)).toEqual(["Enigma", "JRA", "Kuj", "Martin", "Ovidiu"]);
  });

  it("preserves official relationship authority regardless of collector order", () => {
    const official = {
      name: "Alex Kujavsky",
      role: "cofounder",
      handle: "@kujcrypto",
      kind: "person" as const,
      artifact_verified: true,
      evidence_origin: "deterministic",
      relationshipProvenance: "subject_official" as const,
      source: "Official project team page",
      sourceUrl: "https://project.example/team",
    };
    const selfClaim = {
      name: "Kuj Crypto",
      role: "VC",
      handle: "@kujcrypto",
      kind: "person" as const,
      artifact_verified: true,
      evidence_origin: "deterministic",
      relationshipProvenance: "claimant_self" as const,
      source: "Self-authored X bio",
    };

    for (const rows of [[selfClaim, official], [official, selfClaim]]) {
      const [member] = canonicalizeTeamRecords(rows);
      expect(member).toMatchObject({
        role: "cofounder",
        relationshipProvenance: "subject_official",
        relationship: "core_team",
      });
    }

    const [sourceWordedButUnbound] = canonicalizeTeamRecords([
      selfClaim,
      {
        ...official,
        relationshipProvenance: undefined,
        source: "deterministically fetched official team page",
      },
    ]);
    expect(sourceWordedButUnbound).toMatchObject({
      role: "cofounder",
      relationship: "associate",
    });
    expect(sourceWordedButUnbound.relationshipProvenance).toBeUndefined();

    const [protectedFromModelMetadata] = canonicalizeTeamRecords([
      selfClaim,
      {
        ...official,
        role: "cofounder",
        evidence_origin: "model_lead",
        artifact_verified: false,
        relationshipProvenance: "subject_official",
      },
    ]);
    expect(protectedFromModelMetadata).toMatchObject({
      role: "VC",
      relationshipProvenance: "claimant_self",
      relationship: "associate",
    });
  });

  it("preserves confirmed non-core classifications despite team-like occupation words", () => {
    expect(canonicalizeTeamRecords([{
      name: "Partner Engineer",
      role: "engineer",
      handle: "@partner_engineer",
      kind: "person",
      artifact_verified: true,
      evidence_origin: "deterministic",
      relationship: "associate",
      relationshipProvenance: "subject_official",
    }])[0].relationship).toBe("associate");
    expect(canonicalizeTeamRecords([{
      name: "Fund Founder",
      role: "founder",
      handle: "@fund_founder",
      kind: "person",
      artifact_verified: true,
      evidence_origin: "deterministic",
      relationship: "backer",
      relationshipProvenance: "counterparty",
    }])[0].relationship).toBe("backer");
  });

  it("recomputes stale classifications after stronger evidence merges", () => {
    const [member] = canonicalizeTeamRecords([
      {
        name: "Builder",
        role: "VC",
        handle: "@builder",
        kind: "person" as const,
        artifact_verified: true,
        relationship: "backer" as const,
      },
      {
        name: "Builder",
        role: "Engineer",
        handle: "@builder",
        kind: "person" as const,
        artifact_verified: true,
        evidence_origin: "deterministic",
        linkedin: "https://linkedin.com/in/builder",
        relationshipProvenance: "subject_official",
        source: "Official project team page",
        sourceUrl: "https://project.example/team",
      },
    ]);
    expect(member.relationship).toBe("core_team");
  });
});
