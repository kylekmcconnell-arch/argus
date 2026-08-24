// Explicitly authorized evidence-gap follow-up. This is intentionally separate
// from /api/ask: conversation remains frozen-report reasoning, while this route
// may spend a bounded research budget and can create only an inactive proposal.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditToken, collectSocialActivity, resolveInput, runAudit } from "./_collector.js";
import {
  consumeInvestigationQuota,
  requireArgusAuth,
  serviceCredentials,
  serviceHeaders,
  type AuthContext,
  type ServiceCredentials,
} from "./_auth.js";
import { loadExactVersionReport } from "./report.js";
import { persistGapInvestigationProposalBundle } from "./_provenance.js";
import { recordProviderUsageBatch, type PanelCostLine } from "./_cache.js";
import { screenSanctionedAddresses } from "./_sanctions-core.js";
import { coverageQualifiedCompleteness } from "../src/lib/reportPresentation.js";
import {
  reportChecks,
  reportCompleteness,
  TOKEN_GAP_DELEGATES,
  TOKEN_GAP_TASK_ID,
  withTokenGapInvestigationPlan,
} from "../src/lib/reports.js";
import {
  authorizeGapInvestigation,
  GapInvestigationAuthorizationError,
  type AuthorizedResearchScope,
} from "../src/lib/gapInvestigation.js";
import type { Dossier } from "../src/data/dossier.js";
import type { TraceStep } from "../src/data/evidence.js";
import type { RunnableTokenInput } from "../src/lib/resolveInput.js";
import type { TokenDossier } from "../src/token/audit.js";

export const config = { maxDuration: 600 };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODOLOGY_VERSION = "argus-person-v5-project-strength-bands";
const TOKEN_METHODOLOGY_VERSION = "argus-token-v2-terminal-outcomes";
const INVESTIGATION_METHODOLOGY_VERSION = "argus-investigation-v2-terminal-outcomes";
type JsonRecord = Record<string, unknown>;
type SupportedGapReportKind = "person" | "token" | "investigation";

const record = (value: unknown): JsonRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};

const text = (value: unknown, max = 500): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";

function parseBody(req: VercelRequest): JsonRecord | null {
  try {
    return record(typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body);
  } catch {
    return null;
  }
}

async function rpc(
  credentials: ServiceCredentials,
  name: string,
  body: JsonRecord,
  timeoutMs = 10_000,
): Promise<unknown> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${name} failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  return response.status === 204 ? null : response.json();
}

