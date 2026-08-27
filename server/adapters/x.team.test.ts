import { describe, expect, it } from "vitest";
import { officialXNamedOrgs, officialXNamedTeam, scanPostsForRoles } from "./x";

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

  it("does not bind a media account to the project's own role", () => {
    expect(scanPostsForRoles([
      "Thanks @twistartups for having our CEO on the show today!",
    ], "Venice")).toEqual([]);
    expect(scanPostsForRoles([
      "Our founder joined @twistartups to talk private AI.",
    ], "Venice")).toEqual([]);
  });

  it("still binds an appositive role to the adjacent handle", () => {
    expect(scanPostsForRoles([
      "@erikvoorhees, our CEO, shipped private inference this week.",
    ], "Venice")).toEqual([
      expect.objectContaining({ handle: "@erikvoorhees", role: "ceo", kind: "team" }),
    ]);
    expect(scanPostsForRoles([
      "Meet our CTO @teanabt.",
    ], "Venice")).toEqual([
      expect.objectContaining({ handle: "@teanabt", role: "cto", kind: "team" }),
    ]);
  });

  it("captures a bounded list explicitly named as members of the project team", () => {
    const people = scanPostsForRoles([
      "@weremeow @sssionggg and other members of the Jupiter team are joining us.",
    ], "Jupiter");

    expect(people.map(({ handle }) => handle)).toEqual(["@weremeow", "@sssionggg"]);
    expect(people.every(({ role }) => role === "team member")).toBe(true);
  });

  it("binds every handle in a project-owned plural co-founder list and stops at a colon", () => {
    const people = scanPostsForRoles([
      "Joining our co-founders@alice_founder and@bob_builder:@guestcorp is in the room.",
    ], "Project");
    expect(people.map(({ handle }) => handle)).toEqual(["@alice_founder", "@bob_builder"]);
    expect(people.every(({ role }) => /co-?founders?/.test(role))).toBe(true);
    expect(people.map(({ handle }) => handle)).not.toContain("@guestcorp");
  });

  it("binds a comma-joined plural Co-Founders list and does not take a guest after the clause", () => {
    const people = scanPostsForRoles([
      "We see two of our Co-Founders,@alice_founder and@bob_builder, holding a cheque!",
    ], "Project");
    expect(people.map(({ handle }) => handle)).toEqual(["@alice_founder", "@bob_builder"]);
    expect(people.every(({ kind }) => kind === "team")).toBe(true);
  });

  it("does not bind a display name without a handle", () => {
    expect(scanPostsForRoles([
      "Joining our co-founders Alice and Bob: guest appearance tonight.",
    ], "Project")).toEqual([]);
  });
});

describe("official corpus names handles as team or linked orgs", () => {
  // Motivating incident: a project account named co-founders by @handle in its
  // own timeline, Serper was rejected, and extra checks paused on a lineage
  // save error. Finder must bind from twitterapi posts alone.

  it("binds co-founders named only by @handle on the official account", () => {
    const team = officialXNamedTeam([
      "Proud to introduce our co-founders @alice and @bob.",
    ], "ExampleProject", "@exampleproj");
    expect(team.map((m) => m.handle).sort()).toEqual(["@alice", "@bob"]);
    expect(team.every((m) => m.handleProvenance === "subject_first_party")).toBe(true);
    expect(team.every((m) => m.provider === "twitterapi")).toBe(true);
    expect(team.every((m) => m.artifact_verified === true)).toBe(true);
    expect(team.every((m) => m.name === m.handle)).toBe(true);
  });

  it("requires the post to assign the role to the audited project", () => {
    expect(officialXNamedTeam(["Meet co-founder @alice."], undefined, "@exampleproj")).toEqual([]);
    const team = officialXNamedTeam(["Meet our co-founder @alice."], undefined, "@exampleproj");
    expect(team).toEqual([
      expect.objectContaining({
        handle: "@alice",
        name: "@alice",
        role: "co-founder",
        handleProvenance: "subject_first_party",
        provider: "twitterapi",
      }),
    ]);
  });

  it("does not turn an NFT project mentioned beside founder language into a person", () => {
    expect(officialXNamedTeam([
      "Meet founder @womenofsatoshi, an NFT project joining this week's community event.",
    ], "Fedi", "@fedibtc")).toEqual([]);
  });

  it("binds an incubator/team-behind/backed-by handle as an org, not a person", () => {
    const posts = [
      "Incubated by @SomeOrg.",
      "The team behind this is @SomeOrg.",
      "Backed by @SomeOrg.",
    ];
    const orgs = officialXNamedOrgs(posts);
    expect(orgs.some((o) => o.handle === "@SomeOrg" && o.role === "incubator")).toBe(true);
    const team = officialXNamedTeam(posts, "ExampleProject");
    expect(team.some((m) => (m.handle ?? "").toLowerCase() === "someorg")).toBe(false);
  });

  it("does not bind an unrelated @mention as team", () => {
    expect(officialXNamedTeam([
      "Thanks @alice for the shoutout, shipping next week.",
    ], "ExampleProject")).toEqual([]);
  });

  it("does not bind a display name without an @handle", () => {
    expect(officialXNamedTeam([
      "Proud to introduce co-founders Alice and Bob.",
    ], "ExampleProject")).toEqual([]);
  });
});
