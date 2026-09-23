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
async function writeScanReceipt(auth: AuthContext, input: ScanReceiptWrite): Promise<"written" | "duplicate" | "unavailable"> {
  const credentials = serviceCredentials();
  if (!credentials || !RUN_KEY.test(input.runKey)) return "unavailable";
  const canonicalRef = cleanText(input.canonicalRef, 500);
  const displayQuery = cleanText(input.displayQuery, 500);
  const route = cleanText(input.route, 160);
  const startedAt = iso(input.startedAt);
  const finishedAt = input.status === "running" ? null : iso(input.finishedAt ?? "");
  const durationMs = input.status === "running"
    ? null
    : Number.isFinite(input.durationMs) ? Math.max(0, Math.floor(input.durationMs ?? 0)) : null;
  if (!canonicalRef || !displayQuery || !route || !startedAt) return "unavailable";
  if (input.status !== "running" && (!finishedAt || durationMs == null)) return "unavailable";
  if (input.reportVersionId && !UUID.test(input.reportVersionId)) return "unavailable";

  const costBasis = input.costBasis ?? "unknown";
  const providerCostUsd = costBasis === "unknown"
    ? null
    : Number.isFinite(input.providerCostUsd)
      ? Math.max(0, Math.round((input.providerCostUsd ?? 0) * 100000000) / 100000000)
      : null;
  if (costBasis !== "unknown" && providerCostUsd == null) return "unavailable";

  const starting = input.status === "running";
  const outcome = {
    status: input.status,
    report_version_id: input.reportVersionId ?? null,
    provider_cost_usd: providerCostUsd,
    cost_basis: costBasis,
    finished_at: finishedAt,
    duration_ms: durationMs,
    failure_code: input.failureCode ? cleanText(input.failureCode, 100) : null,
    failure_detail: input.failureDetail ? cleanText(input.failureDetail, 500) : null,
  };
  // Identity belongs to the reservation. A terminal write patches the outcome
  // only: resending identity trips the immutability guard whenever the
  // finishing caller normalises a value differently from the reserving one
  // (a checksummed address against a lowercased ref, a resolved symbol against
  // raw input), which would strand the receipt in `running` for good.
  const row = starting
    ? {
      organization_id: auth.organizationId,
      run_key: input.runKey,
      initiated_by: auth.userId,
      route,
      kind: input.kind,
      canonical_ref: canonicalRef,
      display_query: displayQuery,
      private_run: input.privateRun === true,
      credits_charged_millis: Math.max(0, Math.round((input.creditsCharged ?? 0) * 1000)),
      started_at: startedAt,
      metadata: { deployment: process.env.VERCEL_GIT_COMMIT_SHA ?? null, methodology: "argus-reliability-20260909" },
      ...outcome,
    }
    : outcome;
  const endpoint = starting
    ? `${credentials.url}/rest/v1/scan_run_receipts?on_conflict=organization_id,run_key`
    : `${credentials.url}/rest/v1/scan_run_receipts?organization_id=eq.${encodeURIComponent(auth.organizationId)}&run_key=eq.${encodeURIComponent(input.runKey)}`;
  const prefer = starting ? "resolution=ignore-duplicates,return=representation" : "return=representation";
  try {
    const response = await fetch(endpoint, {
      method: starting ? "POST" : "PATCH",
      headers: serviceHeaders(credentials.key, { prefer }),
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      const updated = await response.json() as unknown;
      if (!Array.isArray(updated)) return "unavailable";
      return updated.length === 1 ? "written" : starting && updated.length === 0 ? "duplicate" : "unavailable";
    }
    console.error("[scan-receipt] write rejected", response.status);
  } catch (error) {
    console.error("[scan-receipt] write failed", error instanceof Error ? error.message : "transport");
  }
  return "unavailable";
}

/** Claim once using the existing tenant/run unique constraint, before providers start. */
export async function claimScanReceipt(auth: AuthContext, input: ScanReceiptWrite) {
  if (input.status !== "running") return "unavailable" as const;
  return writeScanReceipt(auth, input);
}

/** True when the reservation input can be written as a running receipt. Checked before any credit moves. */
export function scanReceiptClaimInputValid(input: Pick<ScanReceiptWrite, "runKey" | "canonicalRef" | "displayQuery" | "route" | "startedAt">): boolean {
  return RUN_KEY.test(input.runKey)
    && cleanText(input.canonicalRef, 500).length > 0
    && cleanText(input.displayQuery, 500).length > 0
    && cleanText(input.route, 160).length > 0
    && iso(input.startedAt) !== null;
}

export interface ExistingScanReceipt {
  initiatedBy: string;
  route: string;
  kind: string;
  canonicalRef: string;
  status: string;
  reportVersionId: string | null;
}

/**
 * Read the tenant/run receipt a duplicate claim collided with. `null` means no
 * row; `"unavailable"` means the store could not answer, which callers must
 * treat as unknown rather than as absence.
 */
export async function readScanReceipt(auth: AuthContext, runKey: string): Promise<ExistingScanReceipt | null | "unavailable"> {
  const credentials = serviceCredentials();
  if (!credentials || !RUN_KEY.test(runKey)) return "unavailable";
  try {
    const response = await fetch(
      `${credentials.url}/rest/v1/scan_run_receipts?organization_id=eq.${encodeURIComponent(auth.organizationId)}&run_key=eq.${encodeURIComponent(runKey)}&select=initiated_by,route,kind,canonical_ref,status,report_version_id&limit=1`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return "unavailable";
    const rows = await response.json() as unknown;
    const row = Array.isArray(rows) && rows[0] && typeof rows[0] === "object" ? rows[0] as Record<string, unknown> : null;
    if (!row) return null;
    return {
      initiatedBy: typeof row.initiated_by === "string" ? row.initiated_by : "",
      route: typeof row.route === "string" ? row.route : "",
      kind: typeof row.kind === "string" ? row.kind : "",
      canonicalRef: typeof row.canonical_ref === "string" ? row.canonical_ref : "",
      status: typeof row.status === "string" ? row.status : "",
      reportVersionId: typeof row.report_version_id === "string" ? row.report_version_id : null,
    };
  } catch (error) {
    console.error("[scan-receipt] read failed", error instanceof Error ? error.message : "transport");
    return "unavailable";
  }
}

export async function recordScanReceipt(auth: AuthContext, input: ScanReceiptWrite): Promise<boolean> {
  return (await writeScanReceipt(auth, input)) !== "unavailable";
}

/**
 * A duplicate run key is two different failures wearing one error code. The
 * same subject retried is a recoverable replay; a DIFFERENT subject on a key
 * this organization already paid for is an attempt to spend one credit twice,
 * and the caller should be told so rather than invited to open a saved result
 * belonging to somebody else (#355).
 */
export async function describeClaimedRun(
  auth: AuthContext,
  runKey: string,
  route: string,
  canonicalRef: string,
): Promise<"same_subject" | "subject_mismatch" | "unknown"> {
  const credentials = serviceCredentials();
  if (!credentials) return "unknown";
  try {
    const response = await fetch(
      `${credentials.url}/rest/v1/scan_run_receipts?organization_id=eq.${encodeURIComponent(auth.organizationId)}&run_key=eq.${encodeURIComponent(runKey)}&select=route,canonical_ref&limit=1`,
      { headers: serviceHeaders(credentials.key), signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return "unknown";
    const prior = (await response.json() as { route?: string; canonical_ref?: string }[])[0];
    if (!prior) return "unknown";
    return prior.route === route && prior.canonical_ref === canonicalRef ? "same_subject" : "subject_mismatch";
  } catch {
    return "unknown";
  }
}
