// Unique-id gate for Serper LinkedIn/press founder follow-up.
// reverseBioTwitter.team mixes live-bio confirms with tweet-only people;
// only the former may spend Serper. confirmClaimantBios entries are already
// live-bio confirmed and stay on the follow-up map without this helper.
import { describe, expect, it } from "vitest";
import { uniqueIdConfirmedForFounderFollowup } from "./orchestrate";

describe("uniqueIdConfirmedForFounderFollowup", () => {
  it("includes a reverse-bio twitterapi member whose live bio states the role", () => {
    expect(uniqueIdConfirmedForFounderFollowup(
      {
        handle: "@ada",
        evidence: 'their current X bio states "Co-founder @projecthandle"',
      },
      "@projecthandle",
    )).toBe(true);
  });

  it("does not query a tweet-only reverse-bio member", () => {
    expect(uniqueIdConfirmedForFounderFollowup(
      {
        handle: "@bob",
        evidence: 'their current X bio @-mentions @projecthandle and they wrote "we built @projecthandle"',
      },
      "@projecthandle",
    )).toBe(false);
  });

  it("skips the subject handle even with live-bio unique-id evidence", () => {
    expect(uniqueIdConfirmedForFounderFollowup(
      {
        handle: "@projecthandle",
        evidence: 'their current X bio states "Founder"',
      },
      "@projecthandle",
    )).toBe(false);
  });

  it("skips a member with no handle", () => {
    expect(uniqueIdConfirmedForFounderFollowup(
      {
        evidence: 'their current X bio states "Co-founder @projecthandle"',
      },
      "@projecthandle",
    )).toBe(false);
  });
});
