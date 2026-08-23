// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  DecisionLens,
  DerivedIntelligenceSignal,
  IntelligenceDomainCoverage,
  IntelligenceSpineSnapshot,
} from "../intelligence/types";
import { PointInTimeIntelligencePanel } from "./PointInTimeIntelligencePanel";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const capturedEarly = "2026-08-01T10:00:00.000Z";
const capturedLate = "2026-08-01T10:30:00.000Z";

function signal(overrides: Partial<DerivedIntelligenceSignal> & Pick<DerivedIntelligenceSignal, "id" | "headline">): DerivedIntelligenceSignal {
  const { id, headline, ...rest } = overrides;
  return {
    id,
    ruleId: `rule:${id}`,
    ruleVersion: 1,
    kind: "observation",
    domain: "product",
    severity: "medium",
    polarity: "neutral",
    headline,
    finding: `${headline} finding`,
    whyItMatters: `${headline} matters to the decision`,
    changeCondition: `Recheck ${headline.toLowerCase()}`,
    evidenceState: "verified",
    measurementRefs: [],
    sourceRefs: ["source:official"],
    lenses: ["general_diligence"],
    ...rest,
  };
}

function lens(overrides: Partial<DecisionLens> & Pick<DecisionLens, "id">): DecisionLens {
  const { id, ...rest } = overrides;
  const labels: Record<DecisionLens["id"], string> = {
    investment: "Investment",
    alpha_research: "Alpha research",
    counterparty: "Counterparty",
    general_diligence: "General diligence",
  };
  return {
    id,
    label: labels[id],
    question: `Question for ${labels[id]}`,
    domainPriority: id === "investment"
      ? ["control", "security", "treasury", "supply", "economics", "liquidity", "team", "legal", "market"]
      : id === "alpha_research"
        ? ["supply", "liquidity", "market", "economics", "chronology", "product"]
        : id === "counterparty"
          ? ["identity", "legal", "control", "security", "team", "treasury", "product"]
          : ["identity", "product", "team", "market", "liquidity", "supply", "economics", "funding", "treasury", "governance", "control", "security", "legal", "chronology"],
    signalIds: [],
    unresolvedQuestionIds: [],
    changeConditions: [],
    ...rest,
  };
}

function coverage(overrides: Partial<IntelligenceDomainCoverage> & Pick<IntelligenceDomainCoverage, "domain">): IntelligenceDomainCoverage {
  const { domain, ...rest } = overrides;
  return {
    domain,
    state: "measured",
    measurementIds: [],
    questionIds: [],
    detail: `${domain} was measured`,
    ...rest,
  };
}

