// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GithubAssessment } from "../../data/evidence";
import type { SocialActivitySnapshot } from "../../data/socialActivity";
import { KyleGithubSynthesis } from "./KyleGithubSynthesis";
import { KyleSocialSynthesis } from "./KyleSocialSynthesis";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const social: SocialActivitySnapshot = {
  schemaVersion: 1,
  provider: "x-api-v2",
  state: "complete",
  capturedAt: "2026-08-26T12:00:00.000Z",
  sourceUrl: "https://x.com/search?q=fedi",
  queryBasis: { handle: "@fedibtc", projectName: "Fedi", query: "@fedibtc -is:retweet", excludesReposts: true },
  windows: {
    last24Hours: { start: "2026-08-25T12:00:00.000Z", end: "2026-08-26T12:00:00.000Z", postCount: 8, uniqueAccounts: 3, inspectedPosts: 8, authorCoverageComplete: true },
    previous24Hours: { start: "2026-08-24T12:00:00.000Z", end: "2026-08-25T12:00:00.000Z", postCount: 11, uniqueAccounts: 4, inspectedPosts: 11, authorCoverageComplete: true },
    last7Days: { start: "2026-08-19T12:00:00.000Z", end: "2026-08-26T12:00:00.000Z", postCount: 32, uniqueAccounts: 14, inspectedPosts: 32, authorCoverageComplete: true },
  },
  hourlyPostCounts: [],
  top10AccountSharePct: 72,
  activeDays: 5,
  activityScore: 24,
  scoreVersion: "social-activity-v1",
  collection: { countsRequestCompleted: true, searchRequests: 1, postReads: 32, maxPosts: 100, estimatedUsd: 0.1 },
  note: "Saved X search.",
  mentioners: [
    { postId: "1", handle: "@builder", text: "The Fedi wallet shipped a new privacy feature for community custody.", tweetUrl: "https://x.com/builder/status/1", createdAt: "2026-08-26T10:00:00.000Z", followers: 1200 },
    { postId: "2", handle: "@trader", text: "$FEDI could moon after this airdrop.", tweetUrl: "https://x.com/trader/status/2", createdAt: "2026-08-26T09:00:00.000Z", followers: 300 },
  ],
};

describe("Kyle report synthesis layers", () => {
  it("interprets social activity without inventing a sentiment score", () => {
    act(() => root.render(<KyleSocialSynthesis snapshot={social} />));
    expect(container.textContent).toContain("What the conversation actually says");
    expect(container.textContent).toContain("Highly concentrated");
    expect(container.textContent).toContain("Wallet & custody");
    expect(container.textContent).toContain("The Fedi wallet shipped a new privacy feature");
    expect(container.textContent).toContain("Sentiment is not scored here");
  });

  it("puts a GitHub conclusion ahead of repository facts", () => {
    const assessment: GithubAssessment = {
      login: "fedibtc",
      confidence: "gold",
      publicRepos: 12,
      originalCount: 9,
      forkCount: 3,
      forkRatio: 0.25,
      totalStarsOnOriginals: 64,
      topLanguages: [{ language: "Rust", repos: 5 }],
      notableRepos: [],
      daysSinceActivity: 12,
      claimChecks: [],
      summary: "Recent original work is visible.",
    };
    act(() => root.render(<KyleGithubSynthesis assessment={assessment} />));
    expect(container.textContent).toContain("Actively maintained, modest external validation");
    expect(container.textContent).toContain("75% original");
    expect(container.textContent).toContain("Verified identity link");
  });
});
