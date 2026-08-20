import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../publicWeb", () => ({ fetchPublicText: vi.fn(async () => null) }));
import {
  amplifiedAuthorsFromTimeline,
  clearLastTweetsMemo,
  confirmClaimantBios,
  discoverOperatorsFromAmplified,
  findRoleClaimants,
  discoverReverseBioFromTwitterapi,
  linkedOrgsFromBioText,
  operatorClaimInBio,
  projectRoleClaimInBio,
  resetReverseBioMemo,
  reverseBioTeamAsWebMembers,
  roleClaimantSerperPlan,
  scanPostsForRoles,
  confirmedFounderFollowupPlan,
  serperConfirmedFounderFollowup,
  linkedInProfileFromOrganicUrl,
} from "./x";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearLastTweetsMemo();
  resetReverseBioMemo();
});

// The Clutch Markets case: the project account named no team anywhere, but it
// retweeted @OxSimpleFarmer, whose own X bio says "Founder @clutchmarkets" and
// whose site footer credits them. The report published "no visible founders".
// These lanes exist so that exact evidence chain resolves deterministically.

describe("operatorClaimInBio · the Clutch founder bio", () => {
  it("reads the real founder bio the audit missed", () => {
    const claim = operatorClaimInBio("Founder @clutchmarkets, I grow things", "@clutchmarkets", "CLUTCH");
    expect(claim).not.toBeNull();
    expect(claim!.role).toBe("founder");
    expect(claim!.phrase).toContain("Founder @clutchmarkets");
  });
});

describe("amplifiedAuthorsFromTimeline", () => {
  const timeline = {
    data: {
      tweets: [
        { // a retweet of the founder, author bio embedded
          text: "RT @OxSimpleFarmer: Clock In 2.0 is live",
          retweeted_tweet: {
            author: { userName: "OxSimpleFarmer", name: "SimpleFarmer", description: "Founder @clutchmarkets, I grow things" },
          },
        },
        { // a quote-post of a partner, not a claimant
          text: "so it begins",
          quoted_tweet: { author: { userName: "PureBredCrypto", name: "PBC", description: "media" } },
        },
        { // duplicate amplification collapses to one author
          text: "RT @OxSimpleFarmer: gm",
          retweeted_tweet: { author: { userName: "OxSimpleFarmer", name: "SimpleFarmer", description: "Founder @clutchmarkets, I grow things" } },
        },
        { // a self-quote must not list the subject as its own team
          text: "ICYMI",
          quoted_tweet: { author: { userName: "ClutchMarkets", name: "CLUTCH", description: "official" } },
        },
        { text: "plain original post, no amplification" },
      ],
    },
  };

  it("collects distinct amplified authors with embedded bios, excluding the subject", () => {
    const authors = amplifiedAuthorsFromTimeline(timeline, "clutchmarkets");
    expect(authors.map((a) => a.handle)).toEqual(["OxSimpleFarmer", "PureBredCrypto"]);
    expect(authors[0].bio).toContain("Founder @clutchmarkets");
  });

  it("tolerates the flatter legacy payload shapes and garbage rows", () => {
    const flat = {
      tweets: [
        { retweeted_status: { user: { screen_name: "OxSimpleFarmer", description: "Founder @clutchmarkets" } } },
        { retweeted_tweet: null },
        null,
        "not a tweet",
      ],
    };
    const authors = amplifiedAuthorsFromTimeline(flat, "@clutchmarkets");
    expect(authors).toHaveLength(1);
    expect(authors[0].handle).toBe("OxSimpleFarmer");
    expect(amplifiedAuthorsFromTimeline(null, "@clutchmarkets")).toEqual([]);
    expect(amplifiedAuthorsFromTimeline({ data: {} }, "@clutchmarkets")).toEqual([]);
  });
});