function snapshot(overrides: Partial<IntelligenceSpineSnapshot> = {}): IntelligenceSpineSnapshot {
  const signals: DerivedIntelligenceSignal[] = [
    signal({
      id: "support-liquidity",
      headline: "Exit liquidity is meaningful",
      kind: "arithmetic",
      domain: "liquidity",
      severity: "high",
      polarity: "support",
      evidenceState: "measured",
      measurementRefs: ["measure:liquidity", "measure:market-cap"],
      lenses: ["investment", "alpha_research"],
      changeCondition: "Measured exit liquidity falls below the recorded level",
      arithmetic: [{
        expression: "liquidity_usd / market_cap_usd * 100",
        value: 12.5,
        unit: "percent",
        inputMeasurementIds: ["measure:liquidity", "measure:market-cap"],
        temporal: {
          state: "aligned",
          maxInputSkewHours: 0.5,
          inputAsOf: [
            { measurementId: "measure:liquidity", asOf: capturedEarly },
            { measurementId: "measure:market-cap", asOf: capturedLate },
          ],
        },
      }],
    }),
    signal({
      id: "risk-control",
      headline: "One controller can change the system",
      domain: "control",
      severity: "high",
      polarity: "risk",
      lenses: ["investment", "counterparty"],
      changeCondition: "Control moves to a verified delayed multisig",
    }),
    signal({
      id: "alpha-supply",
      headline: "A scheduled unlock adds supply pressure",
      kind: "screening_heuristic",
      domain: "supply",
      severity: "medium",
      polarity: "risk",
      evidenceState: "bounded",
      lenses: ["alpha_research"],
      changeCondition: "The unlock schedule or destination changes",
    }),
    signal({
      id: "general-identity",
      headline: "The operating entity is source backed",
      domain: "identity",
      severity: "low",
      polarity: "support",
      lenses: ["general_diligence", "counterparty"],
      changeCondition: "The entity record or official binding changes",
    }),
    signal({
      id: "coverage-treasury",
      headline: "Treasury runway was not collected",
      kind: "coverage_gap",
      domain: "treasury",
      severity: "context",
      polarity: "unknown",
      evidenceState: "bounded",
      sourceRefs: [],
      lenses: ["investment", "general_diligence"],
      changeCondition: "Bound treasury addresses and liabilities are measured",
    }),
  ];

  return {
    schemaVersion: 1,
    rulesetVersion: "argus-point-in-time-v1",
    mode: "point_in_time",
    scoringImpact: "none",
    subject: {
      key: "project:argus",
      label: "Argus Protocol",
      forms: [
        { form: "protocol", evidenceState: "verified", sourceRefs: ["source:official"] },
        { form: "token", evidenceState: "verified", sourceRefs: ["source:official"] },
      ],
      archetypes: {
        state: "resolved",
        primary: "dex",
        matches: [{
          archetype: "dex",
          confidence: "strict_source_backed",
          sourceRefs: ["source:official"],
        }],
      },
    },
    captureWindow: { earliest: capturedEarly, latest: capturedLate },
    sources: [{
      id: "source:official",
      inputPath: "basicFacts.product",
      provider: "official-site",
      title: "Official project documentation",
      sourceClass: "official_subject",
      evidenceState: "verified",
      sourceUrl: "https://example.com/docs",
      capturedAt: capturedEarly,
      providerUpdatedAt: "2026-08-01T09:55:00.000Z",
    }],
    measurements: [{
      id: "measure:liquidity",
      domain: "liquidity",
      label: "Exit liquidity",
      unit: "usd",
      entityKey: "token:arg",
      evidenceState: "measured",
      sourceRefs: ["source:official"],
      valueType: "number",
      value: 12_500_000,
    }, {
      id: "measure:market-cap",
      domain: "market",
      label: "Market capitalization",
      unit: "usd",
      entityKey: "token:arg",
      evidenceState: "measured",
      sourceRefs: ["source:official"],
      valueType: "number",
      value: 100_000_000,
    }],
    questions: [{
      id: "question:treasury",
      domain: "treasury",
      prompt: "What is the liquidation adjusted treasury runway?",
      materiality: "critical",
      state: "not_collected",
      basis: "No bound treasury set was collected",
      answerRefs: [],
      sourceRefs: [],
    }, {
      id: "question:governance",
      domain: "governance",
      prompt: "Can governance be bypassed?",
      materiality: "important",
      state: "partial",
      basis: "Only Snapshot proposals were available",
      answerRefs: [],
      sourceRefs: ["source:official"],
    }, {
      id: "question:product",
      domain: "product",
      prompt: "Is the product live?",
      materiality: "critical",
      state: "resolved",
      basis: "A live product was verified",
      answerRefs: ["support-liquidity"],
      sourceRefs: ["source:official"],
    }],
    coverage: [
      coverage({ domain: "liquidity", measurementIds: ["measure:liquidity"] }),
      coverage({ domain: "market", measurementIds: ["measure:market-cap"] }),
      coverage({
        domain: "governance",
        state: "partial",
        questionIds: ["question:governance"],
        detail: "Offchain proposals were collected; execution authority was not",
      }),
    ],
    signals,
    lenses: [
      lens({
        id: "general_diligence",
        signalIds: ["general-identity", "coverage-treasury", "risk-control", "support-liquidity", "alpha-supply"],
        unresolvedQuestionIds: ["question:governance", "question:treasury"],
        changeConditions: ["The official entity binding changes"],
      }),
      lens({
        id: "counterparty",
        signalIds: ["risk-control", "general-identity"],
        unresolvedQuestionIds: ["question:governance"],
        changeConditions: ["Execution authority moves to a delayed multisig"],
      }),
      lens({
        id: "alpha_research",
        signalIds: ["alpha-supply", "support-liquidity"],
        unresolvedQuestionIds: ["question:treasury"],
        changeConditions: ["The next unlock date changes"],
      }),
      lens({
        id: "investment",
        signalIds: ["support-liquidity", "risk-control", "coverage-treasury"],
        unresolvedQuestionIds: ["question:treasury", "question:governance"],
        changeConditions: ["Verified control or liquidity evidence changes"],
      }),
    ],
    ...overrides,
  };
}

function signalIds(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>("[data-signal-id]")]
    .map((item) => item.dataset.signalId ?? "");
}

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

function render(value: IntelligenceSpineSnapshot, thesisEligible = true, governingVerdict: string | null = null) {
  act(() => {
    root.render(
      <PointInTimeIntelligencePanel
        snapshot={value}
        thesisEligible={thesisEligible}
        governingVerdict={governingVerdict}
      />,
    );
  });
}

