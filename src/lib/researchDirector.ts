import type { CollectedEvidence } from "../data/evidence";
import { SubjectClass } from "../engine/taxonomy";
import { canonicalOfficialWebsite } from "./fundScaleEvidence";
import { isOrganizationAccount } from "./investorSubject";
import type { ScanCheck } from "./scanChecklist";

export type ResearchIntent =
  | "investment_due_diligence"
  | "counterparty_risk"
  | "alpha_discovery"
  | "identity_and_control";

export type ResearchCapability =
  | "role_resolution"
  | "identity_resolution"
  | "official_facts"
  | "people_and_control"
  | "token_and_market"
  | "project_fundamentals"
  | "portfolio_and_outcomes"
  | "fund_scale"
  | "legal_and_adverse"
  | "network_connections"
  | "counter_evidence"
  | "analyst_synthesis";

export type ResearchTaskState = "planned" | "completed" | "partial" | "unavailable" | "skipped";

export interface ResearchTask {
  id: string;
  capability: ResearchCapability;
  question: string;
  why: string;
  priority: "critical" | "high" | "medium";
  delegates: string[];
  checkIds: string[];
  triggeredBy: string[];
  rank: number;
  decisionImpact: 1 | 2 | 3 | 4 | 5;
  costClass: "free" | "low" | "medium" | "high";
  dispatchReason: string;
  stopWhen: string;
  blockedBy: string[];
  state: ResearchTaskState;
  outcome?: string;
}

export interface ResearchNextAction {
  rank: number;
  taskId: string;
  capability: ResearchCapability;
  action: string;
  whyNow: string;
  delegates: string[];
}

export interface ResearchPlan {
  schemaVersion: 1;
  intent: ResearchIntent;
  subject: string;
  roles: string[];
  createdAt: string;
  tasks: ResearchTask[];
  nextActions: ResearchNextAction[];
}

export interface ResearchPlanCompletionContext {
  roleResolved?: boolean;
  analystConclusionRecorded?: boolean;
}

interface TaskTemplate extends Omit<ResearchTask, "id" | "priority" | "triggeredBy" | "rank" | "dispatchReason" | "blockedBy" | "state"> {
  roles?: SubjectClass[];
  intents?: ResearchIntent[];
  predicates?: string[];
  baselinePriority: ResearchTask["priority"];
}

