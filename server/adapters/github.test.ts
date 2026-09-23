import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import { githubAdapter, githubOrgFromOfficialSite, searchQueryVariants, sitemapCandidateUrls } from "./github";

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

  it("records outages on the repos and orgs lists as unavailable, never as an empty account", async () => {
    // Regression for INT-5: a 403 on /repos rendered "no public repositories";
    // a 403 on /orgs rendered affiliations checked-empty.
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return json({ items: [{ login: "subject" }] });
      if (url.endsWith("/users/subject")) return json({ login: "subject", twitter_username: "subject", public_repos: 40 });
      if (url.endsWith("/users/subject/orgs")) return new Response("forbidden", { status: 403 });
      if (url.includes("/users/subject/repos")) return new Response("forbidden", { status: 403 });
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@subject");
    evidence.profile.display_name = "";
    evidence.profile.bio = "founder and builder: github.com/subject";
    const recordCheck = vi.fn();
    const emit = vi.fn();
    await githubAdapter.run({ handle: evidence.profile.handle, evidence, emit, recordCheck });

    const assessment = evidence.profile.githubAssessment;
    expect(assessment).toMatchObject({ login: "subject", repoSampleState: "unavailable", publicRepos: 40 });
    expect(assessment?.claimChecks.some((check) => /no public repositories/i.test(check.observation))).toBe(false);
    expect(assessment?.claimChecks.some((check) => check.grade === "unsupported" || check.grade === "contradicted")).toBe(false);
    expect(assessment?.summary).toContain("unavailable");
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "affiliations-associates", status: "unavailable" }));
    expect(recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ id: "affiliations-associates", status: "checked-empty" }));
    expect(emit).not.toHaveBeenCalledWith(expect.objectContaining({ label: "No public orgs" }));
  });

  it("records a provider failure during resolution as unavailable rather than no match", async () => {
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("rate limited", { status: 429 })));
    const evidence = emptyEvidence("@subject");
    evidence.profile.display_name = "Subject Name";
    const recordCheck = vi.fn();
    await githubAdapter.run({ handle: evidence.profile.handle, evidence, emit: vi.fn(), recordCheck });
    expect(recordCheck).toHaveBeenCalledWith(expect.objectContaining({ id: "code-footprint-github", status: "unavailable" }));
    expect(recordCheck).not.toHaveBeenCalledWith(expect.objectContaining({ id: "code-footprint-github", status: "checked-empty" }));
  });

  it("labels a truncated repository window as a sample and withholds ratio grades", async () => {
    // Regression for INT-16: 30 most-recently-pushed forks of a 200-repo
    // account are not the account's fork ratio.
    vi.stubEnv("GITHUB_TOKEN", "github-test-key");
    const forks = Array.from({ length: 30 }, (_, index) => ({
      name: `fork-${index}`,
      html_url: `https://github.com/subject/fork-${index}`,
      owner: { login: "subject", type: "User" },
      fork: true,
      pushed_at: "2026-07-01T00:00:00Z",
    }));
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/search/users")) return json({ items: [{ login: "subject" }] });
      if (url.endsWith("/users/subject")) return json({ login: "subject", twitter_username: "subject", public_repos: 200 });
      if (url.endsWith("/users/subject/orgs")) return json([]);
      if (url.includes("/users/subject/repos")) return json(forks);
      throw new Error(`unexpected GitHub URL: ${url}`);
    }));
    const evidence = emptyEvidence("@subject");
    evidence.profile.display_name = "";
    evidence.profile.bio = "founder and builder: github.com/subject";
    const emit = vi.fn();
    await githubAdapter.run({ handle: evidence.profile.handle, evidence, emit, recordCheck: vi.fn() });

    const assessment = evidence.profile.githubAssessment;
    expect(assessment).toMatchObject({ repoSampleState: "sample", sampledRepos: 30, publicRepos: 200, forkCount: 30 });
    expect(assessment?.summary).toContain("30 most recently pushed of 200");
    expect(assessment?.claimChecks.every((check) => check.grade !== "contradicted" && check.grade !== "unsupported")).toBe(true);
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ label: "GitHub assessment", tone: "neutral" }));
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

