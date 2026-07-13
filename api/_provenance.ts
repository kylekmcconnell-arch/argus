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
const PROJECT_STRENGTH_TIERS = new Set(["none", "adverse", "emerging", "solid", "exceptional"]);
const CATALOG_ARTIFACT_KEYS = new Set([
  "artifactId", "kind", "provider", "operation", "section", "title", "excerpt",
  "sourceUrl", "capturedAt", "contentHash", "eligibleAxes", "verification", "counterEligibleAxes", "scope",
]);
const PROJECT_BAND_KEYS = new Set(["tier", "minScore", "maxScore", "reasons", "anchorArtifactIds"]);
const SENSITIVE_URL_PARAM = /^(?:(?:x[-_]?(?:amz|goog)|x[-_](?:oss|cos))[-_].+|x[-_]ms[-_](?:signature|token|credential)|access[_-]?token|api[_-]?key|key|token|signature|sig|auth|credential|credentials|security[_-]?token|session[_-]?token|awsaccesskeyid|googleaccessid|key[_-]?pair[_-]?id|policy|cf[_-]?access[_-]?token)$/i;

// Keep the serverless provenance boundary self-contained. Importing the
// browser/engine profile graph from this API module pulls extensionless engine
// dependencies into Vercel's function bundle, where native ESM cannot resolve
// them at runtime. The synchronization test in provenance.test.ts guards this
// manifest against drift from the canonical engine profiles.
export const AXIS_SCORING_CONTRACT: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  FOUNDER: {
    F1_identity_verifiability: 12,
    F2_track_record: 28,
    F3_repeat_backing: 15,
    F4_build_substance: 15,
    F5_reputation_integrity: 18,
    F6_network_quality: 12,
  },
  PROJECT: {
    P1_team_and_identity: 16,
    P2_product_substance: 24,
    P3_token_conduct: 20,
    P4_backing_and_partners: 14,
    P5_traction_and_liveness: 14,
    P6_transparency_integrity: 12,
  },
  KOL: {
    K1_identity_roster: 12,
    K2_call_performance: 30,
    K3_disclosure_deletion: 18,
    K4_onchain_conduct: 20,
    K5_cabal_fud: 20,
  },
  INVESTOR: {
    I1_identity_legitimacy: 15,
    I2_portfolio_quality: 25,
    I3_fund_scale_tier: 15,
    I4_testimonial_corroboration: 20,
    I5_reputation_fud: 25,
  },
  AGENCY: {
    AG1_identity_legitimacy: 15,
    AG2_client_outcomes: 25,
    AG3_service_integrity: 25,
    AG4_reputation_fud: 35,
  },
  ADVISOR: {
    AD1_identity_verifiability: 12,
    AD2_advised_outcomes: 28,
    AD3_relationship_corroboration: 25,
    AD4_advisory_conduct: 20,
    AD5_reputation_fud: 15,
  },
  MEMBER: {
    ME1_identity: 25,
    ME2_role_authenticity: 35,
    ME3_conduct_reputation: 40,
  },
};

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
  const persistenceCapturedAt = new Date().toISOString();
  const eligibleByArtifact = new Map<string, Set<string>>();
  const verificationByArtifact = new Map<string, string>();
  const counterEligibleByArtifact = new Map<string, Set<string>>();
  const operationByArtifact = new Map<string, string>();
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
    const counterEligibleAxes = artifact.counterEligibleAxes === undefined
      ? []
      : strictStringArray(artifact.counterEligibleAxes, "counterEligibleAxes", {
        min: 1,
        max: 80,
        itemMax: 160,
        pattern: AXIS_ID,
      });
    if (
      counterEligibleAxes.some((axis) => !eligibleAxes.includes(axis))
      || (counterEligibleAxes.length > 0 && verification !== "verified")
    ) {
      throw new Error("invalid axis evidence lineage: counter eligibility");
    }
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
      ...(counterEligibleAxes.length ? { counterEligibleAxes } : {}),
      scope,
    };

    eligibleByArtifact.set(artifactId, new Set(eligibleAxes));
    verificationByArtifact.set(artifactId, verification);
    counterEligibleByArtifact.set(artifactId, new Set(counterEligibleAxes));
    operationByArtifact.set(artifactId, operation);
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
      // PostgREST requires every object in a bulk JSON insert to expose the
      // same key set, while the column itself is NOT NULL. Artifacts without a
      // source timestamp use one capture instant shared by this persistence
      // batch instead of conditionally omitting the column or writing null.
      captured_at: capturedAt ?? persistenceCapturedAt,
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
        ...(counterEligibleAxes.length ? { counterEligibleAxes } : {}),
        scope,
        catalogArtifact: normalizedArtifact,
      },
    });
  }

  const rawProjectBands = payload.projectStrengthBands === undefined
    ? null
    : asRecord(payload.projectStrengthBands);
  if (payload.projectStrengthBands !== undefined && !rawProjectBands) {
    throw new Error("invalid axis evidence lineage: projectStrengthBands");
  }
  const projectBands = new Map<string, {
    tier: string;
    minScore: number;
    maxScore: number;
    reasons: string[];
    anchorArtifactIds: string[];
  }>();
  for (const [axisId, candidate] of Object.entries(rawProjectBands ?? {})) {
    const band = asRecord(candidate);
    const tier = String(band?.tier ?? "");
    if (
      !AXIS_ID.test(axisId)
      || !band
      || Object.keys(band).some((key) => !PROJECT_BAND_KEYS.has(key))
      || !PROJECT_STRENGTH_TIERS.has(tier)
      || !Number.isInteger(band.minScore)
      || !Number.isInteger(band.maxScore)
    ) {
      throw new Error("invalid axis evidence lineage: project strength band");
    }
    const reasons = strictStringArray(band.reasons, `${axisId}.band.reasons`, {
      min: tier === "none" ? 0 : 1,
      max: 12,
      itemMax: 240,
    });
    const anchorArtifactIds = strictStringArray(band.anchorArtifactIds, `${axisId}.band.anchorArtifactIds`, {
      min: tier === "none" ? 0 : 1,
      max: 32,
      itemMax: 71,
      pattern: ARTIFACT_ID,
    });
    if (
      tier === "none"
      && (band.minScore !== 0 || band.maxScore !== 0 || reasons.length > 0 || anchorArtifactIds.length > 0)
    ) {
      throw new Error("invalid axis evidence lineage: empty project strength band");
    }
    projectBands.set(axisId, {
      tier,
      minScore: band.minScore as number,
      maxScore: band.maxScore as number,
      reasons,
      anchorArtifactIds,
    });
  }

  const report = asRecord(payload.report);
  if (!report || !Array.isArray(report.role_reports) || report.role_reports.length < 1 || report.role_reports.length > 16) {
    throw new Error("invalid axis evidence lineage: report.role_reports");
  }
  const roleReports = report.role_reports;
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
    const roleAxes = AXIS_SCORING_CONTRACT[role];
    if (!roleAxes) throw new Error("invalid axis evidence lineage: unsupported role");
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
      if (!support.some((artifactId) =>
        !ABSENCE_VERIFICATIONS.has(verificationByArtifact.get(artifactId) ?? ""))) {
        throw new Error(`invalid axis evidence lineage: ${axisId} lacks substantive support`);
      }
      if (counter.some((artifactId) => ABSENCE_VERIFICATIONS.has(verificationByArtifact.get(artifactId) ?? ""))) {
        throw new Error(`invalid axis evidence lineage: ${axisId} cites absence evidence as counter-evidence`);
      }
      if (
        role === "PROJECT"
        && counter.some((artifactId) => !counterEligibleByArtifact.get(artifactId)?.has(axisId))
      ) {
        throw new Error(`invalid axis evidence lineage: ${axisId} cites non-limiting project counter-evidence`);
      }
      const requiredDrawdownCounters = [...operationByArtifact.entries()]
        .filter(([artifactId, operation]) =>
          operation === "findings:ProjectTokenDrawdown"
          && counterEligibleByArtifact.get(artifactId)?.has(axisId))
        .map(([artifactId]) => artifactId);
      if (
        role === "PROJECT"
        && projectBands.get(axisId)?.tier !== "adverse"
        && requiredDrawdownCounters.some((artifactId) => !counter.includes(artifactId))
      ) {
        throw new Error(`invalid axis evidence lineage: ${axisId} omits required project counter-evidence`);
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
      const expectedWeight = roleAxes[axisId];
      if (
        expectedWeight === undefined
        || !Number.isInteger(axis.score)
        || axis.score < 0
        || axis.score > expectedWeight
        || axis.weight !== expectedWeight
        || axis.role !== role
        || typeof axis.rationale !== "string"
        || axis.rationale.trim().length < 1
        || axis.rationale.trim().length > 2_000
      ) {
        throw new Error(`invalid axis evidence lineage: ${axisId} violates the scoring contract`);
      }
      if (role === "PROJECT") {
        const band = projectBands.get(axisId);
        if (!band || band.tier === "none") {
          throw new Error(`invalid axis evidence lineage: ${axisId} missing project strength band`);
        }
        const expectedRange = band.tier === "adverse"
          ? { min: 0, max: Math.floor(expectedWeight * 0.39) }
          : band.tier === "emerging"
            ? { min: Math.ceil(expectedWeight * 0.4), max: Math.floor(expectedWeight * 0.69) }
            : band.tier === "solid"
              ? { min: Math.ceil(expectedWeight * 0.7), max: Math.floor(expectedWeight * 0.84) }
              : { min: Math.ceil(expectedWeight * 0.85), max: expectedWeight };
        const verifiedCounters = counter.filter((artifactId) =>
          counterEligibleByArtifact.get(artifactId)?.has(axisId));
        const hasSevereCounter = verifiedCounters.some((artifactId) =>
          operationByArtifact.get(artifactId) !== "findings:ProjectTokenDrawdown");
        if (
          band.minScore !== expectedRange.min
          || band.maxScore !== expectedRange.max
          || axis.score > band.maxScore
          || (band.tier !== "adverse" && axis.score < band.minScore && !hasSevereCounter)
          || (requiredDrawdownCounters.length > 0 && band.tier === "exceptional")
          || band.anchorArtifactIds.some((artifactId) =>
            !eligibleByArtifact.get(artifactId)?.has(axisId)
            || ABSENCE_VERIFICATIONS.has(verificationByArtifact.get(artifactId) ?? ""))
          || (band.tier === "adverse" && !band.anchorArtifactIds.some((artifactId) =>
            counterEligibleByArtifact.get(artifactId)?.has(axisId)))
        ) {
          throw new Error(`invalid axis evidence lineage: ${axisId} violates project strength band`);
        }
      }
    }
    const expectedAxisIds = Object.keys(roleAxes).sort();
    const receivedAxisIds = axisEntries.map(([axisId]) => axisId).sort();
    if (!isIncomplete && (
      expectedAxisIds.length !== receivedAxisIds.length
      || expectedAxisIds.some((axisId, index) => axisId !== receivedAxisIds[index])
    )) {
      throw new Error(`invalid axis evidence lineage: ${role} axis set is incomplete or non-canonical`);
    }
    if (role === "PROJECT" && !isIncomplete) {
      const expectedBandIds = Object.keys(roleAxes).sort();
      const receivedBandIds = [...projectBands.keys()].sort();
      if (
        expectedBandIds.length !== receivedBandIds.length
        || expectedBandIds.some((axisId, index) => axisId !== receivedBandIds[index])
      ) {
        throw new Error("invalid axis evidence lineage: PROJECT strength band set is incomplete or non-canonical");
      }
    }
  }
  const declaredRoles = strictStringArray(report.roles, "report.roles", {
    min: 1,
    max: 16,
    itemMax: 80,
    pattern: ROLE_ID,
  }).sort();
  const scoredRoles = [...roles].sort();
  if (
    declaredRoles.length !== scoredRoles.length
    || declaredRoles.some((role, index) => role !== scoredRoles[index])
  ) {
    throw new Error("invalid axis evidence lineage: declared roles do not match role reports");
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
    const decisionCritical = typeof check.decisionCritical === "boolean"
      ? check.decisionCritical
      : undefined;
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
        ...(decisionCritical !== undefined ? { decisionCritical } : {}),
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

interface BoundProvenanceRows {
  evidenceItems: JsonRecord[];
  checkRuns: JsonRecord[];
  axisEvidence: JsonRecord[];
}

export interface PreparedProvenanceRows {
  evidenceItems: Array<Record<string, unknown>>;
  checkRuns: Array<Record<string, unknown>>;
  axisEvidence: Array<Record<string, unknown>>;
}

function collectProvenanceRows(
  context: ProvenanceContext,
  payload: unknown,
  checks: unknown,
): BoundProvenanceRows {
  const payloadRecord = asRecord(payload);
  const hasLineageVersion = payloadRecord?.axisCitationVersion !== undefined;
  const report = asRecord(payloadRecord?.report);
  const roleReports = Array.isArray(report?.role_reports) ? report.role_reports : [];
  const hasScoredAxis = roleReports.some((candidate) => {
    const axes = asRecord(asRecord(candidate)?.axes);
    return !!axes && Object.keys(axes).length > 0;
  });
  const compositeVerdict = typeof report?.composite_verdict === "string"
    ? report.composite_verdict
    : "";
  const decisionBearing = hasScoredAxis
    || typeof report?.governing_score === "number"
    || (!!compositeVerdict && compositeVerdict !== "INCOMPLETE");
  if (
    context.attestationState === "server_collected"
    && !hasLineageVersion
    && decisionBearing
  ) {
    throw new Error("invalid axis evidence lineage: scored server-collected report omitted axisCitationVersion");
  }
  const strict = hasLineageVersion
    ? collectStrictLineage(payloadRecord!, context)
    : null;
  const evidenceItems = strict?.evidenceRows ?? collectEvidence(payload, context);
  const checkRuns = collectCheckRuns(checks, context);
  if (Array.isArray(checks) && (checks.length > 250 || checkRuns.length !== checks.length)) {
    throw new Error("invalid check run materialization: every frozen check must have one unique row");
  }
  if (
    Array.isArray(payloadRecord?.checkRuns)
    && (!Array.isArray(checks) || payloadRecord.checkRuns.length !== checkRuns.length)
  ) {
    throw new Error("invalid check run materialization: payload and child rows differ");
  }
  return {
    evidenceItems,
    checkRuns,
    axisEvidence: strict?.axisRows ?? [],
  };
}

const unbindProvenanceRow = (row: JsonRecord): JsonRecord => {
  const {
    organization_id: _organizationId,
    report_version_id: _reportVersionId,
    attestation_state: _attestationState,
    ...unbound
  } = row;
  return unbound;
};

/**
 * Validate and normalize the complete child bundle before the first database
 * write. Tenant/version bindings are deliberately omitted from the returned
 * rows; the transactional RPC supplies those authoritative values itself.
 */
export function prepareProvenanceRows(
  context: Omit<ProvenanceContext, "reportVersionId">,
  payload: unknown,
  checks: unknown,
): PreparedProvenanceRows {
  const rows = collectProvenanceRows(
    { ...context, reportVersionId: "00000000-0000-0000-0000-000000000000" },
    payload,
    checks,
  );
  return {
    evidenceItems: rows.evidenceItems.map(unbindProvenanceRow),
    checkRuns: rows.checkRuns.map(unbindProvenanceRow),
    axisEvidence: rows.axisEvidence.map(unbindProvenanceRow),
  };
}

export interface PersistReportVersionBundleInput {
  organizationId: string;
  kind: "person" | "token" | "investigation" | "site";
  canonicalRef: string;
  query: string;
  createdBy: string;
  payload: unknown;
  checks: unknown;
  runId: string | null;
  attestationState: ProvenanceContext["attestationState"];
  verdict: string | null;
  score: number | null;
  completenessState: "complete" | "partial" | "failed";
  methodologyVersion: string | null;
  providerSnapshot: unknown;
  cost: unknown;
}

/** Persist the immutable parent and every frozen provenance child atomically. */
export async function persistReportVersionBundle(
  credentials: ServiceCredentials,
  input: PersistReportVersionBundleInput,
): Promise<string> {
  // This can throw on malformed scorer lineage. Because it runs before fetch,
  // no parent report_versions row can be stranded by local validation.
  const provenance = prepareProvenanceRows(
    { organizationId: input.organizationId, attestationState: input.attestationState },
    input.payload,
    input.checks,
  );
  const response = await fetch(`${credentials.url}/rest/v1/rpc/persist_report_version_bundle`, {
    method: "POST",
    headers: serviceHeaders(credentials.key),
    body: JSON.stringify({
      p_organization_id: input.organizationId,
      p_kind: input.kind,
      p_canonical_ref: input.canonicalRef,
      p_query: input.query,
      p_created_by: input.createdBy,
      p_payload: input.payload,
      p_run_id: input.runId,
      p_attestation_state: input.attestationState,
      p_verdict: input.verdict,
      p_score: input.score,
      p_completeness_state: input.completenessState,
      p_methodology_version: input.methodologyVersion,
      p_provider_snapshot: input.providerSnapshot,
      p_cost: input.cost,
      p_evidence_items: provenance.evidenceItems,
      p_check_runs: provenance.checkRuns,
      p_axis_evidence: provenance.axisEvidence,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`immutable report bundle write failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  const result = await response.json() as unknown;
  const row = Array.isArray(result) ? asRecord(result[0]) : null;
  const reportVersionId = typeof row?.report_version_id === "string"
    ? row.report_version_id
    : "";
  if (!reportVersionId) throw new Error("immutable report bundle write returned no id");
  if (
    row?.evidence_count !== provenance.evidenceItems.length
    || row?.check_count !== provenance.checkRuns.length
    || row?.axis_evidence_count !== provenance.axisEvidence.length
  ) {
    throw new Error("immutable report bundle returned inconsistent child counts");
  }
  return reportVersionId;
}

export async function persistProvenance(
  credentials: ServiceCredentials,
  context: ProvenanceContext,
  payload: unknown,
  checks: unknown,
): Promise<void> {
  const rows = collectProvenanceRows(context, payload, checks);
  await Promise.all([
    upsertRows(credentials, "evidence_items", "report_version_id,evidence_key", rows.evidenceItems),
    upsertRows(credentials, "check_runs", "report_version_id,check_id", rows.checkRuns),
  ]);
  if (rows.axisEvidence.length) {
    await upsertRows(
      credentials,
      "report_axis_evidence",
      "report_version_id,role,axis_id,relation,ordinal",
      rows.axisEvidence,
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