const TEMPLATES: TaskTemplate[] = [
  {
    capability: "role_resolution",
    question: "What kind of subject is this, and which decision methodology applies?",
    why: "Every later search must be scoped to the correct person, fund, company, project, or market asset.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "free",
    stopWhen: "A provider-backed subject class is frozen, or the report abstains because role evidence remains unresolved.",
    delegates: ["x-profile", "official-domain", "basic-facts"],
    checkIds: ["identity-resolution"],
  },
  {
    capability: "identity_resolution",
    question: "What exact real-world or organizational identity is bound to this subject?",
    why: "Names, handles, and tickers collide; identity must be bound before relationships can be trusted.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "low",
    stopWhen: "At least one exact account-to-person or account-to-organization binding is source-verified, with collisions rejected.",
    delegates: ["twitterapi", "peopledatalabs", "github", "official-domain", "public-web"],
    checkIds: ["identity-resolution", "identity-continuity", "profile-photo-authenticity", "code-footprint-github"],
    predicates: ["official_identity", "current_role", "legal_entity"],
  },
  {
    capability: "official_facts",
    question: "What does the subject officially claim about its people, products, history, and structure?",
    why: "First-party claims establish what was published, while remaining separate from independent corroboration.",
    baselinePriority: "high",
    decisionImpact: 4,
    costClass: "low",
    stopWhen: "The canonical first-party surfaces are fetched and their claims are preserved as first-party claims.",
    delegates: ["official-site", "official-x", "wayback", "basic-facts"],
    checkIds: ["project-product-substance", "project-team-identity", "project-transparency"],
    predicates: ["founder", "executive", "product", "founded", "legal_entity", "governance"],
  },
  {
    capability: "people_and_control",
    question: "Who founded, operates, owns, governs, or practically controls the subject?",
    why: "Published team membership is not the same as legal identity, current authority, ownership, or wallet control.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "medium",
    stopWhen: "Founder, operator, ownership, and practical-control claims are either source-backed or explicitly unresolved.",
    roles: [SubjectClass.PROJECT, SubjectClass.FOUNDER, SubjectClass.INVESTOR, SubjectClass.AGENCY, SubjectClass.MEMBER],
    intents: ["investment_due_diligence", "counterparty_risk", "identity_and_control"],
    delegates: ["official-site", "official-x", "peopledatalabs", "monid", "public-web", "direct-chain-rpc"],
    checkIds: ["project-team-identity", "project-leadership-currency", "founder-identity-authority", "founder-company-relationships", "founder-control-conflicts", "organization-registration"],
    predicates: ["founder", "executive", "current_role", "control", "governance", "conflict_of_interest"],
  },
  {
    capability: "token_and_market",
    question: "What official asset is bound to the subject, and what do liquidity, holders, unlocks, and market history show?",
    why: "A ticker is only a label; the exact contract and its current market/control state drive asset diligence.",
    baselinePriority: "high",
    decisionImpact: 4,
    costClass: "medium",
    stopWhen: "The exact official contract is bound and the material market and control questions have dated readings.",
    roles: [SubjectClass.PROJECT, SubjectClass.FOUNDER, SubjectClass.KOL, SubjectClass.INVESTOR],
    intents: ["investment_due_diligence", "alpha_discovery", "identity_and_control"],
    delegates: ["coingecko", "dexscreener", "geckoterminal", "goplus", "direct-chain-rpc"],
    checkIds: ["project-token-identity", "promoted-token-performance", "founder-asset-distinction"],
    predicates: ["official_token", "public_security", "tokenomics", "vesting"],
  },
  {
    capability: "project_fundamentals",
    question: "Is there a live product with measurable usage, funding, integrations, and security evidence?",
    why: "A project narrative becomes investable diligence only when product and traction claims have dated sources.",
    baselinePriority: "high",
    decisionImpact: 4,
    costClass: "medium",
    stopWhen: "Product, usage, funding, integration, and security claims have attributable outcomes or explicit gaps.",
    roles: [SubjectClass.PROJECT, SubjectClass.FOUNDER],
    intents: ["investment_due_diligence", "alpha_discovery", "counterparty_risk"],
    delegates: ["official-site", "defillama", "github", "security-auditors", "monid", "public-web"],
    checkIds: ["project-product-substance", "project-backing-partners", "project-traction-liveness", "project-transparency"],
    predicates: ["product", "launched", "traction", "funding", "investor", "partnership", "repository", "audit", "security_incident"],
  },
  {
    capability: "portfolio_and_outcomes",
    question: "Which investments, ventures, exits, failures, and measurable outcomes are actually attributable to this subject?",
    why: "Firm portfolios, personal investments, employment, and namesake companies must not be merged.",
    baselinePriority: "high",
    decisionImpact: 5,
    costClass: "high",
    stopWhen: "Each material portfolio or track-record claim is counterparty-corroborated or rejected as a namesake/unverified lead.",
    roles: [SubjectClass.INVESTOR, SubjectClass.FOUNDER],
    intents: ["investment_due_diligence", "alpha_discovery"],
    delegates: ["portfolio-web", "official-portfolio", "official-x", "public-web", "entity-store"],
    checkIds: ["vc-portfolio-track-record", "founder-track-record", "founder-repeat-backing"],
    predicates: ["investor", "funding", "exit", "track_record", "founder", "prior_role"],
  },
  {
    capability: "fund_scale",
    question: "What dated, source-backed evidence establishes fund or vehicle scale?",
    why: "AUM, fund close, and firm size are different claims and require different primary or corroborated sources.",
    baselinePriority: "medium",
    decisionImpact: 4,
    costClass: "medium",
    stopWhen: "A dated manager, regulatory, or corroborated fund-scale claim is found, or the bounded search is recorded as empty.",
    roles: [SubjectClass.INVESTOR],
    intents: ["investment_due_diligence", "alpha_discovery"],
    delegates: ["fund-manager-site", "regulatory-filings", "fund-scale-web", "monid"],
    checkIds: ["investor-fund-scale"],
    predicates: ["funding", "legal_entity"],
  },
  {
    capability: "legal_and_adverse",
    question: "What sanctions, litigation, regulatory, exploit, scam, rug, or integrity evidence is directly attributable?",
    why: "Adverse claims require exact-subject attribution, while provider failure must remain an open risk gate.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "medium",
    stopWhen: "Every configured adverse source has an attributable outcome; outages remain open risk gates.",
    delegates: ["opensanctions", "courtlistener", "sec-registry", "public-web", "adverse-search"],
    checkIds: ["adverse-screen", "us-legal-history", "ofac-sanctions-name", "organization-sanctions", "founder-legal-regulatory"],
    predicates: ["legal_regulatory_event", "security_incident", "conflict_of_interest"],
  },
  {
    capability: "network_connections",
    question: "Which verified people, companies, wallets, investments, and flagged subjects connect to this case?",
    why: "The most valuable signal often sits one or two hops away from the searched subject.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "low",
    stopWhen: "The frozen graph is reconciled against verified entities and flagged subjects, including an explicit empty outcome.",
    delegates: ["trust-graph", "entity-store", "wallet-graph", "official-relationship-sources"],
    checkIds: ["trust-graph-connections", "affiliations-associates"],
  },
  {
    capability: "counter_evidence",
    question: "What is the strongest evidence against the emerging thesis, and which claims conflict?",
    why: "A case plan that searches only for confirmation cannot support a real capital decision.",
    baselinePriority: "high",
    decisionImpact: 5,
    costClass: "medium",
    stopWhen: "The strongest plausible disconfirming evidence has been tested and conflicts are either resolved or surfaced.",
    delegates: ["independent-web", "adverse-search", "contradiction-analyst"],
    checkIds: ["news-press", "adverse-screen"],
  },
  {
    capability: "analyst_synthesis",
    question: "What conclusion follows from the admissible evidence, and what remains decision-critical?",
    why: "Collection is not a conclusion; every claim needs lineage, counter-evidence, and an explicit uncertainty boundary.",
    baselinePriority: "critical",
    decisionImpact: 5,
    costClass: "low",
    stopWhen: "Every conclusion cites admissible evidence and every decision-critical unknown is visible to the reader.",
    delegates: ["evidence-preflight", "contradiction-analyst", "axis-scorer", "ai-analyst"],
    checkIds: [],
  },
];

