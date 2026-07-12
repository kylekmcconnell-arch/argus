// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ livePanel: vi.fn(), askReport: vi.fn() }));

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
vi.mock("./AskReport", () => ({ AskReport: (props: Record<string, unknown>) => { harness.askReport(props); return null; } }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  harness.livePanel.mockReset();
  harness.askReport.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function decisionBasisText(): string {
  return container.querySelector('section[aria-label="Decision basis"]')?.textContent ?? "";
}

describe("private person report evidence boundary", () => {
  it("renders model-only team identities as leads and excludes them from grounded report chat", () => {
    const base = buildReport(SUBJECTS[1]);
    const modelVenture = {
      ...base.evidence.ventures[0],
      project_name: "Model Venture",
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    };
    const dossier = {
      ...base,
      webTeam: [{
        name: "Model Team Lead",
        handle: "@model_team_lead",
        linkedin: "linkedin.com/in/model-team-lead",
        role: "CTO",
        source: "Grok web search",
        provider: "grok",
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
      }],
      evidence: { ...base.evidence, ventures: [modelVenture] },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("Investigative team candidates");
    expect(container.textContent).toContain("Model Team Lead");
    expect(container.textContent).toContain("not identity proof");
    expect(container.textContent).not.toContain("identity resolved through the named team");
    expect(container.querySelector('a[href*="model-team-lead"]')).toBeNull();
    const context = String(harness.askReport.mock.calls.at(-1)?.[0]?.context ?? "");
    expect(context).not.toContain("Model Team Lead");
    expect(context).not.toContain("Model Venture");
  });

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

  it("keeps a failed immutable save visible and pauses supplemental providers", () => {
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      persistence: { state: "failed" as const },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("not safely bound to an immutable version");
    expect(container.textContent).toContain("Rescan before spending on supplemental providers");
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
  it("presents a zero-axis project attempt as collected intelligence, never decision-ready", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      bio: "the solana prediction market",
      completeness_state: "partial" as const,
      checkRuns: [
        { checkId: "profile", label: "X profile", status: "confirmed" as const, provider: "twitterapi" },
        { checkId: "news", label: "News and press", status: "finding" as const, provider: "google-news" },
        { checkId: "photo", label: "Profile photo", status: "checked-empty" as const, provider: "claude-vision" },
      ],
      providerSnapshot: {
        capturedAt: "2026-07-12T20:24:00.000Z",
        runs: [{
          id: "pdl",
          label: "Identity resolution",
          state: "failed" as const,
          observedAt: "2026-07-12T20:24:00.000Z",
          detail: "Provider returned no identity match.",
        }],
      },
      webTeam: [{
        name: "<UNKNOWN>",
        role: "<UNKNOWN>",
        source: "project team page",
        provider: "team-page",
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
      }],
      report: {
        ...base.report,
        roles: [],
        role_reports: [],
        governing_role: null,
        governing_score: null,
        composite_verdict: "INCOMPLETE" as const,
      },
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onRescan={() => {}} />);
    });

    expect(container.textContent).toContain("Project routing unresolved");
    expect(container.textContent).toContain("ARGUS collected intelligence, but did not select a scoring methodology");
    expect(container.textContent).toContain("Decision coverage0%");
    expect(container.textContent).toContain("Resolve whether this account represents a project, organization, token, or person");
    expect(container.textContent).toContain("Identity resolution collection failed");
    expect([...container.querySelectorAll("span")].some((node) => node.textContent?.trim() === "decision-ready")).toBe(false);
    expect(container.textContent).not.toContain("<UNKNOWN>");
    expect(decisionBasisText()).toContain("No evidence-backed role selected a scoring methodology");
    expect(decisionBasisText()).not.toContain("predates strict evidence-to-axis citations");
  });

  it("explains an adverse verdict with adverse drivers and labels positive evidence as counterweight", () => {
    const dossier = buildReport(SUBJECTS[0]);

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(dossier.report.composite_verdict).not.toBe("PASS");
    const verdictDrivers = container.querySelector('section[aria-labelledby="verdict-rationale-title"]')?.textContent ?? "";
    const counterweight = container.querySelector('section[aria-labelledby="confidence-limits-title"]')?.textContent ?? "";
    expect(verdictDrivers).toMatch(/hard cap governs|scored \d+\/\d+/i);
    expect(counterweight).toContain("What evidence pulls the other way");
  });

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
    expect(container.textContent).toContain("Preliminary scored-axis breakdown");
    expect(container.textContent).toContain("final decision score is withheld");
    expect(container.textContent).toContain("preliminary raw axis total");
    expect(container.textContent).toContain("= preliminary 100");
  });

  it("binds report chat to the exact frozen version without sending client-authored evidence", () => {
    const base = buildReport(SUBJECTS[1]);
    const reportVersionId = "1d4b3030-de29-4633-a281-beb9672c4a00";
    const dossier = {
      ...base,
      sourceArtifacts: [{
        kind: "portfolio_relationship" as const,
        provider: "portfolio-web" as const,
        title: "Official portfolio relationship",
        sourceUrl: "https://example.com/portfolio",
        investorDomainSourceUrl: "https://x.com/examplefund",
        attributionSourceUrl: "https://x.com/examplepartner",
        capturedAt: "2026-07-12T04:00:00.000Z",
        contentHash: "a".repeat(64),
        match: "relationship_confirmed" as const,
      }],
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000101",
        reportVersionId,
        version: 10,
        completenessState: "partial" as const,
        attestationState: "server_collected" as const,
        methodologyVersion: "person-v1",
        createdAt: "2026-07-12T04:00:00.000Z",
        checks: [
          { checkId: "identity", label: "Identity", status: "confirmed" as const, provider: "twitterapi", sourceCount: 1 },
          { checkId: "portfolio", label: "Portfolio track record", status: "confirmed" as const, provider: "portfolio-web", sourceCount: 6 },
          { checkId: "fund-scale", label: "Fund scale", status: "confirmed" as const, provider: "fund-scale-web", sourceCount: 1 },
          { checkId: "press", label: "Press coverage", status: "unavailable" as const, provider: "google-news", note: "one cited page failed" },
        ],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const props = harness.askReport.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(props.reportVersionId).toBe(reportVersionId);
    expect(props.subject).toBe(base.report.handle);
    expect(props).not.toHaveProperty("context");
    expect(props).not.toHaveProperty("citations");
    expect(props).not.toHaveProperty("readiness");
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

  it("renders verified fund scale beside portfolio attribution without inflating personal capital", () => {
    const base = buildReport(SUBJECTS[2]);
    const dossier = {
      ...base,
      website: "https://novacap.io",
      profile_collection_state: "resolved" as const,
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T14:00:00.000Z",
      sourceArtifacts: [{
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Nova Capital reports $850 million AUM",
        excerpt: "Nova Capital reports $850 million in assets under management.",
        sourceUrl: "https://novacap.io/fund",
        capturedAt: "2026-07-11T14:00:00.000Z",
        publishedAt: "2026-06-30T00:00:00.000Z",
        sourceContentHash: "a".repeat(64),
        contentHash: "b".repeat(64),
        match: "fund_scale_confirmed" as const,
        subjectName: "Nova Capital",
        subjectHandle: "@nova_capital",
        investorEntityName: "Nova Capital",
        investorEntityDomain: "novacap.io",
        attribution: "direct_subject" as const,
        sourceClass: "first_party_subject" as const,
        fundName: "Nova Capital",
        fundSizeUsd: 850_000_000,
        fundVehicle: "Nova Capital managed funds",
        fundScaleMetric: "reported_aum" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleBasis: "manager_reported" as const,
        fundScaleAsOf: "2026-06-30T00:00:00.000Z",
        fundScaleTemporalState: "current" as const,
        fundScaleSourceCount: 1,
        fundScaleClaimId: "nova-aum-2026q2",
      }, {
        kind: "portfolio_relationship" as const,
        provider: "portfolio-web" as const,
        title: "Nova Capital → Acme Protocol",
        excerpt: "Acme Protocol appears on the official portfolio page.",
        sourceUrl: "https://novacap.io/portfolio/acme",
        capturedAt: "2026-07-11T14:00:00.000Z",
        sourceContentHash: "c".repeat(64),
        contentHash: "d".repeat(64),
        match: "relationship_confirmed" as const,
        relationship: "invested_in" as const,
        subjectName: "Nova Capital",
        investorEntityName: "Nova Capital",
        attribution: "direct_subject" as const,
        projectName: "Acme Protocol",
        sourceClass: "first_party_subject" as const,
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Investor evidence");
    expect(container.textContent).toContain("1 verified relationship · 1 verified scale claim");
    const investorHeading = [...container.querySelectorAll("h2")]
      .find((heading) => heading.textContent === "Investor evidence");
    expect(investorHeading?.closest("section")?.parentElement?.classList.contains("lg:col-span-2")).toBe(true);
    expect(container.textContent).toContain("Fund scale");
    expect(container.textContent).toContain("Portfolio relationships");
    expect(container.textContent).toContain("Nova Capital managed funds");
    expect(container.textContent).toContain("$850M");
    expect(container.textContent).toContain("reported AUM");
    expect(container.textContent).toContain("manager reported");
    expect(container.textContent).toContain("As of Jun 30, 2026");
    expect(container.textContent).toContain("source published Jun 30, 2026");
    expect(container.textContent).toContain("captured Jul 11, 2026");
    expect(container.textContent).toContain("fund scale verified");
    expect(container.textContent).toContain("Nova Capital → invested in Acme Protocol");
    expect(container.textContent).toContain("direct investment verified");
    expect(container.querySelector('a[href="https://novacap.io/fund"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://novacap.io/portfolio/acme"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label*="Open scale source"][aria-label*="novacap.io/fund"][aria-label*="captured Jul 11, 2026"]')).not.toBeNull();
    expect(container.querySelector('a[aria-label*="Open deal source"][aria-label*="novacap.io/portfolio/acme"][aria-label*="captured Jul 11, 2026"]')).not.toBeNull();
  });

  it("shows the complete person-to-affiliated-fund chain with separate affiliation, scale, and deal sources", () => {
    const affiliationUrl = "https://x.com/satoshi_builds";
    const domainSourceUrl = "https://x.com/paradigm";
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      bio: "Research Partner at Paradigm",
      profile_collection_state: "resolved" as const,
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-10T14:00:00.000Z",
      sourceArtifacts: [{
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Reuters reports Paradigm Fund III close",
        excerpt: "Reuters reports that Paradigm completed the final close of Paradigm Fund III at $850 million.",
        sourceUrl: "https://reuters.com/markets/paradigm-fund-iii",
        capturedAt: "2026-07-11T14:00:00.000Z",
        publishedAt: "2026-07-01T00:00:00.000Z",
        sourceContentHash: "e".repeat(64),
        contentHash: "f".repeat(64),
        match: "fund_scale_confirmed" as const,
        subjectName: "Mara Voss",
        subjectHandle: "@satoshi_builds",
        investorEntityName: "Paradigm",
        investorEntityDomain: "paradigm.xyz",
        attribution: "affiliated_fund" as const,
        attributionSourceUrl: affiliationUrl,
        attributionSourceContentHash: "1".repeat(64),
        attributionCapturedAt: "2026-07-10T14:00:00.000Z",
        attributionSourceKind: "provider_profile" as const,
        investorDomainSourceUrl: domainSourceUrl,
        investorDomainSourceContentHash: "8".repeat(64),
        investorDomainCapturedAt: "2026-07-10T14:01:00.000Z",
        investorDomainSourceKind: "provider_profile" as const,
        investorDomainProfileName: "Paradigm",
        investorDomainProfileWebsite: "https://paradigm.xyz",
        sourceClass: "independent_press" as const,
        fundName: "Paradigm",
        fundSizeUsd: 850_000_000,
        fundVehicle: "Paradigm Fund III",
        fundScaleMetric: "final_close" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleBasis: "press_corroborated" as const,
        fundScaleAsOf: "2026-07-01T00:00:00.000Z",
        fundScaleTemporalState: "fixed_historical" as const,
        fundScaleSourceCount: 2,
        fundScaleClaimId: "paradigm-fund-iii-final-close",
      }, {
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Financial Times confirms Paradigm Fund III close",
        excerpt: "The Financial Times independently confirms Paradigm Fund III completed a final close at $850 million.",
        sourceUrl: "https://ft.com/content/paradigm-fund-iii",
        capturedAt: "2026-07-11T14:01:00.000Z",
        publishedAt: "2026-07-02T00:00:00.000Z",
        sourceContentHash: "6".repeat(64),
        contentHash: "7".repeat(64),
        match: "fund_scale_confirmed" as const,
        subjectName: "Mara Voss",
        subjectHandle: "@satoshi_builds",
        investorEntityName: "Paradigm",
        investorEntityDomain: "paradigm.xyz",
        attribution: "affiliated_fund" as const,
        attributionSourceUrl: affiliationUrl,
        attributionSourceContentHash: "1".repeat(64),
        attributionCapturedAt: "2026-07-10T14:00:00.000Z",
        attributionSourceKind: "provider_profile" as const,
        sourceClass: "independent_press" as const,
        fundName: "Paradigm",
        fundSizeUsd: 850_000_000,
        fundVehicle: "Paradigm Fund III",
        fundScaleMetric: "final_close" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleBasis: "press_corroborated" as const,
        fundScaleAsOf: "2026-07-01T00:00:00.000Z",
        fundScaleTemporalState: "fixed_historical" as const,
        fundScaleSourceCount: 2,
        fundScaleClaimId: "paradigm-fund-iii-final-close",
      }, {
        kind: "portfolio_relationship" as const,
        provider: "portfolio-web" as const,
        title: "Paradigm → Acme Protocol",
        excerpt: "Acme Protocol appears on Paradigm's official portfolio page.",
        sourceUrl: "https://paradigm.xyz/portfolio/acme",
        capturedAt: "2026-07-11T15:00:00.000Z",
        sourceContentHash: "2".repeat(64),
        contentHash: "3".repeat(64),
        match: "relationship_confirmed" as const,
        relationship: "invested_in" as const,
        subjectName: "Mara Voss",
        subjectHandle: "@satoshi_builds",
        investorEntityName: "Paradigm",
        investorEntityDomain: "paradigm.xyz",
        attribution: "affiliated_fund" as const,
        attributionSourceUrl: affiliationUrl,
        attributionSourceContentHash: "1".repeat(64),
        attributionCapturedAt: "2026-07-10T14:00:00.000Z",
        attributionSourceKind: "provider_profile" as const,
        investorDomainSourceUrl: domainSourceUrl,
        investorDomainSourceContentHash: "8".repeat(64),
        investorDomainCapturedAt: "2026-07-10T14:01:00.000Z",
        investorDomainSourceKind: "provider_profile" as const,
        investorDomainProfileName: "Paradigm",
        investorDomainProfileWebsite: "https://paradigm.xyz",
        projectName: "Acme Protocol",
        sourceClass: "first_party_investor" as const,
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Mara Voss → affiliated with Paradigm");
    expect(container.textContent).toContain("Mara Voss → affiliated with Paradigm → invested in Acme Protocol");
    expect(container.textContent).toContain("Paradigm Fund III");
    expect(container.textContent).toContain("Fund close date · Jul 1, 2026");
    expect(container.textContent).toContain("source published Jul 1, 2026");
    expect(container.textContent).not.toContain("Fixed historical");
    expect(container.textContent).toContain("fund scale verified · not personal capital");
    expect(container.textContent).toContain("fund investment verified · not attributed personally");
    const longStatus = [...container.querySelectorAll(".chip")]
      .find((chip) => chip.textContent?.includes("fund investment verified · not attributed personally"));
    expect(longStatus?.classList.contains("chip-wrap")).toBe(true);

    const affiliationLinks = container.querySelectorAll(`a[href="${affiliationUrl}"][aria-label*="Open affiliation source"][aria-label*="captured Jul 10, 2026"]`);
    expect(affiliationLinks.length).toBeGreaterThanOrEqual(2);
    const domainLinks = container.querySelectorAll(`a[href="${domainSourceUrl}"][aria-label*="Open fund domain source"][aria-label*="Paradigm official domain paradigm.xyz"]`);
    expect(domainLinks.length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector('a[href="https://reuters.com/markets/paradigm-fund-iii"][aria-label*="Open scale source"][aria-label*="reuters.com/markets/paradigm-fund-iii"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://ft.com/content/paradigm-fund-iii"][aria-label*="Open scale source"][aria-label*="ft.com/content/paradigm-fund-iii"]')).not.toBeNull();
    expect(container.querySelector('a[href="https://paradigm.xyz/portfolio/acme"][aria-label*="Open deal source"][aria-label*="paradigm.xyz/portfolio/acme"]')).not.toBeNull();
  });

  it("keeps named and unnumbered same-amount claims separate without overstating the source basis", () => {
    const base = buildReport(SUBJECTS[2]);
    const dossier = {
      ...base,
      sourceArtifacts: [{
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Secondary directory reports Paradigm fund size",
        excerpt: "Paradigm announced a $2.5 billion fund.",
        sourceUrl: "https://venturecapitalarchive.example/paradigm",
        capturedAt: "2026-07-11T14:00:00.000Z",
        publishedAt: "2026-07-10T00:00:00.000Z",
        sourceContentHash: "9".repeat(64),
        contentHash: "a".repeat(64),
        match: "candidate" as const,
        subjectName: "Nova Capital",
        subjectHandle: "@nova_capital",
        investorEntityName: "Paradigm",
        attribution: "direct_subject" as const,
        sourceClass: "other_public" as const,
        fundName: "Paradigm",
        fundSizeUsd: 2_500_000_000,
        fundVehicle: "Unspecified Fund",
        fundScaleMetric: "fund_vehicle" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleTemporalState: "fixed_historical" as const,
        fundScaleSourceCount: 0,
        fundScaleClaimId: "paradigm-unspecified-2-5b",
      }, {
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Wikipedia reports Paradigm Fund I size",
        excerpt: "Paradigm Fund I closed at $2.5 billion.",
        sourceUrl: "https://en.wikipedia.org/wiki/Paradigm_(company)",
        capturedAt: "2026-07-11T14:01:00.000Z",
        publishedAt: "2025-01-15T00:00:00.000Z",
        sourceContentHash: "b".repeat(64),
        contentHash: "c".repeat(64),
        match: "candidate" as const,
        subjectName: "Nova Capital",
        subjectHandle: "@nova_capital",
        investorEntityName: "Paradigm",
        attribution: "direct_subject" as const,
        sourceClass: "other_public" as const,
        fundName: "Paradigm",
        fundSizeUsd: 2_500_000_000,
        fundVehicle: "Fund I",
        fundScaleMetric: "fund_vehicle" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleTemporalState: "fixed_historical" as const,
        fundScaleSourceCount: 0,
        fundScaleClaimId: "paradigm-fund-i-2-5b",
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const investorHeading = [...container.querySelectorAll("h2")]
      .find((heading) => heading.textContent === "Investor evidence");
    const investorSection = investorHeading?.closest("section");
    expect(investorSection?.textContent).toContain("2 reported-only scale claims");
    expect(investorSection?.querySelectorAll("article")).toHaveLength(2);
    expect(investorSection?.textContent).toContain("Fund I");
    expect(investorSection?.textContent).toContain("Unspecified Fund");
    expect(investorSection?.textContent).toContain("Possible overlap");
    expect(investorSection?.textContent).toContain("keeps them separate");
    expect(investorSection?.textContent).toContain("Fund vehicle date not stated");
    expect(investorSection?.textContent).toContain("source published Jul 10, 2026");
    expect(investorSection?.textContent).toContain("source published Jan 15, 2025");
    expect(investorSection?.textContent).toContain("captured Jul 11, 2026");
    expect(investorSection?.textContent).not.toContain("press corroborated");
    expect(investorSection?.textContent).not.toContain("Fixed historical");
    expect(investorSection?.querySelectorAll('a[aria-label*="Open scale source"]')).toHaveLength(2);
  });

  it("does not style or label a nominally confirmed fund-size payload as verified when the strict gate rejects it", () => {
    const base = buildReport(SUBJECTS[2]);
    const dossier = {
      ...base,
      website: "https://novacap.io",
      profile_collection_state: "resolved" as const,
      profile_provider: "twitterapi",
      profile_captured_at: "2026-07-11T14:00:00.000Z",
      sourceArtifacts: [{
        kind: "fund_scale" as const,
        provider: "fund-scale-web" as const,
        title: "Incomplete Nova Capital AUM claim",
        excerpt: "Nova Capital reports $850 million in assets under management.",
        sourceUrl: "https://novacap.io/fund",
        capturedAt: "2026-07-11T14:00:00.000Z",
        publishedAt: "2026-06-30T00:00:00.000Z",
        sourceContentHash: "4".repeat(64),
        contentHash: "5".repeat(64),
        match: "fund_scale_confirmed" as const,
        subjectName: "Nova Capital",
        subjectHandle: "@nova_capital",
        investorEntityName: "Nova Capital",
        investorEntityDomain: "novacap.io",
        attribution: "direct_subject" as const,
        sourceClass: "first_party_subject" as const,
        fundName: "Nova Capital",
        fundSizeUsd: 850_000_000,
        fundScaleMetric: "reported_aum" as const,
        fundAmountQualifier: "exact" as const,
        fundScaleBasis: "manager_reported" as const,
        fundScaleTemporalState: "current" as const,
        fundScaleSourceCount: 1,
        fundScaleClaimId: "nova-aum-missing-claim-date",
        // No claim-local fundScaleAsOf: publication time must not impersonate it.
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const investorHeading = [...container.querySelectorAll("h2")]
      .find((heading) => heading.textContent === "Investor evidence");
    const investorSection = investorHeading?.closest("section");
    expect(investorSection).not.toBeNull();
    expect(investorSection?.textContent).toContain("0 verified scale claims");
    expect(investorSection?.textContent).toContain("reported scale · strict verification incomplete");
    expect(investorSection?.textContent).toContain("Current AUM · as-of unavailable");
    expect(investorSection?.textContent).not.toContain("As of Jun 30, 2026");
    expect(investorSection?.textContent).not.toContain("fund scale verified");
    expect(investorSection?.querySelector(".tint-pass")).toBeNull();
    expect(container.textContent).toContain("reported · strict verification incomplete");
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

  it("does not infer legacy axis lineage from collector prose or model findings", () => {
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

    const basis = decisionBasisText();
    expect(basis).toContain("Lineage unavailable");
    expect(basis).toContain("will not infer");
    expect(basis).not.toContain("Identity resolution");
    expect(basis).not.toContain("GitHub account kylemcconnell links back to @kyle");
    expect(basis).not.toContain("MODEL-GENERATED POSITIVE NARRATIVE");
  });

  it("keeps a frozen press artifact in its ledger without inventing a legacy axis link", () => {
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

    expect(container.textContent).toContain("Independent profile of the founder");
    const basis = decisionBasisText();
    expect(basis).toContain("Lineage unavailable");
    expect(basis).not.toContain("Independent profile of the founder");
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

    const basis = decisionBasisText();
    expect(basis).toContain("Lineage unavailable");
    expect(basis).not.toContain("MODEL POSITIVE");
    expect(basis).not.toContain("Artifact without a confirmed press outcome");
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

  it("quarantines unsafe findings and derived contradictions in immutable legacy reports", () => {
    const base = buildReport(SUBJECTS[1]);
    const legacyLead = {
      finding_type: "AdverseLead",
      claim: "@legacy_associate (scam accusation lead): a candidate complaint names the associate.",
      source_url: "https://example.com/legacy-associate-complaint",
      source_date: "",
      source_author: "candidate complaint index",
      verification_status: "Reported" as const,
      independent_source_count: 1,
      polarity: -1,
      evidence_origin: "model_lead" as const,
      artifact_verified: false,
    };
    const dossier = {
      ...base,
      contradictions: [{
        claim: "The subject works with @legacy_associate.",
        conflict: "A model-discovered complaint names @legacy_associate.",
        severity: "medium" as const,
        confidence: "low" as const,
      }],
      report: {
        ...base.report,
        publishable_findings: [legacyLead],
        investigative_leads: [],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).not.toContain("Publishable findings");
    expect(container.textContent).toContain("Investigative leads");
    expect(container.textContent).toContain("Related-entity lead");
    expect(container.textContent).toContain("@legacy_associate");
    expect(decisionBasisText()).not.toContain("legacy_associate");
    expect(decisionBasisText()).toContain("Lineage unavailable");
    expect(container.textContent).not.toContain("A model-discovered complaint names @legacy_associate");
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