describe("discoverOperatorsFromAmplified", () => {
  const timelineResponse = (tweets: unknown[]) => new Response(
    JSON.stringify({ data: { tweets } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

  it("returns the founder with both crossing signals in its evidence", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    const fetchMock = vi.fn(async (_input?: unknown) => timelineResponse([
      {
        text: "RT @OxSimpleFarmer: Clock In 2.0",
        retweeted_tweet: {
          author: { userName: "OxSimpleFarmer", name: "SimpleFarmer", description: "Founder @clutchmarkets, I grow things | @stonkbrokers" },
        },
      },
      {
        text: "cool thread",
        quoted_tweet: { author: { userName: "randomfan", name: "Fan", description: "bullish on @clutchmarkets" } },
      },
    ]));
    vi.stubGlobal("fetch", fetchMock);

    const team = await discoverOperatorsFromAmplified("@clutchmarkets", "CLUTCH");

    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({
      handle: "@OxSimpleFarmer",
      role: "founder",
      kind: "team",
      sourceUrl: "https://x.com/OxSimpleFarmer",
    });
    expect(team[0].evidence).toContain("retweeted/quoted @OxSimpleFarmer");
    expect(team[0].evidence).toContain("Founder @clutchmarkets");
    // The serial-launcher signal: the same bio names another project.
    expect(team[0].projects).toEqual([{ name: "@stonkbrokers" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/twitter/user/last_tweets?userName=clutchmarkets");
  });

  it("fetches the profile when the timeline embeds no bio, bounded and best-effort", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    const fetchMock = vi.fn(async (input?: unknown) => {
      const url = String(input);
      if (url.includes("/twitter/user/last_tweets")) {
        return timelineResponse([
          { text: "RT", retweeted_tweet: { author: { userName: "OxSimpleFarmer", name: "SimpleFarmer" } } },
        ]);
      }
      if (url.includes("/twitter/user/info")) {
        return new Response(JSON.stringify({ data: { name: "SimpleFarmer", description: "Founder @clutchmarkets", followers: 1 } }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const team = await discoverOperatorsFromAmplified("@clutchmarkets");
    expect(team).toHaveLength(1);
    expect(team[0].handle).toBe("@OxSimpleFarmer");
    expect(String(fetchMock.mock.calls.map(String))).toContain("userName=OxSimpleFarmer");
  });

  it("stays silent without a key and on a provider error", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    expect(await discoverOperatorsFromAmplified("@clutchmarkets")).toEqual([]);

    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("oops", { status: 500 })));
    expect(await discoverOperatorsFromAmplified("@clutchmarkets")).toEqual([]);
  });
});

describe("findRoleClaimants", () => {
  it("runs the reverse quoted queries and parses the roster", async () => {
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "grok");
    vi.stubEnv("XAI_API_KEY", "xai-key");
    let seenBody = "";
    vi.stubGlobal("fetch", vi.fn(async (_url?: unknown, init?: RequestInit) => {
      seenBody = String(init?.body ?? "");
      return new Response(JSON.stringify({
        output_text: JSON.stringify({ people: [{ name: "SimpleFarmer", handle: "@OxSimpleFarmer", role: "founder", kind: "team", evidence: "X bio: Founder @clutchmarkets" }] }),
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));

    const team = await findRoleClaimants("@clutchmarkets", "CLUTCH", "clutch.markets");

    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ handle: "@OxSimpleFarmer", role: "founder", source: "reverse role-phrase search" });
    // The user-specified query grammar must reach the searcher verbatim.
    expect(seenBody).toContain('\\"founder of @clutchmarkets\\"');
    expect(seenBody).toContain('\\"cofounder of @clutchmarkets\\"');
    expect(seenBody).toContain('\\"CEO at @clutchmarkets\\"');
    expect(seenBody).toContain('\\"@clutchmarkets team\\"');
    expect(seenBody).toContain('\\"founder of CLUTCH\\"');
    expect(seenBody).toContain('\\"founder of clutch.markets\\"');
  });

  it("returns [] when no search provider is configured", async () => {
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "grok");
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubEnv("SERPER_API_KEY", "");
    expect(await findRoleClaimants("@clutchmarkets")).toEqual([]);
  });

  it("posts more than 5 quoted + official-site queries to Serper, including site: team, when a domain is passed", async () => {
    vi.stubEnv("SERPER_API_KEY", "serp");
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("TWITTERAPI_KEY", "");
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "");
    const webQueries: string[] = [];
    const newsQueries: string[] = [];
    const serperNums: number[] = [];
    let xaiHits = 0;
    vi.stubGlobal("fetch", vi.fn(async (url?: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("google.serper.dev")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { q?: string; num?: number };
        if (u.includes("/news")) newsQueries.push(String(body.q ?? ""));
        else webQueries.push(String(body.q ?? ""));
        serperNums.push(Number(body.num));
        const hits = [{ title: "Founder bio", link: "https://ex.com/a", snippet: "Founder @clutchmarkets" }];
        return new Response(JSON.stringify(u.includes("/news") ? { news: hits } : { organic: hits }), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("api.x.ai")) {
        xaiHits += 1;
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                people: [{
                  name: "SimpleFarmer",
                  handle: "@OxSimpleFarmer",
                  role: "founder",
                  kind: "team",
                  evidence: "X bio: Founder @clutchmarkets",
                }],
              }),
            },
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    }));

    const team = await findRoleClaimants("@clutchmarkets", "CLUTCH", "clutch.markets");

    expect(webQueries.length).toBeGreaterThan(5);
    expect(webQueries.length).toBeLessThanOrEqual(8);
    expect(webQueries).toContain('"founder of @clutchmarkets"');
    expect(webQueries).toContain('"co-founder of @clutchmarkets"');
    expect(webQueries).toContain('"CEO of @clutchmarkets"');
    expect(webQueries).toContain('"@clutchmarkets team"');
    expect(webQueries).toContain("site:clutch.markets team");
    expect(webQueries).toContain("site:clutch.markets founder");
    expect(webQueries).toContain("site:clutch.markets about");
    expect(webQueries).toContain('site:linkedin.com "CLUTCH" founder');
    expect(webQueries.some((q) => q === "@clutchmarkets founder CEO team" || q.startsWith("@clutchmarkets "))).toBe(false);
    expect(webQueries.some((q) => q.startsWith("@") && !q.startsWith('"'))).toBe(false);
    expect(newsQueries).toEqual(['"CLUTCH" founder OR team']);
    expect(serperNums.every((n) => n === 10)).toBe(true);
    expect(xaiHits).toBe(1);
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ handle: "@OxSimpleFarmer", role: "founder", source: "reverse role-phrase search" });
  });
});

describe("roleClaimantSerperPlan", () => {
  it("builds official-site and LinkedIn queries from the bound handle/name/domain, never a twitter-style @handle dump", () => {
    const plan = roleClaimantSerperPlan("@examplebrand", "Example Brand", "https://www.examplebrand.io/about");
    expect(plan.queries[0]).toBe('"founder of @examplebrand"');
    expect(plan.queries).toContain("site:examplebrand.io team");
    expect(plan.queries).toContain('site:linkedin.com "Example Brand" founder');
    expect(plan.queries).toContain('"Example Brand" founder LinkedIn');
    expect(plan.queries.some((q) => q === "@examplebrand founder CEO team")).toBe(false);
    expect(plan.newsQuery).toBe('"Example Brand" founder OR team');
  });

  it("skips news and name/LinkedIn extras when no project name is supplied", () => {
    const plan = roleClaimantSerperPlan("@examplebrand", undefined, "examplebrand.io");
    expect(plan.newsQuery).toBeUndefined();
    expect(plan.queries).toContain("site:examplebrand.io team");
    expect(plan.queries.some((q) => /linkedin/i.test(q))).toBe(false);
  });
});

describe("confirmClaimantBios", () => {
  it("keeps only claimants whose live bio really carries the claim", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (input?: unknown) => {
      const url = String(input);
      const bio = url.includes("OxSimpleFarmer") ? "Founder @clutchmarkets, I grow things" : "just a fan of @clutchmarkets";
      return new Response(JSON.stringify({ data: { name: "x", description: bio, followers: 1 } }), { status: 200 });
    }));

    const confirmed = await confirmClaimantBios(
      [
        { name: "SimpleFarmer", handle: "@OxSimpleFarmer", role: "founder", kind: "team" },
        { name: "Fan", handle: "@randomfan", role: "founder", kind: "team" },
        { name: "Self", handle: "@clutchmarkets", role: "founder", kind: "team" },
        { name: "NoHandle", role: "founder", kind: "team" },
      ],
      "@clutchmarkets",
      "CLUTCH",
    );

    expect([...confirmed.keys()]).toEqual(["oxsimplefarmer"]);
    expect(confirmed.get("oxsimplefarmer")!.phrase).toContain("Founder @clutchmarkets");
  });
});

