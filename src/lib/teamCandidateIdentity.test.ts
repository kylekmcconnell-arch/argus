import { describe, expect, it } from "vitest";
import { teamCandidateSourceMatchesIdentity } from "./teamCandidateIdentity";

describe("team candidate identity boundary", () => {
  it("rejects the exact Bandos candidate whose citation belongs to another X account", () => {
    expect(teamCandidateSourceMatchesIdentity({
      handle: "@dt_obrien",
      sourceUrl: "https://x.com/henrik_win?lang=en",
    })).toBe(false);
  });

  it("allows a matching profile and a project post that names the candidate", () => {
    expect(teamCandidateSourceMatchesIdentity({
      handle: "@dt_obrien",
      sourceUrl: "https://x.com/dt_obrien",
    })).toBe(true);
    expect(teamCandidateSourceMatchesIdentity({
      handle: "@dt_obrien",
      sourceUrl: "https://x.com/bandoscash/status/123",
    })).toBe(true);
  });
});