async function updateFailure(
  credentials: ServiceCredentials,
  auth: AuthContext,
  authorizationId: string,
  error: unknown,
): Promise<void> {
  const response = await fetch(
    `${credentials.url}/rest/v1/gap_investigations?id=eq.${encodeURIComponent(authorizationId)}&organization_id=eq.${encodeURIComponent(auth.organizationId)}&actor_user_id=eq.${encodeURIComponent(auth.userId)}&status=in.%28authorized%2Crunning%29`,
    {
      method: "PATCH",
      headers: serviceHeaders(credentials.key, { prefer: "return=minimal" }),
      body: JSON.stringify({
        status: "failed",
        failure_code: text(error instanceof Error ? error.message : error, 240) || "investigation_failed",
        completed_at: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (!response.ok) console.warn("[gap-investigation] failure receipt rejected", response.status);
}

function traceReceipt(step: TraceStep): JsonRecord {
  return {
    phase: text(step.phase, 80),
    label: text(step.label, 200),
    detail: text(step.detail, 1_000),
    source: text(step.source, 120),
    tone: step.tone,
    observedAt: new Date().toISOString(),
  };
}

function proposalPayload<T extends JsonRecord>(
  payload: T,
  auth: AuthContext,
  authorizationId: string,
  sourceReportVersionId: string,
  scope: AuthorizedResearchScope,
  observedCostUsd: number,
): T & { gapInvestigation: JsonRecord } {
  return {
    ...payload,
    gapInvestigation: {
      schemaVersion: 1,
      publicationState: "proposed",
      authorizationId,
      sourceReportVersionId,
      gapId: scope.gap.id,
      gapPrompt: scope.gap.prompt,
      requestedTaskIds: scope.requestedTaskIds,
      taskIds: scope.taskIds,
      capabilities: scope.capabilities,
      delegates: scope.delegates,
      actorUserId: auth.userId,
      timeBudgetSeconds: scope.timeBudgetSeconds,
      estimatedCostCeilingUsd: scope.estimatedCostCeilingUsd,
      observedCostUsd,
      budgetOutcome: observedCostUsd > scope.estimatedCostCeilingUsd ? "estimate_exceeded" : "within_estimate",
      createdAt: new Date().toISOString(),
    },
  };
}

function projectAccountHandle(payload: unknown): string {
  const root = record(payload);
  return text(record(root.projectAccount).handle, 80).replace(/^@/, "")
    || text(root.projectX, 80).replace(/^@/, "");
}

function collectorHandle(kind: SupportedGapReportKind, report: JsonRecord, payload: unknown): string {
  if (kind === "token") throw new Error("token reports use the bounded token collector");
  const handle = kind === "person"
    ? text(report.ref, 80).replace(/^@/, "")
    : projectAccountHandle(payload);
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) {
    throw new Error(kind === "person"
      ? "source report is not bound to a valid person handle"
      : "token and project report is not bound to a valid project account handle");
  }
  return handle;
}

function tokenCollectorInput(report: JsonRecord): RunnableTokenInput {
  const input = resolveInput(text(report.ref, 500));
  if (
    input.kind !== "token"
    || (input.via !== "evm" && input.via !== "solana" && input.via !== "dexscreener")
  ) {
    throw new Error("source report is not bound to an exact token contract or DexScreener URL");
  }
  return input as RunnableTokenInput;
}

function assertTokenCollectorScope(scope: AuthorizedResearchScope): void {
  const allowedDelegates = new Set<string>(TOKEN_GAP_DELEGATES);
  if (
    scope.taskIds.length !== 1
    || scope.taskIds[0] !== TOKEN_GAP_TASK_ID
    || scope.capabilities.length !== 1
    || scope.capabilities[0] !== "token_and_market"
    || scope.delegates.length !== allowedDelegates.size
    || scope.delegates.some((delegate) => !allowedDelegates.has(delegate))
  ) {
    throw new GapInvestigationAuthorizationError(
      "research_task_not_allowed",
      "The saved token follow-up does not match the bounded integrated token collector.",
    );
  }
}

function proposedReportPayload(
  kind: SupportedGapReportKind,
  sourcePayload: unknown,
  dossier: Dossier | TokenDossier,
): JsonRecord {
  if (kind === "person") return dossier as Dossier as unknown as JsonRecord;
  if (kind === "token") {
    const token = dossier as TokenDossier;
    return withTokenGapInvestigationPlan(token, reportChecks("token", token)) as unknown as JsonRecord;
  }
  return {
    ...record(sourcePayload),
    projectAccount: dossier as Dossier,
    projectAccountAudit: {
      state: "complete",
      note: "The authorized project-account follow-up completed and is preserved in this proposed report version.",
    },
  };
}

function reportProjection(
  kind: SupportedGapReportKind,
  report: JsonRecord,
  payload: JsonRecord,
  dossier: Dossier | TokenDossier,
) {
  if (kind === "person") {
    const person = dossier as Dossier;
    return {
      verdict: typeof person.report?.composite_verdict === "string"
        ? person.report.composite_verdict.slice(0, 40)
        : null,
      score: typeof person.report?.governing_score === "number"
        ? person.report.governing_score
        : null,
    };
  }
  if (kind === "token") {
    const token = dossier as TokenDossier;
    return {
      verdict: text(token.verdict, 40) || null,
      score: typeof token.score === "number" && Number.isFinite(token.score) ? token.score : null,
    };
  }
  const token = record(payload.token);
  return {
    verdict: text(token.verdict, 40) || text(report.verdict, 40) || null,
    score: typeof token.score === "number" && Number.isFinite(token.score)
      ? token.score
      : typeof report.score === "number" && Number.isFinite(report.score)
        ? report.score
        : null,
  };
}

async function authorizeAndExecute(
  req: VercelRequest,
  res: VercelResponse,
  auth: AuthContext,
  credentials: ServiceCredentials,
  body: JsonRecord,
): Promise<void> {
  const sourceReportVersionId = text(body.sourceReportVersionId, 80);
  const gapId = text(body.gapId, 180);
  const requestedTaskIds = Array.isArray(body.taskIds)
    ? body.taskIds.map((value) => text(value, 160)).filter(Boolean)
    : [];
  const timeBudgetSeconds = Number(body.timeBudgetSeconds);
  const acceptedCostCeilingUsd = Number(body.acceptedCostCeilingUsd);
  if (!UUID.test(sourceReportVersionId) || !gapId) {
    res.status(400).json({ error: "source_report_and_gap_required" });
    return;
  }

  const exact = await loadExactVersionReport(credentials, auth.organizationId, sourceReportVersionId);
  if (!exact) {
    res.status(404).json({ error: "source_report_not_found" });
    return;
  }
  const report = record(exact.report);
  const kind = text(report.kind, 40);
  if (kind !== "person" && kind !== "token" && kind !== "investigation") {
    res.status(409).json({
      error: "supported_report_required",
      note: "Bounded follow-up is available for person, token, and saved token + project reports.",
    });
    return;
  }
  const supportedKind: SupportedGapReportKind = kind;
  const payload = report.payload;
  let scope: AuthorizedResearchScope;
  try {
    scope = authorizeGapInvestigation({
      payload,
      gapId,
      requestedTaskIds,
      timeBudgetSeconds,
      acceptedCostCeilingUsd,
    });
    if (supportedKind === "token") assertTokenCollectorScope(scope);
  } catch (error) {
    if (error instanceof GapInvestigationAuthorizationError) {
      res.status(409).json({ error: error.code, note: error.message });
      return;
    }
    throw error;
  }

  const quota = await consumeInvestigationQuota(auth, "/api/gap-investigation", {
    sourceReportVersionId,
    gapId,
    taskIds: scope.taskIds,
  });
  if (quota.error) {
    res.status(503).json({ error: quota.error, note: "Usage controls are temporarily unavailable." });
    return;
  }
  if (!quota.allowed) {
    res.status(429).json({
      error: quota.reason || "daily_investigation_limit_reached",
      remaining: 0,
    });
    return;
  }

  const expiresAt = new Date(Date.now() + Math.min(30 * 60_000, (scope.timeBudgetSeconds + 180) * 1_000)).toISOString();
  const authorizationResult = await rpc(credentials, "authorize_gap_investigation", {
    p_organization_id: auth.organizationId,
    p_source_report_version_id: sourceReportVersionId,
    p_gap_id: scope.gap.id,
    p_gap_prompt: scope.gap.prompt,
    p_requested_task_ids: scope.requestedTaskIds,
    p_task_ids: scope.taskIds,
    p_capabilities: scope.capabilities,
    p_delegates: scope.delegates,
    p_actor_user_id: auth.userId,
    p_expires_at: expiresAt,
    p_time_budget_seconds: scope.timeBudgetSeconds,
    p_estimated_cost_ceiling_usd: scope.estimatedCostCeilingUsd,
  });
  const authorizationId = text(authorizationResult, 80);
  if (!UUID.test(authorizationId)) throw new Error("authorization RPC returned no id");

  try {
    await rpc(credentials, "start_gap_investigation", {
      p_organization_id: auth.organizationId,
      p_authorization_id: authorizationId,
      p_actor_user_id: auth.userId,
    });
    const receipts: JsonRecord[] = [{
      phase: "authorization",
      state: "accepted",
      observedAt: new Date().toISOString(),
      sourceReportVersionId,
      gapId: scope.gap.id,
      taskIds: scope.taskIds,
    }];
    const startedAt = Date.now();
    const handle = supportedKind === "token" ? null : collectorHandle(supportedKind, report, payload);
    let dossier: Dossier | TokenDossier | null;
    if (supportedKind === "token") {
      const deadlineMs = Math.max(1_000, scope.timeBudgetSeconds * 1_000 - 15_000);
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        dossier = await Promise.race([
          auditToken(tokenCollectorInput(report), (step) => {
            if (receipts.length < 199) receipts.push(traceReceipt(step));
          }, {
            force: true,
            screenSanctions: screenSanctionedAddresses,
            collectSocialActivity,
          }),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(new Error("bounded token collector exceeded its authorized time budget")), deadlineMs);
          }),
        ]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    } else {
      dossier = await runAudit(handle as string, (step) => {
        if (receipts.length < 199) receipts.push(traceReceipt(step));
      }, {
        organizationId: auth.organizationId,
        intent: savedIntent(payload),
        analystDeadlineAt: startedAt + scope.timeBudgetSeconds * 1_000 - 30_000,
        authorizedResearchScope: {
          taskIds: scope.taskIds,
          capabilities: scope.capabilities,
          delegates: scope.delegates,
        },
      });
    }
    if (!dossier) throw new Error("bounded collector returned no dossier");

    const personDossier = supportedKind === "token" ? null : dossier as Dossier;
    const costRecord = record(personDossier?.cost);
    const observedCostUsd = typeof costRecord.usd === "number" && Number.isFinite(costRecord.usd)
      ? Math.max(0, costRecord.usd)
      : 0;
    const proposedBase = proposedReportPayload(supportedKind, payload, dossier);
    const proposed = proposalPayload(
      proposedBase,
      auth,
      authorizationId,
      sourceReportVersionId,
      scope,
      observedCostUsd,
    );
    const { verdict, score } = reportProjection(supportedKind, report, proposed, dossier);
    const attestationState = (supportedKind === "person" || supportedKind === "token") && dossier.live
      ? "server_collected" as const
      : "analyst_submitted" as const;
    const checks = supportedKind === "person"
      ? personDossier?.checkRuns ?? []
      : reportChecks(supportedKind, proposed);
    const requestedCompleteness = supportedKind === "person"
      ? personDossier?.completeness_state === "complete" ? "complete" : "partial"
      : reportCompleteness(supportedKind, proposed, checks);
    const completenessState = observedCostUsd > scope.estimatedCostCeilingUsd
      ? "partial" as const
      : coverageQualifiedCompleteness({
          completeness: requestedCompleteness,
          attestation: attestationState,
          checks,
        });
    receipts.push({
      phase: "completion",
      state: completenessState === "complete" ? "complete" : "partial",
      observedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      observedCostUsd,
      estimatedCostCeilingUsd: scope.estimatedCostCeilingUsd,
    });
    const runId = personDossier && typeof personDossier.report?.audit_id === "string"
      ? `gap:${authorizationId}:${personDossier.report.audit_id}`.slice(0, 200)
      : supportedKind === "token"
        ? `gap:${authorizationId}:${(dossier as TokenDossier).address}`.slice(0, 200)
        : `gap:${authorizationId}`;
    const proposedReportVersionId = await persistGapInvestigationProposalBundle(credentials, {
      authorizationId,
      organizationId: auth.organizationId,
      kind: supportedKind,
      canonicalRef: supportedKind === "person" ? (handle as string).toLowerCase() : text(report.ref, 500),
      query: text(report.query, 200) || (supportedKind === "person" ? `@${handle}` : text(report.ref, 200)),
      createdBy: auth.userId,
      payload: proposed,
      checks,
      runId,
      attestationState,
      verdict,
      score,
      completenessState,
      methodologyVersion: process.env.ARGUS_METHODOLOGY_VERSION
        || (supportedKind === "person"
          ? personDossier?.axisCitationVersion === 1 ? METHODOLOGY_VERSION : null
          : supportedKind === "token"
            ? TOKEN_METHODOLOGY_VERSION
            : INVESTIGATION_METHODOLOGY_VERSION),
      providerSnapshot: personDossier?.providerSnapshot ?? {},
      cost: personDossier?.cost ?? {},
      executionReceipts: receipts.slice(0, 200),
    });
    const costLines = Array.isArray(costRecord.calls) ? costRecord.calls as PanelCostLine[] : [];
    if (costLines.length) {
      await recordProviderUsageBatch(auth.organizationId, proposedReportVersionId, auth.userId, costLines);
    }
    res.status(201).json({
      authorizationId,
      sourceReportVersionId,
      proposedReportVersionId,
      status: completenessState === "complete" ? "proposed" : "partial",
      active: false,
      gap: scope.gap,
      taskIds: scope.taskIds,
      delegates: scope.delegates,
      timeBudgetSeconds: scope.timeBudgetSeconds,
      estimatedCostCeilingUsd: scope.estimatedCostCeilingUsd,
      observedCostUsd,
      costOutcome: observedCostUsd > scope.estimatedCostCeilingUsd ? "estimate_exceeded" : "within_estimate",
      reviewPath: `/?version=${encodeURIComponent(proposedReportVersionId)}`,
    });
  } catch (error) {
    await updateFailure(credentials, auth, authorizationId, error);
    throw error;
  }
}

function savedIntent(payload: unknown): "investment_due_diligence" | "counterparty_risk" | "alpha_discovery" | "identity_and_control" {
  const root = record(payload);
  const plan = Object.keys(record(root.researchPlan)).length
    ? record(root.researchPlan)
    : record(record(root.projectAccount).researchPlan);
  const intent = text(plan.intent, 80);
  return intent === "counterparty_risk" || intent === "alpha_discovery" || intent === "identity_and_control"
    ? intent
    : "investment_due_diligence";
}

async function mutateProposal(
  res: VercelResponse,
  auth: AuthContext,
  credentials: ServiceCredentials,
  body: JsonRecord,
): Promise<void> {
  const authorizationId = text(body.authorizationId, 80);
  const action = text(body.action, 40);
  if (!UUID.test(authorizationId) || (action !== "promote" && action !== "rollback")) {
    res.status(400).json({ error: "authorization_and_action_required" });
    return;
  }
  const name = action === "promote"
    ? "promote_gap_investigation_proposal"
    : "rollback_gap_investigation_proposal";
  const result = await rpc(credentials, name, {
    p_organization_id: auth.organizationId,
    p_authorization_id: authorizationId,
    p_actor_user_id: auth.userId,
  }, 20_000);
  res.status(200).json({
    authorizationId,
    status: action === "promote" ? "promoted" : "rolled_back",
    ...(action === "promote" && typeof result === "string" ? { reportVersionId: result } : {}),
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "PATCH") {
    res.status(405).setHeader("Allow", "POST, PATCH").json({ error: "method_not_allowed" });
    return;
  }
  const body = parseBody(req);
  if (!body) {
    res.status(400).json({ error: "invalid_json" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "analyst");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "storage_not_configured" });
    return;
  }
  try {
    if (req.method === "PATCH") {
      await mutateProposal(res, auth, credentials, body);
      return;
    }
    await authorizeAndExecute(req, res, auth, credentials, body);
  } catch (error) {
    console.error("[gap-investigation] failed", error);
    res.status(502).json({
      error: "gap_investigation_failed",
      note: text(error instanceof Error ? error.message : error, 300) || "The bounded investigation failed.",
    });
  }
}
