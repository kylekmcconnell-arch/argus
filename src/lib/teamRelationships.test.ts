import { describe, expect, it } from "vitest";
import {
  canonicalizeCoreTeamRecords,
  canonicalizeTeamRecords,
  classifyProjectRelationship,
  samePersonName,
} from "./teamRelationships";

describe("project relationship ontology", () => {
  it("keeps operating people on team and routes affiliations elsewhere", () => {
    expect(classifyProjectRelationship({ name: "JRA", role: "COO & cofounder", kind: "person", artifact_verified: true })).toBe("core_team");
    expect(classifyProjectRelationship({ name: "Ovidiu Dan", role: "BD manager", kind: "person", artifact_verified: true })).toBe("core_team");
    expect(classifyProjectRelationship({ name: "Superteam DE", role: "ecosystem", kind: "org", artifact_verified: true })).toBe("ecosystem");
    expect(classifyProjectRelationship({ name: "SSR", role: "VC", kind: "person", artifact_verified: true })).toBe("associate");
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

  it("collapses conservative legal-name variants without merging conflicting handles", () => {
    expect(samePersonName("Alex Kujavesky", "Alexander Kujavsky")).toBe(true);
    const merged = canonicalizeTeamRecords([
      { name: "Alex Kujavesky", role: "CBO", linkedin: "linkedin.com/in/alexander-kujavsky-90a80b90", evidence_origin: "model_lead" },
      { name: "Alexander Kujavsky", role: "cofounder", linkedin: "https://linkedin.com/in/alexander-kujavsky-90a80b90", artifact_verified: true },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].artifact_verified).toBe(true);

    expect(canonicalizeTeamRecords([
      { name: "Alex Kujavsky", role: "founder", handle: "@alex_one" },
      { name: "Alexander Kujavsky", role: "founder", handle: "@alex_two" },
    ])).toHaveLength(2);
  });

  it("produces one core roster and excludes orgs, VCs, advisors, and leads", () => {
    const roster = canonicalizeCoreTeamRecords([
      { name: "Enigma", role: "CEO founder", handle: "@enigmafund", kind: "person", artifact_verified: true },
      { name: "JRA", role: "COO cofounder", handle: "@jra_xyz", kind: "person", artifact_verified: true },
      { name: "Kuj", role: "CBO cofounder", handle: "@kujcrypto", kind: "person", artifact_verified: true },
      { name: "Martin", role: "lead developer", kind: "person", artifact_verified: true },
      { name: "Ovidiu", role: "BD manager", kind: "person", artifact_verified: true },
      { name: "Superteam DE", role: "ecosystem", handle: "@superteamde", kind: "org", artifact_verified: true },
      { name: "Strategic Super R", role: "VC", handle: "@strategicsuperR", kind: "person", artifact_verified: true },
      { name: "Lovable", role: "VC", handle: "@lovable_dev", kind: "org", artifact_verified: true },
      { name: "Search Person", role: "CTO", handle: "@candidate", evidence_origin: "model_lead" },
    ]);
    expect(roster.map((member) => member.name)).toEqual(["Enigma", "JRA", "Kuj", "Martin", "Ovidiu"]);
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
      },
    ]);
    expect(member.relationship).toBe("core_team");
  });
});