describe("projectRoleClaimInBio · handle is the unique id", () => {
  it("reads a comma-separated co-founder / COO bio against the project handle", () => {
    const claim = projectRoleClaimInBio("Co-founder, COO @projecthandle", "@projecthandle");
    expect(claim).not.toBeNull();
    expect(claim!.phrase).toContain("@projecthandle");
    expect(/co-?founder|coo/i.test(claim!.role)).toBe(true);
  });

  it("does not bind a display name without the @handle", () => {
    expect(projectRoleClaimInBio("Co-founder, COO ProjectHandle", "@projecthandle")).toBeNull();
  });
});

describe("discoverReverseBioFromTwitterapi · serper-independent keep", () => {
  it("keeps a twitterapi bio claimant when search is down and drops a random mention", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "serper");
    vi.stubEnv("SERPER_API_KEY", "");
    const fetchMock = vi.fn(async (input?: unknown) => {
      const url = String(input);
      if (url.includes("/twitter/tweet/advanced_search") || url.includes("/twitter/user/mentions")) {
        return new Response(JSON.stringify({
          tweets: [
            { text: "building with @projecthandle", author: { userName: "alice", name: "Alice", description: "Co-founder, COO @projecthandle" } },
            { text: "love @projecthandle", author: { userName: "randomfan", name: "Fan", description: "just a fan of the feed" } },
          ],
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.includes("/twitter/user/followings") || url.includes("/twitter/user/followers")) {
        return new Response(JSON.stringify({ followings: [], followers: [] }), { status: 200 });
      }
      if (url.includes("/twitter/user/info")) {
        const bio = url.includes("alice") ? "Co-founder, COO @projecthandle" : "just a fan of the feed";
        const name = url.includes("alice") ? "Alice" : "Fan";
        return new Response(JSON.stringify({ data: { name, description: bio, followers: 1 } }), { status: 200 });
      }
      return new Response("{}", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team.map((m) => m.handle)).toEqual(["@alice"]);
    expect(found.team[0]).toMatchObject({
      handle: "@alice",
      source: "reverse-bio twitterapi",
      sourceUrl: "https://x.com/alice",
    });
    expect(found.team.map((m) => m.handle)).not.toContain("@randomfan");
  });

  it("classifies linked fund/incubator handles as orgs, not people", () => {
    const orgs = linkedOrgsFromBioText(
      "Co-founder, COO @projecthandle | incubated by @somefundvc",
      "@projecthandle",
      new Set(["alice"]),
    );
    expect(orgs.map((o) => o.handle)).toEqual(["@somefundvc"]);
    expect(orgs[0].role).toMatch(/fund|incubator|vc|team-behind/);
  });
});

function twitterapiStub(input?: unknown) {
  const url = String(input);
  if (url.includes("/twitter/tweet/advanced_search") || url.includes("/twitter/user/mentions")) {
    return new Response(JSON.stringify({
      tweets: [
        { text: "shipping", author: { userName: "alice", name: "Alice", description: "Co-founder, COO @projecthandle | @SomeOrg" } },
        { text: "love @projecthandle", author: { userName: "bob", name: "Bob", description: "just mentioning @projecthandle in passing" } },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.includes("/twitter/user/followings") || url.includes("/twitter/user/followers")) {
    return new Response(JSON.stringify({ followings: [], followers: [] }), { status: 200 });
  }
  if (url.includes("/twitter/user/info")) {
    if (/userName=SomeOrg/i.test(url) || /userName=someorg/i.test(url)) {
      return new Response(JSON.stringify({
        data: { name: "Some Org", description: "early-stage fund backing builders", followers: 10, profilePicture: "https://pbs.twimg.com/profile_images/some_normal.jpg" },
      }), { status: 200 });
    }
    if (/userName=alice/i.test(url)) {
      return new Response(JSON.stringify({
        data: { name: "Alice", description: "Co-founder, COO @projecthandle | @SomeOrg", followers: 2, profilePicture: "https://pbs.twimg.com/profile_images/alice_normal.jpg" },
      }), { status: 200 });
    }
    if (/userName=bob/i.test(url)) {
      return new Response(JSON.stringify({
        data: { name: "Bob", description: "just mentioning @projecthandle in passing", followers: 1 },
      }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { name: "x", description: "", followers: 0 } }), { status: 200 });
  }
  return new Response("{}", { status: 503 });
}

describe("reverse-bio keep path · @alice @bob @SomeOrg @projecthandle", () => {
  it("finds @alice via twitterapi when Serper is down and official posts name nobody", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "serper");
    vi.stubEnv("SERPER_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    vi.stubGlobal("fetch", vi.fn(twitterapiStub));

    expect(scanPostsForRoles([], "Project Handle")).toEqual([]);
    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team.map((m) => m.handle)).toEqual(["@alice"]);
    expect(found.team[0]).toMatchObject({
      handle: "@alice",
      name: "Alice",
      source: "reverse-bio twitterapi",
      sourceUrl: "https://x.com/alice",
    });
    expect(found.team.map((m) => m.handle)).not.toContain("@bob");

    const viaSearch = await findRoleClaimants("@projecthandle", "Project Handle");
    expect(viaSearch.map((m) => m.handle)).toEqual(["@alice"]);
    expect(viaSearch[0].source).toBe("reverse-bio twitterapi");
  });

  it("does not turn a founder's separate fund affiliation into a project backer", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(twitterapiStub));

    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team.map((m) => m.handle)).toEqual(["@alice"]);
    expect(found.orgs).toEqual([]);

    const people = reverseBioTeamAsWebMembers(found.team);
    expect(people[0]).toMatchObject({
      handle: "@alice",
      kind: "person",
      evidence_origin: "deterministic",
      artifact_verified: true,
      relationshipProvenance: "claimant_self",
      provider: "twitterapi",
    });
    expect(people[0]).not.toHaveProperty("handleProvenance");
  });

  it("requires explicit relationship grammar before linking an organization", () => {
    expect(linkedOrgsFromBioText(
      "Co-founder @projecthandle | VC @lovable_dev | member @superteamde",
      "@projecthandle",
    )).toEqual([]);
    expect(linkedOrgsFromBioText(
      "Project incubated by @somefundvc and partnered with @trmlabs",
      "@projecthandle",
    )).toEqual([
      expect.objectContaining({ handle: "@somefundvc", role: "incubator" }),
      expect.objectContaining({ handle: "@trmlabs", role: "partner" }),
    ]);
  });

  it("does not bind a display-name-only bio or a random @mention without role language", async () => {
    expect(projectRoleClaimInBio("Co-founder, COO of Project Handle", "@projecthandle")).toBeNull();
    expect(projectRoleClaimInBio("just mentioning @projecthandle in passing", "@projecthandle")).toBeNull();
    expect(projectRoleClaimInBio("we built @projecthandle", "@projecthandle")).not.toBeNull();

    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", vi.fn(async (input?: unknown) => {
      const url = String(input);
      if (url.includes("/twitter/user/info") && /userName=alice/i.test(url)) {
        return new Response(JSON.stringify({
          data: { name: "Alice", description: "Co-founder, COO of Project Handle", followers: 1 },
        }), { status: 200 });
      }
      return twitterapiStub(input);
    }));

    const confirmed = await confirmClaimantBios(
      [{ name: "Alice", handle: "@alice", role: "co-founder", kind: "team" }],
      "@projecthandle",
      "Project Handle",
    );
    expect([...confirmed.keys()]).toEqual([]);
  });
});

