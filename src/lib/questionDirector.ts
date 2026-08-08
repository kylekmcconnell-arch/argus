import type { DecisionLensId, DerivedIntelligenceSignal, IntelligenceDomain, IntelligenceQuestion, IntelligenceSpineSnapshot } from "../intelligence/types";
import type { ResearchCapability, ResearchIntent, ResearchPlan, ResearchTask } from "./researchDirector";

export interface DirectedInvestigationRoute {
  intent: ResearchIntent;
  reasoningMode: "answer_question" | "challenge_thesis" | "trace_connection" | "explain_score" | "compare_scenarios" | "plan_investigation";
  inheritedIntent: boolean;
  capabilities: ResearchCapability[];
  taskIds: string[];
  delegates: string[];
  blockedBy: string[];
  unresolvedQuestions: Array<{
    id: string;
    prompt: string;
    domain: IntelligenceDomain;
    state: IntelligenceQuestion["state"];
    materiality: IntelligenceQuestion["materiality"];
  }>;
  evidenceFocus: Array<{
    id: string;
    headline: string;
    domain: IntelligenceDomain;
    polarity: DerivedIntelligenceSignal["polarity"];
    severity: DerivedIntelligenceSignal["severity"];
    evidenceState: DerivedIntelligenceSignal["evidenceState"];
    sourceRefs: string[];
    measurementRefs: string[];
  }>;
  sourceRefs: string[];
  measurementRefs: string[];
  changeConditions: string[];
  claimChains: Array<{
    signalId: string;
    claim: string;
    finding: string;
    whyItMatters: string;
    inferenceBoundary: string;
    lineageState: "complete" | "partial" | "unanchored";
    measurements: Array<{
      id: string;
      label: string;
      value: string | number;
      unit: string;
      evidenceState: string;
      sourceRefs: string[];
    }>;
    sources: Array<{
      id: string;
      title: string;
      provider: string;
      sourceClass: string;
      evidenceState: string;
    }>;
    counterSignalIds: string[];
  }>;
  answerMode: "synthesize_saved_evidence" | "investigate_evidence_gap";
  explanation: string;
}

interface RouteDefinition {
  intent: ResearchIntent;
  patterns: RegExp[];
  capabilities: ResearchCapability[];
  domains: IntelligenceDomain[];
  explanation: string;
}

const ROUTES: RouteDefinition[] = [
  {
    intent: "identity_and_control",
    patterns: [
      /\b(?:who\s+(?:is|are|owns?|controls?|founded|runs?)|founder|cofounder|owner|operator|team|leadership|identity|behind|authority|signer|admin|deployer)\b/i,
    ],
    capabilities: ["identity_resolution", "people_and_control", "network_connections", "counter_evidence"],
    domains: ["identity", "career", "team", "control", "governance", "relationships"],
    explanation: "The question turns on exact identity, authority, and control rather than a name match.",
  },
  {
    intent: "counterparty_risk",
    patterns: [
      /\b(?:counterparty|partner(?:ship)?|vendor|hire|work\s+with|trust|reliable|legitimate|legal|lawsuit|litigation|sanction|fraud|scam|rug|conflict)\b/i,
    ],
    capabilities: ["identity_resolution", "legal_and_adverse", "people_and_control", "network_connections", "counter_evidence", "analyst_synthesis"],
    domains: ["identity", "legal", "reputation", "control", "security", "relationships", "operations"],
    explanation: "The question is a counterparty decision and requires attributable identity, adverse, control, and relationship evidence.",
  },
  {
    intent: "alpha_discovery",
    patterns: [
      /\b(?:alpha|catalyst|timing|momentum|setup|entry|exit|price|volume|liquidity|unlock|holders?|whales?|supply|market|trade|buy\s+now|sell\s+now)\b/i,
    ],
    capabilities: ["token_and_market", "project_fundamentals", "network_connections", "counter_evidence", "analyst_synthesis"],
    domains: ["market", "liquidity", "supply", "economics", "chronology", "funding", "treasury"],
    explanation: "The question is time-sensitive market research, so dated market, supply, catalyst, and counter-evidence records lead.",
  },
  {
    intent: "investment_due_diligence",
    patterns: [
      /\b(?:invest|investment|thesis|valuation|upside|downside|bull|bear|portfolio|funding|backers?|investors?|fund|aum|returns?|outcomes?|good\s+(?:investment|bet))\b/i,
    ],
    capabilities: ["project_fundamentals", "portfolio_and_outcomes", "fund_scale", "people_and_control", "token_and_market", "legal_and_adverse", "counter_evidence", "analyst_synthesis"],
    domains: ["product", "operations", "track_record", "portfolio", "fund_scale", "funding", "economics", "team", "control", "security", "legal", "liquidity", "supply"],
    explanation: "The question asks for a capital-allocation view, so operating evidence, track record, downside, and disconfirming evidence lead.",
  },
];

