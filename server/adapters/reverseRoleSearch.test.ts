import { afterEach, describe, expect, it, vi } from "vitest";
import {
  amplifiedAuthorsFromTimeline,
  clearLastTweetsMemo,
  confirmClaimantBios,
  discoverOperatorsFromAmplified,
  findRoleClaimants,
  operatorClaimInBio,
} from "./x";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearLastTweetsMemo();
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
    expect(await findRoleClaimants("@clutchmarkets")).toEqual([]);
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
