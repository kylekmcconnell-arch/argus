import { describe, expect, it } from "vitest";
import type { WebTeamMember } from "./evidence";

describe("WebTeamMember relationship provenance", () => {
  it("persists counterparty and independent relationship evidence", () => {
    const members = [
      {
        name: "Protocol Partner",
        role: "integration partner",
        source: "official partner announcement",
        relationshipProvenance: "counterparty",
      },
      {
        name: "Independent Researcher",
        role: "research subject",
        source: "independent reporting",
        relationshipProvenance: "independent",
      },
    ] satisfies WebTeamMember[];

    expect(members.map((member) => member.relationshipProvenance)).toEqual([
      "counterparty",
      "independent",
    ]);
  });
});