const SUCCESS = new Set(["confirmed", "reported", "finding", "checked-empty"]);
const GAP = new Set(["unknown", "unavailable", "stale"]);

const RELATIONSHIP_CAPABILITIES = new Set<ResearchCapability>([
  "project_fundamentals",
  "portfolio_and_outcomes",
  "fund_scale",
]);

const priorityWeight: Record<ResearchTask["priority"], number> = { critical: 300, high: 200, medium: 100 };
const costPenalty: Record<ResearchTask["costClass"], number> = { free: 0, low: 4, medium: 12, high: 24 };

/**
 * An organization subject whose profile came back from the provider with a
 * credible official website is already identity-bound for portfolio and
 * fund-scale discovery. The gate below exists to stop namesake results from
 * binding to the wrong PERSON; for an organization both collectors carry
 * their own domain bind (portfolioRelationshipBinding requires the investor
 * entity domain to equal the profile's official domain, and
 * isStrictFundScaleArtifact requires the exact fund name plus that domain),
 * so a wrong-entity lead cannot pass either of them. Blocking discovery on an
 * unanswered official_identity passage only removed evidence the verifier
 * would have bound on the domain anyway (owner decision on #327).
 */
function organizationBoundByOfficialSite(evidence: CollectedEvidence): boolean {
  const profile = evidence.profile;
  return profile.profile_collection_state === "resolved"
    && profile.profile_provider === "twitterapi"
    && canonicalOfficialWebsite(profile.website) !== null
    && isOrganizationAccount(evidence);
}