describe("PointInTimeIntelligencePanel", () => {
  it("defaults to investment and keeps the complete signal set across accessible lenses", () => {
    render(snapshot());

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      "Investment",
      "Alpha research",
      "Counterparty",
      "General diligence",
    ]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe(tabs[0].id);

    const investmentOrder = signalIds(container);
    expect(investmentOrder).toHaveLength(5);
    expect(investmentOrder.slice(0, 3)).toEqual([
      "support-liquidity",
      "risk-control",
      "coverage-treasury",
    ]);

    act(() => tabs[1].click());
    const alphaOrder = signalIds(container);
    expect(alphaOrder[0]).toBe("alpha-supply");
    expect([...alphaOrder].sort()).toEqual([...investmentOrder].sort());
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");

    act(() => tabs[1].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    expect(tabs[2].getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
    expect([...signalIds(container)].sort()).toEqual([...investmentOrder].sort());
  });

  it("withholds the investment thesis when only a coverage gap is tagged to that lens", () => {
    const base = snapshot();
    const signals = base.signals.map((item) => ({
      ...item,
      lenses: item.id === "coverage-treasury"
        ? ["investment" as const, "general_diligence" as const]
        : item.lenses.filter((lensId) => lensId !== "investment"),
    }));
    const lenses = base.lenses.map((item) => item.id === "investment"
      ? { ...item, signalIds: ["coverage-treasury"] }
      : item);
    render({
      ...base,
      signals,
      lenses,
      questions: base.questions.map((question) => question.id === "question:treasury"
        ? { ...question, state: "partial" }
        : question),
    });

    const thesis = container.querySelector('[aria-label="Current report conclusion"]');
    expect(thesis?.textContent).toContain("Conclusion limited");
    expect(thesis?.textContent).toContain("does not support a conclusion");
    expect(signalIds(container)).toHaveLength(base.signals.length);

    const alpha = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Alpha research");
    act(() => alpha?.click());
    expect(container.querySelector('[aria-label="Current report conclusion"]')?.textContent).toContain("Current read");
    expect(signalIds(container)).toHaveLength(base.signals.length);
  });

  it("withholds every decision thesis when the parent report is not decision-ready", () => {
    const value = snapshot();
    render(value, false);

    const thesis = container.querySelector('[aria-label="Current report conclusion"]');
    expect(thesis?.textContent).toContain("Conclusion limited");
    expect(thesis?.textContent).toContain("does not have enough completed evidence");
    expect(signalIds(container)).toHaveLength(value.signals.length);
    expect(container.querySelector('[aria-labelledby$="-cases-title"]')?.textContent)
      .toContain("No specific refresh trigger is supported");
  });

  it("withholds a derived thesis under identity failure and adverse governing verdicts", () => {
    for (const verdict of ["UNVERIFIABLE_IDENTITY", "FAIL", "AVOID"]) {
      render(snapshot(), true, verdict);

      const thesis = container.querySelector('[aria-label="Current report conclusion"]');
      expect(thesis?.textContent, verdict).toContain("Conclusion limited");
      expect(thesis?.textContent, verdict).toContain(`report result is ${verdict}`);
      expect(thesis?.textContent, verdict).toContain("cannot replace it");
      expect(thesis?.textContent, verdict).not.toContain("Strongest supporting finding");
    }
  });

  it("keeps a CAUTION thesis explicitly subordinate to the governing report", () => {
    const value = snapshot();
    render({
      ...value,
      signals: value.signals.map((item) => item.id === "support-liquidity"
        ? {
            ...item,
            ruleId: "strict-product-description",
            headline: "Product description has strict direct-subject sourcing",
          }
        : item.id === "risk-control"
          ? {
              ...item,
              ruleId: "goplus-fired-contract-flag",
              headline: "GoPlus reports a fired contract or deployer flag",
            }
          : item),
      questions: value.questions.map((question) => question.id === "question:treasury"
        ? { ...question, state: "partial" }
        : question),
    }, true, "CAUTION");

    const thesis = container.querySelector('[aria-label="Current report conclusion"]');
    expect(thesis?.textContent).toContain("Current read");
    expect(thesis?.textContent).toContain("ARGUS rates this report CAUTION");
    expect(thesis?.textContent).toContain("Strongest supporting finding: Direct sources describe what the product does.");
    expect(thesis?.textContent).toContain("Strongest concern: GoPlus reported a contract or deployer warning.");
    expect(thesis?.textContent).not.toMatch(/This report is CAUTION|strict direct-subject|fired .* flag/i);
  });

  it("withholds a lens thesis across an uncollected critical priority question", () => {
    render(snapshot());

    const thesis = container.querySelector('[aria-label="Current report conclusion"]');
    expect(thesis?.textContent).toContain("Conclusion limited");
    expect(thesis?.textContent).toContain("one critical question has not been answered");
    expect(thesis?.textContent).toContain("Missing evidence is not treated as a favorable result");
    expect(thesis?.textContent).not.toContain("Strongest supporting finding");
    expect(container.querySelector('[aria-labelledby$="-cases-title"]')?.textContent)
      .toContain("No specific refresh trigger is supported");
  });

  it("withholds a lens thesis when a critical priority question is unresolved", () => {
    const value = snapshot();
    render({
      ...value,
      questions: value.questions.map((question) => question.id === "question:treasury"
        ? { ...question, state: "unresolved" }
        : question),
    });

    expect(container.querySelector('[aria-label="Current report conclusion"]')?.textContent)
      .toContain("Conclusion limited");
  });

  it("states that a missing opposite-polarity signal is bounded absence, not evidence", () => {
    const value = snapshot();
    const signals = value.signals.map((item) => item.polarity === "risk" || item.polarity === "mixed"
      ? { ...item, lenses: item.lenses.filter((lensId) => lensId !== "investment") }
      : item);
    const questions = value.questions.map((question) => question.id === "question:treasury"
      ? { ...question, state: "partial" as const }
      : question);
    const lenses = value.lenses.map((item) => item.id === "investment"
      ? { ...item, signalIds: item.signalIds.filter((signalId) => signalId !== "risk-control") }
      : item);
    render({ ...value, signals, questions, lenses });

    expect(container.querySelector('[aria-label="Current report conclusion"]')?.textContent)
      .toContain("That does not mean no risk exists");
  });

  it("shows arithmetic receipts, capture bounds, and every coverage domain without making a provider call", () => {
    render(snapshot());

    expect(container.textContent).toContain("Saved report");
    expect(container.textContent).toContain("or change the ARGUS score");
    expect(container.textContent).toContain("does not refresh in the background");
    expect(container.textContent).toContain("Aug 1, 2026");
    expect(container.textContent).toContain("10:00 UTC to Aug 1, 2026");
    expect(container.textContent).toContain("10:30 UTC");

    const receipt = container.querySelector('[aria-label="Arithmetic receipts for Exit liquidity is meaningful"]');
    expect(receipt?.textContent).toContain("liquidity_usd / market_cap_usd * 100 = 12.5%");
    expect(receipt?.textContent).toContain("Exit liquidity $12.5M");
    expect(receipt?.textContent).toContain("Market capitalization $100M");
    expect(receipt?.textContent).toContain("maximum input skew 0.5 hours");

    const domains = [...container.querySelectorAll<HTMLElement>("[data-coverage-domain]")];
    expect(domains).toHaveLength(14);
    expect(domains.map((item) => item.dataset.coverageDomain)).toEqual(expect.arrayContaining([
      "liquidity",
      "governance",
      "treasury",
      "legal",
    ]));
    expect(container.querySelector('[data-coverage-domain="liquidity"]')?.textContent)
      .toContain("1 saved fact. No questions remain unanswered.");
    expect(container.querySelector('[data-coverage-domain="governance"]')?.textContent)
      .toContain("0 saved facts. 1 question remains unanswered.");
    expect(container.querySelector('[data-coverage-domain="treasury"]')?.textContent)
      .toContain("0 saved facts. 1 question remains unanswered.");
    expect(container.textContent).toContain("Missing evidence is never treated as a pass");
    expect(container.textContent).not.toContain("Lens priority");
    const coverageMap = container.querySelector('[aria-label="What this report checked"]');
    expect(coverageMap?.textContent).not.toMatch(/\bPartial\b|\bMeasured\b|\bNot Collected\b/);
  });

  it("exposes prioritized measurements, dated events, and exact source lineage", () => {
    const value = snapshot();
    render({
      ...value,
      measurements: [...value.measurements, {
        id: "measure:next-unlock",
        domain: "supply",
        label: "Next reported unlock date",
        unit: "date",
        entityKey: "token:arg",
        valueType: "date",
        value: "2026-09-01T00:00:00.000Z",
        evidenceState: "reported_context",
        sourceRefs: ["source:official"],
        window: { kind: "scheduled", asOf: capturedLate, end: "2026-09-01T00:00:00.000Z" },
      }, {
        id: "project_strength_tier:p3-token-conduct",
        domain: "supply",
        label: "P3_token_conduct deterministic scorer-packet evidence tier",
        unit: "text",
        entityKey: "token:arg",
        valueType: "text",
        value: "solid",
        evidenceState: "reported_context",
        sourceRefs: [],
      }],
    });

    const publicMeasurements = container.querySelector('[data-testid="priority-measurements"]')?.textContent;
    expect(publicMeasurements).toContain("Exit liquidity");
    expect(publicMeasurements).not.toContain("P3_token_conduct");
    expect(publicMeasurements).not.toContain("solid");
    expect(container.querySelector('[data-testid="complete-measurement-ledger"]')?.textContent)
      .toContain("Market capitalization");
    expect(container.querySelector('[data-testid="complete-measurement-ledger"]')?.textContent)
      .not.toContain("P3_token_conduct deterministic scorer-packet evidence tier");
    expect(container.querySelector('[aria-label="Saved event timeline"]')?.textContent)
      .toContain("Next reported unlock date");
    expect(container.querySelector('[data-testid="complete-source-ledger"]')?.textContent)
      .toContain("Official project documentation");
    expect(container.querySelector('[data-testid="complete-source-ledger"]')?.textContent)
      .not.toContain("basicFacts.product");
    expect(container.querySelector('[data-testid="complete-source-ledger"]')?.textContent)
      .toContain("provider updated Aug 1, 2026");
  });

  it("keeps undated sources outside the dated capture boundary", () => {
    const base = snapshot();
    render({
      ...base,
      sources: [...base.sources, {
        id: "source:undated-employment",
        inputPath: "leaderDepartures",
        provider: "licensed-employment-enrichment",
        title: "Undated employment record",
        sourceClass: "licensed_enrichment",
        evidenceState: "reported_context",
      }],
    });

    expect(container.textContent).toContain("Evidence dates");
    expect(container.textContent).toContain("1 source reference has no recorded capture time");
  });

  it("counts unique artifacts rather than inflating repeated lineage references", () => {
    const base = snapshot();
    render({
      ...base,
      sources: [...base.sources, {
        ...base.sources[0],
        id: "source:official-second-reference",
        inputPath: "basicFacts.product.sources.1",
      }],
    });

    expect(container.querySelector('[data-stat="unique-artifacts"]')?.textContent).toBe("1");
    expect(container.querySelector('[data-stat="lineage-origins"]')?.textContent).toBe("1");
    expect(container.textContent).toContain("2 saved source references");
  });

  it("renders every question and basis in the complete frozen ledger", () => {
    const value = snapshot();
    render(value);

    const ledger = container.querySelector('[data-testid="complete-question-ledger"]');
    expect(ledger?.querySelectorAll("li")).toHaveLength(value.questions.length);
    for (const question of value.questions) {
      expect(ledger?.textContent).not.toContain(question.id);
      expect(ledger?.textContent).toContain(question.prompt);
      expect(ledger?.textContent).toContain(question.basis);
    }
  });

  it("renders non-directional recheck cases and preserves every change condition when the lens changes", () => {
    const value = snapshot();
    render({
      ...value,
      questions: value.questions.map((question) => question.id === "question:treasury"
        ? { ...question, state: "partial" }
        : question),
    });

    const conditionalCases = container.querySelector('[aria-labelledby$="-cases-title"]');
    expect(conditionalCases?.textContent).toContain("Refresh the report when");
    expect(conditionalCases?.textContent).toContain("What this report says now");
    expect(conditionalCases?.textContent).toContain("Verify next");
    expect(conditionalCases?.textContent).toContain("A new report may strengthen, weaken, or leave the conclusion unchanged");
    expect(conditionalCases?.textContent).not.toContain("case under this lens strengthens");
    expect(conditionalCases?.textContent).not.toContain("current evidence case under this lens breaks");
    expect(conditionalCases?.textContent).not.toMatch(/probability|price target|expected return/i);

    const changes = () => container.querySelector('[aria-labelledby$="-changes-title"]')?.textContent ?? "";
    const investmentChanges = changes();
    expect(investmentChanges).toContain("Verified control or liquidity evidence changes");
    expect(investmentChanges).toContain("The next unlock date changes");
    expect(investmentChanges).toContain("Bound treasury addresses and liabilities are measured");

    const counterparty = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Counterparty");
    act(() => counterparty?.click());
    expect(changes()).toContain("Verified control or liquidity evidence changes");
    expect(changes()).toContain("The next unlock date changes");
    expect(changes()).toContain("Bound treasury addresses and liabilities are measured");
    expect(container.querySelector('[aria-label="Open questions"]')?.textContent).toContain("Can governance be bypassed?");
  });
});
