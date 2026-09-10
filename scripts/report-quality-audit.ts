import { evidenceRetryPlan } from "../src/lib/evidenceRetry";
import { readAllCorpusRows } from "../src/lib/corpusPagination";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  auditStoredReportQuality,
  type ReportQualityExpectation,
  type StoredReportQualityInput,
} from "../src/lib/reportQualityAudit";

for (const envFile of [".env", ".env.local"]) {
  try {
    process.loadEnvFile(envFile);
  } catch {
    // CI can provide credentials directly.
  }
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, "") ?? "";
const supabaseKey = process.env.SUPABASE_SECRET_KEY
  || process.env.SUPABASE_SERVICE_ROLE_KEY
  || process.env.SUPABASE_SERVICE_KEY
  || "";

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL and a Supabase secret key are required for the read-only report corpus audit.");
}

const headers = {
  apikey: supabaseKey,
  ...(supabaseKey.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${supabaseKey}` }),
  accept: "application/json",
};

async function readPage(path: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Report corpus read failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  const rows = await response.json() as unknown;
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== "object" || Array.isArray(r))) throw new Error("Malformed report corpus page");
  return rows as Record<string, unknown>[];
}


const expectations = JSON.parse(
  readFileSync(join(process.cwd(), "eval", "expectations.json"), "utf8"),
) as Record<string, ReportQualityExpectation>;

const snapshotAt = new Date().toISOString();
const readRows = (path: string) => readAllCorpusRows(`${path}&created_at=lte.${encodeURIComponent(snapshotAt)}`, readPage);
const [cases, versions] = await Promise.all([
  readRows("cases?select=id,kind,canonical_ref,display_query,status"),
  readRows("report_versions?select=id,case_id,version,verdict,score,completeness_state,attestation_state,created_at,methodology_version,payload"),
]);

const latestByCase = new Map<string, Record<string, unknown>>();
for (const version of versions) {
  const caseId = typeof version.case_id === "string" ? version.case_id : "";
  const candidateVersion = typeof version.version === "number" ? version.version : 0;
  const currentVersion = typeof latestByCase.get(caseId)?.version === "number"
    ? latestByCase.get(caseId)?.version as number
    : 0;
  if (caseId && candidateVersion > currentVersion) latestByCase.set(caseId, version);
}

const results = cases.flatMap((reportCase) => {
  const caseId = typeof reportCase.id === "string" ? reportCase.id : "";
  const version = latestByCase.get(caseId);
  if (!version) return [];
  const ref = typeof reportCase.canonical_ref === "string" ? reportCase.canonical_ref : "";
  const sample: StoredReportQualityInput = {
    kind: typeof reportCase.kind === "string" ? reportCase.kind : "",
    ref,
    query: typeof reportCase.display_query === "string" ? reportCase.display_query : ref,
    version: typeof version.version === "number" ? version.version : 0,
    verdict: typeof version.verdict === "string" ? version.verdict : null,
    score: typeof version.score === "number"
      ? version.score
      : typeof version.score === "string" && version.score.trim()
        ? Number(version.score)
        : null,
    completeness: typeof version.completeness_state === "string" ? version.completeness_state : null,
    attestation: typeof version.attestation_state === "string" ? version.attestation_state : null,
    createdAt: typeof version.created_at === "string" ? version.created_at : null,
    payload: version.payload,
  };
  return [{ ...auditStoredReportQuality(sample, expectations[ref.toLowerCase().replace(/^@/, "")]), caseId, reportVersionId: version.id, kind: sample.kind, attestation: sample.attestation }];
});

const missingVersions = cases.length - results.length;
const cohorts = new Map<string, number>();
for (const result of results) {
  const key = `${result.kind}/${result.attestation ?? "unknown"}`;
  cohorts.set(key, (cohorts.get(key) ?? 0) + 1);
}
const rescanCandidates = results.filter((result) => {
  const version = latestByCase.get(result.caseId);
  return result.errorCount > 0 || version?.score == null || (version?.methodology_version !== "argus-token-v3-assessed-evidence" && result.kind === "token");
}).sort((a, b) => Number(latestByCase.get(b.caseId)?.score == null) - Number(latestByCase.get(a.caseId)?.score == null));
console.log(JSON.stringify({ snapshotAt, boundedRescanPlan: rescanCandidates.slice(0, 12).map((r) => ({ caseId: r.caseId, reportVersionId: r.reportVersionId, kind: r.kind, failedInvariants: r.findings.filter(f => f.severity === "error").map(f => f.code), targetedRetries: evidenceRetryPlan((latestByCase.get(r.caseId)?.payload as { evidenceAttempts?: import("../src/lib/evidenceRetry").EvidenceAttempt[] })?.evidenceAttempts ?? []), reason: latestByCase.get(r.caseId)?.score == null ? "historical_missing_score" : r.errorCount > 0 ? "quality_invariant_failed" : "methodology_changed", estimatedCostUsd: null })), rescanCandidates: rescanCandidates.length, cases: cases.length, versionsRead: versions.length, assessedLatest: results.length, missingVersions, cohorts: Object.fromEntries(cohorts) }));
const errorCount = results.reduce((sum, result) => sum + result.errorCount, 0);
const warningCount = results.reduce((sum, result) => sum + result.warningCount, 0);

console.log(`ARGUS report quality corpus · ${results.length} latest reports across all attestations`);
for (const result of results.filter((item) => item.findings.length)) {
  console.log(`\n${result.subject} · v${result.version}`);
  for (const item of result.findings) {
    console.log(`  ${item.severity === "error" ? "ERROR" : "WARN "} ${item.code}: ${item.message}`);
  }
}
console.log(`\nResult: ${errorCount} error${errorCount === 1 ? "" : "s"} · ${warningCount} warning${warningCount === 1 ? "" : "s"}`);
process.exitCode = errorCount > 0 || missingVersions > 0 ? 1 : 0;
