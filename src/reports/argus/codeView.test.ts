import { describe, expect, it } from "vitest";
import { buildCodeView } from "./codeView";
import type { ShippingSummary, ShippingSummaryCommitter } from "../../threat/shipping";
import type { PersonCardView } from "./view";

function person(over: Partial<PersonCardView> = {}): PersonCardView {
  return {
    key: "p1",
    name: "Dana Reed",
    role: "Chief technology officer",
    badge: { label: "Role recorded", tone: "neutral" },
    text: "Named on the project website.",
    contacts: { x: { label: "@danareed", url: "https://x.com/danareed" } },
    sourceLabel: "website",
    ...over,
  } as PersonCardView;
}

function committer(over: Partial<ShippingSummaryCommitter> = {}): ShippingSummaryCommitter {
  return { name: "Dana Reed", login: "danareed", commits: 40, sharePct: 80, kind: "human", freshAccount: false, last30: 10, prior60: 30, ...over };
}

function summary(over: Partial<ShippingSummary> = {}): ShippingSummary {
  return {
    version: 1,
    target: "example-org",
    capturedAt: "2026-09-01T00:00:00.000Z",
    windowDays: 90,
    grade: "shipping-solo",
    headline: "Shipping, one builder",
    cadenceStatus: "shipping",
    totalCommits: 50,
    activeWeeks: 9,
    distinctHuman: 1,
    concentration: "single-author",
    authorship: "mixed",
    origin: "original",
    stars: "insufficient",
    market: "insufficient",
    claimsSupported: 0,
    claimsUnsupported: 0,
    live: "unknown",
    adoption: "unknown",
    health: "unknown",
    leadDeparted: false,
    reposRead: 2,
    commitsRead: 50,
    releasesInWindow: 1,
    ...over,
  };
}

const area = (view: ReturnType<typeof buildCodeView>, id: string) => view.areas.find((entry) => entry.id === id);

