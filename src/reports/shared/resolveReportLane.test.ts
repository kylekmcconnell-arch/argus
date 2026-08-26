import { describe, expect, it } from "vitest";
import { resolveReportLane } from "./resolveReportLane";

describe("report lane resolution", () => {
  it("defaults the canonical product to Kyle without exposing a selector", () => {
    expect(resolveReportLane({ hostname: "argus-one-flax.vercel.app", search: "?reportLane=enigma" })).toMatchObject({
      definition: { id: "kyle", owner: "@kylekmcconnell-arch", navigation: "sticky" },
      staging: false,
    });
  });

  it("binds each permanent staging hostname to its owner", () => {
    expect(resolveReportLane({ hostname: "argus-git-codex-staging-kyle-reports-kyle-mcconnells-projects.vercel.app", search: "" }).definition.id).toBe("kyle");
    expect(resolveReportLane({ hostname: "argus-git-codex-staging-enigma-kyle-mcconnells-projects.vercel.app", search: "" }).definition.id).toBe("enigma");
  });

  it("lets either owner view the other lane only inside staging", () => {
    expect(resolveReportLane({
      hostname: "argus-git-codex-staging-kyle-reports-kyle-mcconnells-projects.vercel.app",
      search: "?reportLane=enigma",
    }).definition.id).toBe("enigma");
    expect(resolveReportLane({ hostname: "localhost", search: "?reportLane=enigma", development: true }).definition.id).toBe("enigma");
  });

  it("supports an explicit preview environment lane", () => {
    expect(resolveReportLane({ hostname: "preview.vercel.app", search: "", envLane: "enigma" })).toMatchObject({
      definition: { id: "enigma", owner: "@Enigma-Fund", navigation: "guide" },
      staging: true,
    });
  });
});
