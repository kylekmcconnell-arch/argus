import type {
  ResearchCapability,
  ResearchPlan,
  ResearchTask,
} from "./researchDirector";

export const GAP_INVESTIGATION_SCHEMA_VERSION = 1 as const;

const OPEN_QUESTION_STATES = new Set([
  "reported",
  "partial",
  "unresolved",
  "unavailable",
  "not_collected",
]);
const OPEN_TASK_STATES = new Set(["planned", "partial", "unavailable"]);
const REQUIRED_GATE_CAPABILITIES = new Set<ResearchCapability>([
  "role_resolution",
  "identity_resolution",
  "analyst_synthesis",
]);
const COST_CEILING_USD: Record<ResearchTask["costClass"], number> = {
  free: 0,
  low: 0.25,
  medium: 1.5,
  high: 3,
};

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const text = (value: unknown, max = 500): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function asResearchPlan(value: unknown): ResearchPlan | null {
  const plan = record(value);
  if (plan.schemaVersion !== 1 || !Array.isArray(plan.tasks)) return null;
  const tasks = plan.tasks.filter((task): task is ResearchTask => {
    const row = record(task);
    return Boolean(text(row.id, 160) && text(row.capability, 80) && Array.isArray(row.delegates));
  });
  if (!tasks.length || tasks.length !== plan.tasks.length) return null;
  return plan as unknown as ResearchPlan;
}

export function savedResearchPlan(payload: unknown): ResearchPlan | null {
  const root = record(payload);
  const direct = asResearchPlan(root.researchPlan);
  if (direct) return direct;
  return asResearchPlan(record(root.projectAccount).researchPlan);
}

export interface SavedGapQuestion {
  id: string;
  prompt: string;
  state: string;
  materiality: string;
}

export function savedOpenGapQuestions(payload: unknown): SavedGapQuestion[] {
  const root = record(payload);
  const project = record(root.projectAccount);
  const token = record(root.token);
  const intelligence = Object.keys(record(root.intelligence)).length
    ? record(root.intelligence)
    : Object.keys(record(project.intelligence)).length
      ? record(project.intelligence)
      : record(token.intelligence);
  const questions = Array.isArray(intelligence.questions) ? intelligence.questions : [];
  return questions.flatMap((candidate): SavedGapQuestion[] => {
    const question = record(candidate);
    const id = text(question.id, 180);
    const prompt = text(question.prompt, 800);
    const state = text(question.state, 80);
    if (!id || !prompt || !OPEN_QUESTION_STATES.has(state)) return [];
    return [{
      id,
      prompt,
      state,
      materiality: text(question.materiality, 40) || "important",
    }];
  });
}

export interface AuthorizedResearchScope {
  schemaVersion: typeof GAP_INVESTIGATION_SCHEMA_VERSION;
  gap: SavedGapQuestion;
  requestedTaskIds: string[];
  taskIds: string[];
  capabilities: ResearchCapability[];
  delegates: string[];
  timeBudgetSeconds: number;
  estimatedCostCeilingUsd: number;
}

