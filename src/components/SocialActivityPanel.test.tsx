// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SocialActivitySnapshot } from "../data/socialActivity";

vi.mock("./PfpCheck", () => ({
  PfpCheck: () => null,
  PfpAvatar: ({ handle }: { handle?: string }) => <span>{handle ? `avatar:${handle}` : "avatar"}</span>,
}));

import { SocialActivityPanel } from "./SocialActivityPanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const snapshot: SocialActivitySnapshot = {
  schemaVersion: 1,
  provider: "x-api-v2",
  state: "complete",
  capturedAt: "2026-08-22T21:40:00.000Z",
  sourceUrl: "https://x.com/search?q=clutch",
  queryBasis: { handle: "@clutch", ticker: "$CLUTCH", projectName: "Clutch", query: "(@clutch OR $CLUTCH) -is:retweet", excludesReposts: true },
  windows: {
    last24Hours: { start: "2026-08-21T21:39:30.000Z", end: "2026-08-22T21:39:30.000Z", postCount: 712, uniqueAccounts: 238, inspectedPosts: 712, authorCoverageComplete: true },
    previous24Hours: { start: "2026-08-20T21:39:30.000Z", end: "2026-08-21T21:39:30.000Z", postCount: 501, uniqueAccounts: 168, inspectedPosts: 501, authorCoverageComplete: true },
    last7Days: { start: "2026-08-15T21:39:30.000Z", end: "2026-08-22T21:39:30.000Z", postCount: 3912, uniqueAccounts: 1284, inspectedPosts: 3912, authorCoverageComplete: true },
  },
  hourlyPostCounts: [
    { start: "2026-08-21T22:00:00.000Z", end: "2026-08-21T23:00:00.000Z", postCount: 20 },
    { start: "2026-08-22T20:00:00.000Z", end: "2026-08-22T21:00:00.000Z", postCount: 48 },
  ],
  top10AccountSharePct: 18,
  activeDays: 7,
  activityScore: 78,
  scoreVersion: "social-activity-v1",
  collection: { countsRequestCompleted: true, searchRequests: 4, postReads: 3912, maxPosts: 5000, estimatedUsd: 19.565 },
  note: "Public X posts matched to the bound project identifiers. Reposts are excluded.",
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("SocialActivityPanel", () => {
  it("leads with unique accounts and explains that the score is not a safety score", () => {
    act(() => root.render(<SocialActivityPanel snapshot={snapshot} />));
    expect(container.textContent).toContain("238");
    expect(container.textContent).toContain("unique accounts talked about Clutch in the last 24 hours");
    expect(container.textContent).toContain("Measures conversation activity, not project quality or safety.");
    expect(container.textContent).toContain("+42%");
    expect(container.textContent).toContain("matched to this project's @clutch and $CLUTCH");
    expect(container.textContent).toContain("Matches use this project's @clutch and $CLUTCH saved with this report.");
    expect(container.textContent).not.toMatch(/bound identifiers|bound project identifiers/i);
  });

  it("switches to the seven-day breadth without changing the saved evidence", () => {
    act(() => root.render(<SocialActivityPanel snapshot={snapshot} />));
    const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === "7 days");
    expect(button).toBeDefined();
    act(() => button!.click());
    expect(container.textContent).toContain("1,284");
    expect(container.textContent).toContain("over the last 7 days");
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders an honest unavailable state without a zero", () => {
    act(() => root.render(<SocialActivityPanel snapshot={{
      ...snapshot,
      state: "unavailable",
      unavailableReason: "not_configured",
      activityScore: null,
    }} />));
    expect(container.textContent).toContain("Social activity is unavailable");
    expect(container.textContent).toContain("cannot measure the conversation yet");
    expect(container.textContent).not.toContain("0 unique");
  });

  it("does not call a legacy pagination gap a post limit", () => {
    act(() => root.render(<SocialActivityPanel snapshot={{
      ...snapshot,
      state: "partial",
      activityScore: null,
      top10AccountSharePct: null,
      collection: {
        ...snapshot.collection,
        maxPosts: 200,
        postReads: 47,
        countsRequestCompleted: false,
      },
      windows: {
        ...snapshot.windows,
        last7Days: {
          ...snapshot.windows.last7Days,
          postCount: 47,
          uniqueAccounts: 22,
          inspectedPosts: 47,
          authorCoverageComplete: false,
        },
      },
      note: "ARGUS inspected 47 posts before the configured limit. Unique-account counts are minimums.",
    }} />));
    expect(container.textContent).toContain("more matching result pages existed than this saved search collected");
    expect(container.textContent).toContain("At least 47");
    expect(container.textContent).toContain("Emerging observed");
    expect(container.textContent).not.toContain("Withheld");
    expect(container.textContent).not.toContain("before the configured limit");
  });

  it("names the post ceiling only when the collector actually reaches it", () => {
    act(() => root.render(<SocialActivityPanel snapshot={{
      ...snapshot,
      state: "partial",
      activityScore: null,
      collection: {
        ...snapshot.collection,
        maxPosts: 5000,
        postReads: 5000,
        incompleteReason: "post_limit",
      },
    }} />));
    expect(container.textContent).toContain("reached its 5,000-post collection ceiling");
    expect(container.textContent).toContain("High observed");
    expect(container.textContent).not.toContain("activity score stays withheld");
  });

  it("shows an observed activity level without turning a time-bounded search into an error", () => {
    act(() => root.render(<SocialActivityPanel snapshot={{
      ...snapshot,
      state: "partial",
      activityScore: null,
      top10AccountSharePct: null,
      collection: {
        ...snapshot.collection,
        postReads: 80,
        incompleteReason: "time_budget",
      },
      windows: {
        ...snapshot.windows,
        last7Days: { ...snapshot.windows.last7Days, authorCoverageComplete: false },
      },
    }} />));
    expect(container.textContent).toContain("Minimum observed counts");
    expect(container.textContent).toContain("High observed");
    expect(container.textContent).toContain("no safety or project score depends on this social pulse");
    expect(container.textContent).not.toContain("Withheld");
    expect(container.textContent).not.toContain("Not calculated");
    expect(container.textContent).not.toContain("Unknownfrom the 10 most active accounts");
  });

  it("renders report-specific context at the bottom of the social section", () => {
    act(() => root.render(<SocialActivityPanel snapshot={snapshot} afterActivity={<div>Direct accusation context</div>} />));
    expect(container.textContent).toContain("Direct accusation context");
  });

  it("renders mentioner people-cards with follower counts and tweet links, without an influence score", () => {
    act(() => root.render(<SocialActivityPanel snapshot={{
      ...snapshot,
      mentioners: [
        {
          postId: "1",
          handle: "@whale",
          text: "Watching $CLUTCH",
          tweetUrl: "https://x.com/whale/status/1",
          createdAt: "2026-08-22T20:00:00.000Z",
          followers: 880000,
          avatarUrl: "https://pbs.twimg.com/profile_images/1/whale.jpg",
        },
        {
          postId: "2",
          handle: "@quiet",
          text: "mentioned the project",
          tweetUrl: "https://x.com/quiet/status/2",
          createdAt: "2026-08-22T19:00:00.000Z",
        },
      ],
    }} />));
    expect(container.textContent).toContain("Who talked about it");
    expect(container.textContent).toContain("@whale");
    expect(container.textContent).toContain("Watching $CLUTCH");
    expect(container.textContent).toContain("followers");
    expect(container.querySelector('a[href="https://x.com/whale/status/1"]')).not.toBeNull();
    expect(container.textContent).toContain("@quiet");
    expect(container.textContent).toContain("not an influence score");
    expect(container.textContent).toContain("mentioned this project's @clutch and $CLUTCH");
    expect(container.textContent).toContain("Matches use this project's @clutch and $CLUTCH saved with this report.");
    expect(container.textContent).not.toMatch(/influence score:\s*\d/i);
    expect(container.textContent).not.toContain("#1");
    expect(container.textContent).not.toMatch(/bound identifiers|bound project identifiers/i);
  });
});
