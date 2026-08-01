// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Dossier } from "../data/dossier";
import { buildReport, SUBJECTS } from "../data/subjects";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../auth-context", () => ({ useArgusAuth: () => ({ role: "owner" }) }));
vi.mock("../graph/store", () => ({ getContributions: () => [] }));
vi.mock("../graph/network", () => ({ subjectConnections: () => [] }));
vi.mock("./RingAlert", () => ({ RingAlert: () => null }));
vi.mock("./SanctionsNameScreen", () => ({ SanctionsNameScreen: () => null }));
vi.mock("./LegalScreen", () => ({ LegalScreen: () => null }));
vi.mock("./PfpCheck", () => ({ PfpCheck: () => null }));
vi.mock("./PersonGithub", () => ({ PersonGithub: () => null }));
vi.mock("./VcReport", () => ({ VcReport: () => null }));
vi.mock("./KolReport", () => ({ KolReport: () => null }));
vi.mock("./ProjectIntel", () => ({ ProjectIntel: () => null }));
vi.mock("./NewsSection", () => ({ NewsSection: () => null }));
vi.mock("./IdentitySweep", () => ({ IdentitySweep: () => null }));
vi.mock("./AddInfo", () => ({ AddInfo: () => null }));
vi.mock("./LinkEntity", () => ({ LinkEntity: () => null }));
vi.mock("./ServiceAlert", () => ({ ServiceAlert: () => <div>service-ready</div> }));
vi.mock("./TrustGraph", () => ({ TrustGraph: () => null }));
vi.mock("./AskReport", () => ({ AskReport: () => null }));
vi.mock("./Avatar", () => ({ Avatar: () => null }));
vi.mock("./ArgusMark", () => ({ ArgusMark: () => null }));

import { Report } from "./Report";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type Lead = Dossier["report"]["investigative_leads"][number];

const base = buildReport(SUBJECTS[1]);

const subjectLead: Lead = {
  finding_type: "AdverseLead",
  claim: `${base.report.handle} (rug pull accusation lead): a complaint thread names the subject as the operator of a drained pool.`,
  source_url: "https://example.com/subject-complaint",
  source_date: "",
  source_author: "candidate complaint index",
  verification_status: "Rumor",
  independent_source_count: 1,
  polarity: -1,
  evidence_origin: "model_lead",
  artifact_verified: false,
  finding_scope: {
    scope: "direct_subject",
    target_entity_key: base.report.handle,
    target_entity_type: "person",
    relationship_to_subject: "self",
    relationship_label: "audited subject",
  },
};

const associateLead: Lead = {
  finding_type: "AdverseLead",
  claim: "@associate (scam accusation lead): a complaint page names the associate.",
  source_url: "https://example.com/associate-complaint",
  source_date: "",
  source_author: "candidate complaint index",
  verification_status: "Rumor",
  independent_source_count: 1,
  polarity: -1,
  evidence_origin: "model_lead",
  artifact_verified: false,
  finding_scope: {
    scope: "related_entity",
    target_entity_key: "@associate",
    target_entity_type: "person",
    relationship_to_subject: "associate",
    relationship_label: "recorded collaborator",
  },
};

/** A clean, complete, scored PASS: the exact shape that used to print an
 *  unqualified all-clear regardless of what the sweep found. */
function favorablePassDossier(leads: Lead[]): Dossier {
  return {
    ...base,
    contradictions: [],
    completeness_state: "complete",
    checkRuns: [
      { label: "Sanctions screen", status: "checked-empty", note: "No sanctions match recorded." },
      { label: "Legal history", status: "checked-empty", note: "No court record recorded." },
      { label: "Adverse media", status: "checked-empty", note: "No adverse press recorded." },
    ],
    report: {
      ...base.report,
      composite_verdict: "PASS",
      verdict: "PASS",
      governing_score: 82,
      score_total: 82,
      cap_applied: null,
      publishable_findings: [],
      investigative_leads: leads,
    },
  };
}