export class GapInvestigationAuthorizationError extends Error {
  constructor(
    public readonly code:
      | "saved_plan_required"
      | "open_gap_required"
      | "research_tasks_required"
      | "research_task_not_allowed"
      | "research_task_blocked"
      | "time_budget_invalid"
      | "cost_ceiling_too_low",
    message: string,
  ) {
    super(message);
  }
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function roundUsd(value: number): number {
  return Math.ceil(value * 100) / 100;
}

/**
 * Freeze the exact server-selected research scope. The browser may choose task
 * ids already present in the saved plan, but it never supplies capabilities or
 * delegates. Identity and synthesis gates are added only when the same saved
 * director already selected them.
 */
export function authorizeGapInvestigation(input: {
  payload: unknown;
  gapId: string;
  requestedTaskIds: readonly string[];
  timeBudgetSeconds: number;
  acceptedCostCeilingUsd: number;
}): AuthorizedResearchScope {
  const plan = savedResearchPlan(input.payload);
  if (!plan) {
    throw new GapInvestigationAuthorizationError(
      "saved_plan_required",
      "This frozen report has no saved research plan to authorize.",
    );
  }
  const gap = savedOpenGapQuestions(input.payload).find((question) => question.id === input.gapId);
  if (!gap) {
    throw new GapInvestigationAuthorizationError(
      "open_gap_required",
      "The requested evidence gap is not open in this frozen report.",
    );
  }
  const requestedTaskIds = unique(input.requestedTaskIds).slice(0, 8);
  if (!requestedTaskIds.length) {
    throw new GapInvestigationAuthorizationError(
      "research_tasks_required",
      "Select at least one research task from the saved plan.",
    );
  }
  const byId = new Map(plan.tasks.map((task) => [task.id, task]));
  const requested = requestedTaskIds.map((taskId) => {
    const task = byId.get(taskId);
    if (!task) {
      throw new GapInvestigationAuthorizationError(
        "research_task_not_allowed",
        `Research task ${taskId} is not in the frozen plan.`,
      );
    }
    if (!OPEN_TASK_STATES.has(task.state)) {
      throw new GapInvestigationAuthorizationError(
        "research_task_not_allowed",
        `Research task ${taskId} is not open for follow-up.`,
      );
    }
    if (task.blockedBy.length) {
      throw new GapInvestigationAuthorizationError(
        "research_task_blocked",
        `Research task ${taskId} is blocked by an unresolved identity gate.`,
      );
    }
    return task;
  });
  const requiredGates = plan.tasks.filter((task) => (
    REQUIRED_GATE_CAPABILITIES.has(task.capability)
    && task.state !== "skipped"
    && task.blockedBy.length === 0
  ));
  const tasks = [...new Map([...requested, ...requiredGates].map((task) => [task.id, task])).values()];
  if (!Number.isInteger(input.timeBudgetSeconds) || input.timeBudgetSeconds < 180 || input.timeBudgetSeconds > 540) {
    throw new GapInvestigationAuthorizationError(
      "time_budget_invalid",
      "The investigation time budget must be between 180 and 540 seconds.",
    );
  }
  const estimatedCostCeilingUsd = roundUsd(tasks.reduce(
    (total, task) => total + COST_CEILING_USD[task.costClass],
    0,
  ));
  if (!Number.isFinite(input.acceptedCostCeilingUsd) || input.acceptedCostCeilingUsd < estimatedCostCeilingUsd) {
    throw new GapInvestigationAuthorizationError(
      "cost_ceiling_too_low",
      `The accepted cost ceiling must cover the $${estimatedCostCeilingUsd.toFixed(2)} server estimate.`,
    );
  }
  return {
    schemaVersion: GAP_INVESTIGATION_SCHEMA_VERSION,
    gap,
    requestedTaskIds,
    taskIds: tasks.map((task) => task.id),
    capabilities: unique(tasks.map((task) => task.capability)) as ResearchCapability[],
    delegates: unique(tasks.flatMap((task) => task.delegates)).slice(0, 40),
    timeBudgetSeconds: input.timeBudgetSeconds,
    estimatedCostCeilingUsd,
  };
}

/** Keep a fresh collector plan inside the frozen authorization capability set. */
export function restrictResearchPlan(
  plan: ResearchPlan,
  authorizedCapabilities?: readonly ResearchCapability[],
): ResearchPlan {
  if (!authorizedCapabilities) return plan;
  const allowed = new Set(authorizedCapabilities);
  const tasks = plan.tasks
    .filter((task) => allowed.has(task.capability))
    .map((task, index) => ({ ...task, rank: index + 1 }));
  const taskIds = new Set(tasks.map((task) => task.id));
  return {
    ...plan,
    tasks,
    nextActions: plan.nextActions
      .filter((action) => taskIds.has(action.taskId) && allowed.has(action.capability))
      .map((action, index) => ({ ...action, rank: index + 1 })),
  };
}

export function isProposedGapInvestigationPayload(payload: unknown): boolean {
  const marker = record(record(payload).gapInvestigation);
  return marker.schemaVersion === GAP_INVESTIGATION_SCHEMA_VERSION
    && marker.publicationState === "proposed"
    && Boolean(text(marker.authorizationId, 80))
    && Boolean(text(marker.sourceReportVersionId, 80));
}
