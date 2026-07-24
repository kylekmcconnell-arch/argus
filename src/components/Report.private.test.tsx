// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const harness = vi.hoisted(() => ({ livePanel: vi.fn(), askReport: vi.fn(), trustGraph: vi.fn() }));

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
vi.mock("./ProjectIntel", () => ({ ProjectIntel: (props: Record<string, unknown>) => { harness.livePanel("project-intel", props); return null; } }));
vi.mock("./NewsSection", () => ({ NewsSection: () => { harness.livePanel("news"); return null; } }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: (props: Record<string, unknown>) => { harness.livePanel("identity-sweep", props); return null; } }));
vi.mock("./AddInfo", () => ({ AddInfo: () => { harness.livePanel("add-info"); return null; } }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => { harness.livePanel("link-entity"); return null; } }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div>service-ready</div> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: (props: Record<string, unknown>) => { harness.trustGraph(props); return null; } }));
vi.mock("./AskReport", () => ({ AskReport: (props: Record<string, unknown>) => { harness.askReport(props); return null; } }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  harness.livePanel.mockReset();
  harness.askReport.mockReset();
  harness.trustGraph.mockReset();
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

  it("renders a server-derived model-enriched lead once, not re-derived from the sanitized team copy", () => {
    const base = buildReport(SUBJECTS[1]);
    const groundedMember = {
      name: "Jane Founder",
      handle: "@jane_founder",
      role: "CEO",
      source: "https://example.com/team",
      provider: "firecrawl",
      evidence_origin: "deterministic" as const,
      artifact_verified: true,
      identity_link_evidence_origin: "model_lead" as const,
    };
    const dossier = {
      ...base,
      // assembleDossier ships the sanitized copy in webTeam (handle stripped)
      // and the lead copy in webTeamLeads (handle kept, source suffixed).
      webTeam: [{ ...groundedMember, handle: undefined, linkedin: undefined }],
      webTeamLeads: [{
        ...groundedMember,
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
        provider: "grok",
        source: "https://example.com/team · unverified model-enriched links",
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    const candidatesCard = () => [...container.querySelectorAll<HTMLElement>("div")]
      .find((el) => el.className.includes("border-caution/25"));
    expect(candidatesCard()).toBeDefined();
    expect((candidatesCard()?.textContent?.match(/Jane Founder/g) ?? []).length).toBe(1);
    expect(candidatesCard()?.textContent).toContain("candidate @jane_founder");

    // A legacy sanitized row no longer has the model-supplied handle. It fails
    // closed instead of resurfacing an unverifiable name-only candidate.
    const legacy = { ...dossier, webTeamLeads: undefined };
    act(() => {
      root.render(<Report dossier={legacy} onReset={() => {}} onAudit={() => {}} />);
    });
    expect((candidatesCard()?.textContent?.match(/Jane Founder/g) ?? []).length).toBe(0);
  });

  it("hides model-only team names that have no stable identity locator", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      webTeam: [],
      webTeamLeads: [{
        name: "Dr. Unrelated Executive",
        role: "President and CEO",
        source: "Generic web research",
        evidence: "An unrelated company page used the same short project name.",
        provider: "grok",
        evidence_origin: "model_lead" as const,
        artifact_verified: false,
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).not.toContain("Dr. Unrelated Executive");
    expect(container.textContent).not.toContain("Investigative team candidates");
  });

  it("cleans namesake citations and answers the project product from the frozen official profile", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      handle: "@ponsdotfamily",
      display_name: "Pons",
      bio: "Launch coins on Robinhood via https://t.co/example",
      profile_collection_state: "resolved" as const,
      profile_provider: "twitterapi",
      report: {
        ...base.report,
        handle: "@ponsdotfamily",
        roles: ["PROJECT"],
        governing_role: "PROJECT",
      },
      basicFacts: [{
        factId: "pons-identity",
        subjectKey: "@ponsdotfamily",
        predicate: "official_identity",
        value: "Pons",
        normalizedValue: "pons",
        status: "verified" as const,
        critical: true,
        sources: [{
          url: "https://ponstherapy.com/",
          title: "PoNS portable neuromodulation stimulator",
          sourceClass: "independent_press" as const,
          relation: "supports" as const,
          excerpt: "PoNS is a medical device.",
          contentHash: "a".repeat(64),
          capturedAt: "2026-07-23T23:10:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }, {
          url: "https://pons1945.com/",
          title: "Pons olive oil",
          sourceClass: "independent_press" as const,
          relation: "supports" as const,
          excerpt: "Pons produces olive oil.",
          contentHash: "b".repeat(64),
          capturedAt: "2026-07-23T23:10:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }, {
          url: "https://x.com/ponsdotfamily",
          title: "Official X profile",
          sourceClass: "official_subject" as const,
          relation: "supports" as const,
          excerpt: "Pons (@ponsdotfamily): Launch coins on Robinhood.",
          contentHash: "c".repeat(64),
          capturedAt: "2026-07-23T23:11:00.000Z",
          provider: "twitterapi",
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Launch coins on Robinhood");
    expect(container.textContent).not.toContain("PoNS portable neuromodulation stimulator");
    expect(container.textContent).not.toContain("Pons olive oil");
    expect(container.querySelector('a[href="https://x.com/ponsdotfamily"]')).not.toBeNull();
  });

  it("uses the verified project role when an early question ledger was opened as a person", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Drift Protocol",
      report: {
        ...base.report,
        roles: ["PROJECT"],
        governing_role: "PROJECT",
      },
      basicFacts: [{
        factId: "drift-identity",
        subjectKey: "@driftprotocol",
        predicate: "official_identity",
        value: "Drift Protocol",
        normalizedValue: "drift protocol",
        status: "verified" as const,
        critical: true,
        sources: [{
          url: "https://www.drift.trade/",
          title: "Official site and X account binding",
          sourceClass: "official_subject" as const,
          relation: "supports" as const,
          excerpt: "Drift Protocol links to @driftprotocol.",
          contentHash: "d".repeat(64),
          capturedAt: "2026-07-24T07:12:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
      }],
      basicFactQuestionLedger: [{
        questionId: "person.official_identity",
        audience: "person",
        batch: "identity",
        predicate: "official_identity",
        question: "Who is this person?",
        critical: true,
        status: "answered",
        answerRefs: ["drift-identity"],
        providerRuns: [{ phase: "primary", provider: "public-web", state: "succeeded" }],
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("What is the project's official identity?");
    expect(container.textContent).not.toContain("Who is this person?");
  });

  it("does not publish a legacy press-only ticker as the project's official token", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Pons",
      report: {
        ...base.report,
        roles: ["PROJECT"],
        governing_role: "PROJECT",
      },
      projectToken: undefined,
      basicFacts: [{
        factId: "press-only-token",
        subjectKey: "@ponsdotfamily",
        predicate: "official_token",
        value: "PRESSONLY",
        normalizedValue: "pressonly",
        status: "corroborated" as const,
        critical: true,
        sources: [{
          url: "https://press-one.example/pons-token",
          title: "Pons token article",
          sourceClass: "independent_press" as const,
          relation: "supports" as const,
          excerpt: "PRESSONLY is described as the Pons token.",
          contentHash: "e".repeat(64),
          capturedAt: "2026-07-24T05:38:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }, {
          url: "https://press-two.example/pons-token",
          title: "Second Pons token article",
          sourceClass: "independent_press" as const,
          relation: "supports" as const,
          excerpt: "PRESSONLY is described as the Pons token.",
          contentHash: "f".repeat(64),
          capturedAt: "2026-07-24T05:39:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.querySelector('[aria-label="Key verified answers"]')?.textContent ?? "")
      .not.toContain("PRESSONLY");
    expect(container.querySelector('[aria-label="Unverified basic fact leads"]')?.textContent ?? "")
      .toContain("PRESSONLY");
  });

  it("removes project namesakes and collapses repeated metrics from the same lead source", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Pons",
      website: "https://www.ponsfamily.com/launchpad",
      report: {
        ...base.report,
        roles: ["PROJECT"],
        governing_role: "PROJECT",
      },
      basicFacts: [{
        factId: "verified-product",
        subjectKey: "@ponsdotfamily",
        predicate: "product",
        value: "Launchpad for tokens on Robinhood Chain",
        normalizedValue: "launchpad for tokens on robinhood chain",
        status: "verified" as const,
        critical: true,
        sources: [{
          url: "https://www.ponsfamily.com/launchpad",
          title: "Official Pons launchpad",
          sourceClass: "official_subject" as const,
          relation: "supports" as const,
          excerpt: "Pons launches tokens on Robinhood Chain.",
          contentHash: "1".repeat(64),
          capturedAt: "2026-07-24T05:38:00.000Z",
          provider: "public-web",
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
      }],
      basicFactLeads: [{
        predicate: "founder",
        value: "MEADGod",
        sourceUrl: "https://press.example/pons-token",
        sourceTitle: "PONS token on Robinhood Chain",
        excerpt: "PONS launchpad founder MEADGod was named after the token launched on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "founder",
        value: "Wesley Pons",
        sourceUrl: "https://ponsdigitalmarketing.example/about",
        sourceTitle: "Pons Digital Marketing",
        excerpt: "Wesley Pons founded a digital marketing agency.",
        provider: "test",
      }, {
        predicate: "product",
        value: "PoNS medical device",
        sourceUrl: "https://medical.example/pons",
        sourceTitle: "Portable Neuromodulation Stimulator",
        excerpt: "The PoNS device uses electrical stimulation for rehabilitation.",
        provider: "test",
      }, {
        predicate: "traction",
        value: "20,000 launches",
        sourceUrl: "https://press.example/pons-metrics",
        sourceTitle: "Pons launchpad metrics",
        excerpt: "Pons recorded 20,000 token launches on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "traction",
        value: "$120 million volume",
        sourceUrl: "https://press.example/pons-metrics",
        sourceTitle: "Pons launchpad metrics",
        excerpt: "Pons recorded $120 million token volume on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "product",
        value: "Launchpad",
        sourceUrl: "https://docs.ponsfamily.com/",
        sourceTitle: "Pons docs",
        excerpt: "Pons is a token launchpad on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "repository",
        value: "https://docs.ponsfamily.com/",
        sourceUrl: "https://docs.ponsfamily.com/",
        sourceTitle: "Pons docs",
        excerpt: "Documentation for launching tokens on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "audit",
        value: "no independent security audits published",
        sourceUrl: "https://exchange.example/pons-guide",
        sourceTitle: "Pons launchpad guide",
        excerpt: "Public information about Pons audits remains limited.",
        provider: "test",
      }, {
        predicate: "launched",
        value: "Robinhood Chain",
        qualifier: "July 22, 2026",
        sourceUrl: "https://www.instagram.com/p/namesake/",
        sourceTitle: "Pons",
        excerpt: "Pons is making waves on Robinhood Chain.",
        provider: "test",
      }, {
        predicate: "funding",
        value: "$30 million",
        sourceUrl: "https://www.rootdata.com/projects/detail/Pons",
        sourceTitle: "Pons",
        excerpt: "PONS surpassed a market capitalization of $30 million.",
        provider: "test",
      }, {
        predicate: "investor",
        value: "Robinhood",
        sourceUrl: "https://www.rootdata.com/projects/detail/Pons",
        sourceTitle: "Pons",
        excerpt: "Robinhood ecosystem token PONS surpassed a market capitalization of $30 million.",
        provider: "test",
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    const leads = container.querySelector('[aria-label="Unverified basic fact leads"]')?.textContent ?? "";
    expect(leads).toContain("MEADGod");
    expect(leads).toContain("20,000 launches");
    expect(leads).not.toContain("$120 million volume");
    expect(leads).not.toContain("Wesley Pons");
    expect(leads).not.toContain("PoNS medical device");
    expect(leads).not.toContain("Pons docs");
    expect(leads).not.toContain("https://docs.ponsfamily.com/");
    expect(leads).not.toContain("no independent security audits published");
    expect(leads).not.toContain("July 22, 2026");
    expect(leads).not.toContain("$30 million");
    expect(leads).not.toContain("Who funded it?Robinhood");
  });

  it("lets corroborated funding govern a conflicting aggregator projection", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Uniswap",
      report: { ...base.report, roles: ["PROJECT"], governing_role: "PROJECT" },
      protocolFunding: {
        slug: "uniswap",
        name: "Uniswap",
        geckoId: "uniswap",
        rounds: [{
          date: "2020-08-07",
          round: "Series A",
          amountUsd: 11_000_000,
          leadInvestors: [],
          otherInvestors: ["a16z"],
          valuationUsd: null,
        }, {
          date: "2026-02-11",
          round: "Undisclosed round",
          amountUsd: null,
          leadInvestors: ["BlackRock"],
          otherInvestors: [],
          valuationUsd: null,
        }],
        totalRaisedUsd: 11_000_000,
        leadInvestors: ["BlackRock"],
        sourceUrl: "https://defillama.com/protocol/uniswap",
        capturedAt: "2026-07-23T19:43:00.102Z",
      },
      basicFacts: [{
        factId: "series-b",
        subjectKey: "@uniswap",
        predicate: "funding",
        value: "Series B",
        normalizedValue: "series b",
        status: "corroborated" as const,
        critical: false,
        sources: [{
          url: "https://news.example/2022/10/13/uniswap-series-b",
          title: "Uniswap Labs Raises $165M in Polychain Capital-Led Round",
          excerpt: "Uniswap Labs raised $165 million in a Series B led by Polychain Capital.",
          provider: "public-web",
          relation: "supports" as const,
          capturedAt: "2026-07-23T19:43:00.102Z",
          contentHash: "d".repeat(64),
          sourceClass: "independent_press" as const,
          artifactVerified: true,
        }, {
          url: "https://second.example/2022/10/13/uniswap-series-b",
          title: "Uniswap Series B",
          excerpt: "Uniswap Labs secured $165 million in a Series B led by Polychain Capital.",
          provider: "public-web",
          relation: "supports" as const,
          capturedAt: "2026-07-23T19:43:00.102Z",
          contentHash: "e".repeat(64),
          sourceClass: "independent_press" as const,
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
      }, {
        factId: "defillama-summary",
        subjectKey: "@uniswap",
        predicate: "funding",
        value: "2 public funding rounds · $11.0M raised · led by BlackRock",
        normalizedValue: "2 public funding rounds 11m raised led by blackrock",
        status: "verified" as const,
        critical: false,
        sources: [{
          url: "https://defillama.com/protocol/uniswap",
          title: "DeFiLlama funding record",
          excerpt: "Uniswap raised $11.0M across 2 public funding rounds, led by BlackRock.",
          provider: "defillama",
          relation: "supports" as const,
          capturedAt: "2026-07-23T19:43:00.102Z",
          contentHash: "f".repeat(64),
          sourceClass: "other_public" as const,
          artifactVerified: true,
        }],
        evidence_origin: "deterministic" as const,
        artifact_verified: true,
        provider: "public-web",
        providerProjection: true,
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("≥$176M across 2 evidenced funding rounds");
    expect(container.textContent).toContain("Series B");
    expect(container.textContent).toContain("Polychain Capital");
    expect(container.textContent).not.toContain("BlackRock");
    expect(container.textContent).not.toContain("2 public funding rounds");
  });

  it("renders never-collected follow and acknowledgment checks as unchecked instead of affirmative negatives", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      evidence: {
        ...base.evidence,
        testimonials: [{
          claimed_endorser_handle: "@unchecked_endorser",
          claimed_relationship: "advisor",
        }, {
          claimed_endorser_handle: "@screened_endorser",
          claimed_relationship: "investor",
          follows_subject: false,
          public_acknowledgment: "none",
        }],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    const rowText = (handle: string) => [...container.querySelectorAll<HTMLElement>("div")]
      .find((el) => el.className.includes("grid-cols-[1.4fr_1fr_auto]") && el.textContent?.includes(handle))
      ?.textContent ?? "";

    const unchecked = rowText("@unchecked_endorser");
    expect(unchecked).toContain("follow unchecked");
    expect(unchecked).toContain("ack unchecked");
    expect(unchecked).not.toContain("no follow");
    expect(unchecked).not.toContain("no ack");

    const screened = rowText("@screened_endorser");
    expect(screened).toContain("no follow");
    expect(screened).toContain("no ack");
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

  it("labels a persisted live result as saved and links the exact immutable snapshot", () => {
    const reportVersionId = "00000000-0000-4000-8000-000000000201";
    const dossier = {
      ...buildReport(SUBJECTS[1]),
      persistence: {
        state: "persisted" as const,
        reportVersionId,
        panelCostToken: "signed-panel-capability",
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    const snapshotLink = container.querySelector<HTMLAnchorElement>(`a[href="/?version=${reportVersionId}"]`);
    expect(snapshotLink?.textContent?.trim()).toBe("SAVED REPORT");
    expect(snapshotLink?.title).toContain("exact immutable snapshot");
    expect(snapshotLink?.target).toBe("_blank");
    expect(container.textContent).toContain("core snapshot saved");
    expect(container.textContent).not.toContain("live collection");
    expect(container.textContent).toContain("Live supplemental intelligence");
    expect(container.textContent).toContain("not included in the immutable Share payload or scored verdict");
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
      .find((button) => button.textContent?.trim() === "Refresh live intelligence");
    expect(loadOverlay).toBeDefined();
    act(() => loadOverlay?.click());

    expect(container.textContent).toContain("Current intelligence · fetched now · not part of snapshot v6 · does not change stored verdict");
    expect(harness.livePanel.mock.calls.find(([panel]) => panel === "ring-alert")?.[1]).toEqual(
      expect.objectContaining({ snapshotVersion: 6 }),
    );
  });
});

describe("decision-safe person report presentation", () => {
  it("keeps verified project-token fundamentals above an incomplete decision state", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Jupiter",
      bio: "Just use crypto, Just use Jupiter",
      website: "https://jup.ag/",
      completeness_state: "partial" as const,
      projectToken: {
        verified: true as const,
        verification: "official_x" as const,
        name: "Jupiter",
        symbol: "JUP",
        coingeckoId: "jupiter-exchange-solana",
        rank: 89,
        address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
        chain: "solana",
        officialX: "@JupiterExchange",
        sourceUrl: "https://www.coingecko.com/en/coins/jupiter-exchange-solana",
        capturedAt: "2026-07-12T22:37:00.000Z",
        priceUsd: 0.2,
        marketCapUsd: 620_000_000,
        liquidityUsd: 18_000_000,
        history: {
          points: [0.18, 0.21, 0.2],
          first: 0.18,
          last: 0.2,
          peak: 0.21,
          changePct: 11.1,
          drawdownPct: -4.8,
          timeframe: "day" as const,
          poolAddress: "jup-usdc",
        },
      },
      report: {
        ...base.report,
        roles: ["PROJECT"],
        role_reports: [],
        governing_role: "PROJECT",
        governing_score: null,
        composite_verdict: "INCOMPLETE" as const,
      },
    } as unknown as Dossier;

    act(() => root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />));

    const tokenSection = container.querySelector("#project-token");
    const decisionSummary = container.querySelector("#decision-summary");
    expect(tokenSection).not.toBeNull();
    expect(decisionSummary).not.toBeNull();
    expect(tokenSection?.textContent).toContain("$JUP");
    expect(tokenSection?.textContent).toContain("$620.00M");
    expect(tokenSection?.querySelector("svg polygon")).not.toBeNull();
    expect(tokenSection!.compareDocumentPosition(decisionSummary!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses the stored project website for project intelligence when the bio has no domain", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      bio: "Just use crypto, Just use Jupiter",
      website: "https://jup.ag/",
      persistence: {
        state: "persisted" as const,
        reportVersionId: "00000000-0000-4000-8000-000000000250",
        panelCostToken: "signed-panel-capability",
      },
      report: { ...base.report, roles: ["PROJECT"], governing_role: "PROJECT" },
    } as unknown as Dossier;

    act(() => root.render(<Report dossier={dossier} onReset={() => {}} />));

    expect(harness.livePanel.mock.calls.find(([name]) => name === "project-intel")?.[1]).toEqual({ domain: "jup.ag" });
  });

  it("presents an unrouted project attempt as collected intelligence, never decision-ready", () => {
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
      graph: {
        nodes: [
          ...base.graph.nodes,
          { type: "Person", key: "<unknown>", label: "<UNKNOWN>", role: "<UNKNOWN>" },
        ],
        edges: [
          ...base.graph.edges,
          { src: base.report.handle, dst: "<unknown>", type: "TEAM" },
        ],
      },
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
    expect(container.textContent).toContain("Coverage 0%");
    expect(container.textContent).toContain("Resolve whether this account represents a project, organization, token, or person");
    expect(container.textContent).toContain("Data coverage notes");
    expect(container.textContent).toContain("Identity resolution");
    expect(container.textContent).toContain("Provider returned no identity match");
    expect([...container.querySelectorAll("span")].some((node) => node.textContent?.trim() === "decision-ready")).toBe(false);
    expect(container.textContent).not.toContain("<UNKNOWN>");
    expect(harness.trustGraph).toHaveBeenCalledWith(expect.objectContaining({
      nodes: expect.not.arrayContaining([expect.objectContaining({ key: "<unknown>" })]),
      edges: expect.not.arrayContaining([expect.objectContaining({ dst: "<unknown>" })]),
    }));
    expect(decisionBasisText()).toContain("No evidence-backed role selected a scoring methodology");
    expect(decisionBasisText()).not.toContain("predates strict evidence-to-axis citations");
  });

  it("presents a resolved Project role with zero axes as incomplete scoring, not failed routing", () => {
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
      report: {
        ...base.report,
        roles: ["PROJECT"],
        role_reports: [{
          role: "PROJECT",
          verdict: "INCOMPLETE",
          raw_total: 0,
          score_total: 0,
          cap_applied: null,
          dox_bonus: 0,
          axes: {},
        }],
        governing_role: "PROJECT",
        governing_score: null,
        composite_verdict: "INCOMPLETE" as const,
      },
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onRescan={() => {}} />);
    });

    expect(container.textContent).toContain("Scoring output incomplete");
    expect(container.textContent).toContain("ARGUS resolved this subject to Project, but the scoring pass did not complete");
    expect(container.textContent).toContain("Coverage 0%");
    expect(container.textContent).toContain("What ARGUS found before the decision failed");
    expect(container.textContent).toContain("Complete the Project scoring pass");
    expect(container.textContent).not.toContain("Project routing unresolved");
    expect(container.textContent).not.toContain("Resolve whether this account represents a project");
    expect([...container.querySelectorAll("span")].some((node) => node.textContent?.trim() === "decision-ready")).toBe(false);
    expect(decisionBasisText()).toContain("resolved an evidence-backed role");
    expect(decisionBasisText()).not.toContain("No evidence-backed role selected a scoring methodology");
  });

  it("explains an adverse verdict with adverse drivers and labels positive evidence as counterweight", () => {
    const dossier = buildReport(SUBJECTS[0]);

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(dossier.report.composite_verdict).not.toBe("PASS");
    const verdictDrivers = container.querySelector('section[aria-labelledby="verdict-rationale-title"]')?.textContent ?? "";
    const counterweight = container.querySelector('section[aria-labelledby="confidence-limits-title"]')?.textContent ?? "";
    expect(verdictDrivers).toMatch(/hard cap governs|is thin|assessed with no positive record|No token could be tied|No outside backers/i);
    // The risk section leads with findings, never with our own process status.
    expect(verdictDrivers).not.toContain("needs more verification");
    expect(verdictDrivers).not.toContain("Treat the score and verdict as provisional");
    expect(counterweight).toContain("What argues against the risk case");
  });

  it("titles assessed-null axes with their deterministic finding and keeps coverage out of the risk section", () => {
    const base = buildReport(SUBJECTS[0]);
    const governing = base.report.role_reports.find((role) => role.role === base.report.governing_role)!;
    const axisName = Object.keys(governing.axes)[0]!;
    const artifactId = `art_v1_${"c".repeat(64)}`;
    const dossier = {
      ...base,
      axisCitationVersion: 1 as const,
      axisEvidenceCatalog: [{
        artifactId,
        kind: "axis_evidence" as const,
        provider: "project-core-evidence",
        operation: "checkOutcomes:project-backing-partners",
        section: "checkOutcomes",
        title: "Assessed backing and partners: no verified backer appears",
        contentHash: "c".repeat(64),
        eligibleAxes: [axisName],
        verification: "verified" as const,
        scope: "direct_subject" as const,
      }],
      projectStrengthBands: {
        [axisName]: {
          tier: "assessed_null" as const,
          minScore: 0,
          maxScore: 5,
          reasons: ["completed backing assessment found no verified backer or partner"],
          anchorArtifactIds: [artifactId],
        },
      },
      report: {
        ...base.report,
        role_reports: base.report.role_reports.map((role) => role.role === governing.role ? {
          ...role,
          axes: {
            ...role.axes,
            [axisName]: { ...role.axes[axisName], score: 0, evidenceRefs: [artifactId] },
          },
        } : role),
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    const verdictDrivers = container.querySelector('section[aria-labelledby="verdict-rationale-title"]')?.textContent ?? "";
    expect(verdictDrivers).toMatch(/assessed with no positive record|No token could be tied|No outside backers/);
    expect(verdictDrivers).not.toContain("needs more verification");
  });

  it("translates internal axis and provider language into an investor-readable summary", () => {
    const base = buildReport(SUBJECTS[1]);
    const governing = base.report.role_reports.find((role) => role.role === base.report.governing_role)!;
    const originalAxisName = Object.keys(governing.axes)[0]!;
    const artifactId = `art_v1_${"a".repeat(64)}`;
    const dossier = {
      ...base,
      axisCitationVersion: 1 as const,
      axisEvidenceCatalog: [{
        artifactId,
        kind: "axis_evidence" as const,
        provider: "frozen-provider",
        operation: "project-diligence",
        section: "governing-axis",
        title: "Verified operating-team source",
        contentHash: "b".repeat(64),
        eligibleAxes: [originalAxisName],
        verification: "verified" as const,
        scope: "direct_subject" as const,
      }],
      providerSnapshot: {
        capturedAt: "2026-07-12T20:00:00.000Z",
        runs: [
          { id: "crunchbase", label: "Crunchbase", state: "unavailable" as const, observedAt: "2026-07-12T20:00:00.000Z" },
          { id: "reddit", label: "Reddit", state: "failed" as const, observedAt: "2026-07-12T20:00:00.000Z" },
        ],
      },
      checkRuns: [{
        checkId: "project-disclosures",
        label: "Transparency and disclosures",
        status: "unknown" as const,
        provider: "project-disclosure-collector",
        decisionCritical: true,
      }, {
        checkId: "optional-enrichment",
        label: "Optional social enrichment",
        status: "unavailable" as const,
        provider: "optional-provider",
        decisionCritical: false,
      }],
      report: {
        ...base.report,
        role_reports: base.report.role_reports.map((role) => role.role === governing.role ? {
          ...role,
          axes: {
            ...role.axes,
            [originalAxisName]: {
              ...governing.axes[originalAxisName]!,
              evidenceRefs: [artifactId],
              gaps: ["Confirm the current operating team."],
            },
          },
        } : role),
      },
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    // The rail duplicates are gone; the same translation contract now applies
    // to the decision-basis panel and the single verification list: axis keys
    // and investigator vocabulary never reach the investor.
    const decisionBasis = container.querySelector("#decision-basis")?.textContent ?? "";
    const verificationSection = container.querySelector("#verification-next")?.textContent ?? "";
    expect(decisionBasis).not.toContain(originalAxisName);
    expect(decisionBasis).not.toMatch(/[A-Z]\d+_/);
    expect(verificationSection).not.toMatch(/[A-Z]\d+_/);
    expect(container.textContent).toMatch(/Strong evidence|Moderate evidence|Limited evidence/);
    // Provider diagnostics stay in the methodology ledger; they never leak
    // into the decision summary or the verification list.
    const summarySurfaces = `${container.querySelector("#decision-summary")?.textContent ?? ""}${verificationSection}`;
    expect(summarySurfaces).not.toContain("Optional social enrichment");
    expect(summarySurfaces).not.toContain("Crunchbase");
    expect(summarySurfaces).not.toContain("Reddit");
    // The gap renders exactly once outside its axis detail panel: in the
    // verification list, never as a thesis risk.
    const gapMatches = (container.textContent ?? "").split("Confirm the current operating team.").length - 1;
    expect(gapMatches).toBeGreaterThanOrEqual(1);
    const thesisSection = container.querySelector("#confidence-limits")?.textContent ?? "";
    expect(thesisSection).not.toContain("Confirm the current operating team.");
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
    const decisionResult = container.querySelector<HTMLElement>('[aria-label="Decision readiness result"]');
    expect(decisionResult?.classList.contains("max-sm:grid")).toBe(true);
    const preliminarySignal = [...container.querySelectorAll<HTMLElement>(".chip")]
      .find((chip) => chip.textContent?.includes("PRELIMINARY MODEL SIGNAL"));
    expect(preliminarySignal?.classList.contains("chip-wrap")).toBe(true);
  });

  it("keeps a supported 71 PASS signal provisional while a sanctions screen remains open (never-waive)", () => {
    const base = buildReport(SUBJECTS[1]);
    const governing = base.report.role_reports.find((role) => role.role === base.report.governing_role)!;
    const catalog = Object.keys(governing.axes).map((axis, index) => {
      const hash = "abcdef"[index]!.repeat(64);
      return {
        artifactId: `art_v1_${hash}`,
        kind: "axis_evidence" as const,
        provider: "frozen-provider",
        operation: "project-diligence",
        section: "governing-axis",
        title: `${axis} supporting artifact`,
        contentHash: hash,
        eligibleAxes: [axis],
        verification: "verified" as const,
        scope: "direct_subject" as const,
      };
    });
    const axes = Object.fromEntries(Object.entries(governing.axes).map(([axis, score], index) => [
      axis,
      { ...score, evidenceRefs: [catalog[index]!.artifactId] },
    ]));
    // 10/13 recorded is above the clearance floor, but one open check is the
    // OFAC sanctions screen: a never-waive safety screen always withholds
    // final clearance regardless of coverage.
    const checks = Array.from({ length: 13 }, (_, index) => ({
      checkId: index === 10 ? "ofac-sanctions-name" : `check-${index + 1}`,
      label: index === 10 ? "OFAC sanctions (name)" : `Evidence check ${index + 1}`,
      status: index < 10 ? "confirmed" as const : "unknown" as const,
      provider: "frozen-provider",
      sourceCount: index < 10 ? 1 : 0,
    }));
    const dossier = {
      ...base,
      axisCitationVersion: 1 as const,
      axisEvidenceCatalog: catalog,
      completeness_state: "partial" as const,
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000301",
        reportVersionId: "00000000-0000-4000-8000-000000000302",
        version: 1,
        completenessState: "partial" as const,
        attestationState: "server_collected" as const,
        methodologyVersion: "project-v1",
        createdAt: "2026-07-12T22:00:00.000Z",
        checks,
      },
      report: {
        ...base.report,
        governing_score: 71,
        composite_verdict: "PASS" as const,
        role_reports: base.report.role_reports.map((role) => role.role === governing.role
          ? { ...role, raw_total: 71, score_total: 71, verdict: "PASS", axes }
          : role),
      },
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect([...container.querySelectorAll(".display")].some((node) => node.textContent?.trim() === "PROVISIONAL")).toBe(true);
    expect(container.textContent).toContain("provisional score");
    expect(container.textContent).toContain("PASS SIGNAL");
    expect(container.textContent).toContain("Coverage 76%");
    expect(container.textContent).toContain("Coverage 76%");
    expect(container.textContent).toContain("10/13");
    expect(container.textContent).toContain("6 of 6 diligence areas have cited support");
    expect(container.textContent).toContain("3 open questions");
    expect(container.textContent).toContain("Also open: 3 decision questions");
    expect(container.textContent).toContain("Final clearance remains withheld");
    expect(container.textContent).toContain("Evidence-backed scored-axis breakdown");
    expect(container.textContent).toContain("= provisional 71");
    expect(container.textContent).not.toContain("score withheld");
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

    expect(container.textContent).toContain("Sources we saved");
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

    expect(container.textContent).toContain("Profile-photo check");
    expect(container.textContent).toContain("a quick photo check, not identity proof");
    expect(container.textContent).toContain("AI-generated image lead");
    expect(container.textContent).toContain("cannot prove image ownership, identity, or web-wide reuse");
    expect(container.textContent).toContain(`Source image SHA-256 ${imageHash.slice(0, 12)}…`);
    expect(container.querySelector('img[src="data:image/jpeg;base64,YWJj"]')).not.toBeNull();
    expect(container.textContent).toContain("exact image bytes retained with this report");

    expect(container.textContent).toContain("Known connections");
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
          label: "Profile-photo check",
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

  it("repairs a frozen probable label only when the snapshot already contains a licensed full-name resolution", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      display_name: "Georgios Konstantopoulos",
      report: {
        ...base.report,
        identity_confidence: "Probable" as const,
      },
      checkRuns: [{
        checkId: "identity-resolution",
        label: "Identity resolution",
        status: "confirmed" as const,
        note: "GitHub account gakonst links back to @gakonst · licensed identity record resolved to Georgios Konstantopoulos",
        provider: "github,peopledatalabs",
        sourceCount: 2,
      }],
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} />);
    });

    expect(container.textContent).toContain("Identity verified");
    expect(container.textContent).not.toContain("Identity probable");
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
        label: "Profile-photo check",
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

    expect(container.textContent).toContain("Worth a second look");
    expect(container.textContent).toContain("About an associate");
    expect(container.textContent).toContain("unconfirmed · not scored");
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
    expect(container.textContent).toContain("Worth a second look");
    expect(container.textContent).toContain("About a related company");
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

    expect(container.textContent).toContain("confirmed about the named entity · not scored");
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
    expect(container.textContent).toContain("report was saved before per-check results were recorded");
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
    expect(container.textContent).toContain("Checks1/1");
    expect(container.querySelector('a[href="#scan-methodology"]')).not.toBeNull();
    expect(container.querySelector("#scan-methodology")).not.toBeNull();
  });

  it("hides impossible legacy scoring dates while preserving the immutable save time", () => {
    const base = buildReport(SUBJECTS[1]);
    const dossier = {
      ...base,
      report: {
        ...base.report,
        finalized_at: "1970-01-01T00:00:00.000Z",
      },
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000101",
        reportVersionId: "00000000-0000-4000-8000-000000000203",
        version: 3,
        completenessState: "complete" as const,
        attestationState: "server_collected" as const,
        methodologyVersion: "argus-person-v1",
        createdAt: "2026-07-23T12:05:00.000Z",
        checks: [],
      },
    };

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("Report saved");
    expect(container.textContent).not.toContain("1970");
  });

  it("does not manufacture a founder token warning or empty outcome summary from absent structured claims", () => {
    const base = buildReport(SUBJECTS[1]);
    const hash = "a".repeat(64);
    const dossier = {
      ...base,
      founderSummary: {
        pattern: "Unproven",
        repeat_backing: {
          strength: "none" as const,
          repeat_backers: [],
          from_successful_exit: false,
        },
      },
      basicFacts: [{
        factId: "public-security",
        subjectKey: base.handle,
        predicate: "public_security",
        value: "NASDAQ: COIN",
        normalizedValue: "nasdaq coin",
        status: "verified",
        critical: true,
        sources: [{
          url: "https://www.sec.gov/Archives/edgar/data/1679788/",
          title: "SEC issuer record",
          sourceClass: "regulatory_or_onchain",
          relation: "supports",
          excerpt: "Coinbase Global, Inc. trades on Nasdaq under COIN.",
          contentHash: hash,
          capturedAt: "2026-07-14T00:00:00.000Z",
          provider: "sec-registry",
          artifactVerified: true,
        }],
        evidence_origin: "deterministic",
        artifact_verified: true,
        provider: "public-web",
      }],
      basicFactQuestionLedger: [{
        questionId: "founder.official_token",
        audience: "person",
        batch: "track_record",
        predicate: "official_token",
        question: "Is an official crypto token tied to a venture they control?",
        critical: true,
        status: "unanswered",
        answerRefs: [],
        providerRuns: [{ phase: "primary", provider: "test", state: "failed" }],
      }],
      basicFactLeads: [{
        subject: base.handle,
        predicate: "official_token",
        value: "cbBTC",
        excerpt: "Coinbase offers a wrapped Bitcoin token.",
        sourceUrl: "https://www.coinbase.com/cbbtc",
        sourceTitle: "Coinbase cbBTC",
        evidence_origin: "model_lead",
        artifact_verified: false,
        provider: "claude-web-search",
      }],
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.textContent).toContain("NASDAQ: COIN");
    expect(container.textContent).not.toContain("Token identity unresolved");
    expect(container.textContent).not.toContain("Founder pattern");
  });

  it("keeps not-applicable cited operations out of investor follow-ups", () => {
    const base = buildReport(SUBJECTS[1]);
    const governing = base.report.role_reports.find((role) => role.role === base.report.governing_role)!;
    const axis = Object.keys(governing.axes)[0]!;
    const hash = "b".repeat(64);
    const artifactId = `art_v1_${hash}`;
    const roleReports = base.report.role_reports.map((role) => role !== governing
      ? role
      : {
          ...role,
          axes: {
            ...role.axes,
            [axis]: {
              ...role.axes[axis],
              evidenceRefs: [artifactId],
              counterEvidenceRefs: [],
              gaps: [],
            },
          },
        });
    const dossier = {
      ...base,
      report: { ...base.report, role_reports: roleReports },
      axisCitationVersion: 1 as const,
      axisEvidenceCatalog: [{
        kind: "axis_evidence",
        artifactId,
        provider: "twitterapi",
        operation: "checkOutcomes:promoted-token-performance",
        section: "methodology",
        title: "Promoted-token performance",
        excerpt: "Not a KOL.",
        contentHash: hash,
        capturedAt: "2026-07-14T00:00:00.000Z",
        verification: "unavailable",
        relation: "supports",
        scope: "direct_subject",
        eligibleAxes: [axis],
      }],
      versionContext: {
        caseId: "00000000-0000-4000-8000-000000000301",
        reportVersionId: "00000000-0000-4000-8000-000000000302",
        version: 4,
        completenessState: "complete" as const,
        attestationState: "server_collected" as const,
        methodologyVersion: "argus-person-v5",
        createdAt: "2026-07-14T00:00:00.000Z",
        checks: [{
          checkId: "promoted-token-performance",
          label: "Promoted-token performance",
          status: "not-applicable" as const,
          note: "not a KOL",
        }],
      },
    } as unknown as Dossier;

    act(() => {
      root.render(<Report dossier={dossier} onReset={() => {}} onAudit={() => {}} />);
    });

    expect(container.querySelector("#verification-next")?.textContent)
      .not.toContain("Promoted-token performance");
  });
});
