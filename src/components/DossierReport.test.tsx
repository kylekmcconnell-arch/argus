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
  it("renders buildDossier of the live payload, never the dynex fixture", () => {
    render(livePayload());
    expect(container.textContent).toContain("CLUTCH");
    expect(container.textContent).toContain("@clutchmarkets");
    expect(container.textContent).toContain("This is the @clutchmarkets we audited. The site is bound.");
    expect(container.textContent).toContain("The project named 1 founder. Nobody else confirmed them.");
    expect(container.textContent).not.toContain("Handle resolves to the official site.");
    expect(container.textContent).not.toContain("The project account is identified.");
    expect(container.textContent).not.toContain("dynexcoin.org");
    expect(container.textContent).not.toContain("EDGAR CIK 826675");
    expect(container.textContent).not.toContain("Fourteen people. Nine of them proven.");
    expect(container.textContent).not.toContain("Design preview");
    expect(container.textContent).not.toContain("7c51822f");
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

  it("keeps the fixture harness header only in theatrical DEV mode", () => {
    render(livePayload(), true);
    expect(container.textContent).toContain("Design preview · derived from report 7c51822f");
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
      expect(container.textContent).toContain("This is the @clutchmarkets we audited. The site is bound.");
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
});
