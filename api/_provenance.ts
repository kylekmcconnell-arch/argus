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
const ARTIFACT_ID = /^art_v1_[a-f0-9]{64}$/;
const CONTENT_HASH = /^[a-f0-9]{64}$/;
const AXIS_ID = /^[A-Za-z0-9_.:-]{1,160}$/;
const ROLE_ID = /^[A-Z][A-Z0-9_]{0,79}$/;
const VERIFICATIONS = new Set(["verified", "reported", "observed", "checked_empty", "unavailable"]);
const ABSENCE_VERIFICATIONS = new Set(["checked_empty", "unavailable"]);
const SCOPES = new Set(["direct_subject", "subject_context"]);
const CATALOG_ARTIFACT_KEYS = new Set([
  "artifactId", "kind", "provider", "operation", "section", "title", "excerpt",
  "sourceUrl", "capturedAt", "contentHash", "eligibleAxes", "verification", "scope",
]);
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

interface StrictLineageRows {
  evidenceRows: JsonRecord[];
  axisRows: JsonRecord[];
}

const timestampValue = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
};

function safeSourceUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || !url.hostname) {
      return null;
    }
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_PARAM.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    const normalized = url.toString();
    return normalized.length <= 2_000 ? normalized : null;
  } catch {
    return null;
  }
}

function hasSensitiveUrlParam(raw: string): boolean {
  try {
    const url = new URL(raw);
    return [...url.searchParams.keys()].some((key) => SENSITIVE_URL_PARAM.test(key));
  } catch {
    return false;
  }
}

function strictText(record: JsonRecord, key: string, max: number): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`invalid axis evidence lineage: ${key}`);
  }
  return value.trim();
}

function optionalStrictText(record: JsonRecord, key: string, max: number): string | null {
  const value = record[key];
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > max) {
    throw new Error(`invalid axis evidence lineage: ${key}`);
  }
  return value.trim();
}

