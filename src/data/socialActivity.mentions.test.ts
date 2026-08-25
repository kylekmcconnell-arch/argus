import { describe, expect, it } from "vitest";
import { selectSocialMentioners, type SocialActivityMentionCandidate } from "./socialActivity";

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