describe("confirmedFounderFollowupPlan", () => {
  it("builds a LinkedIn site: query for a named confirmed founder and skips unverified leads", () => {
    const plan = confirmedFounderFollowupPlan(
      new Map([
        ["alice", { role: "founder", phrase: "Founder @projecthandle", name: "Alice Example" }],
      ]),
      "@projecthandle",
      "Example Project",
    );
    expect(plan).toEqual([{
      handle: "alice",
      displayName: "Alice Example",
      linkedinQuery: 'site:linkedin.com/in "Alice Example"',
      pressQuery: '"Alice Example" "Example Project" founder',
    }]);
  });

  it("skips the subject project handle even if it is in the confirmed map", () => {
    const plan = confirmedFounderFollowupPlan(
      new Map([
        ["projecthandle", { role: "founder", phrase: "Founder @projecthandle", name: "Project Brand" }],
        ["alice", { role: "ceo", phrase: "CEO @projecthandle", name: "Alice Example" }],
      ]),
      "@projecthandle",
      "Example Project",
    );
    expect(plan.map((row) => row.handle)).toEqual(["alice"]);
  });

  it("caps follow-up at 3 confirmed people", () => {
    const confirmed = new Map(
      ["ann", "ben", "cam", "dee"].map((handle) => [
        handle,
        { role: "founder" as const, phrase: "Founder @projecthandle", name: `Person ${handle}` },
      ]),
    );
    const plan = confirmedFounderFollowupPlan(confirmed, "@projecthandle", "Example Project");
    expect(plan).toHaveLength(3);
    expect(plan.map((row) => row.handle)).toEqual(["ann", "ben", "cam"]);
  });

  it("uses a handle LinkedIn query when the display name is the @handle, and skips orgs", () => {
    const plan = confirmedFounderFollowupPlan(
      new Map([
        ["alice", { role: "founder", phrase: "Founder @projecthandle", name: "@alice" }],
        ["somefund", { role: "vc", phrase: "backed by", name: "Some Fund" }],
      ]),
      "@projecthandle",
      "Example Project",
    );
    expect(plan).toEqual([{
      handle: "alice",
      displayName: undefined,
      linkedinQuery: 'site:linkedin.com "alice" founder',
      pressQuery: undefined,
    }]);
  });
});

