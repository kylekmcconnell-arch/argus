import type { TraceStep } from "../data/evidence";

export type InvestigationProgressKind = "person" | "token" | "investigation" | "resolution";
export type InvestigationStageState = "observed" | "active" | "waiting";

export interface InvestigationProgressStage {
  key: string;
  label: string;
  state: InvestigationStageState;
}

export interface InvestigationProgressSummary {
  eventCount: number;
  observedSources: string[];
  attentionCount: number;
  latestEvent: TraceStep | null;
  currentLabel: string;
  stages: InvestigationProgressStage[];
}

interface StageDefinition {
  key: string;
  label: string;
  matches: (step: TraceStep) => boolean;
  hopMatches?: (hop: string) => boolean;
}

const includes = (value: string, fragments: readonly string[]) => {
  const normalized = value.toLowerCase();
  return fragments.some((fragment) => normalized.includes(fragment));
};

const personStages: StageDefinition[] = [
  {
    key: "subject",
    label: "Subject identity",
    matches: (step) => includes(step.phase, ["intake", "identity", "routing"]),
  },
  {
    key: "evidence",
    label: "Evidence collection",
    matches: (step) => includes(step.phase, [
      "collect",
      "team",
      "substance",
      "founder",
      "investor",
      "reputation",
      "corroborate",
      "on-chain",
      "token",
      "cadence",
      "adverse",
    ]),
  },
  {
    key: "network",
    label: "Connection screening",
    matches: (step) => includes(step.phase, ["network"]),
  },
  {
    key: "analysis",
    label: "Decision analysis",
    matches: (step) => includes(step.phase, ["contradictions", "analyst"]),
  },
  {
    key: "finalize",
    label: "Report finalization",
    matches: (step) => includes(step.phase, ["finalize"]),
  },
];

const tokenStages: StageDefinition[] = [
  { key: "resolve", label: "Resolve token", matches: (step) => includes(step.phase, ["intake"]) },
  { key: "market", label: "Market evidence", matches: (step) => includes(step.phase, ["market"]) },
  { key: "contract", label: "Contract checks", matches: (step) => includes(step.phase, ["contract"]) },
  { key: "corroborate", label: "Corroboration", matches: (step) => includes(step.phase, ["corroborate"]) },
  { key: "finalize", label: "Verdict assembly", matches: (step) => includes(step.phase, ["finalize"]) },
];

const investigationStages: StageDefinition[] = [
  {
    key: "token",
    label: "Token evidence",
    matches: (step) => includes(step.phase, ["intake", "market", "contract", "corroborate"])
      || includes(step.label, ["step 1 · on-chain", "token audited"]),
    hopMatches: (hop) => includes(hop, ["auditing the token"]),
  },
  {
    key: "identity",
    label: "Project identity",
    matches: (step) => includes(step.label, ["step 1c", "identity resolved"]),
    hopMatches: (hop) => includes(hop, ["official identity"]),
  },
  {
    key: "funding",
    label: "Funding trail",
    matches: (step) => includes(step.label, ["step 1b", "deployer trail"]),
    hopMatches: (hop) => includes(hop, ["funded the deployer"]),
  },
  {
    key: "site",
    label: "Site and team",
    matches: (step) => includes(step.phase, ["site recon"])
      || includes(step.label, ["step 2 ·", "site read"]),
    hopMatches: (hop) => includes(hop, ["project site"]),
  },
  {
    key: "people",
    label: "People background",
    matches: (step) => includes(step.label, ["step 3 ·", "project account audited"])
      || includes(step.phase, [
        "team",
        "substance",
        "founder",
        "investor",
        "reputation",
        "on-chain",
        "cadence",
        "adverse",
        "network",
        "contradictions",
        "analyst",
      ]),
    hopMatches: (hop) => includes(hop, ["project's x account"]),
  },
  {
    key: "complete",
    label: "Investigation assembly",
    matches: (step) => includes(step.label, ["investigation complete"]),
  },
];

const resolutionStages: StageDefinition[] = [
  { key: "resolve", label: "Resolve exact subject", matches: () => false },
];

function definitionsFor(kind: InvestigationProgressKind): StageDefinition[] {
  if (kind === "token") return tokenStages;
  if (kind === "investigation") return investigationStages;
  if (kind === "resolution") return resolutionStages;
  return personStages;
}

function stageIndexForStep(definitions: StageDefinition[], step: TraceStep): number {
  return definitions.findIndex((stage) => stage.matches(step));
}

function stageIndexForHop(definitions: StageDefinition[], hop: string): number {
  if (!hop.trim()) return -1;
  return definitions.findIndex((stage) => stage.hopMatches?.(hop) ?? false);
}

function observedSources(steps: TraceStep[]): string[] {
  const seen = new Set<string>();
  const sources: string[] = [];
  for (const step of steps) {
    const source = step.source?.trim();
    if (!source) continue;
    const key = source.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    sources.push(source);
  }
  return sources;
}

export function deriveInvestigationProgress({
  kind,
  steps,
  working,
  hop = "",
}: {
  kind: InvestigationProgressKind;
  steps: TraceStep[];
  working: boolean;
  hop?: string;
}): InvestigationProgressSummary {
  const definitions = definitionsFor(kind);
  const latestEvent = steps.at(-1) ?? null;
  const observed = new Set<number>();
  for (const step of steps) {
    const index = stageIndexForStep(definitions, step);
    if (index >= 0) observed.add(index);
  }

  const hopIndex = kind === "investigation" ? stageIndexForHop(definitions, hop) : -1;
  const latestIndex = latestEvent ? stageIndexForStep(definitions, latestEvent) : -1;
  const activeIndex = working
    ? hopIndex >= 0
      ? hopIndex
      : latestIndex >= 0
        ? latestIndex
        : kind === "resolution" || steps.length === 0
          ? 0
          : -1
    : -1;

  const stages = definitions.map<InvestigationProgressStage>((stage, index) => ({
    key: stage.key,
    label: stage.label,
    state: index === activeIndex ? "active" : observed.has(index) ? "observed" : "waiting",
  }));

  const currentLabel = kind === "resolution" && steps.length === 0
    ? "Resolving the exact subject"
    : latestEvent
      ? latestEvent.label
      : working
        ? "Waiting for the first evidence event"
        : "No evidence events were observed";

  return {
    eventCount: steps.length,
    observedSources: observedSources(steps),
    attentionCount: steps.filter((step) => step.tone === "warn" || step.tone === "bad").length,
    latestEvent,
    currentLabel,
    stages,
  };
}