function unresolvedIdentityQuestions(evidence: CollectedEvidence, capability: ResearchCapability): string[] {
  if (
    (capability === "portfolio_and_outcomes" || capability === "fund_scale")
    && organizationBoundByOfficialSite(evidence)
  ) return [];
  const blockingPredicates = capability === "fund_scale"
    ? ["official_identity", "legal_entity", "current_role"]
    : ["official_identity", "current_role"];
  return (evidence.basicFactQuestionLedger ?? [])
    .filter((entry) => entry.status === "unanswered" && entry.critical && blockingPredicates.includes(entry.predicate))
    .map((entry) => entry.questionId);
}

/**
 * Attribute a provider run to a delegate on an ID BOUNDARY, never on a bare
 * substring.
 *
 * Bidirectional `includes` matched any short id inside a longer one, so a run
 * called "x" claimed the "official-x" delegate and a failed run could be
 * reported against a workstream that never dispatched it.
 */
function delegateMatchesRun(delegate: string, runId: string): boolean {
  const target = delegate.trim().toLowerCase();
  const run = runId.trim().toLowerCase();
  if (!target || !run) return false;
  if (run === target) return true;
  return run.startsWith(`${target}-`) || run.startsWith(`${target}:`);
}

function nextActions(tasks: readonly ResearchTask[]): ResearchNextAction[] {
  return tasks
    .filter((task) => task.state === "planned" || task.state === "partial" || task.state === "unavailable")
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map((task, index) => ({
      rank: index + 1,
      taskId: task.id,
      capability: task.capability,
      action: task.blockedBy.length
        ? `Resolve ${task.blockedBy.length} identity gate${task.blockedBy.length === 1 ? "" : "s"} before testing: ${task.question}`
        : task.question,
      whyNow: task.blockedBy.length ? "This prevents a namesake or wrong-entity result from entering the report." : task.dispatchReason,
      delegates: [...task.delegates],
    }));
}

function applies(template: TaskTemplate, roles: readonly SubjectClass[], intent: ResearchIntent): boolean {
  if (template.intents && !template.intents.includes(intent)) return false;
  if (!template.roles?.length) return true;
  return template.roles.some((role) => roles.includes(role));
}

export function buildResearchPlan(evidence: CollectedEvidence, intent: ResearchIntent = "investment_due_diligence"): ResearchPlan {
  const roles = evidence.roles ?? [];
  const openQuestions = (evidence.basicFactQuestionLedger ?? []).filter((entry) =>
    entry.status === "unanswered");
  const subject = evidence.profile.resolved_name || evidence.profile.display_name || evidence.profile.handle;
  const tasks = TEMPLATES.filter((template) => applies(template, roles, intent)).map((template, index): ResearchTask => {
    const triggered = openQuestions.filter((entry) => template.predicates?.includes(entry.predicate));
    const criticalGap = triggered.some((entry) => entry.critical);
    const priority = criticalGap ? "critical" : template.baselinePriority;
    const blockedBy = RELATIONSHIP_CAPABILITIES.has(template.capability)
      ? unresolvedIdentityQuestions(evidence, template.capability)
      : [];
    return {
      id: `research-${index + 1}-${template.capability}`,
      capability: template.capability,
      question: template.question,
      why: template.why,
      priority,
      delegates: [...template.delegates],
      checkIds: [...template.checkIds],
      triggeredBy: triggered.map((entry) => entry.questionId),
      rank: 0,
      decisionImpact: template.decisionImpact,
      costClass: template.costClass,
      dispatchReason: criticalGap
        ? `${triggered.length} decision-critical evidence gap${triggered.length === 1 ? "" : "s"} raised this workstream.`
        : `Selected for ${intent.replaceAll("_", " ")} based on the provider-backed subject role.`,
      stopWhen: template.stopWhen,
      blockedBy: [...blockedBy],
      state: "planned",
    };
  });
  const rankedTasks = tasks
    .sort((a, b) => {
      const scoreA = priorityWeight[a.priority] + a.decisionImpact * 20 + a.triggeredBy.length * 15 - costPenalty[a.costClass] - (a.blockedBy.length ? 500 : 0);
      const scoreB = priorityWeight[b.priority] + b.decisionImpact * 20 + b.triggeredBy.length * 15 - costPenalty[b.costClass] - (b.blockedBy.length ? 500 : 0);
      return scoreB - scoreA || a.id.localeCompare(b.id);
    })
    .map((task, index) => ({ ...task, rank: index + 1 }));
  return {
    schemaVersion: 1,
    intent,
    subject,
    roles: roles.map(String),
    createdAt: new Date().toISOString(),
    tasks: rankedTasks,
    nextActions: nextActions(rankedTasks),
  };
}

