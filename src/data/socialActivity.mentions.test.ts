import { describe, expect, it } from "vitest";
import { selectSocialAdverseMentions, selectSocialMentioners, type SocialActivityMentionCandidate } from "./socialActivity";

const post = (row: Partial<SocialActivityMentionCandidate> & Pick<SocialActivityMentionCandidate, "id" | "authorId" | "createdAt" | "handle" | "text">): SocialActivityMentionCandidate => row;

describe("selectSocialMentioners", () => {
  it("ranks by provider followers, excludes the subject, and never invents a count", () => {
    const mentioners = selectSocialMentioners([
      post({
        id: "1",
        authorId: "big",
        createdAt: "2026-08-22T20:00:00.000Z",
        handle: "whale",
        text: "Watching $CLUTCH",
        followers: 900_000,
      }),
      post({
        id: "2",
        authorId: "mid",
        createdAt: "2026-08-22T21:00:00.000Z",
        handle: "midsize",
        text: "Clutch Markets looks busy",
        followers: 12_400,
      }),
      post({
        id: "3",
        authorId: "self",
        createdAt: "2026-08-22T22:00:00.000Z",
        handle: "clutch",
        text: "Our own announcement",
        followers: 2_000_000,
      }),
      post({
        id: "4",
        authorId: "unknown",
        createdAt: "2026-08-22T19:00:00.000Z",
        handle: "quiet",
        text: "mentioned @clutch",
      }),
    ], "@clutch");

    expect(mentioners.map((row) => row.handle)).toEqual(["@whale", "@midsize", "@quiet"]);
    expect(mentioners[0].followers).toBe(900_000);
    expect(mentioners[2].followers).toBeUndefined();
    expect(mentioners.every((row) => row.tweetUrl.includes("/status/"))).toBe(true);
  });

  it("keeps one card per account and only uses posts already in this collected set", () => {
    const mentioners = selectSocialMentioners([
      post({
        id: "old",
        authorId: "a",
        createdAt: "2026-08-21T20:00:00.000Z",
        handle: "alice",
        text: "first mention",
        followers: 50,
      }),
      post({
        id: "new",
        authorId: "a",
        createdAt: "2026-08-22T20:00:00.000Z",
        handle: "alice",
        text: "later mention",
        followers: 50,
      }),
    ], "@clutch");

    expect(mentioners).toHaveLength(1);
    expect(mentioners[0]).toMatchObject({ postId: "new", text: "later mention" });
  });

  it("drops cards that lack a handle, text, or usable tweet link", () => {
    expect(selectSocialMentioners([
      post({ id: "no-handle", authorId: "123", createdAt: "2026-08-22T20:00:00.000Z", handle: "", text: "hello" }),
      post({ id: "blank", authorId: "b", createdAt: "2026-08-22T20:00:00.000Z", handle: "bob", text: "   " }),
    ], "@clutch")).toEqual([]);
  });
});

describe("selectSocialAdverseMentions negation scoping (ARGUS-16)", () => {
  const candidate = (id: string, text: string): SocialActivityMentionCandidate =>
    ({ id, authorId: `a${id}`, createdAt: "2026-09-03T05:00:00.000Z", handle: `watcher${id}`, text, tweetUrl: `https://x.com/watcher${id}/status/${id}` });

  it("does not convert a denial into the allegation it denies", () => {
    const mentions = selectSocialAdverseMentions(
      [candidate("1", "Checked the chart: no bundle here, supply looks clean.")],
      "@subject",
    );
    expect(mentions).toEqual([]);
  });

  it("keeps a real allegation, and keeps the unnegated half of a mixed post", () => {
    const mentions = selectSocialAdverseMentions(
      [
        candidate("2", "This looks like a bundle, same deployer as the last one."),
        candidate("3", "No bundle, but the deployer sold into the launch."),
      ],
      "@subject",
    );
    expect(mentions.map((mention) => mention.postId).sort()).toEqual(["2", "3"]);
    expect(mentions.find((mention) => mention.postId === "3")?.signals).toContain("deployer claim");
    expect(mentions.find((mention) => mention.postId === "3")?.signals).not.toContain("wallet bundling claim");
  });
});
