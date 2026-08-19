import { afterEach, describe, expect, it, vi } from "vitest";
import {
  discoverReverseBioFromTwitterapi,
  linkedOrgsFromBioText,
  operatorClaimInBio,
  resetReverseBioMemo,
  reverseBioTeamAsWebMembers,
  scanPostsForRoles,
} from "./x";
import { enrichFirstPartyTeamAvatars } from "./teamEnrichment";
import { emptyEvidence } from "../../src/data/evidence";
import { isolateExtraCheckPersist } from "../../api/_provenance";
import type { CollectContext } from "./types";

afterEach(() => {
  resetReverseBioMemo();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const jpegBytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 1)]);

function twitterapiStub(opts: {
  mentions?: unknown[];
  tweets?: unknown[];
  followings?: unknown[];
  followers?: unknown[];
  profiles?: Record<string, { name?: string; description: string; profilePicture?: string }>;
}) {
  const profiles = opts.profiles ?? {};
  return vi.fn(async (input?: unknown) => {
    const url = String(input);
    if (/serper|google|x\.ai|anthropic/i.test(url)) {
      throw new Error(`web search must not be consulted: ${url}`);
    }
    if (url.includes("pbs.twimg.com")) {
      return new Response(jpegBytes, { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    if (url.includes("/twitter/tweet/advanced_search")) {
      const q = decodeURIComponent(url);
      const rows = q.includes("%40") || q.includes("@") ? (opts.mentions ?? opts.tweets ?? []) : (opts.tweets ?? []);
      return json({ tweets: rows });
    }
    if (url.includes("/twitter/user/mentions")) return json({ tweets: opts.mentions ?? [] });
    if (url.includes("/twitter/user/followings")) return json({ followings: opts.followings ?? [] });
    if (url.includes("/twitter/user/followers")) return json({ followers: opts.followers ?? [] });
    if (url.includes("/twitter/user/info")) {
      const user = new URL(url).searchParams.get("userName") ?? "";
      const profile = profiles[user.toLowerCase()];
      if (!profile) return json({ data: { name: user, description: "", followers: 1 } });
      return json({ data: { name: profile.name ?? user, description: profile.description, followers: 12, profilePicture: profile.profilePicture } });
    }
    return json({});
  });
}

describe("linkedOrgsFromBioText", () => {
  it("binds a fund/incubator handle and never the subject or a person", () => {
    const orgs = linkedOrgsFromBioText(
      "COO @projecthandle · @orghandle fund / incubator",
      "projecthandle",
      new Set(["alice"]),
    );
    expect(orgs.map((o) => o.handle.toLowerCase())).toEqual(["@orghandle"]);
    expect(orgs[0].role).toMatch(/fund|incubator/);
  });

  it("does not bind a display name or an unrelated @mention", () => {
    expect(linkedOrgsFromBioText("COO of Project Handle", "projecthandle")).toEqual([]);
    expect(linkedOrgsFromBioText("gm @randomfan", "projecthandle")).toEqual([]);
  });
});

describe.sequential("discoverReverseBioFromTwitterapi", () => {
  it("finds @alice via twitterapi mention/following stubs when Serper is down", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubEnv("SERPER_API_KEY", "");
    vi.stubEnv("XAI_API_KEY", "");
    const fetchMock = twitterapiStub({
      mentions: [{
        text: "@projecthandle shipping?",
        author: {
          userName: "alice",
          name: "Alice",
          description: "COO @projecthandle · @orghandle fund",
          profilePicture: "https://pbs.twimg.com/profile_images/1/alice_normal.jpg",
        },
      }],
      followings: [{
        userName: "alice",
        name: "Alice",
        description: "COO @projecthandle · @orghandle fund",
      }],
      profiles: {
        alice: {
          name: "Alice",
          description: "COO @projecthandle · @orghandle fund",
          profilePicture: "https://pbs.twimg.com/profile_images/1/alice_normal.jpg",
        },
        orghandle: { name: "Org Fund", description: "early-stage fund" },
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    const found = await discoverReverseBioFromTwitterapi("@projecthandle", "Project Handle");

    expect(found.team).toHaveLength(1);
    expect(found.team[0]).toMatchObject({
      handle: "@alice",
      kind: "team",
      source: "reverse-bio twitterapi",
    });
    expect(found.team[0].role).toMatch(/coo|co-founder/i);
    expect(found.team[0].evidence).toMatch(/COO @projecthandle/i);
    expect(found.orgs.map((o) => o.handle.toLowerCase())).toContain("@orghandle");
    expect(found.orgs.every((o) => o.handle.toLowerCase() !== "@alice")).toBe(true);
    expect(fetchMock.mock.calls.every((c) => !/serper|google/i.test(String(c[0])))).toBe(true);

    const webTeam = reverseBioTeamAsWebMembers(found.team);
    expect(webTeam[0].handleProvenance).toBe("subject_first_party");
    expect(webTeam[0].evidence_origin).toBe("deterministic");
    expect(webTeam[0].provider).toBe("twitterapi");

    const evidence = emptyEvidence("@projecthandle");
    evidence.webTeam = webTeam;
    const ctx: CollectContext = { handle: "@projecthandle", evidence, emit: vi.fn() };
    await enrichFirstPartyTeamAvatars(ctx);
    expect(webTeam[0].avatarUrl).toMatch(/pbs\.twimg\.com/);
    expect(webTeam[0].enrichmentProvider).toBe("twitterapi");
  });

  it("still finds @alice when official project posts never name anyone", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    const officialPosts = ["gm", "shipping v2 this week", "docs are live"];
    expect(scanPostsForRoles(officialPosts, "Project Handle")).toEqual([]);

    vi.stubGlobal("fetch", twitterapiStub({
      mentions: [{
        text: "working",
        author: { userName: "alice", name: "Alice", description: "COO @projecthandle" },
      }],
    }));

    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team.map((t) => t.handle)).toEqual(["@alice"]);
  });

  it("does not bind a display name without a handle", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", twitterapiStub({
      mentions: [{ text: "Alice is our COO and built the product" }],
      tweets: [{ text: "Alice is COO of Project Handle" }],
    }));
    const found = await discoverReverseBioFromTwitterapi("@projecthandle", "Project Handle");
    expect(found.team).toEqual([]);
  });

  it("does not bind a random @mention with no founder language", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", twitterapiStub({
      mentions: [{
        text: "@projecthandle cool",
        author: { userName: "randomfan", name: "Fan", description: "just a degen" },
      }],
    }));
    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team).toEqual([]);
    expect(found.orgs).toEqual([]);
  });

  it("binds first-person we-built tweets when the bio @-mentions the subject without a title", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", twitterapiStub({
      mentions: [{
        text: "we built @projecthandle from scratch",
        author: { userName: "bob", name: "Bob", description: "builder | @projecthandle | other work" },
      }],
    }));
    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team).toHaveLength(1);
    expect(found.team[0].handle).toBe("@bob");
    expect(found.team[0].role).toBe("founder");
    expect(found.team[0].evidence).toMatch(/we built @projecthandle/i);
  });

  it("stays empty without a twitterapi key", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "");
    expect(await discoverReverseBioFromTwitterapi("@projecthandle")).toEqual({ team: [], orgs: [] });
  });
});

