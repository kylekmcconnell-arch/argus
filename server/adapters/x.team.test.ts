import { describe, expect, it } from "vitest";
import { scanPostsForRoles } from "./x";

describe("deterministic project-team post scan", () => {
  it("binds a founder role to the adjacent person handle", () => {
    expect(scanPostsForRoles([
      "The history of our router, from project co-founder @sssionggg.",
    ], "Project")).toEqual([
      expect.objectContaining({ handle: "@sssionggg", role: "co-founder", kind: "team" }),
    ]);
  });

  it("does not assign one role word to every account mentioned in a long post", () => {
    const people = scanPostsForRoles([
      "Powered by @jup_studio, bringing the best launch tooling to users. As a founder, you can apply through the site and later reach out to @wassielawyer.",
      "Use @jup_mobile, @jup_portfolio, and @JupPro. Our dev tools are engineered by a world-class team.",
    ], "Jupiter");

    expect(people).toEqual([]);
  });

  it("excludes a guest who is identified as the founder of another project", () => {
    const people = scanPostsForRoles([
      "@edgarpavlovsky Co-Founder of @marginfi joined our community call.",
    ], "Jupiter");

    expect(people).toEqual([]);
  });

  it("captures a bounded list explicitly named as members of the project team", () => {
    const people = scanPostsForRoles([
      "@weremeow @sssionggg and other members of the Jupiter team are joining us.",
    ], "Jupiter");

    expect(people.map(({ handle }) => handle)).toEqual(["@weremeow", "@sssionggg"]);
    expect(people.every(({ role }) => role === "team member")).toBe(true);
  });
});
