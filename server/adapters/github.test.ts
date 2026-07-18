import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { githubAdapter } from "./github";

const json = (body: unknown) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("GitHub evidence provenance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("stamps acquired venture and associate records with exact GitHub provenance", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return json({ items: [{ login: "subject" }] });
      if (url.endsWith("/users/subject")) return json({ login: "subject", twitter_username: "subject" });
      if (url.endsWith("/users/subject/orgs")) return json([{ login: "verified-org" }]);
      if (url.includes("/users/subject/repos")) return json([]);
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@subject");
    evidence.profile.display_name = "";
    // Bidirectional gold: the subject's own bio references the GitHub account.
    evidence.profile.bio = "building in public: github.com/subject";

    await githubAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    });

    expect(evidence.ventures).toContainEqual(expect.objectContaining({
      project_name: "verified-org",
      provider: "github",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }));
    expect(evidence.associates).toContainEqual(expect.objectContaining({
      associate_handle: "verified-org",
      provider: "github",
      evidence_origin: "deterministic",
      artifact_verified: true,
    }));
  });

  it("treats a one-directional twitter_username claim as a lead and attributes nothing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      // An account surfaced by name search claims the subject's X handle, but
      // nothing on the subject's side points back at it.
      if (url.includes("/search/users")) return json({ items: [{ login: "impostor" }] });
      if (url.endsWith("/users/subject")) return json({ login: "subject" });
      if (url.endsWith("/users/impostor")) return json({ login: "impostor", twitter_username: "subject", name: "Subject Name" });
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@subject");
    evidence.profile.display_name = "Subject Name";
    const recordCheck = vi.fn();

    await githubAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck,
    });

    expect(evidence.ventures).toEqual([]);
    expect(evidence.associates).toEqual([]);
    expect(evidence.profile.identity_confidence).not.toBe("Probable");
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "unknown",
    }));
    expect(recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "identity-resolution",
      status: "confirmed",
    }));
  });
});
