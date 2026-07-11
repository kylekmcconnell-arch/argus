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
vi.mock("./RingAlert", () => ({ RingAlert: (props: Record<string, unknown>) => { harness.livePanel("ring-alert", props); return null; } }));
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

function readinessSupportText(): string {
  const label = [...container.querySelectorAll("dt")]
    .find((node) => node.textContent?.trim() === "Strongest recorded support");
  return label?.parentElement?.textContent ?? "";
}

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

    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).toContain("ring-alert");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("news");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("legal");
    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("sanctions");
  });

  it("does not auto-rerun unavailable frozen photo or graph checks", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      checkRuns: [
        {
          checkId: "profile-photo-authenticity",
          label: "Profile-photo authenticity",
          status: "unavailable" as const,
          note: "official X avatar bytes were unavailable",
        },
        {
          checkId: "trust-graph-connections",
          label: "Trust-graph connections",
          status: "unavailable" as const,
          note: "qualified graph history was unavailable",
        },
      ],
      completeness_state: "partial" as const,
      persistence: {
        state: "persisted" as const,
        reportVersionId: "00000000-0000-4000-8000-000000000209",
        panelCostToken: "signed-panel-capability",
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    const mountedPanels = harness.livePanel.mock.calls.map(([panel]) => panel);
    expect(mountedPanels).not.toContain("pfp");
    expect(mountedPanels).not.toContain("ring-alert");
    expect(container.textContent).toContain("2 unresolved");
  });

  it("keeps legacy snapshot graph intelligence behind an explicitly labeled current overlay", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000101",
        reportVersionId: "00000000-0000-4000-8000-000000000221",
        version: 6,
        completenessState: "partial" as const,
        attestationState: "legacy_unattested" as const,
        methodologyVersion: null,
        createdAt: "2026-06-03T12:00:00.000Z",
        checks: [{ label: "Identity resolution", status: "confirmed" as const }],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(harness.livePanel.mock.calls.map(([panel]) => panel)).not.toContain("ring-alert");
    const loadOverlay = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Load current intelligence");
    expect(loadOverlay).toBeDefined();
    act(() => loadOverlay?.click());

    expect(container.textContent).toContain("Current intelligence · fetched now · not part of snapshot v6 · does not change stored verdict");
    expect(harness.livePanel.mock.calls.find(([panel]) => panel === "ring-alert")?.[1]).toEqual(
      expect.objectContaining({ snapshotVersion: 6 }),
    );
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

  it("renders frozen photo and graph evidence, links exact versions, and suppresses duplicate live panels", () => {
    const currentVersionId = "00000000-0000-4000-8000-000000000211";
    const connectedVersionId = "00000000-0000-4000-8000-000000000311";
    const imageHash = "b".repeat(64);
    const graphHash = "c".repeat(64);
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      profileAuthenticity: {
        provider: "claude-vision" as const,
        capturedAt: "2026-07-11T15:00:00.000Z",
        imageUrl: "https://pbs.twimg.com/profile_images/founder.jpg",
        imageData: "data:image/jpeg;base64,YWJj",
        mediaType: "image/jpeg" as const,
        imageContentHash: imageHash,
        classification: "ai_generated" as const,
        confidence: 0.91,
        isRealPerson: false,
        flag: true,
        tells: ["warped glasses", "asymmetric background"],
        note: "Synthetic-image characteristics were surfaced as a review lead, not identity proof.",
      },
      trustGraphScreen: {
        provider: "argus-graph" as const,
        capturedAt: "2026-07-11T15:01:00.000Z",
        status: "risk" as const,
        contributionCount: 12,
        qualifiedContributionCount: 9,
        sourceContentHash: graphHash,
        severity: "caution" as const,
        line: "A medium-strength shared team identity connects this subject to a failed project snapshot.",
        connections: [{
          other: "@failed_project",
          otherReportVersionId: connectedVersionId,
          otherAttestation: "server_collected" as const,
          otherCompleteness: "complete" as const,
          otherVerdict: "FAIL",
          qualified: true,
          direct: false,
          ties: [{
            key: "person:shared-founder",
            label: "Shared founder",
            type: "Person",
            strength: "medium" as const,
            subjectEdgeTypes: ["TEAM"],
            otherEdgeTypes: ["TEAM"],
          }],
        }],
        riskEntities: [{ key: "person:shared-founder", label: "Shared founder" }],
      },
      sourceArtifacts: [{
        kind: "profile_photo" as const,
        provider: "claude-vision" as const,
        title: "Profile-photo integrity screen",
        sourceUrl: "https://pbs.twimg.com/profile_images/founder.jpg",
        capturedAt: "2026-07-11T15:00:00.000Z",
        contentHash: "d".repeat(64),
        sourceContentHash: imageHash,
        excerpt: "AI-generated image review lead; identity remains unproven.",
        match: "risk_signal" as const,
      }, {
        kind: "trust_graph" as const,
        provider: "argus-graph" as const,
        title: "Organization trust-graph reconciliation",
        capturedAt: "2026-07-11T15:01:00.000Z",
        contentHash: "e".repeat(64),
        sourceContentHash: graphHash,
        excerpt: "One decision-qualified connection was frozen.",
        match: "risk_signal" as const,
      }],
      checkRuns: [
        { checkId: "profile-photo-authenticity", label: "Profile-photo authenticity", status: "finding" as const },
        { checkId: "trust-graph-connections", label: "Trust-graph connections", status: "finding" as const },
      ],
      completeness_state: "partial" as const,
      persistence: {
        state: "persisted" as const,
        reportVersionId: currentVersionId,
        panelCostToken: "signed-panel-capability",
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("Profile-photo integrity");
    expect(container.textContent).toContain("visual triage, not identity proof");
    expect(container.textContent).toContain("AI-generated image lead");
    expect(container.textContent).toContain("cannot prove image ownership, identity, or web-wide reuse");
    expect(container.textContent).toContain(`Source image SHA-256 ${imageHash.slice(0, 12)}…`);
    expect(container.querySelector('img[src="data:image/jpeg;base64,YWJj"]')).not.toBeNull();
    expect(container.textContent).toContain("exact image bytes retained with this report");

    expect(container.textContent).toContain("Frozen trust-graph screen");
    expect(container.textContent).toContain("A shared person, wallet, funder, or project is an investigative lead");
    expect(container.textContent).toContain("9 / 12");
    expect(container.textContent).toContain("Shared founder");
    expect(container.textContent).toContain(`Graph snapshot SHA-256 ${graphHash.slice(0, 12)}…`);

    expect(container.querySelector(`a[href="/?version=${currentVersionId}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="/?version=${connectedVersionId}"]`)?.textContent).toContain("Open exact connected report");
    expect(container.textContent).toContain("Source link unavailable");
    const mountedPanels = harness.livePanel.mock.calls.map(([panel]) => panel);
    expect(mountedPanels).not.toContain("pfp");
    expect(mountedPanels).not.toContain("ring-alert");
  });

  it("summarizes confirmed collector support instead of model findings", () => {
    const base = buildReport(SUBJECTS[1]);
    const modelFinding = {
      ...base.report.publishable_findings[0],
      claim: "MODEL-GENERATED POSITIVE NARRATIVE MUST NOT DRIVE READINESS",
    };
    const dossier = {
      ...base,
      report: {
        ...base.report,
        publishable_findings: [modelFinding],
      },
      checkRuns: [
        {
          checkId: "identity-resolution",
          label: "Identity resolution",
          status: "confirmed" as const,
          note: "GitHub account kylemcconnell links back to @kyle · licensed identity record resolved to Kyle McConnell",
          provider: "github,peopledatalabs",
          sourceCount: 2,
        },
        {
          checkId: "code-footprint-github",
          label: "Code footprint (GitHub)",
          status: "confirmed" as const,
          note: "github.com/kylemcconnell resolved through its X handle field",
          provider: "github",
          sourceCount: 1,
        },
        {
          checkId: "news-press",
          label: "News & press",
          status: "confirmed" as const,
          note: "1 exact-handle crypto press result frozen",
          provider: "google-news",
          sourceCount: 1,
        },
        {
          checkId: "profile-photo-authenticity",
          label: "Profile-photo integrity",
          status: "checked-empty" as const,
          note: "real candid observed; visual-only screen cannot prove image ownership or identity",
          provider: "claude-vision",
          sourceCount: 1,
        },
      ],
      sourceArtifacts: [{
        kind: "press" as const,
        provider: "google-news" as const,
        title: "Kyle McConnell launches an on-chain research product",
        sourceUrl: "https://example.com/kyle-launch",
        capturedAt: "2026-07-11T15:00:00.000Z",
        contentHash: "a".repeat(64),
        match: "exact_handle" as const,
      }, {
        kind: "profile_photo" as const,
        provider: "claude-vision" as const,
        title: "Profile-photo integrity screen",
        sourceUrl: "https://pbs.twimg.com/profile_images/kyle.jpg",
        capturedAt: "2026-07-11T15:01:00.000Z",
        contentHash: "b".repeat(64),
        match: "observed" as const,
      }],
      completeness_state: "complete" as const,
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const support = readinessSupportText();
    expect(support).toContain("Identity resolution");
    expect(support).toContain("GitHub account kylemcconnell links back to @kyle");
    expect(support).not.toContain("MODEL-GENERATED POSITIVE NARRATIVE");
    expect(support).not.toContain("No verified positive finding");
  });

  it("uses an exact frozen press artifact only with a confirmed press outcome", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      report: { ...base.report, publishable_findings: [] },
      checkRuns: [{
        checkId: "news-press",
        label: "News & press",
        status: "confirmed" as const,
        note: "1 exact-handle crypto press result frozen",
        provider: "google-news",
        sourceCount: 1,
      }],
      sourceArtifacts: [{
        kind: "press" as const,
        provider: "google-news" as const,
        title: "Independent profile of the founder",
        sourceUrl: "https://example.com/founder-profile",
        capturedAt: "2026-07-11T15:00:00.000Z",
        contentHash: "c".repeat(64),
        match: "exact_handle" as const,
      }],
      completeness_state: "complete" as const,
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const support = readinessSupportText();
    expect(support).toContain("Public-footprint evidence");
    expect(support).toContain("Independent profile of the founder");
    expect(support).toContain("source match, not favorable coverage");
  });

  it("does not promote checked-empty, no-match, or unsupported artifacts into positive support", () => {
    const base = buildReport(SUBJECTS[1]);
    const modelFinding = {
      ...base.report.publishable_findings[0],
      claim: "MODEL POSITIVE THAT MUST REMAIN OUTSIDE THE READINESS SUMMARY",
    };
    const dossier = {
      ...base,
      report: { ...base.report, publishable_findings: [modelFinding] },
      checkRuns: [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "checked-empty" as const,
        note: "licensed identity provider completed without a matching real-world record",
        provider: "peopledatalabs",
      }, {
        checkId: "code-footprint-github",
        label: "Code footprint (GitHub)",
        status: "confirmed" as const,
        note: "GitHub footprint marked confirmed without a frozen source count",
        provider: "github",
      }, {
        checkId: "news-press",
        label: "News & press",
        status: "checked-empty" as const,
        note: "exact-name and exact-handle crypto press searches returned no matching article",
        provider: "google-news",
      }, {
        checkId: "profile-photo-authenticity",
        label: "Profile-photo integrity",
        status: "checked-empty" as const,
        note: "real candid observed; visual-only screen cannot prove image ownership or identity",
        provider: "claude-vision",
      }],
      sourceArtifacts: [{
        kind: "press" as const,
        provider: "google-news" as const,
        title: "Artifact without a confirmed press outcome",
        sourceUrl: "https://example.com/unqualified-press",
        capturedAt: "2026-07-11T15:00:00.000Z",
        contentHash: "d".repeat(64),
        match: "exact_handle" as const,
      }, {
        kind: "sanctions_screen" as const,
        provider: "opensanctions" as const,
        title: "US Treasury OFAC SDN exact-name screen",
        sourceUrl: "https://example.com/ofac",
        capturedAt: "2026-07-11T15:01:00.000Z",
        contentHash: "e".repeat(64),
        match: "no_match" as const,
      }],
      completeness_state: "complete" as const,
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const support = readinessSupportText();
    expect(support).toContain("No confirmed supporting outcome is frozen");
    expect(support).toContain("Checked-empty and no-match records count toward coverage, not positive support");
    expect(support).not.toContain("MODEL POSITIVE");
    expect(support).not.toContain("Artifact without a confirmed press outcome");
  });

  it("renders associate accusations as unverified leads outside the subject score", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      report: {
        ...base.report,
        publishable_findings: [],
        investigative_leads: [{
          finding_type: "AdverseLead",
          claim: "@associate (scam accusation lead): a complaint page names the associate.",
          source_url: "https://example.com/associate-complaint",
          source_date: "",
          source_author: "candidate complaint index",
          verification_status: "Reported",
          independent_source_count: 1,
          polarity: -1,
          evidence_origin: "model_lead" as const,
          artifact_verified: false,
          finding_scope: {
            scope: "related_entity" as const,
            target_entity_key: "@associate",
            target_entity_type: "person" as const,
            relationship_to_subject: "associate" as const,
            relationship_label: "recorded collaborator",
          },
        }],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Investigative leads");
    expect(container.textContent).toContain("Associate lead");
    expect(container.textContent).toContain("unverified lead · outside subject score");
    expect(container.textContent).toContain(`not verified evidence of conduct by ${base.report.handle}`);
    expect(container.textContent).not.toContain("Publishable findings");
  });

  it("distinguishes a verified related-entity artifact from subject attribution", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      report: {
        ...base.report,
        publishable_findings: [],
        investigative_leads: [{
          finding_type: "LegalFinding",
          claim: "A frozen court artifact names the associated venture.",
          source_url: "https://example.com/venture-case",
          source_date: "2026-01-02",
          source_author: "court record",
          verification_status: "Verified" as const,
          independent_source_count: 1,
          polarity: -1,
          evidence_origin: "deterministic" as const,
          artifact_verified: true,
          finding_scope: {
            scope: "related_entity" as const,
            target_entity_key: "@related_venture",
            target_entity_type: "project" as const,
            relationship_to_subject: "venture" as const,
            relationship_label: "former employer",
          },
        }],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("verified about target · outside subject score");
    expect(container.textContent).toContain(`verified about @related_venture, but it is not evidence of conduct by ${base.report.handle}`);
    expect(container.textContent).toContain("Verified target source");
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