function render(dossier: Dossier) {
  act(() => {
    root.render(<Report dossier={dossier} onReset={() => {}} />);
  });
}

function concernsText(): string {
  return container.querySelector("#confidence-limits")?.textContent ?? "";
}

function supportLineText(): string {
  return container.querySelector('[aria-label="Verdict support summary"]')?.textContent ?? "";
}

describe("favorable person report with adverse leads about the subject", () => {
  it("still prints the all-clear when nothing adverse names the subject", () => {
    render(favorablePassDossier([]));

    expect(concernsText()).toContain("No adverse findings in the collected evidence");
    expect(supportLineText()).toContain("0 warning signs");
    expect(container.querySelector("#subject-leads")).toBeNull();
  });

  it("never claims an all-clear while an unverified adverse lead names the subject", () => {
    render(favorablePassDossier([subjectLead]));

    expect(concernsText()).not.toContain("No adverse findings in the collected evidence");
    expect(concernsText()).toContain("1 unverified adverse lead");
    expect(concernsText()).toContain("drained pool");
  });

  it("keeps the subject lead out of the zero-warning-signs support line", () => {
    render(favorablePassDossier([subjectLead]));

    expect(supportLineText()).not.toContain("0 warning signs");
    expect(supportLineText()).toContain("1 unverified lead");
    expect(container.querySelector('a[href="#subject-leads"]')).not.toBeNull();
  });

  it("gives subject-scoped leads their own card that is open by default", () => {
    render(favorablePassDossier([subjectLead]));

    const card = container.querySelector("#subject-leads");
    expect(card).not.toBeNull();
    // An open question about the subject must not hide behind a disclosure the
    // reader has to find.
    expect(card?.querySelector("details")).toBeNull();
    expect(card?.textContent).toContain("drained pool");
    expect(card?.textContent).toContain(base.report.handle);
    // A rumor stays a rumor: never promoted into the findings ledger.
    expect(container.querySelector("#publishable-findings")).toBeNull();
    expect(card?.textContent).toContain("never counted in this score");
  });

  it("keeps the lead a rumor: no ledger promotion, no verified tone, no score move", () => {
    render(favorablePassDossier([subjectLead]));

    const card = container.querySelector("#subject-leads");
    expect(card?.textContent).toContain("unconfirmed · not scored");
    expect(card?.textContent).not.toContain("Confirmed findings");
    expect(container.querySelector("#publishable-findings")).toBeNull();
    // The verdict and the score are the engine's, and an uncorroborated lead
    // never touches either.
    expect(container.querySelector("span.display")?.textContent).toBe("PASS");
    expect(container.textContent).toContain("82");
  });

  it("does not describe a subject lead as an item about a related company", () => {
    render(favorablePassDossier([subjectLead]));

    const related = container.querySelector("#investigative-leads");
    expect(related).toBeNull();
    expect(container.textContent).not.toContain("items about related people and companies");
  });

  it("keeps related-entity leads collapsed and separate from subject leads", () => {
    render(favorablePassDossier([subjectLead, associateLead]));

    const subjectCard = container.querySelector("#subject-leads");
    expect(subjectCard?.textContent).toContain("drained pool");
    expect(subjectCard?.textContent).not.toContain("names the associate");

    const related = container.querySelector("#investigative-leads");
    expect(related?.querySelector("details")).not.toBeNull();
    expect(related?.textContent).toContain("names the associate");
    expect(related?.textContent).not.toContain("drained pool");
  });

  it("leaves the all-clear intact when only a related entity is named", () => {
    render(favorablePassDossier([associateLead]));

    expect(concernsText()).toContain("No adverse findings in the collected evidence");
    expect(supportLineText()).toContain("0 warning signs");
    expect(container.querySelector("#subject-leads")).toBeNull();
    expect(container.querySelector("#investigative-leads")).not.toBeNull();
  });
});