describe("linkedInProfileFromOrganicUrl", () => {
  it("keeps linkedin.com/in profile URLs and rejects company pages", () => {
    expect(linkedInProfileFromOrganicUrl("https://www.linkedin.com/in/alice-example")).toBe("linkedin.com/in/alice-example");
    expect(linkedInProfileFromOrganicUrl("https://www.linkedin.com/company/example-project")).toBeNull();
  });
});

describe("serperConfirmedFounderFollowup", () => {
  const ok = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

  it("fires LinkedIn site: for a confirmed named founder and does not search an unverified lead", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubEnv("SERPER_API_KEY", "serp");
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("ARGUS_GENERAL_WEB_PROVIDER", "");
    const webQueries: string[] = [];
    const newsQueries: string[] = [];
    const serperNums: number[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url?: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/twitter/user/info")) {
        const alice = /userName=alice/i.test(u);
        const bio = alice ? "Founder @projecthandle" : "just a fan of @projecthandle";
        const name = alice ? "Alice Example" : "Unverified Bob";
        return ok({ data: { name, description: bio, followers: 1 } });
      }
      if (u.includes("google.serper.dev")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { q?: string; num?: number };
        if (u.includes("/news")) newsQueries.push(String(body.q ?? ""));
        else webQueries.push(String(body.q ?? ""));
        serperNums.push(Number(body.num));
        const hits = [{ title: "Alice Example", link: "https://www.linkedin.com/in/alice-example", snippet: "Founder" }];
        return ok(u.includes("/news") ? { news: hits } : { organic: hits });
      }
      return ok({
        choices: [{ message: { content: '{"linkedin":"linkedin.com/in/invented-slug"}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      });
    }));

    const confirmed = await confirmClaimantBios(
      [
        { name: "Alice Example", handle: "@alice", role: "founder", kind: "team" },
        { name: "Unverified Bob", handle: "@bob", role: "founder", kind: "team" },
      ],
      "@projecthandle",
      "Example Project",
    );
    const hits = await serperConfirmedFounderFollowup(confirmed, "@projecthandle", "Example Project");

    expect([...confirmed.keys()]).toEqual(["alice"]);
    expect(webQueries).toEqual(['site:linkedin.com/in "Alice Example"']);
    expect(newsQueries).toEqual(['"Alice Example" "Example Project" founder']);
    expect(serperNums.every((n) => n === 10)).toBe(true);
    expect(webQueries.some((q) => /bob|Unverified/i.test(q))).toBe(false);
    expect(newsQueries.some((q) => /bob|Unverified/i.test(q))).toBe(false);
    expect(hits.get("alice")?.linkedin).toBe("linkedin.com/in/alice-example");
  });

  it("skips all follow-up fetches when ARGUS_SERPER_FOUNDER_FOLLOWUP is off", async () => {
    vi.stubEnv("SERPER_API_KEY", "serp");
    vi.stubEnv("XAI_API_KEY", "xai");
    vi.stubEnv("ARGUS_SERPER_FOUNDER_FOLLOWUP", "0");
    const fetchMock = vi.fn(async () => ok({ organic: [] }));
    vi.stubGlobal("fetch", fetchMock);

    const hits = await serperConfirmedFounderFollowup(
      new Map([["alice", { role: "founder", phrase: "Founder @projecthandle", name: "Alice Example" }]]),
      "@projecthandle",
      "Example Project",
    );
    expect(hits.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not search the project subject handle", async () => {
    vi.stubEnv("SERPER_API_KEY", "serp");
    vi.stubEnv("XAI_API_KEY", "xai");
    const webQueries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url?: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("google.serper.dev") && !u.includes("/news")) {
        webQueries.push(String((JSON.parse(String(init?.body ?? "{}")) as { q?: string }).q ?? ""));
        return ok({ organic: [] });
      }
      if (u.includes("google.serper.dev/news")) return ok({ news: [] });
      return ok({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }));

    await serperConfirmedFounderFollowup(
      new Map([
        ["projecthandle", { role: "founder", phrase: "Founder @projecthandle", name: "Project Brand" }],
        ["alice", { role: "founder", phrase: "Founder @projecthandle", name: "Alice Example" }],
      ]),
      "@projecthandle",
      "Example Project",
    );
    expect(webQueries).toEqual(['site:linkedin.com/in "Alice Example"']);
  });

  it("caps Serper follow-up at 3 confirmed people", async () => {
    vi.stubEnv("SERPER_API_KEY", "serp");
    vi.stubEnv("XAI_API_KEY", "xai");
    const webQueries: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url?: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("google.serper.dev") && !u.includes("/news")) {
        webQueries.push(String((JSON.parse(String(init?.body ?? "{}")) as { q?: string }).q ?? ""));
        return ok({ organic: [] });
      }
      if (u.includes("google.serper.dev/news")) return ok({ news: [] });
      return ok({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }));

    const confirmed = new Map(
      ["ann", "ben", "cam", "dee"].map((handle) => [
        handle,
        { role: "founder", phrase: "Founder @projecthandle", name: `Person ${handle}` },
      ]),
    );
    await serperConfirmedFounderFollowup(confirmed, "@projecthandle", "Example Project");
    expect(webQueries).toHaveLength(3);
    expect([...webQueries].sort()).toEqual([
      'site:linkedin.com/in "Person ann"',
      'site:linkedin.com/in "Person ben"',
      'site:linkedin.com/in "Person cam"',
    ]);
    expect(webQueries.some((q) => q.includes("Person dee"))).toBe(false);
  });
});