describe("buildCodeView", () => {
  it("matches a committer to a named person by GitHub account", () => {
    const view = buildCodeView({
      shipping: summary({ committers: [committer({ login: "danareed" })] }),
      people: [person({ developerProfiles: [{ label: "GitHub", url: "https://github.com/DanaReed" }] })],
    });
    expect(view.committers[0].match.label).toBe("Named in this report");
    expect(view.committers[0].match.personKey).toBe("p1");
  });

  it("matches by X account when the GitHub account is not on the roster", () => {
    const view = buildCodeView({
      shipping: summary({ committers: [committer({ login: "dr-builds", twitter: "@DanaReed" })] }),
      people: [person()],
    });
    expect(view.committers[0].match.label).toBe("Named in this report");
  });

  it("treats a bare name match as weaker than an account match", () => {
    const view = buildCodeView({
      shipping: summary({ committers: [committer({ login: "someone-else", twitter: undefined })] }),
      people: [person({ contacts: {} as PersonCardView["contacts"] })],
    });
    expect(view.committers[0].match.label).toBe("Same name as a named person");
    expect(view.committers[0].match.tone).toBe("amber");
  });

  it("does not read an unmatched committer as unnamed when the report publishes no roster", () => {
    const view = buildCodeView({ shipping: summary({ committers: [committer()] }), people: [] });
    expect(view.committers[0].match.label).toBe("No roster to match");
    expect(view.committers[0].match.tone).toBe("neutral");
    expect(area(view, "committers")?.next).toContain("This report names no team");
  });

  it("flags a committer nobody in the report names", () => {
    const view = buildCodeView({
      shipping: summary({ committers: [committer({ name: "ghost", login: "ghost", freshAccount: true })] }),
      people: [person()],
    });
    expect(view.committers[0].match.label).toBe("Not in this report");
    expect(view.committers[0].match.detail).toContain("created inside the read window");
  });

  it("never counts a bot or a mirror account as a person", () => {
    const view = buildCodeView({
      shipping: summary({ committers: [committer({ name: "renovate[bot]", kind: "bot" }), committer({ name: "sync", kind: "mirror" })] }),
      people: [person()],
    });
    expect(view.committers[0].match.label).toBe("Automation");
    expect(view.committers[1].match.label).toBe("Mirror account");
  });

  it("marks a committer who stopped in the last 30 days", () => {
    const view = buildCodeView({ shipping: summary({ committers: [committer({ last30: 0, prior60: 24 })] }), people: [] });
    expect(view.committers[0].quiet).toBe(true);
  });

  it("reads an unlicensed repository as not open source", () => {
    const view = buildCodeView({ shipping: summary({ license: "none" }), people: [] });
    expect(area(view, "open-source")?.badge.label).toBe("Not open source");
    expect(area(view, "open-source")?.answer).toContain("closed source in effect");
  });

  it("calls a permissive licence open source", () => {
    const view = buildCodeView({ shipping: summary({ license: "permissive", licenseId: "MIT" }), people: [] });
    expect(area(view, "open-source")?.badge.label).toBe("Open source");
  });

  it("says a suspect star pattern is what buying looks like, with the timing", () => {
    const view = buildCodeView({ shipping: summary({ stars: "suspect", starsTotal: 900, starBurstSharePct: 64 }), people: [] });
    const stars = area(view, "stars");
    expect(stars?.badge.tone).toBe("red");
    expect(stars?.detail).toContain("64%");
  });

  it("does not read no stars as a finding against the project", () => {
    const view = buildCodeView({ shipping: summary({ stars: "none" }), people: [] });
    expect(area(view, "stars")?.answer).toContain("not a finding against the project");
  });

  it("separates outside use from attention", () => {
    const view = buildCodeView({ shipping: summary({ adoption: "unused", externalPrs: 0, activeForks: 0 }), people: [] });
    expect(area(view, "adoption")?.badge.label).toBe("No outside use");
    expect(area(view, "adoption")?.next).toContain("revenue is not published");
  });

  it("reports machine-heavy authorship without calling assistance a finding", () => {
    const view = buildCodeView({ shipping: summary({ authorship: "machine-heavy", aiTrailerCount: 120 }), people: [] });
    const authorship = area(view, "authorship");
    expect(authorship?.badge.label).toBe("Machine-heavy");
    expect(authorship?.next).toContain("Assistant use is not itself a finding");
  });

  it("keeps peer and cohort positions out when the read never took them", () => {
    expect(area(buildCodeView({ shipping: summary(), people: [] }), "peers")).toBeUndefined();
    const compared = buildCodeView({ shipping: summary({ peerSector: "DEX infrastructure", peerPositionCommits: "below", cohortLabel: "Base tokens at a similar stage", cohortSize: 7 }), people: [] });
    expect(area(compared, "peers")?.answer).toContain("DEX infrastructure");
    expect(area(compared, "peers")?.answer).toContain("7 projects");
  });

  it("warns when nobody writing the code is named in the report", () => {
    const view = buildCodeView({ shipping: summary({ committers: [committer({ name: "ghost", login: "ghost" })] }), people: [person()] });
    expect(area(view, "committers")?.next).toContain("Nobody writing this code is named");
  });

  it("carries no development read, and says why, when the scan saved none", () => {
    const view = buildCodeView({ shipping: null, people: [], absentReason: "The GitHub lane was unavailable." });
    expect(view.read).toBeNull();
    expect(view.areas).toHaveLength(0);
    expect(view.absentReason).toBe("The GitHub lane was unavailable.");
  });

  it("reports no code footprint only when there is no account either", () => {
    expect(buildCodeView({ shipping: null, people: [] }).noCodeFootprint).toBe(true);
    const withAccount = buildCodeView({
      shipping: null,
      people: [],
      github: { login: "example-org", confidence: "gold", publicRepos: 3, originalCount: 3, forkCount: 0, forkRatio: 0, totalStarsOnOriginals: 12, topLanguages: [], notableRepos: [], claimChecks: [], summary: "3 original repos." },
    });
    expect(withAccount.noCodeFootprint).toBe(false);
    expect(withAccount.account?.login).toBe("example-org");
  });

  it("keeps the read's own coverage notes verbatim", () => {
    const view = buildCodeView({ shipping: summary({ coverageNotes: ["Stargazer lists are admin-only."], reposTotal: 9 }), people: [] });
    expect(view.coverage).toEqual(["Stargazer lists are admin-only."]);
    expect(view.coverageLine).toContain("2 of 9 repositories read");
  });
});
