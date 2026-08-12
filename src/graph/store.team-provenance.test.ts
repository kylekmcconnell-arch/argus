import { describe, expect, it } from "vitest";
import type { WebPerson } from "../lib/investigation";
import { projectPeopleContribution } from "./store";

describe("project people graph provenance", () => {
  it("creates WORKED_ON edges only for direct confirmed team attributions", () => {
    const people: WebPerson[] = [
      {
        name: "Mira Model",
        role: "Founder",
        provider: "grok",
        evidence_origin: "model_lead",
        artifact_verified: false,
        evidenceKind: "model_candidate",
      },
      {
        name: "Tess Tagged",
        role: "follows + tags",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
        evidenceKind: "project_association",
      },
      {
        name: "Gina Contributor",
        role: "github contributor",
        provider: "github",
        evidence_origin: "deterministic",
        artifact_verified: true,
        evidenceKind: "code_contribution",
      },
      {
        name: "Cora Confirmed",
        handle: "@coraconfirmed",
        role: "Engineer",
        provider: "twitterapi",
        evidence_origin: "deterministic",
        artifact_verified: true,
        evidenceKind: "team_attribution",
      },
    ];

    const contribution = projectPeopleContribution("Argus", people);

    expect(contribution.nodes.map((node) => node.key)).toEqual(["Argus", "@coraconfirmed"]);
    expect(contribution.edges).toEqual([
      { src: "@coraconfirmed", dst: "Argus", type: "WORKED_ON" },
    ]);
  });
});
