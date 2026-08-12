import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyEvidence } from "../../src/data/evidence";
import type { CollectContext } from "./types";
import {
  AUDIENCE_SAMPLE_MIN,
  clearLastTweetsMemo,
  describeAudienceSample,
  newAudienceTally,
  notableFollowers,
  sealAudienceSample,
  tallyAudienceRow,
  xAdapter,
} from "./x";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json" },
});

/** A follower row shaped like twitterapi's user object: real photo, real bio,
 *  real posting history. Overrides carve out the specific gap under test. */
const row = (index: number, over: Record<string, unknown> = {}) => ({
  userName: `follower${index}`,
  createdAt: "Tue Mar 03 07:16:36 +0000 2026",
  description: "building things",
  statusesCount: 40,
  followers: 300,
  following: 250,
  profilePicture: "https://pbs.twimg.com/profile_images/1/photo_normal.jpg",
  ...over,
});

const rows = (count: number, over: (index: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: count }, (_, index) => row(index, over(index)));

const page = (followers: unknown[], over: Record<string, unknown> = {}) =>
  json({ followers, has_next_page: false, ...over });

describe("X follower audience shape", () => {
  afterEach(() => {
    clearLastTweetsMemo();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reports every statistic against the profiles it actually read, never the follower count", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      page(rows(60, (index) => (index < 24 ? { statusesCount: 0 } : {}))),
    ));

    // The account claims 200 followers; the scan read 60 rows.
    const scan = await notableFollowers("@subject", { followerCount: 200 });

    expect(scan.audience?.profilesExamined).toBe(60);
    expect(scan.audience?.posts).toEqual({ measured: 60, zeroPosts: 24 });
    const sentence = describeAudienceSample(scan.audience);
    expect(sentence).toContain("24 of 60 (40%)");
    expect(sentence).toContain("60 follower profiles");
    expect(sentence).not.toContain("200");
  });

  it("leaves an omitted creation date unmeasured instead of counting it as an older account", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(page(rows(120, (index) => {
      if (index < 40) return { createdAt: "Sat Mar 07 07:16:36 +0000 2026" };
      if (index < 60) return { createdAt: "Wed Jan 01 07:16:36 +0000 2025" };
      const { createdAt: _dropped, ...missing } = row(index);
      return { ...missing, createdAt: undefined };
    }))));

    const scan = await notableFollowers("@subject", { followerCount: 200 });

    // 60 of the 120 rows carried a date. The cohort is a share of those 60.
    expect(scan.audience?.profilesExamined).toBe(120);
    expect(scan.audience?.creation).toEqual({
      measured: 60,
      largestMonth: { month: "2026-03", accounts: 40 },
    });
    const sentence = describeAudienceSample(scan.audience);
    expect(sentence).toContain("2026-03, 40 of 60 (67%)");
    expect(sentence).not.toContain("40 of 120");
  });

  it("counts an empty profile only where the provider returned both the avatar and the bio", () => {
    const tally = newAudienceTally();
    tallyAudienceRow(tally, row(1, {
      description: "   ",
      profilePicture: "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
    }));
    tallyAudienceRow(tally, { userName: "bioless", profilePicture: "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png" });
    tallyAudienceRow(tally, { userName: "avatarless", description: "" });

    const sample = sealAudienceSample(tally, true)!;

    expect(sample.profilesExamined).toBe(3);
    expect(sample.avatar).toEqual({ measured: 2, defaultAvatar: 2 });
    expect(sample.bio).toEqual({ measured: 2, empty: 2 });
    // Only the first row answered both questions, so it is the only row that
    // can be counted as a default avatar over an empty bio.
    expect(sample.starterProfile).toEqual({ measured: 1, accounts: 1 });
  });

  it("buckets the follow ratio and drops a row that is missing either count", () => {
    const tally = newAudienceTally();
    tallyAudienceRow(tally, row(1, { followers: 4, following: 900 }));   // followingHeavy
    tallyAudienceRow(tally, row(2, { followers: 900, following: 4 }));   // followerHeavy
    tallyAudienceRow(tally, row(3, { followers: 300, following: 250 })); // balanced
    tallyAudienceRow(tally, row(4, { followers: 0, following: 0 }));     // leans neither way
    tallyAudienceRow(tally, row(5, { followers: 500, following: undefined }));
    tallyAudienceRow(tally, row(6, { followers: undefined, following: 500 }));

    const sample = sealAudienceSample(tally, true)!;

    expect(sample.profilesExamined).toBe(6);
    expect(sample.followRatio).toEqual({
      measured: 4,
      followingHeavy: 1,
      balanced: 2,
      followerHeavy: 1,
    });
  });

  it("does not let a null page entry dilute a denominator", () => {
    const tally = newAudienceTally();
    tallyAudienceRow(tally, row(1, { statusesCount: 0 }));
    tallyAudienceRow(tally, null);
    tallyAudienceRow(tally, "not a profile");

    expect(sealAudienceSample(tally, true)).toEqual(expect.objectContaining({
      profilesExamined: 1,
      posts: { measured: 1, zeroPosts: 1 },
    }));
  });

  it("publishes no share at all from a handful of profiles", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    const thin = AUDIENCE_SAMPLE_MIN - 1;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      page(rows(thin, () => ({ statusesCount: 0 }))),
    ));

    const scan = await notableFollowers("@subject", { followerCount: 200 });

    // The counts are still facts and still returned; what is withheld is the
    // percentage, which at this sample size would be invented precision.
    expect(scan.audience?.profilesExamined).toBe(thin);
    expect(scan.audience?.posts.zeroPosts).toBe(thin);
    const sentence = describeAudienceSample(scan.audience);
    expect(sentence).toContain("too thin to describe an audience shape");
    expect(sentence).not.toContain("%");
  });

  it("names a dimension the provider under-answered instead of sharing it out of the whole sample", () => {
    const tally = newAudienceTally();
    for (let index = 0; index < 60; index++) {
      // Every row answers posts; only the first ten carry follow counts.
      tallyAudienceRow(tally, index < 10
        ? row(index, { statusesCount: 0 })
        : { userName: `follower${index}`, statusesCount: 0 });
    }

    const sentence = describeAudienceSample(sealAudienceSample(tally, true));

    expect(sentence).toContain("60 of 60 (100%)");
    expect(sentence).toContain("follow counts");
    expect(sentence).toContain("stay unmeasured");
    expect(sentence).not.toContain("10 of 60");
  });

  it("marks an interrupted pass a floor rather than the audience", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(page(rows(60), { has_next_page: true, next_cursor: "next-page" }))
      .mockResolvedValueOnce(json({ status: "failed", message: "followers lookup failed" })));

    const scan = await notableFollowers("@subject", { followerCount: 2_000 });

    expect(scan.coverage).toBe("partial");
    expect(scan.audience?.sampleIsComplete).toBe(false);
    const sentence = describeAudienceSample(scan.audience);
    expect(sentence).toContain(
      "60 follower profiles, a floor: pagination stopped before the follower list ran out",
    );
    // The provider pages newest first, so an interrupted read skews to the
    // newest accounts. That skew has to be said, not just implied by "floor".
    expect(sentence).toContain("most recently gained followers rather than a random draw");
  });

  it("reports no audience read on the reverse-check path, which downloads no profile", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ status: "success", data: { following: true } })));

    const scan = await notableFollowers("@subject", {
      followerCount: Number.POSITIVE_INFINITY,
      budgetMs: 1_000,
    });

    expect(scan.list.length).toBeGreaterThan(0);
    expect(scan.audience).toBeUndefined();
    expect(describeAudienceSample(scan.audience)).toBe(
      "No follower profiles were read on this path, so audience shape is not measured.",
    );
  });

  it("emits the distribution as a neutral observation and labels no account", async () => {
    vi.stubEnv("TWITTERAPI_KEY", "twitter-test-key");
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/twitter/user/followers")) {
        return page(rows(60, (index) => (index < 45
          ? {
            statusesCount: 0,
            description: "",
            profilePicture: "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
            followers: 2,
            following: 900,
          }
          : {})));
      }
      return json({ data: { tweets: [] } });
    }));

    const evidence = emptyEvidence("@subject");
    evidence.profile.followers = "60";
    evidence.profile.avatar_source_state = "resolved";
    evidence.recentActivity = ["already collected upstream"];
    const steps: Parameters<CollectContext["emit"]>[0][] = [];
    await xAdapter.run({ handle: "@subject", evidence, emit: (step) => steps.push(step) });

    const shape = steps.find((step) => step.label === "Audience shape");
    expect(shape).toBeDefined();
    expect(shape?.tone).toBe("neutral"); // a distribution is never a verdict
    expect(shape?.detail).toContain("45 of 60 (75%) had never posted");
    expect(shape?.detail).toContain("never proof that a follower was bought");
    // The sentence may say a shape is not proof a follower was bought; what it
    // must never do is call the audience one of these.
    expect(shape?.detail).not.toMatch(/\b(?:bots?|fake|farmed|inauthentic|purchased)\b/i);
  });
});
