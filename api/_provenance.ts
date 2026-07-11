import { createHash } from "node:crypto";
import { serviceHeaders, type ServiceCredentials } from "./_auth.js";

type JsonRecord = Record<string, unknown>;

export interface ProvenanceContext {
  organizationId: string;
  reportVersionId: string;
  attestationState: "server_collected" | "analyst_submitted" | "legacy_unattested";
}

const asRecord = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;

const textValue = (record: JsonRecord, keys: string[], max: number): string | null => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
  }
  return null;
};

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

const timestampValue = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

function safeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:access[_-]?token|api[_-]?key|key|token|signature|sig|auth)$/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString().slice(0, 2_000);
  } catch {
    return null;
  }
}

function collectEvidence(payload: unknown, context: ProvenanceContext): JsonRecord[] {
  const evidence = new Map<string, JsonRecord>();
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: payload, path: "$", depth: 0 },
  ];
  const urlKeys = ["url", "source_url", "sourceUrl", "link", "href", "citation"];

  while (stack.length && evidence.size < 400) {
    const item = stack.pop();
    if (!item || item.depth > 8 || item.value === null || typeof item.value !== "object") continue;
    if (seen.has(item.value as object)) continue;
    seen.add(item.value as object);

    if (Array.isArray(item.value)) {
      item.value.slice(0, 1_000).forEach((child, index) => {
        stack.push({ value: child, path: `${item.path}[${index}]`, depth: item.depth + 1 });
      });
      continue;
    }

    const record = item.value as JsonRecord;
    const rawUrl = textValue(record, urlKeys, 2_500)
      ?? (typeof record.source === "string" && /^https?:\/\//i.test(record.source) ? record.source : null);
    const sourceUrl = rawUrl ? safeSourceUrl(rawUrl) : null;
    const title = textValue(record, ["title", "name", "label", "project", "claim", "headline"], 500);
    const excerpt = textValue(record, ["excerpt", "text", "summary", "description", "rationale", "evidence", "quote"], 2_000);
    const provider = textValue(record, ["provider", "source_provider", "origin"], 100);
    const explicitSourceType = textValue(record, ["source_type", "sourceType", "kind", "type"], 100);
    const sourceType = explicitSourceType || "web";
    const suppliedHash = textValue(record, ["contentHash", "content_hash"], 64);
    const artifactContentHash = suppliedHash && /^[a-f0-9]{64}$/i.test(suppliedHash)
      ? suppliedHash.toLowerCase()
      : null;
    const suppliedSourceHash = textValue(record, ["sourceContentHash", "source_content_hash"], 64);
    const sourceContentHash = suppliedSourceHash && /^[a-f0-9]{64}$/i.test(suppliedSourceHash)
      ? suppliedSourceHash.toLowerCase()
      : null;
    // Internal deterministic artifacts (for example the frozen trust graph)
    // legitimately have no public URL. Accept them only when an exact SHA-256,
    // explicit provider, and explicit source kind are all present; this avoids
    // turning arbitrary URL-less payload objects into provenance records.
    const hashOnlyArtifact = !sourceUrl && !!artifactContentHash && !!provider && !!explicitSourceType;
    if (sourceUrl || hashOnlyArtifact) {
      const capturedAt = timestampValue(record.capturedAt ?? record.captured_at);
      const publishedAt = timestampValue(record.publishedAt ?? record.published_at);
      const match = textValue(record, ["match"], 40);
      const evidenceKey = artifactContentHash ?? hash(`${sourceUrl || ""}\n${title || ""}\n${excerpt || ""}`);
      evidence.set(evidenceKey, {
        organization_id: context.organizationId,
        report_version_id: context.reportVersionId,
        evidence_key: evidenceKey,
        provider,
        source_type: sourceType,
        source_url: sourceUrl,
        title,
        excerpt,
        content_hash: artifactContentHash ?? (excerpt ? hash(excerpt) : null),
        attestation_state: context.attestationState,
        metadata: {
          payloadPath: item.path,
          ...(capturedAt ? { capturedAt } : {}),
          ...(publishedAt ? { publishedAt } : {}),
          ...(match ? { match } : {}),
          ...(sourceContentHash ? { sourceContentHash } : {}),
          ...(hashOnlyArtifact ? { hashOnly: true } : {}),
        },
      });
    }

    for (const [key, child] of Object.entries(record)) {
      if (child !== null && typeof child === "object") {
        stack.push({ value: child, path: `${item.path}.${key}`, depth: item.depth + 1 });
      }
    }
  }
  return [...evidence.values()];
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

function collectCheckRuns(rawChecks: unknown, context: ProvenanceContext): JsonRecord[] {
  if (!Array.isArray(rawChecks)) return [];
  const used = new Set<string>();
  const rows: JsonRecord[] = [];
  for (const [order, value] of rawChecks.slice(0, 250).entries()) {
    const check = asRecord(value);
    if (!check) continue;
    const label = textValue(check, ["label", "name"], 200);
    const status = textValue(check, ["status"], 40);
    if (!label || !status) continue;
    let checkId = textValue(check, ["checkId", "check_id", "id"], 160) || slug(label);
    if (!checkId) checkId = hash(label).slice(0, 24);
    if (used.has(checkId)) continue;
    used.add(checkId);

    const state = status === "confirmed" || status === "finding" || status === "checked-empty"
      ? "complete"
      : status === "unavailable"
        ? "unavailable"
        : status === "stale"
          ? "partial"
          : "not_run";
    const sourceCount = typeof check.sourceCount === "number" && Number.isFinite(check.sourceCount)
      ? Math.max(0, Math.floor(check.sourceCount))
      : 0;
    const completedAt = timestampValue(check.completedAt);
    rows.push({
      organization_id: context.organizationId,
      report_version_id: context.reportVersionId,
      check_id: checkId,
      provider: textValue(check, ["provider"], 100),
      state,
      source_count: sourceCount,
      finished_at: completedAt,
      error_code: status === "unavailable" ? "provider_unavailable" : null,
      error_detail: status === "unavailable" ? textValue(check, ["note"], 500) : null,
      attestation_state: context.attestationState,
      metadata: {
        label,
        status,
        note: textValue(check, ["note"], 500),
        notApplicable: status === "not-applicable",
        completedAt,
        order,
      },
    });
  }
  return rows;
}

async function upsertRows(
  credentials: ServiceCredentials,
  table: "evidence_items" | "check_runs",
  conflict: string,
  rows: JsonRecord[],
): Promise<void> {
  if (!rows.length) return;
  const response = await fetch(`${credentials.url}/rest/v1/${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: serviceHeaders(credentials.key, { prefer: "resolution=ignore-duplicates,return=minimal" }),
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`${table} write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
}

export async function persistProvenance(
  credentials: ServiceCredentials,
  context: ProvenanceContext,
  payload: unknown,
  checks: unknown,
): Promise<void> {
  const evidenceRows = collectEvidence(payload, context);
  const checkRows = collectCheckRuns(checks, context);
  await Promise.all([
    upsertRows(credentials, "evidence_items", "report_version_id,evidence_key", evidenceRows),
    upsertRows(credentials, "check_runs", "report_version_id,check_id", checkRows),
  ]);
}

/** Publish the projection only after every provenance write above succeeded. */
export async function activateReportVersion(
  credentials: ServiceCredentials,
  organizationId: string,
  reportVersionId: string,
): Promise<void> {
  const response = await fetch(`${credentials.url}/rest/v1/rpc/activate_report_version`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: organizationId,
      p_report_version_id: reportVersionId,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`report activation failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
}
