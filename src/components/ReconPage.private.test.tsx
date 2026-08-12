// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Recon } from "../collect/recon";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ livePanel: vi.fn() }));

vi.mock("./ScoreTicker", () => ({ ScoreTicker: () => null }));
vi.mock("./ProjectResearch", () => ({ ProjectResearch: () => { harness.livePanel("project-research"); return null; } }));
vi.mock("./ProjectXAccount", () => ({ ProjectXAccount: () => { harness.livePanel("project-x"); return null; } }));
vi.mock("./SiteInfra", () => ({ SiteInfra: () => { harness.livePanel("site-infra"); return null; } }));
vi.mock("./SiteHistory", () => ({ SiteHistory: () => { harness.livePanel("site-history"); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));

import { ReconPage, reconTeamPresentation } from "./ReconPage";

const recon: Recon = {
  retrieval: {
    url: "https://private-project.example/",
    status: "rendered",
    content: "Private Project is a research protocol.",
    title: "Private Project",
    stages: [],
    coverageNote: "Page retrieved directly.",
  },
  title: "Private Project",
  team: { state: "absent", names: [], note: "No team section found." },
  socials: [{ label: "x.com", url: "https://x.com/privateproject" }],
  funding: [],
  tokenSignals: [],
  findings: [],
  identityLine: "No team section on the rendered site.",
  isFund: false,
  verdict: {
    verdict: "CAUTION",
    score: 58,
    reasons: [],
    hype: { fabricatedMetrics: [], giantTam: null, guaranteed: [], buzzwords: 0 },
    capApplied: null,
  },
};

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  harness.livePanel.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("private site recon evidence boundary", () => {
  it("does not mount any subject-specific supplemental panel", () => {
    act(() => {
      root.render(<ReconPage initialRecon={recon} initialPrivate />);
    });

    expect(container.textContent).toContain("Extra live checks are off");
    expect(container.textContent).toContain("nothing is added to shared cases");
    expect(harness.livePanel).not.toHaveBeenCalled();
  });

  it("keeps site names separate from supplemental candidates and associations", () => {
    const presentation = reconTeamPresentation(["Ada Site"], {
      available: true,
      attempted: true,
      completed: true,
      partial: false,
      providerFailed: false,
      people: [
        {
          name: "Mira Model",
          role: "Founder",
          provider: "grok",
          evidence_origin: "model_lead",
          artifact_verified: false,
          evidenceKind: "model_candidate",
        },
        {
          name: "Tess Tagged",
          role: "follows + tags",
          provider: "twitterapi",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "project_association",
        },
        {
          name: "Gina Contributor",
          role: "github contributor",
          provider: "github",
          evidence_origin: "deterministic",
          artifact_verified: true,
          evidenceKind: "code_contribution",
        },
      ],
    });

    expect(presentation.sitePeople).toEqual(["Ada Site"]);
    expect(presentation.supplementalLeads.map((person) => person.name)).toEqual([
      "Mira Model",
      "Tess Tagged",
      "Gina Contributor",
    ]);
    expect(presentation.discoveryCopy).toContain("not verified employment");
  });

  it("renders failed supplemental discovery as unknown instead of a negative", () => {
    const presentation = reconTeamPresentation([], {
      available: true,
      attempted: true,
      completed: false,
      partial: false,
      providerFailed: true,
      people: [],
    });

    expect(presentation.discoveryCopy).toContain("did not complete");
    expect(presentation.discoveryCopy).toContain("remain unknown");
    expect(presentation.discoveryCopy).not.toMatch(/did not find|no team/i);
  });
});