export function researchPlanAllows(plan: ResearchPlan, capability: ResearchCapability): boolean {
  return plan.tasks.some((task) => task.capability === capability && task.state !== "skipped" && task.blockedBy.length === 0);
}

export function finalizeResearchPlan(
  plan: ResearchPlan,
  checks: readonly ScanCheck[],
  providerRuns: readonly { id: string; state: string; detail?: string }[] = [],
  context: ResearchPlanCompletionContext = {},
): ResearchPlan {
  const tasks = plan.tasks.map((task): ResearchTask => {
      if (task.blockedBy.length) {
        return { ...task, state: "skipped" as const, outcome: `blocked by ${task.blockedBy.length} unresolved identity gate${task.blockedBy.length === 1 ? "" : "s"}` };
      }
      if (task.capability === "role_resolution" && context.roleResolved) {
        return { ...task, state: "completed", outcome: "subject type and report methodology were resolved" };
      }
      if (task.capability === "analyst_synthesis" && context.analystConclusionRecorded) {
        return { ...task, state: "completed", outcome: "a frozen analyst conclusion was recorded" };
      }
      const taskChecks = checks.filter((check) => check.checkId && task.checkIds.includes(check.checkId));
      const successful = taskChecks.filter((check) => SUCCESS.has(check.status));
      const gaps = taskChecks.filter((check) => GAP.has(check.status));
      // "reported" is a COMPLETED read of source-attributed context, not ARGUS
      // verification. It still closes the workstream, but the narrative must
      // not let it pass as a verified answer.
      const reported = taskChecks.filter((check) => check.status === "reported");
      const reportedNote = reported.length
        ? ` (${reported.length} from source-reported context, not ARGUS verification)`
        : "";
      if (taskChecks.length) {
        if (successful.length && gaps.length) return { ...task, state: "partial", outcome: `${successful.length} answered${reportedNote}; ${gaps.length} unresolved` };
        if (successful.length) return { ...task, state: "completed", outcome: `${successful.length} evidence question${successful.length === 1 ? "" : "s"} answered${reportedNote}` };
        if (gaps.length) return { ...task, state: "unavailable", outcome: `${gaps.length} evidence question${gaps.length === 1 ? "" : "s"} unresolved` };
        if (taskChecks.every((check) => check.status === "not-applicable")) return { ...task, state: "skipped", outcome: "not applicable to the resolved subject" };
      }
      const runs = providerRuns.filter((run) => task.delegates.some((delegate) => delegateMatchesRun(delegate, run.id)));
      // A successful provider call proves that the search ran, not that the
      // investigation question was answered. Only a frozen check outcome can
      // complete a workstream; otherwise preserve the epistemic gap.
      if (runs.some((run) => run.state === "executed")) return { ...task, state: "partial", outcome: "delegated search completed; no frozen answer was recorded" };
      if (runs.some((run) => run.state === "partial")) return { ...task, state: "partial", outcome: "delegated provider work returned partial coverage" };
      if (runs.some((run) => run.state === "failed" || run.state === "unavailable")) return { ...task, state: "unavailable", outcome: "required provider work was unavailable" };
      return task;
    });
  return { ...plan, tasks, nextActions: nextActions(tasks) };
}