describe("GitHub org from the project's own web surfaces", () => {
  const html = (body: string, status = 200, url = "") =>
    Object.assign(new Response(body, { status, headers: { "content-type": "text/html" } }), url ? { url } : {});

  it("finds the org in a docs-subdomain shell even when the site root is challenge-blocked", async () => {
    // The Ammalgam shape: ammalgam.xyz root has no GitHub link, the docs root
    // 403s behind a bot challenge, but the docs app shell (served even on its
    // 404 page) carries the header link to github.com/ammalgam-protocol.
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://ammalgam.xyz/") return html("<html><body>DLEX protocol</body></html>");
      if (url === "https://docs.ammalgam.xyz/") return html("challenge", 403);
      if (url === "https://docs.ammalgam.xyz/llms.txt") {
        return html('<a class="github-link" href="https://github.com/ammalgam-protocol">GitHub</a>', 404);
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    await expect(githubOrgFromOfficialSite("https://ammalgam.xyz/", fetcher)).resolves.toEqual({
      org: "ammalgam-protocol",
      sourceUrl: "https://docs.ammalgam.xyz/llms.txt",
    });
  });

  it("skips github.com product pages and off-domain redirects", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://example.xyz/") {
        return html('<a href="https://github.com/features">features</a> <a href="https://github.com/pricing">pricing</a>');
      }
      // The docs host redirects to a parking page off the controlled apex:
      // whatever it links proves nothing about this subject.
      if (url.startsWith("https://docs.example.xyz")) {
        return html('<a href="https://github.com/someone-else">gh</a>', 200, "https://parking.example-registrar.com/lander");
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    await expect(githubOrgFromOfficialSite("https://example.xyz/", fetcher)).resolves.toBeNull();
  });

  it("returns null without an official website", async () => {
    await expect(githubOrgFromOfficialSite(undefined)).resolves.toBeNull();
    await expect(githubOrgFromOfficialSite("")).resolves.toBeNull();
  });

  it("walks the site's own sitemap when the primary surfaces carry no link (the Definitive shape)", async () => {
    // definitive.fi live (2026-09-17): the home page is client-rendered with
    // no GitHub link in its raw HTML, docs.* does not exist, but the sitemap
    // lists /flash-api whose prerendered footer links github.com/DefinitiveCo.
    const sitemap = `<?xml version="1.0"?><urlset>
      <loc>https://www.definitive.fi</loc>
      <loc>https://www.definitive.fi/about</loc>
      <loc>https://www.definitive.fi/blog/some-post</loc>
      <loc>https://www.definitive.fi/flash-api</loc>
    </urlset>`;
    const fetched: string[] = [];
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input);
      fetched.push(url);
      if (url === "https://definitive.fi/") return html("<html><body>app shell, no links</body></html>");
      if (url === "https://definitive.fi/sitemap.xml") return html(sitemap);
      if (url.startsWith("https://docs.definitive.fi")) return html("no such host", 404);
      if (url === "https://www.definitive.fi/flash-api") {
        return html('<footer><a href="https://github.com/DefinitiveCo">GitHub</a></footer>');
      }
      if (url === "https://www.definitive.fi/about") return html("<html><body>about us</body></html>");
      return html("not found", 404);
    }) as typeof fetch;

    await expect(githubOrgFromOfficialSite("https://www.definitive.fi/", fetcher)).resolves.toEqual({
      org: "DefinitiveCo",
      sourceUrl: "https://www.definitive.fi/flash-api",
    });
    // The api-shaped page ranks first, so the walk resolves there and never
    // spends fetches on the about or blog pages.
    expect(fetched).toContain("https://www.definitive.fi/flash-api");
    expect(fetched).not.toContain("https://www.definitive.fi/about");
    expect(fetched).not.toContain("https://www.definitive.fi/blog/some-post");
  });

  it("ranks sitemap pages developer-first, drops off-apex and root entries, and caps the walk", () => {
    const xml = `<urlset>
      <loc>https://apex.example/</loc>
      <loc>https://apex.example/blog/one</loc>
      <loc>https://apex.example/blog/two</loc>
      <loc>https://apex.example/about</loc>
      <loc>https://apex.example/developers</loc>
      <loc>https://elsewhere.example/developers</loc>
      <loc>https://apex.example/pricing</loc>
    </urlset>`;
    const ranked = sitemapCandidateUrls(xml, "apex.example", 3);
    expect(ranked[0]).toBe("https://apex.example/developers");
    expect(ranked[1]).toBe("https://apex.example/about");
    expect(ranked).toHaveLength(3);
    expect(ranked).not.toContain("https://elsewhere.example/developers");
    expect(ranked).not.toContain("https://apex.example/");
  });
});
