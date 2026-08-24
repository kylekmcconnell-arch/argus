import type { VercelRequest, VercelResponse } from "@vercel/node";
import { requireArgusAuth, serviceCredentials, serviceHeaders } from "./_auth.js";

type JsonRecord = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const asRecord = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown, max = 500) => typeof value === "string"
  ? value
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]")
    .slice(0, max)
  : "";
const number = (value: unknown) => {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

async function rows(url: string, key: string): Promise<JsonRecord[]> {
  const response = await fetch(url, { headers: serviceHeaders(key), signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`scan operations read failed (${response.status})`);
  const value = await response.json() as unknown;
  return Array.isArray(value) ? value.map(asRecord) : [];
}

const inFilter = (ids: readonly string[]) => encodeURIComponent(`in.(${ids.join(",")})`);

// Provider and check reads are bounded. A capped read is a floor, never a
// total, so the response has to say when the cap was reached rather than
// publish a confident cost built on a truncated sample.
const EVENT_PAGE_LIMIT = 5000;

export type ProviderFailureClass = "quota" | "rate_limit" | "authentication" | "timeout" | "transport" | "provider_error" | null;

export function classifyProviderFailure(status: string, meta?: string): ProviderFailureClass {
  if (status !== "failed") return null;
  const value = (meta ?? "").toLowerCase();
  if (/credits?_or_quota|quota[_\s-]?(?:exhausted|limit)|usage[_\s-]?limit|insufficient[_\s-]?credits?/.test(value)) return "quota";
  if (/http_429|rate[_\s-]?limit/.test(value)) return "rate_limit";
  if (/http_401|http_403|unauthori[sz]ed|forbidden|invalid[_\s-]?(?:key|credential)|authentication/.test(value)) return "authentication";
  if (/timeout|timed[_\s-]?out/.test(value)) return "timeout";
  if (/transport|network|dns|econn|socket/.test(value)) return "transport";
  return "provider_error";
}

function publicFailureDetail(kind: ProviderFailureClass): string {
  if (kind === "quota") return "The provider reported exhausted credits or quota.";
  if (kind === "rate_limit") return "The provider rate-limited this scan.";
  if (kind === "authentication") return "The provider rejected ARGUS access. Check its credential or plan.";
  if (kind === "timeout") return "The provider did not answer before the scan deadline.";
  if (kind === "transport") return "ARGUS could not reach the provider.";
  return "The provider returned an unsuccessful result.";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "method_not_allowed" });
    return;
  }
  const auth = await requireArgusAuth(req, res, "owner");
  if (!auth) return;
  const credentials = serviceCredentials();
  if (!credentials) {
    res.status(503).json({ error: "scan_operations_unavailable", message: "Scan operations storage is unavailable." });
    return;
  }
  const requested = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 30;
  const limit = Number.isFinite(requested) ? Math.min(100, Math.max(1, requested)) : 30;

  try {
    const receiptUrl = new URL(`${credentials.url}/rest/v1/scan_run_receipts`);
    receiptUrl.searchParams.set("select", "id,run_key,initiated_by,route,kind,canonical_ref,display_query,private_run,status,credits_charged_millis,report_version_id,provider_cost_usd,cost_basis,started_at,finished_at,duration_ms,failure_code,failure_detail");
    receiptUrl.searchParams.set("organization_id", `eq.${auth.organizationId}`);
    receiptUrl.searchParams.set("order", "started_at.desc,id.desc");
    receiptUrl.searchParams.set("limit", String(limit));
    const receipts = await rows(receiptUrl.toString(), credentials.key);
    const versionIds = [...new Set(receipts.map((row) => text(row.report_version_id, 36)).filter((id) => UUID.test(id)))];
    const actorIds = [...new Set(receipts.map((row) => text(row.initiated_by, 36)).filter((id) => UUID.test(id)))];

    const [versions, usage, checks, members] = await Promise.all([
      versionIds.length
        ? rows(`${credentials.url}/rest/v1/report_versions?select=id,case_id,version,completeness_state,verdict,score,created_at&organization_id=eq.${encodeURIComponent(auth.organizationId)}&id=${inFilter(versionIds)}`, credentials.key)
        : Promise.resolve([]),
      versionIds.length
        ? rows(`${credentials.url}/rest/v1/provider_usage_events?select=id,report_version_id,provider,operation,calls,usd,status,meta,created_at&organization_id=eq.${encodeURIComponent(auth.organizationId)}&report_version_id=${inFilter(versionIds)}&order=created_at.asc,id.asc&limit=${EVENT_PAGE_LIMIT}`, credentials.key)
        : Promise.resolve([]),
      versionIds.length
        ? rows(`${credentials.url}/rest/v1/check_runs?select=id,report_version_id,check_id,provider,state,error_code,error_detail,metadata&organization_id=eq.${encodeURIComponent(auth.organizationId)}&report_version_id=${inFilter(versionIds)}&order=finished_at.asc,id.asc&limit=${EVENT_PAGE_LIMIT}`, credentials.key)
        : Promise.resolve([]),
      actorIds.length
        ? rows(`${credentials.url}/rest/v1/argus_members?select=user_id,display_name&organization_id=eq.${encodeURIComponent(auth.organizationId)}&user_id=${inFilter(actorIds)}`, credentials.key)
        : Promise.resolve([]),
    ]);
    const caseIds = [...new Set(versions.map((row) => text(row.case_id, 36)).filter((id) => UUID.test(id)))];
    const cases = caseIds.length
      ? await rows(`${credentials.url}/rest/v1/cases?select=id,kind,canonical_ref,display_query&organization_id=eq.${encodeURIComponent(auth.organizationId)}&id=${inFilter(caseIds)}`, credentials.key)
      : [];
    const versionById = new Map(versions.map((row) => [text(row.id, 36), row]));
    const caseById = new Map(cases.map((row) => [text(row.id, 36), row]));
    const actorById = new Map(members.map((row) => [text(row.user_id, 36), text(row.display_name, 80) || "Analyst"]));
    const usageByVersion = new Map<string, JsonRecord[]>();
    const checksByVersion = new Map<string, JsonRecord[]>();
    for (const row of usage) {
      const id = text(row.report_version_id, 36);
      usageByVersion.set(id, [...(usageByVersion.get(id) ?? []), row]);
    }
    for (const row of checks) {
      const id = text(row.report_version_id, 36);
      checksByVersion.set(id, [...(checksByVersion.get(id) ?? []), row]);
    }
    // Hitting the cap means rows were left unread, so any cost summed from
    // this sample is a minimum. Say so rather than presenting it as the total.
    const usageTruncated = usage.length >= EVENT_PAGE_LIMIT;
    const checksTruncated = checks.length >= EVENT_PAGE_LIMIT;

    const now = Date.now();
    const scans = receipts.map((receipt) => {
      const reportVersionId = text(receipt.report_version_id, 36);
      const version = versionById.get(reportVersionId);
      const reportCase = version ? caseById.get(text(version.case_id, 36)) : undefined;
      const providerRows = usageByVersion.get(reportVersionId) ?? [];
      const checkRows = checksByVersion.get(reportVersionId) ?? [];
      const startedAt = text(receipt.started_at, 40);
      const stalled = receipt.status === "running" && Number.isFinite(Date.parse(startedAt)) && now - Date.parse(startedAt) > 20 * 60_000;
      const status = stalled ? "failed" : text(receipt.status, 20);
      const providers = providerRows.map((event) => {
        const failureClass = classifyProviderFailure(text(event.status, 20), text(event.meta, 500));
        return {
          id: text(event.id, 36),
          provider: text(event.provider, 100),
          operation: text(event.operation, 160),
          calls: Math.max(0, Math.floor(number(event.calls) ?? 0)),
          usd: Math.max(0, number(event.usd) ?? 0),
          costBasis: "estimated" as const,
          status: text(event.status, 20),
          failureClass,
          detail: failureClass ? publicFailureDetail(failureClass) : undefined,
        };
      });
      const checksResult = checkRows.map((row) => {
        const metadata = asRecord(row.metadata);
        return {
          id: text(row.check_id, 160),
          label: text(metadata.label, 200) || text(row.check_id, 160).replace(/[-_]+/g, " "),
          provider: text(row.provider, 100) || undefined,
          state: text(row.state, 30),
          status: text(metadata.status, 40) || text(row.state, 30),
          required: metadata.decisionCritical === true,
          detail: text(row.error_detail, 500) || text(metadata.note, 500) || undefined,
        };
      });
      const eventCost = providers.reduce((sum, line) => sum + line.usd, 0);
      const receiptCost = number(receipt.provider_cost_usd);
      const providerCostUsd = receiptCost ?? (providers.length ? eventCost : null);
      const costBasis = receiptCost != null ? text(receipt.cost_basis, 20) : providers.length ? "estimated" : "unknown";
      const requiredOpen = checksResult.filter((check) => check.required && !["complete", "not-applicable"].includes(check.state));
      const issueProviders = providers.filter((line) => line.status === "failed" || line.status === "partial");
      const alerts = [
        ...(status === "failed" ? [{
          id: `${text(receipt.id, 36)}:run`, severity: "critical", kind: stalled ? "stalled" : "scan_failed",
          title: stalled ? "Scan appears stalled" : "Scan failed",
          detail: stalled ? "No terminal receipt was recorded within 20 minutes." : text(receipt.failure_detail, 500) || "The scan did not finish normally.",
        }] : []),
        ...(status === "degraded" ? [{
          id: `${text(receipt.id, 36)}:degraded`, severity: "warning", kind: "scan_degraded",
          title: "Scan finished with an operational problem",
          detail: text(receipt.failure_detail, 500) || "Review the failed provider and required-check rows.",
        }] : []),
        ...requiredOpen.map((check) => ({
          id: `${text(receipt.id, 36)}:check:${check.id}`, severity: "critical", kind: "required_check",
          title: `${check.label} did not finish`, detail: check.detail || "A required report check has no completed outcome.",
        })),
        ...issueProviders.map((line) => ({
          id: `${text(receipt.id, 36)}:provider:${line.provider}:${line.operation}:${line.failureClass}`,
          severity: line.failureClass === "quota" || line.failureClass === "authentication" ? "critical" : "warning",
          kind: line.failureClass ?? "provider_error",
          title: `${line.provider} ${line.status === "partial" ? "was incomplete" : "failed"} during ${line.operation.replace(/[-_]+/g, " ")}`,
          detail: line.detail || (line.status === "partial" ? "The provider returned only part of the requested result." : "The provider returned an unsuccessful result."),
        })),
      ];
      return {
        id: text(receipt.id, 36),
        runKey: text(receipt.run_key, 220),
        route: text(receipt.route, 160),
        kind: text(receipt.kind, 30),
        ref: text(receipt.canonical_ref, 500),
        label: text(receipt.display_query, 500),
        private: receipt.private_run === true,
        status,
        actor: actorById.get(text(receipt.initiated_by, 36)) ?? "Analyst",
        creditsCharged: Math.max(0, (number(receipt.credits_charged_millis) ?? 0) / 1000),
        providerCostUsd,
        costBasis,
        startedAt,
        finishedAt: text(receipt.finished_at, 40) || null,
        durationMs: number(receipt.duration_ms),
        failureCode: stalled ? "stalled" : text(receipt.failure_code, 100) || null,
        failureDetail: stalled ? "No terminal receipt was recorded within 20 minutes." : text(receipt.failure_detail, 500) || null,
        report: reportVersionId ? {
          reportVersionId,
          version: Math.max(0, Math.floor(number(version?.version) ?? 0)),
          completeness: text(version?.completeness_state, 30),
          verdict: text(version?.verdict, 40) || null,
          score: number(version?.score),
          label: text(reportCase?.display_query, 500) || text(receipt.display_query, 500),
        } : null,
        checks: checksResult,
        providers,
        alerts,
      };
    });
    const alerts = scans.flatMap((scan) => scan.alerts.map((alert) => ({ ...alert, scanId: scan.id, scanLabel: scan.label, startedAt: scan.startedAt })));
    res.setHeader("cache-control", "private, no-store");
    res.status(200).json({
      available: true,
      scans,
      alerts,
      totals: {
        scans: scans.length,
        running: scans.filter((scan) => scan.status === "running").length,
        degraded: scans.filter((scan) => scan.status === "degraded").length,
        failed: scans.filter((scan) => scan.status === "failed").length,
        credits: scans.reduce((sum, scan) => sum + scan.creditsCharged, 0),
        providerCostUsd: scans.reduce((sum, scan) => sum + (scan.providerCostUsd ?? 0), 0),
        unknownCostScans: scans.filter((scan) => scan.costBasis === "unknown").length,
        providerCostIsFloor: usageTruncated,
        truncated: { providerEvents: usageTruncated, checks: checksTruncated },
      },
    });
  } catch (error) {
    console.error("[scan-operations] read failed", error);
    res.status(503).json({ error: "scan_operations_unavailable", message: "Scan operations could not be loaded." });
  }
}