const FALLBACK: RouteDefinition = {
  intent: "investment_due_diligence",
  patterns: [],
  capabilities: ["official_facts", "counter_evidence", "analyst_synthesis"],
  domains: ["identity", "product", "operations", "relationships", "chronology"],
  explanation: "No narrower decision intent was explicit, so ARGUS routes this as broad evidence synthesis with a counter-evidence check.",
};

const OPEN_STATES = new Set<IntelligenceQuestion["state"]>([
  "reported", "partial", "unresolved", "unavailable", "not_collected",
]);

const MATERIALITY_RANK: Record<IntelligenceQuestion["materiality"], number> = {
  critical: 0,
  important: 1,
  context: 2,
};

const INTENT_PRIORITY: ResearchIntent[] = [
  "counterparty_risk",
  "alpha_discovery",
  "investment_due_diligence",
  "identity_and_control",
];

const REFERENTIAL_FOLLOW_UP = /^(?:and\b|but\b|what\s+about\b|what\s+does\s+that\b|why\b|how\s+so\b|does\s+that\b|could\s+that\b|him\b|her\b|them\b|it\b|that\b|this\b)/i;

const INTENT_LENS: Record<ResearchIntent, DecisionLensId> = {
  investment_due_diligence: "investment",
  alpha_discovery: "alpha_research",
  counterparty_risk: "counterparty",
  identity_and_control: "general_diligence",
};

const SEVERITY_RANK: Record<DerivedIntelligenceSignal["severity"], number> = {
  high: 0,
  medium: 1,
  low: 2,
  context: 3,
};

function matchedRoutes(value: string): RouteDefinition[] {
  return ROUTES.filter((candidate) => candidate.patterns.some((pattern) => pattern.test(value)));
}

function primaryRoute(routes: readonly RouteDefinition[]): RouteDefinition | null {
  for (const intent of INTENT_PRIORITY) {
    const route = routes.find((candidate) => candidate.intent === intent);
    if (route) return route;
  }
  return null;
}