function strictStringArray(
  value: unknown,
  label: string,
  options: { min?: number; max: number; itemMax: number; pattern?: RegExp },
): string[] {
  const min = options.min ?? 0;
  if (!Array.isArray(value) || value.length < min || value.length > options.max) {
    throw new Error(`invalid axis evidence lineage: ${label}`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (
      typeof candidate !== "string"
      || !candidate.trim()
      || candidate.length > options.itemMax
      || (options.pattern && !options.pattern.test(candidate))
      || seen.has(candidate)
    ) {
      throw new Error(`invalid axis evidence lineage: ${label}`);
    }
    seen.add(candidate);
    result.push(candidate);
  }
  return result;
}

/**
 * Validate the complete v1 lineage contract before issuing any database write.
 * Strict reports persist only the explicit catalog; legacy payloads retain the
 * recursive provenance collector below for backwards compatibility.
 */
function collectStrictLineage(payload: JsonRecord, context: ProvenanceContext): StrictLineageRows {
  if (payload.axisCitationVersion !== 1) {
    throw new Error("invalid axis evidence lineage: unsupported axisCitationVersion");
  }
  const catalog = payload.axisEvidenceCatalog;
  if (!Array.isArray(catalog) || catalog.length < 1 || catalog.length > 400) {
    throw new Error("invalid axis evidence lineage: axisEvidenceCatalog");
  }

  const evidenceRows: JsonRecord[] = [];
  const eligibleByArtifact = new Map<string, Set<string>>();
  const verificationByArtifact = new Map<string, string>();
  for (const candidate of catalog) {
    const artifact = asRecord(candidate);
    if (!artifact || Object.keys(artifact).some((key) => !CATALOG_ARTIFACT_KEYS.has(key))) {
      throw new Error("invalid axis evidence lineage: catalog artifact");
    }
    const artifactId = strictText(artifact, "artifactId", 71);
    const contentHash = strictText(artifact, "contentHash", 64);
    if (
      !ARTIFACT_ID.test(artifactId)
      || !CONTENT_HASH.test(contentHash)
      || contentHash !== artifactId.slice("art_v1_".length)
      || eligibleByArtifact.has(artifactId)
    ) {
      throw new Error("invalid axis evidence lineage: artifact identity");
    }
    if (artifact.kind !== "axis_evidence") {
      throw new Error("invalid axis evidence lineage: kind");
    }
    const provider = strictText(artifact, "provider", 100);
    const operation = strictText(artifact, "operation", 160);
    const section = strictText(artifact, "section", 100);
    const title = strictText(artifact, "title", 500);
    const excerpt = optionalStrictText(artifact, "excerpt", 2_000);
    const verification = strictText(artifact, "verification", 80);
    const scope = strictText(artifact, "scope", 120);
    if (!VERIFICATIONS.has(verification) || !SCOPES.has(scope)) {
      throw new Error("invalid axis evidence lineage: verification or scope");
    }
    const eligibleAxes = strictStringArray(artifact.eligibleAxes, "eligibleAxes", {
      min: 1,
      max: 80,
      itemMax: 160,
      pattern: AXIS_ID,
    });
    const rawSourceUrl = optionalStrictText(artifact, "sourceUrl", 2_000);
    const sourceUrl = rawSourceUrl ? safeSourceUrl(rawSourceUrl) : null;
    if (rawSourceUrl && (!sourceUrl || rawSourceUrl !== sourceUrl || hasSensitiveUrlParam(rawSourceUrl))) {
      throw new Error("invalid axis evidence lineage: sourceUrl");
    }
    const rawCapturedAt = artifact.capturedAt;
    const capturedAt = rawCapturedAt === undefined ? null : timestampValue(rawCapturedAt);
    if (rawCapturedAt !== undefined && !capturedAt) {
      throw new Error("invalid axis evidence lineage: capturedAt");
    }

    const normalizedArtifact: JsonRecord = {
      artifactId,
      kind: "axis_evidence",
      provider,
      operation,
      section,
      title,
      ...(excerpt ? { excerpt } : {}),
      ...(sourceUrl ? { sourceUrl } : {}),
      ...(capturedAt ? { capturedAt } : {}),
      contentHash,
      eligibleAxes,
      verification,
      scope,
    };

    eligibleByArtifact.set(artifactId, new Set(eligibleAxes));
    verificationByArtifact.set(artifactId, verification);
    evidenceRows.push({
      organization_id: context.organizationId,
      report_version_id: context.reportVersionId,
      evidence_key: artifactId,
      provider,
      source_type: section,
      source_url: sourceUrl,
      title,
      excerpt,
      content_hash: contentHash,
      ...(capturedAt ? { captured_at: capturedAt } : {}),
      attestation_state: context.attestationState,
      metadata: {
        strictLineage: true,
        axisCitationVersion: 1,
        artifactId,
        kind: "axis_evidence",
        operation,
        section,
        eligibleAxes,
        verification,
        scope,
        catalogArtifact: normalizedArtifact,
      },
    });
  }

  const report = asRecord(payload.report);
  const roleReports = report?.role_reports;
  if (!Array.isArray(roleReports) || roleReports.length < 1 || roleReports.length > 16) {
    throw new Error("invalid axis evidence lineage: report.role_reports");
  }
  const isIncomplete = report?.composite_verdict === "INCOMPLETE";
  if (isIncomplete && report?.governing_score !== null) {
    throw new Error("invalid axis evidence lineage: incomplete report must have a null governing score");
  }
  const axisRows: JsonRecord[] = [];
  const roles = new Set<string>();
  let scoredAxes = 0;
  for (const candidate of roleReports) {
    const roleReport = asRecord(candidate);
    if (!roleReport) throw new Error("invalid axis evidence lineage: role report");
    const role = strictText(roleReport, "role", 80);
    if (!ROLE_ID.test(role) || roles.has(role)) {
      throw new Error("invalid axis evidence lineage: role");
    }
    roles.add(role);
    const axes = asRecord(roleReport.axes);
    const axisEntries = axes ? Object.entries(axes) : [];
    if ((isIncomplete && axisEntries.length !== 0) || (!isIncomplete && (axisEntries.length < 1 || axisEntries.length > 80))) {
      throw new Error("invalid axis evidence lineage: axes");
    }
    for (const [axisId, rawAxis] of axisEntries) {
      if (!AXIS_ID.test(axisId)) throw new Error("invalid axis evidence lineage: axis id");
      const axis = asRecord(rawAxis);
      if (!axis || typeof axis.score !== "number" || !Number.isFinite(axis.score)) {
        throw new Error("invalid axis evidence lineage: scored axis");
      }
      scoredAxes += 1;
      const support = strictStringArray(axis.evidenceRefs, `${axisId}.evidenceRefs`, {
        min: 1,
        max: 12,
        itemMax: 71,
        pattern: ARTIFACT_ID,
      });
      const counter = strictStringArray(axis.counterEvidenceRefs, `${axisId}.counterEvidenceRefs`, {
        max: 12,
        itemMax: 71,
        pattern: ARTIFACT_ID,
      });
      const gaps = strictStringArray(axis.gaps, `${axisId}.gaps`, { max: 6, itemMax: 400 });
      const supportSet = new Set(support);
      if (counter.some((artifactId) => supportSet.has(artifactId))) {
        throw new Error(`invalid axis evidence lineage: ${axisId} has contradictory references`);
      }
      if (
        gaps.length === 0
        && support.some((artifactId) => ABSENCE_VERIFICATIONS.has(verificationByArtifact.get(artifactId) ?? ""))
      ) {
        throw new Error(`invalid axis evidence lineage: ${axisId} cites absence evidence without a gap`);
      }
      if (counter.some((artifactId) => ABSENCE_VERIFICATIONS.has(verificationByArtifact.get(artifactId) ?? ""))) {
        throw new Error(`invalid axis evidence lineage: ${axisId} cites absence evidence as counter-evidence`);
      }
      for (const [relation, references] of [["support", support], ["counter", counter]] as const) {
        references.forEach((artifactId, ordinal) => {
          const eligibleAxes = eligibleByArtifact.get(artifactId);
          if (!eligibleAxes || !eligibleAxes.has(axisId)) {
            throw new Error(`invalid axis evidence lineage: artifact is not eligible for ${axisId}`);
          }
          axisRows.push({
            organization_id: context.organizationId,
            report_version_id: context.reportVersionId,
            role,
            axis_id: axisId,
            artifact_id: artifactId,
            relation,
            ordinal,
          });
        });
      }
    }
  }
  if (
    (isIncomplete && (scoredAxes !== 0 || axisRows.length !== 0))
    || (!isIncomplete && (scoredAxes < 1 || axisRows.length < scoredAxes))
    || axisRows.length > 1_024
  ) {
    throw new Error("invalid axis evidence lineage: axis bounds");
  }
  return { evidenceRows, axisRows };
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
  table: "evidence_items" | "check_runs" | "report_axis_evidence",
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
  const payloadRecord = asRecord(payload);
  const hasLineageVersion = payloadRecord?.axisCitationVersion !== undefined;
  const strict = hasLineageVersion
    ? collectStrictLineage(payloadRecord!, context)
    : null;
  const evidenceRows = strict?.evidenceRows ?? collectEvidence(payload, context);
  const checkRows = collectCheckRuns(checks, context);
  await Promise.all([
    upsertRows(credentials, "evidence_items", "report_version_id,evidence_key", evidenceRows),
    upsertRows(credentials, "check_runs", "report_version_id,check_id", checkRows),
  ]);
  if (strict) {
    await upsertRows(
      credentials,
      "report_axis_evidence",
      "report_version_id,role,axis_id,relation,ordinal",
      strict.axisRows,
    );
  }
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