describe("extra-check persist must not abort team collection", () => {
  it("keeps reverse-bio team after a forged-floor persist throw is isolated", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "tw-key");
    vi.stubGlobal("fetch", twitterapiStub({
      followings: [{
        userName: "alice",
        name: "Alice",
        description: "COO @projecthandle",
      }],
    }));
    const found = await discoverReverseBioFromTwitterapi("@projecthandle");
    expect(found.team.map((t) => t.handle)).toEqual(["@alice"]);

    const isolated = await isolateExtraCheckPersist(async () => {
      throw new Error("invalid axis evidence lineage: project strength band floor");
    });
    expect(isolated.ok).toBe(false);
    if (!isolated.ok) expect(isolated.reason).toMatch(/project strength band floor/);
    expect(found.team).toHaveLength(1);
    expect(found.team[0].handle).toBe("@alice");
  });

  it("does not flatten a first-party reverse-bio row when the official account never vouched by posts or domain", () => {
    const webTeam = reverseBioTeamAsWebMembers([{
      name: "Alice",
      handle: "@alice",
      role: "coo",
      kind: "team",
      evidence: 'their current X bio states "COO @projecthandle"',
      source: "reverse-bio twitterapi",
    }]);
    const accountVouchesTeam = false;
    if (webTeam.length && !accountVouchesTeam) {
      for (const member of webTeam) {
        if (member.handleProvenance === "subject_first_party") continue;
        member.evidence_origin = "model_lead";
        member.artifact_verified = false;
      }
    }
    expect(webTeam[0].handleProvenance).toBe("subject_first_party");
    expect(webTeam[0].artifact_verified).toBe(true);
    expect(webTeam[0].evidence_origin).toBe("deterministic");
  });
});

describe("operatorClaimInBio · reverse-bio titles", () => {
  it("requires an @handle, never a display name alone", () => {
    expect(operatorClaimInBio("COO of Project Handle", "@projecthandle")).toBeNull();
  });
});
