import { serviceCredentials, serviceHeaders, type AuthContext } from "./_auth.js";

export type ScanReceiptKind = "person" | "token" | "investigation" | "site";
export type ScanReceiptStatus = "running" | "complete" | "degraded" | "failed";
export type ScanCostBasis = "exact" | "estimated" | "unknown";

export interface ScanReceiptWrite {
  runKey: string;
  route: string;
  kind: ScanReceiptKind;
  canonicalRef: string;
  displayQuery: string;
  privateRun?: boolean;
  status: ScanReceiptStatus;
  creditsCharged?: number;
  reportVersionId?: string | null;
  providerCostUsd?: number | null;
  costBasis?: ScanCostBasis;
  startedAt: string;
  finishedAt?: string | null;
  durationMs?: number | null;
  failureCode?: string | null;
  failureDetail?: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RUN_KEY = /^[A-Za-z0-9:_-]{8,220}$/;

function cleanText(value: string, max: number): string {
  const printable = [...value.trim()]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 ? " " : character;
    })
    .join("");
  return printable
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|token|secret|password)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .slice(0, max);
}

function iso(value: string): string | null {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/**
 * Server-mediated scan receipt write. Starting the same run is insert-only so
 * an idempotent credit reservation cannot reset a terminal receipt. Terminal
 * writes update an existing tenant/run row only and may attach the persisted report.
 */
export async function recordScanReceipt(auth: AuthContext, input: ScanReceiptWrite): Promise<boolean> {
  const credentials = serviceCredentials();
  if (!credentials || !RUN_KEY.test(input.runKey)) return false;
  const canonicalRef = cleanText(input.canonicalRef, 500);
  const displayQuery = cleanText(input.displayQuery, 500);
  const route = cleanText(input.route, 160);
  const startedAt = iso(input.startedAt);
  const finishedAt = input.status === "running" ? null : iso(input.finishedAt ?? "");
  const durationMs = input.status === "running"
    ? null
    : Number.isFinite(input.durationMs) ? Math.max(0, Math.floor(input.durationMs ?? 0)) : null;
  if (!canonicalRef || !displayQuery || !route || !startedAt) return false;
  if (input.status !== "running" && (!finishedAt || durationMs == null)) return false;
  if (input.reportVersionId && !UUID.test(input.reportVersionId)) return false;

  const costBasis = input.costBasis ?? "unknown";
  const providerCostUsd = costBasis === "unknown"
    ? null
    : Number.isFinite(input.providerCostUsd)
      ? Math.max(0, Math.round((input.providerCostUsd ?? 0) * 100000000) / 100000000)
      : null;
  if (costBasis !== "unknown" && providerCostUsd == null) return false;

  const row = {
    organization_id: auth.organizationId,
    run_key: input.runKey,
    initiated_by: auth.userId,
    route,
    kind: input.kind,
    canonical_ref: canonicalRef,
    display_query: displayQuery,
    private_run: input.privateRun === true,
    status: input.status,
    credits_charged_millis: Math.max(0, Math.round((input.creditsCharged ?? 0) * 1000)),
    report_version_id: input.reportVersionId ?? null,
    provider_cost_usd: providerCostUsd,
    cost_basis: costBasis,
    started_at: startedAt,
    finished_at: finishedAt,
    duration_ms: durationMs,
    failure_code: input.failureCode ? cleanText(input.failureCode, 100) : null,
    failure_detail: input.failureDetail ? cleanText(input.failureDetail, 500) : null,
    metadata: {},
  };
  const starting = input.status === "running";
  const endpoint = starting
    ? `${credentials.url}/rest/v1/scan_run_receipts?on_conflict=organization_id,run_key`
    : `${credentials.url}/rest/v1/scan_run_receipts?organization_id=eq.${encodeURIComponent(auth.organizationId)}&run_key=eq.${encodeURIComponent(input.runKey)}`;
  const prefer = starting ? "resolution=ignore-duplicates,return=minimal" : "return=representation";
  try {
    const response = await fetch(endpoint, {
      method: starting ? "POST" : "PATCH",
      headers: serviceHeaders(credentials.key, { prefer }),
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      if (starting) return true;
      const updated = await response.json() as unknown;
      return Array.isArray(updated) && updated.length === 1;
    }
    console.error("[scan-receipt] write rejected", response.status);
  } catch (error) {
    console.error("[scan-receipt] write failed", error instanceof Error ? error.message : "transport");
  }
  return false;
}