function reasoningMode(value: string): DirectedInvestigationRoute["reasoningMode"] {
  if (/\b(?:challenge|rebut|counter[- ]?thesis|devil'?s advocate|strongest case against|disprove|what would change)\b/i.test(value)) return "challenge_thesis";
  if (/\b(?:trace|connection|connected|link(?:ed)?|network|funded by|funder|relationship|one hop|two hops)\b/i.test(value)) return "trace_connection";
  if (/\b(?:why (?:is|was|did)|explain (?:the )?(?:score|verdict|rating)|score|verdict|points?|cap(?:ped)?)\b/i.test(value)) return "explain_score";
  if (/\b(?:compare|versus|\bvs\b|scenario|if instead|relative to)\b/i.test(value)) return "compare_scenarios";
  if (/\b(?:investigate next|search next|next (?:step|move|check)|how (?:would|should) (?:you|we) investigate|research plan)\b/i.test(value)) return "plan_investigation";
  return "answer_question";
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function usableTasks(plan: ResearchPlan | null | undefined): ResearchTask[] {
  if (!plan || !Array.isArray(plan.tasks)) return [];
  return plan.tasks.filter((task) => task && typeof task.capability === "string" && task.state !== "skipped");
}

function signalBoundary(signal: DerivedIntelligenceSignal): string {
  if (signal.evidenceState === "reported_context") return "This is attributed source context, not an independently verified ARGUS finding.";
  if (signal.kind === "screening_heuristic") return "This is a screening heuristic that prioritizes investigation; it does not establish the suspected conduct.";
  if (signal.kind === "arithmetic") return "This is deterministic arithmetic over the cited saved measurements; it does not establish causation or intent.";
  return "The claim is bounded to the recorded finding and does not establish unstated identity, ownership, causation, intent, or future outcome.";
}

export function directInvestigationQuestion(
  question: string,
  plan?: ResearchPlan | null,
  snapshot?: IntelligenceSpineSnapshot | null,
  priorQuestions: readonly string[] = [],
): DirectedInvestigationRoute {
  const cleaned = question.replace(/\s+/g, " ").trim();
  const currentMatches = matchedRoutes(cleaned);
  const previousRoute = [...priorQuestions]
    .reverse()
    .map((value) => primaryRoute(matchedRoutes(value)))
    .find((value): value is RouteDefinition => value !== null);
  const inheritPrevious = Boolean(previousRoute && REFERENTIAL_FOLLOW_UP.test(cleaned));
  const route = (inheritPrevious ? previousRoute : primaryRoute(currentMatches)) ?? FALLBACK;
  const supportingRoutes = [route, ...currentMatches.filter((candidate) => candidate.intent !== route.intent)];
  const capabilities = unique(supportingRoutes.flatMap((candidate) => candidate.capabilities)) as ResearchCapability[];
  const domains = unique(supportingRoutes.flatMap((candidate) => candidate.domains)) as IntelligenceDomain[];
  const capabilityRank = new Map(capabilities.map((capability, index) => [capability, index]));
  const tasks = usableTasks(plan)
    .filter((task) => capabilityRank.has(task.capability))
    .sort((left, right) => (capabilityRank.get(left.capability) ?? 99) - (capabilityRank.get(right.capability) ?? 99)
      || left.rank - right.rank);
  const blockedBy = unique(tasks.flatMap((task) => task.blockedBy ?? []));
  const delegates = unique(tasks.flatMap((task) => task.delegates ?? [])).slice(0, 10);
  const domainRank = new Map(domains.map((domain, index) => [domain, index]));
  const unresolvedQuestions = (snapshot?.questions ?? [])
    .filter((item) => OPEN_STATES.has(item.state) && domainRank.has(item.domain))
    .sort((left, right) => MATERIALITY_RANK[left.materiality] - MATERIALITY_RANK[right.materiality]
      || (domainRank.get(left.domain) ?? 99) - (domainRank.get(right.domain) ?? 99)
      || left.id.localeCompare(right.id))
    .slice(0, 6)
    .map((item) => ({
      id: item.id,
      prompt: item.prompt,
      domain: item.domain,
      state: item.state,
      materiality: item.materiality,
    }));
  const intentLens = INTENT_LENS[route.intent];
  const evidenceFocus = [...(snapshot?.signals ?? [])]
    .filter((signal) => signal.kind !== "coverage_gap")
    .filter((signal) => domainRank.has(signal.domain)
      || (signal.severity === "high" && (signal.polarity === "risk" || signal.polarity === "mixed")))
    .sort((left, right) => {
      const leftInvariantRisk = left.severity === "high" && (left.polarity === "risk" || left.polarity === "mixed");
      const rightInvariantRisk = right.severity === "high" && (right.polarity === "risk" || right.polarity === "mixed");
      if (leftInvariantRisk !== rightInvariantRisk) return leftInvariantRisk ? -1 : 1;
      const leftLens = left.lenses.includes(intentLens);
      const rightLens = right.lenses.includes(intentLens);
      if (leftLens !== rightLens) return leftLens ? -1 : 1;
      const leftDomain = domainRank.get(left.domain) ?? 99;
      const rightDomain = domainRank.get(right.domain) ?? 99;
      return leftDomain - rightDomain
        || SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
        || left.id.localeCompare(right.id);
    })
    .slice(0, 8)
    .map((signal) => ({
      id: signal.id,
      headline: signal.headline,
      domain: signal.domain,
      polarity: signal.polarity,
      severity: signal.severity,
      evidenceState: signal.evidenceState,
      sourceRefs: unique(signal.sourceRefs),
      measurementRefs: unique(signal.measurementRefs),
    }));
  const signalIndex = new Map((snapshot?.signals ?? []).map((signal) => [signal.id, signal]));
  const focusedSignals = evidenceFocus
    .map((signal) => signalIndex.get(signal.id))
    .filter((signal): signal is DerivedIntelligenceSignal => Boolean(signal));
  const sourceRefs = unique(focusedSignals.flatMap((signal) => signal.sourceRefs)).slice(0, 20);
  const measurementRefs = unique(focusedSignals.flatMap((signal) => signal.measurementRefs)).slice(0, 20);
  const changeConditions = unique([
    ...focusedSignals.map((signal) => signal.changeCondition),
    ...unresolvedQuestions.filter((item) => item.materiality === "critical").map((item) => item.prompt),
  ]).slice(0, 8);
  const measurementIndex = new Map((snapshot?.measurements ?? []).map((measurement) => [measurement.id, measurement]));
  const sourceIndex = new Map((snapshot?.sources ?? []).map((source) => [source.id, source]));
  const claimChains = focusedSignals.map((signal) => {
    const measurements = signal.measurementRefs
      .map((id) => measurementIndex.get(id))
      .filter((measurement): measurement is NonNullable<typeof measurement> => Boolean(measurement));
    const chainSourceRefs = unique([
      ...signal.sourceRefs,
      ...measurements.flatMap((measurement) => measurement.sourceRefs),
    ]);
    const sources = chainSourceRefs
      .map((id) => sourceIndex.get(id))
      .filter((source): source is NonNullable<typeof source> => Boolean(source));
    const expectedRefs = signal.measurementRefs.length + chainSourceRefs.length;
    const resolvedRefs = measurements.length + sources.length;
    const lineageState = expectedRefs === 0
      ? "unanchored" as const
      : resolvedRefs === expectedRefs
        ? "complete" as const
        : "partial" as const;
    const riskLike = signal.polarity === "risk" || signal.polarity === "mixed";
    const supportLike = signal.polarity === "support";
    const counterSignalIds = (snapshot?.signals ?? [])
      .filter((candidate) => candidate.id !== signal.id && candidate.domain === signal.domain)
      .filter((candidate) => (riskLike && candidate.polarity === "support")
        || (supportLike && (candidate.polarity === "risk" || candidate.polarity === "mixed")))
      .map((candidate) => candidate.id)
      .slice(0, 4);
    return {
      signalId: signal.id,
      claim: signal.headline,
      finding: signal.finding,
      whyItMatters: signal.whyItMatters,
      inferenceBoundary: signalBoundary(signal),
      lineageState,
      measurements: measurements.map((measurement) => ({
        id: measurement.id,
        label: measurement.label,
        value: measurement.value,
        unit: measurement.unit,
        evidenceState: measurement.evidenceState,
        sourceRefs: unique(measurement.sourceRefs),
      })),
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        provider: source.provider,
        sourceClass: source.sourceClass,
        evidenceState: source.evidenceState,
      })),
      counterSignalIds,
    };
  });
  const hasOpenWork = tasks.some((task) => task.state === "planned" || task.state === "partial" || task.state === "unavailable")
    || unresolvedQuestions.length > 0
    || blockedBy.length > 0
    || (!plan && !snapshot);

  return {
    intent: route.intent,
    reasoningMode: reasoningMode(cleaned),
    inheritedIntent: inheritPrevious,
    capabilities: tasks.length ? unique(tasks.map((task) => task.capability)) as ResearchCapability[] : capabilities,
    taskIds: tasks.map((task) => task.id),
    delegates,
    blockedBy,
    unresolvedQuestions,
    evidenceFocus,
    sourceRefs,
    measurementRefs,
    changeConditions,
    claimChains,
    answerMode: hasOpenWork ? "investigate_evidence_gap" : "synthesize_saved_evidence",
    explanation: inheritPrevious
      ? `${route.explanation} The decision intent is inherited from the prior user question; prior answers remain non-evidence.`
      : currentMatches.length > 1
        ? `${route.explanation} ARGUS also adds ${currentMatches.length - 1} supporting decision route${currentMatches.length === 2 ? "" : "s"} without changing the primary intent.`
        : route.explanation,
  };
}
