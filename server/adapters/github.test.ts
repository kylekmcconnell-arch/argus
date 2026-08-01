import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { githubAdapter, searchQueryVariants } from "./github";

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

describe("GitHub search query normalisation", () => {
  it("leads with the ASCII form of a decorated display name and keeps the raw one behind it", () => {
    // Verified live: q="Hayden Adams 🦄" returns total_count 0, q="Hayden Adams"
    // returns haydenadams first.
    expect(searchQueryVariants("Hayden Adams 🦄")).toEqual(["Hayden Adams", "Hayden Adams 🦄"]);
  });

  it("collapses whitespace and folds accents onto base letters", () => {
    expect(searchQueryVariants("  Zoë   Müller  ")).toEqual(["Zoe Muller", "Zoë Müller"]);
  });

  it("issues one query when the name is already plain ASCII", () => {
    expect(searchQueryVariants("Hayden Adams")).toEqual(["Hayden Adams"]);
  });

  it("keeps a wholly non-Latin name searchable instead of reducing it to nothing", () => {
    expect(searchQueryVariants("виталик")).toEqual(["виталик"]);
    expect(searchQueryVariants("   ")).toEqual([]);
  });
});

describe("GitHub resolution through a decorated display name", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const notFound = () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } });

  it("finds the account an emoji in the display name would otherwise hide", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    const searchQueries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        searchQueries.push(q);
        // GitHub matches the query literally: the decorated name returns nothing.
        if (q === "Hayden Adams") return json({ items: [{ login: "haydenadams" }] });
        return json({ items: [] });
      }
      if (url.endsWith("/users/builder")) return notFound();
      if (url.endsWith("/users/haydenadams")) return json({ login: "haydenadams", twitter_username: "builder", public_repos: 40, created_at: "2016-01-01T00:00:00Z" });
      if (url.endsWith("/users/haydenadams/orgs")) return json([]);
      if (url.includes("/users/haydenadams/repos")) return json([]);
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@builder");
    evidence.profile.display_name = "Hayden Adams 🦄";
    evidence.profile.bio = "uniswap, github.com/haydenadams";

    await githubAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    });

    expect(searchQueries).toContain("Hayden Adams");
    // The ASCII variant answered, so the raw name never costs a second call.
    expect(searchQueries).not.toContain("Hayden Adams 🦄");
    expect(evidence.profile.identity_confidence).toBe("Probable");
  });

  it("falls back to the raw name when the ASCII form returns nothing", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    const searchQueries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) {
        const q = new URL(url).searchParams.get("q") ?? "";
        searchQueries.push(q);
        if (q === "Zoë 🦄") return json({ items: [{ login: "zoe" }] });
        return json({ items: [] });
      }
      if (url.endsWith("/users/builder")) return notFound();
      if (url.endsWith("/users/zoe")) return json({ login: "zoe", public_repos: 12, created_at: "2013-01-01T00:00:00Z" });
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@builder");
    evidence.profile.display_name = "Zoë 🦄";

    await githubAdapter.run({
      handle: evidence.profile.handle,
      evidence,
      emit: vi.fn(),
      recordCheck: vi.fn(),
    });

    expect(searchQueries).toEqual(["Zoe", "Zoë 🦄", "builder"]);
  });
});

describe("GitHub squatter suppression", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  // The live shape this guards: /users/VitalikButerin has 0 public repos and was
  // created 2016-08-11, against an X account created in 2011. The real account
  // is vbuterin, which we must never guess at.
  const squatterRun = async (user: Record<string, unknown>) => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return json({ items: [] });
      if (url.toLowerCase().endsWith("/users/vitalikbuterin")) return json(user);
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@VitalikButerin");
    evidence.profile.display_name = "";
    evidence.profile.account_created_at = "2011-05-08T00:00:00.000Z";
    const recordCheck = vi.fn();
    const emit = vi.fn();
    await githubAdapter.run({ handle: evidence.profile.handle, evidence, emit, recordCheck });
    return { evidence, recordCheck, emit };
  };

  it("publishes no GitHub line for an empty account registered after the X account", async () => {
    const { recordCheck, emit } = await squatterRun({
      login: "VitalikButerin",
      public_repos: 0,
      created_at: "2016-08-11T01:24:03Z",
    });

    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ label: "Possible GitHub" }));
    expect(recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "unknown",
    }));
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "checked-empty",
    }));
  });

  it("keeps the lead when the same-name account has actually published code", async () => {
    const { recordCheck, emit } = await squatterRun({
      login: "VitalikButerin",
      public_repos: 3,
      created_at: "2016-08-11T01:24:03Z",
    });

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ label: "Possible GitHub" }));
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "unknown",
    }));
  });

  it("keeps the lead when the empty account predates the X account", async () => {
    const { recordCheck } = await squatterRun({
      login: "VitalikButerin",
      public_repos: 0,
      created_at: "2009-01-01T00:00:00Z",
    });

    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "unknown",
    }));
  });

  it("keeps the lead when the dates cannot be compared", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return json({ items: [] });
      if (url.toLowerCase().endsWith("/users/vitalikbuterin")) return json({ login: "VitalikButerin", public_repos: 0, created_at: "2016-08-11T01:24:03Z" });
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    // No account_created_at on the X profile: an unknown date is not evidence of
    // a squatter, so the hedged lead stands rather than being silently dropped.
    const evidence = emptyEvidence("@VitalikButerin");
    evidence.profile.display_name = "";
    const recordCheck = vi.fn();

    await githubAdapter.run({ handle: evidence.profile.handle, evidence, emit: vi.fn(), recordCheck });

    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({
      id: "code-footprint-github",
      status: "unknown",
    }));
  });
});
