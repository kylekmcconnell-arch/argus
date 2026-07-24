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
  authorization: `Bearer ${supabaseKey}`,
  accept: "application/json",
};

async function readRows(path: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Report corpus read failed (${response.status}): ${(await response.text()).slice(0, 240)}`);
  }
  const rows = await response.json() as unknown;
  return Array.isArray(rows)
    ? rows.filter((value): value is Record<string, unknown> =>
      value !== null && typeof value === "object" && !Array.isArray(value))
    : [];
}

const expectations = JSON.parse(
  readFileSync(join(process.cwd(), "eval", "expectations.json"), "utf8"),
) as Record<string, ReportQualityExpectation>;

const [cases, versions] = await Promise.all([
  readRows("cases?select=id,kind,canonical_ref,display_query,status&order=updated_at.desc&limit=1000"),
  readRows("report_versions?select=id,case_id,version,verdict,score,completeness_state,attestation_state,created_at,payload&order=case_id.asc,version.desc&limit=1000"),
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
  return [auditStoredReportQuality(sample, expectations[ref.toLowerCase().replace(/^@/, "")])];
});

const serverCollected = results.filter((result) => {
  const reportCase = cases.find((value) =>
    (typeof value.display_query === "string" ? value.display_query : value.canonical_ref) === result.subject);
  const caseId = typeof reportCase?.id === "string" ? reportCase.id : "";
  return latestByCase.get(caseId)?.attestation_state === "server_collected";
});
const errorCount = serverCollected.reduce((sum, result) => sum + result.errorCount, 0);
const warningCount = serverCollected.reduce((sum, result) => sum + result.warningCount, 0);

console.log(`ARGUS report quality corpus · ${serverCollected.length} server-collected latest reports`);
for (const result of serverCollected.filter((item) => item.findings.length)) {
  console.log(`\n${result.subject} · v${result.version}`);
  for (const item of result.findings) {
    console.log(`  ${item.severity === "error" ? "ERROR" : "WARN "} ${item.code}: ${item.message}`);
  }
}
console.log(`\nResult: ${errorCount} error${errorCount === 1 ? "" : "s"} · ${warningCount} warning${warningCount === 1 ? "" : "s"}`);
process.exitCode = errorCount > 0 ? 1 : 0;
