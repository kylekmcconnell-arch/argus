// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ livePanel: vi.fn() }));

vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./RingAlert", () => ({ RingAlert: () => { harness.livePanel("ring-alert"); return null; } }));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => { harness.livePanel("sanctions"); return null; } }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => { harness.livePanel("legal"); return null; } }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => { harness.livePanel("pfp"); return null; } }));
vi.mock("./PersonGithub", () => ({ PersonGithub: (props: Record<string, unknown>) => { harness.livePanel("person-github", props); return null; } }));
vi.mock("./VcReport", () => ({ VcReport: () => { harness.livePanel("vc"); return null; } }));
vi.mock("./KolReport", () => ({ KolReport: () => { harness.livePanel("kol"); return null; } }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: () => { harness.livePanel("project-intel"); return null; } }));
vi.mock("./NewsSection", () => ({ NewsSection: () => { harness.livePanel("news"); return null; } }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: (props: Record<string, unknown>) => { harness.livePanel("identity-sweep", props); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div>service-ready</div> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./AskReport", () => ({ AskReport: () => null }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

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

describe("private person report evidence boundary", () => {
  it("does not mount subject-specific supplemental panels", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      persistence: { state: "private" as const },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("supplemental panels are paused");
    expect(container.textContent).toContain("avoid shared cache traces");
    expect(harness.livePanel).not.toHaveBeenCalled();
  });

  it("threads the saved report capability through GitHub and identity panels", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      persistence: {
        state: "persisted" as const,
        reportVersionId: "00000000-0000-4000-8000-000000000201",
        panelCostToken: "signed-panel-capability",
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    for (const panel of ["person-github", "identity-sweep"]) {
      expect(harness.livePanel.mock.calls.find(([name]) => name === panel)?.[1]).toEqual(
        expect.objectContaining({ panelCostToken: "signed-panel-capability" }),
      );
    }
  });

  it("does not repeat frozen news, legal, and sanctions calls after a fresh saved audit", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      checkRuns: [
        { checkId: "news-press", label: "News & press", status: "checked-empty" as const },
        { checkId: "us-legal-history", label: "US legal history", status: "checked-empty" as const },
        { checkId: "ofac-sanctions-name", label: "OFAC sanctions (name)", status: "checked-empty" as const },
      ],
      completeness_state: "partial" as const,
      persistence: {
        state: "persisted" as const,
        reportVersionId: "00000000-0000-4000-8000-000000000201",
        panelCostToken: "signed-panel-capability",
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(harness.livePanel).toHaveBeenCalledWith("ring-alert");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("news");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("legal");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("sanctions");
  });
});

describe("decision-safe person report presentation", () => {
  it("withholds incomplete PASS clearance while preserving it as a preliminary signal", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      completeness_state: "partial" as const,
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(dossier.report.composite_verdict).toBe("PASS");
    expect(container.textContent).toContain("DECISION READINESS");
    expect(container.textContent).toContain("INCOMPLETE");
    expect(container.textContent).toContain("PRELIMINARY MODEL SIGNAL · PASS 100/100");
    expect(container.textContent).toContain("score withheld");
  });

  it("renders frozen off-chain artifacts with capture metadata and only safe source links", () => {
    const hash = "a".repeat(64);
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      sourceArtifacts: [
        {
          kind: "press" as const,
          provider: "google-news" as const,
          title: "Mara Voss raises a new fund",
          sourceUrl: "https://example.com/news/mara-voss",
          capturedAt: "2026-07-11T14:00:00.000Z",
          publishedAt: "2026-07-10T12:00:00.000Z",
          excerpt: "Independent coverage of the subject.",
          match: "exact_name" as const,
          contentHash: hash,
        },
        {
          kind: "legal_case" as const,
          provider: "courtlistener" as const,
          title: "Unsafe source remains inert",
          sourceUrl: "https://user:secret@example.com/private",
          capturedAt: "2026-07-11T14:00:00.000Z",
          match: "candidate" as const,
          contentHash: "not-a-sha",
        },
      ],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Frozen source ledger");
    expect(container.textContent).toContain("Mara Voss raises a new fund");
    expect(container.textContent).toContain(`SHA-256 ${hash.slice(0, 12)}…`);
    expect(container.textContent).toContain("SHA-256 unavailable");
    expect(container.querySelector('a[href="https://example.com/news/mara-voss"]')).not.toBeNull();
    expect(container.querySelector('a[href*="user:secret"]')).toBeNull();
  });
});

describe("legacy person report coverage truth", () => {
  it("labels missing frozen coverage without inventing zero metrics and offers a rescan", () => {
    const onRescan = vi.fn();
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000101",
        reportVersionId: "00000000-0000-4000-8000-000000000201",
        version: 1,
        completenessState: "partial" as const,
        attestationState: "legacy_unattested" as const,
        methodologyVersion: null,
        createdAt: "2026-06-01T12:00:00.000Z",
        checks: [],
      },
    };

    act(() => {
      root.render(
        <Report
          dossier={dossier}
          onReset={() => {}}
          onAudit={() => {}}
          onRescan={onRescan}
        />,
      );
    });

    expect(container.textContent).toContain("Coverage not captured");
    expect(container.textContent).toContain("Frozen coverage unavailable");
    expect(container.textContent).toContain("legacy snapshot predates frozen check-level coverage");
    expect(container.textContent).not.toContain("Evidence coverage0%");
    expect(container.textContent).not.toContain("0 / 0");
    expect(container.textContent).not.toContain("0 unresolved");
    expect(container.textContent).not.toContain("No verified positive finding is stored");
    expect(container.querySelector('a[href="#scan-methodology"]')).toBeNull();
    expect(container.querySelector("#scan-methodology")).toBeNull();

    const recovery = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Rescan to capture coverage");
    expect(recovery).toBeDefined();
    act(() => recovery?.click());
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("keeps frozen methodology and recorded coverage visible for a legacy snapshot that has checks", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000101",
        reportVersionId: "00000000-0000-4000-8000-000000000202",
        version: 2,
        completenessState: "complete" as const,
        attestationState: "legacy_unattested" as const,
        methodologyVersion: null,
        createdAt: "2026-06-02T12:00:00.000Z",
        checks: [{ label: "Identity resolution", status: "confirmed" as const }],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).not.toContain("Coverage not captured");
    expect(container.textContent).toContain("Evidence coverage100%");
    expect(container.querySelector('a[href="#scan-methodology"]')).not.toBeNull();
    expect(container.querySelector("#scan-methodology")).not.toBeNull();
  });
});
