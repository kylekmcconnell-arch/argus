// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DossierReport } from "./DossierReport";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function render(payload: Record<string, unknown>, theatrical = false) {
  act(() => {
    root.render(<DossierReport payload={payload} theatrical={theatrical} />);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const livePayload = (): Record<string, unknown> => ({
  handle: "@clutchmarkets",
  display_name: "CLUTCH",
  website: "https://clutch.markets/",
  bio: "Prediction markets.",
  headline: "The project account is identified.",
  report: { composite_verdict: "CAUTION", governing_score: 61, verdict: "CAUTION", score_total: 61 },
  basicFacts: [{
    predicate: "legal_entity",
    value: "Clutch Auto Repair LLC",
    status: "verified",
    sources: [{
      url: "https://www.sec.gov/Archives/edgar/data/1/a.htm",
      excerpt: "Clutch Auto Repair LLC, a Delaware company",
      relation: "supports",
      artifactVerified: true,
      capturedAt: "2026-08-18T12:00:00.000Z",
      sourceClass: "regulatory_or_onchain",
    }],
  }],
  checkRuns: [
    { checkId: "identity-resolution", label: "Identity", status: "confirmed", note: "Handle resolves to the official site." },
    { checkId: "project-team-identity", label: "Team", status: "confirmed", note: "Two people named on the official site." },
    { checkId: "organization-registration", label: "Entity", status: "confirmed" },
  ],
  webTeamLeads: [{
    name: "@firstparty",
    role: "founder",
    handle: "@firstparty",
    handleProvenance: "subject_first_party",
    avatarUrl: "https://pbs.twimg.com/x.jpg",
    linkedin: "linkedin.com/in/first-party",
    developerProfiles: [{
      provider: "github",
      url: "https://github.com/first-party",
      sourceUrl: "https://x.com/firstparty",
    }, {
      provider: "github",
      url: "https://github.com/first-party/",
      sourceUrl: "https://x.com/firstparty",
    }],
  }, {
    name: "Search Only",
    role: "advisor",
    source: "web/LinkedIn search",
    avatarUrl: "https://example.org/someone.jpg",
  }],
  basicFactLeads: [],
  providerFailures: [],
});

describe("DossierReport", () => {
  it("can render only a canonical reading beat and leave sources to the report appendix", () => {
    act(() => {
      root.render(<DossierReport payload={livePayload()} includeBeats={["team"]} includeSources={false} />);
    });

    expect(container.querySelector('[data-beat="team"]')).not.toBeNull();
    expect(container.querySelector('[data-beat="verdict"]')).toBeNull();
    expect(container.querySelector('[data-beat="coverage"]')).toBeNull();
    expect(container.querySelector("#dossier-sources")).toBeNull();
  });

  it("renders buildDossier of the live payload, never the dynex fixture", () => {
    render(livePayload());
    expect(container.textContent).toContain("@clutchmarkets");
    expect(container.textContent).toContain("This is the @clutchmarkets we audited. An official site is on file. ARGUS could not classify it.");
    expect(container.textContent).toContain("The project named 1 founder. Nobody else confirmed them.");
    expect(container.textContent).not.toContain("Handle resolves to the official site.");
    expect(container.textContent).not.toContain("The project account is identified.");
    expect(container.textContent).not.toContain("dynexcoin.org");
    expect(container.textContent).not.toContain("EDGAR CIK 826675");
    expect(container.textContent).not.toContain("Fourteen people. Nine of them proven.");
    expect(container.textContent).not.toContain("Design preview");
    expect(container.textContent).not.toContain("7c51822f");
    expect(container.textContent).not.toMatch(/The site is bound|No official site is bound|data sources responded/i);
  });

  it("counts recorded sources instead of calling zero failed providers a response", () => {
    render(livePayload());
    expect(container.textContent).toContain("recorded source");
    expect(container.textContent).not.toContain("0 data sources responded");
    expect(container.textContent).not.toContain("data sources responded");
    expect(container.textContent).not.toContain("checked-empty");
    expect(container.textContent).not.toContain("P0 · Intake");
  });

  it("names data sources that did not respond without inventing a responded count", () => {
    const payload = livePayload();
    payload.providerFailures = [{ provider: "opensanctions" }, { provider: "github" }];
    payload.checkRuns = [
      ...(payload.checkRuns as Array<Record<string, unknown>>),
      { checkId: "supplemental-search", label: "Supplemental search", status: "checked-empty", note: "A null result on this axis, not adverse evidence." },
    ];
    render(payload);
    expect(container.textContent).toContain("2 data sources did not respond");
    expect(container.textContent).toContain("recorded source");
    expect(container.textContent).toContain("nothing found");
    expect(container.textContent).toContain("no result was recorded in this area");
    expect(container.textContent).not.toContain("0 data sources responded");
    expect(container.textContent).not.toContain("checked-empty");
    expect(container.textContent).not.toMatch(/null result on this axis/i);
  });

  it("renders a role scorecard and typed evidence ledger without a second score", () => {
    const payload = livePayload();
    payload.intelligence = {
      entityScorecards: [{
        id: "entity_scorecard:agency:@clutchmarkets",
        entityKey: "@clutchmarkets",
        role: "agency",
        label: "Agency scorecard",
        governingScoreImpact: "none",
        axes: [{
          id: "identity",
          label: "Agency identity",
          state: "established",
          ledgerRowIds: ["entity_ledger:career:role"],
          measurementRefs: ["role"],
          sourceRefs: ["source:role"],
        }],
      }],
      entityLedger: [{
        id: "entity_ledger:career:role",
        kind: "career",
        entityKey: "@clutchmarkets",
        role: "agency",
        label: "Current role",
        value: "Market operator",
        state: "verified",
        sourceRefs: ["source:role"],
        measurementRefs: ["role"],
        asOf: "2026-08-22T00:00:00.000Z",
        changeCondition: "Recompute when the role changes.",
      }],
    };
    render(payload);
    expect(container.textContent).toContain("Agency scorecard");
    expect(container.textContent).toContain("Evidence coverage for this role");
    expect(container.textContent).toContain("Agency identity");
    expect(container.textContent).toContain("Evidence established · 1 record");
    expect(container.textContent).toContain("Open role evidence · 1");
    expect(container.textContent).not.toContain("Agency score:");
    const open = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Open role evidence"));
    act(() => { open!.click(); });
    expect(container.textContent).toContain("Market operator");
    expect(container.textContent).toContain("career · verified");
  });

  it("derives the perimeter from recorded unbound sources", () => {
    render(livePayload());
    expect(container.textContent).toContain("Sources that do not name this subject");
    expect(container.textContent).toContain("Clutch Auto Repair LLC");
    expect(container.textContent).toContain("sec.gov");
    expect(container.textContent).toContain("none naming this subject");
  });

  it("splits team cards by the collector first-party marker, not by having a face", () => {
    render(livePayload());
    expect(container.textContent).toContain("named by the account itself");
    expect(container.textContent).toContain("web search only");
    expect(container.textContent).toContain("@firstparty");
    expect(container.textContent).toContain("Search Only");
    expect(container.querySelector('img[src="https://example.org/someone.jpg"]')).toBeNull();
    expect(container.querySelector('img[src="https://pbs.twimg.com/x.jpg"]')).not.toBeNull();
  });

  it("links team members to saved identity-bound social profiles without guessing", () => {
    render(livePayload());
    expect(container.querySelector('a[href="https://x.com/firstparty"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://linkedin.com/in/first-party"]')).not.toBeNull();
    expect(container.querySelectorAll('a[href="https://github.com/first-party"]')).toHaveLength(1);
    expect(container.querySelector('a[aria-label="Open @firstparty on X"]')).not.toBeNull();
    expect(container.querySelector('a[href*="Search%20Only"]')).toBeNull();
  });

  it("hides malformed, company-level, and unbound team profile URLs", () => {
    const payload = livePayload();
    payload.webTeamLeads = [{
      name: "Unsafe Link",
      role: "founder",
      linkedin: "javascript:alert(1)",
      developerProfiles: [{ provider: "github", url: "https://example.com/not-github", sourceUrl: "https://example.com" }],
    }, {
      name: "Company Page",
      role: "advisor",
      linkedin: "https://linkedin.com/company/not-a-person",
    }];
    render(payload);
    expect(container.querySelectorAll("#dossier-team a")).toHaveLength(0);
  });

  it("keeps the fixture harness header only in theatrical DEV mode", () => {
    render(livePayload(), true);
    expect(container.textContent).toContain("Design preview · derived from report 7c51822f");
  });

  it("keeps coverage copy aligned with open questions and strips ledger jargon", () => {
    const payload = livePayload();
    payload.intelligence = {
      signals: [{
        kind: "coverage_gap",
        finding: "The final integrity gate recorded 2 fail-closed integrity events. Counts include duplicate source IDs and rejected archetype evidence.",
      }, {
        kind: "observation",
        finding: "Price sits -39.7410894525038% below the reported high.",
      }],
      measurements: [{
        label: "Registry-reported drawdown from lifetime high",
        value: -39.7410894525038,
        unit: "percent",
        domain: "market",
      }],
      lenses: [{
        id: "investment",
        label: "Investment",
        question: "What supports a decision?",
        signalIds: ["drawdown"],
      }],
    };
    (payload.intelligence as { signals: Array<Record<string, unknown>> }).signals[1]!.id = "drawdown";
    payload.researchPlan = {
      tasks: [
        { capability: "people_and_control", state: "unavailable", question: "Who operates and controls the project?" },
        { capability: "analyst_synthesis", state: "partial", question: "What conclusion follows?" },
      ],
    };

    render(payload);

    const coverageHeading = container.querySelector("#dossier-coverage h2")?.textContent ?? "";
    expect(coverageHeading).toMatch(/\d+ research questions? still need evidence/);
    expect(coverageHeading).not.toContain("No research questions still need evidence");
    expect(container.textContent).not.toMatch(/fail-closed|integrity gate|duplicate source IDs|rejected archetype|-39\.7410894525038/i);
    const measureToggle = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("Every measurement"));
    expect(measureToggle).toBeTruthy();
    act(() => { measureToggle!.click(); });
    expect(container.textContent).toContain("-39.7%");
    expect(container.textContent).not.toContain("-39.7410894525038");
    const rabbit = [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("rabbit hole"));
    expect(rabbit?.textContent).toMatch(/Go down this rabbit hole · \d+/);
    const count = Number(/(\d+)/.exec(rabbit?.textContent ?? "")?.[1] ?? 0);
    expect(coverageHeading).toContain(String(count));
  });

  it("uses the full-width report canvas without a duplicate pinned file in live reports", () => {
    render(livePayload());
    expect(container.querySelector('[data-dossier-layout="full-width"]')).not.toBeNull();
    expect(container.querySelector(".dossier-pinned")).toBeNull();
    expect(container.textContent).not.toContain("The file");
    expect(container.querySelector("#dossier-subject h2")?.className).toContain("story-chapter-title");
    expect(container.textContent).toContain("Sources behind this section");
    expect(container.textContent).toContain("How ARGUS knows");
  });

  it("retains Enigma's split-story rail in the explicit theatrical preview", () => {
    render(livePayload(), true);
    expect(container.querySelector('[data-dossier-layout="split-story"]')).not.toBeNull();
    expect(container.querySelector(".dossier-pinned")).not.toBeNull();
    expect(container.textContent).toContain("The file");
  });

  it("renders immediately under reduced motion without IntersectionObserver", () => {
    const io = vi.fn();
    const previousIO = window.IntersectionObserver;
    const previousMatch = window.matchMedia;
    Object.defineProperty(window, "IntersectionObserver", { configurable: true, writable: true, value: io });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: String(query).includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }),
    });
    try {
      render(livePayload());
      expect(io).not.toHaveBeenCalled();
      expect(container.querySelectorAll("[data-settled=\"false\"]")).toHaveLength(0);
      expect(container.querySelectorAll("[data-settled=\"true\"]").length).toBeGreaterThan(0);
      expect(container.textContent).toContain("This is the @clutchmarkets we audited. An official site is on file. ARGUS could not classify it.");
      expect(container.textContent).toContain("Unestablished");
    } finally {
      Object.defineProperty(window, "IntersectionObserver", { configurable: true, writable: true, value: previousIO });
      Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: previousMatch });
    }
  });

  it("colors dossier figures by provenance tier and keeps locked off the ramp", () => {
    render(livePayload());
    const entity = [...container.querySelectorAll("button")].find((el) => el.textContent === "Clutch Auto Repair LLC");
    expect(entity?.className).toContain("text-unverifiable");
    expect(container.textContent).toContain("Unestablished");
    expect(container.textContent).not.toContain("Not run");
  });

  it("renders a sources table after the beats and expands to the cited labels", () => {
    render({
      handle: "@alice",
      display_name: "Alice",
      website: "https://alice.example/",
      report: { verdict: "PASS", score_total: 70 },
      basicFacts: [
        {
          predicate: "product", value: "Alice Market", status: "verified",
          sources: [{
            url: "https://alice.example/docs",
            excerpt: "Alice Market on alice.example",
            relation: "supports", artifactVerified: true,
            capturedAt: "2026-08-18T12:00:00.000Z", sourceClass: "first_party",
          }],
        },
        {
          predicate: "repository", value: "github.com/alice", status: "verified",
          sources: [{
            url: "https://alice.example/docs#repo",
            excerpt: "Repository on the same document",
            relation: "supports", artifactVerified: true,
            capturedAt: "2026-08-18T13:00:00.000Z", sourceClass: "first_party",
          }],
        },
        {
          predicate: "traction", value: "posts daily", status: "verified",
          sources: [{
            url: "https://x.com/alice/status/1",
            excerpt: "@alice posts daily",
            relation: "supports", artifactVerified: true,
            capturedAt: "2026-08-18T11:00:00.000Z", sourceClass: "social",
          }],
        },
      ],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    expect(container.querySelector("#dossier-sources")).not.toBeNull();
    expect(container.textContent).toContain("2 recorded sources. 3 facts cited.");
    expect(container.textContent).toContain("alice.example · first_party");
    expect(container.textContent).toContain("2 facts");
    expect(container.textContent).toContain("x.com · social");
    expect(container.textContent).toContain("1 fact");
    expect(container.textContent).toContain("13:00:00");
    const row = [...container.querySelectorAll("button")].find((el) => el.textContent?.includes("alice.example · first_party"));
    expect(row).toBeTruthy();
    act(() => { row!.click(); });
    expect(container.textContent).toContain("product");
    expect(container.textContent).toContain("repository");
    const outbound = container.querySelector('a[href="https://alice.example/docs#repo"]')
      ?? container.querySelector('a[href="https://alice.example/docs"]');
    expect(outbound).not.toBeNull();
    expect(outbound?.className).toContain("link-ext");
  });

  it("makes the stored receipt URL a real link in the figure drawer", () => {
    render(livePayload());
    const entity = [...container.querySelectorAll("button")].find((el) => el.textContent === "Clutch Auto Repair LLC");
    expect(entity).toBeTruthy();
    act(() => { entity!.click(); });
    const link = container.querySelector('a[href="https://www.sec.gov/Archives/edgar/data/1/a.htm"]');
    expect(link).not.toBeNull();
    expect(link?.className).toContain("link-ext");
    expect(link?.textContent).toContain("sec.gov");
    expect(container.textContent).toContain("Fetched");
    expect(container.textContent).toContain("Tied to this project");
    expect(container.textContent).toContain("never");
    expect(container.textContent).not.toContain("Accepted by a person");
    expect(container.textContent).not.toContain("Artifact verified");
  });

  it("keeps unbound aggregator funding off the sources table", () => {
    render({
      handle: "@satoshi_builds",
      display_name: "Uniswap",
      website: null,
      report: { verdict: "PASS", score_total: 80 },
      basicFacts: [{
        predicate: "funding",
        value: "2 public funding rounds · $11.0M raised · led by BlackRock",
        status: "verified",
        providerProjection: true,
        sources: [{
          url: "https://defillama.com/protocol/uniswap",
          excerpt: "Uniswap raised $11.0M across 2 public funding rounds, led by BlackRock.",
          provider: "defillama",
          relation: "supports", sourceClass: "other_public", artifactVerified: true,
          capturedAt: "2026-07-23T19:43:00.102Z",
        }],
      }],
      checkRuns: [], basicFactLeads: [], providerFailures: [],
    });
    expect(container.textContent).not.toContain("BlackRock");
    expect(container.textContent).not.toContain("led by");
    expect(container.querySelector("#dossier-sources")).toBeNull();
  });
});
