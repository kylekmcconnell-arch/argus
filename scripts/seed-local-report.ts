// Seed one deterministic, curated dossier into LOCAL Supabase for product and
// accessibility review. Refuses to run against a non-local project.
import { createClient } from "@supabase/supabase-js";
import { assembleDossier } from "../src/data/dossier";
import { findSubject, toEvidence } from "../src/data/subjects";
import { personChecks, type ScanCheck } from "../src/lib/scanChecklist";

const url = process.env.SUPABASE_URL?.replace(/\/$/, "") || "";
const secret = process.env.SUPABASE_SECRET_KEY || "";
const fixtureHandle = process.argv[2] || "@satoshi_builds";
const ownerEmail = (process.env.ARGUS_LOCAL_OWNER_EMAIL || "owner@argus.test").toLowerCase();

if (!url || !secret) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required");
const host = new URL(url).hostname;
if (host !== "127.0.0.1" && host !== "localhost") {
  throw new Error("seed-local-report refuses to run against a non-local Supabase project");
}

const fixture = findSubject(fixtureHandle);
if (!fixture) throw new Error(`Unknown curated fixture: ${fixtureHandle}`);

const client = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const { data: users, error: usersError } = await client.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (usersError) throw usersError;
const owner = users.users.find((user) => user.email?.toLowerCase() === ownerEmail);
if (!owner) throw new Error(`Local owner not found: ${ownerEmail}`);

const organizationId = "00000000-0000-4000-8000-000000000001";
const dossier = assembleDossier(toEvidence(fixture), false);
const ref = dossier.handle.replace(/^@/, "").toLowerCase();
// make the local fixture idempotent despite production audit IDs being unique
dossier.report.audit_id = `PA-LOCAL-${ref.replace(/[^a-z0-9]/g, "-").toUpperCase()}`;
const runId = `local-curated-${ref}-partial-v2`;
const checks = personChecks({
  identityConfidence: dossier.report.identity_confidence ?? undefined,
  realName: dossier.display_name.trim().split(/\s+/).filter(Boolean).length >= 2,
  roles: dossier.report.roles ?? [],
  hasAssociates: (dossier.evidence.associates ?? []).length > 0,
});

const checkState = (check: ScanCheck): "complete" | "partial" | "unavailable" | "failed" | "not_run" => {
  if (check.status === "confirmed" || check.status === "finding" || check.status === "checked-empty") return "complete";
  if (check.status === "unavailable") return "unavailable";
  if (check.status === "stale") return "partial";
  return "not_run";
};
const { data: versionData, error: versionError } = await client.rpc("persist_report_version", {
  p_organization_id: organizationId,
  p_kind: "person",
  p_canonical_ref: ref,
  p_query: dossier.handle,
  p_created_by: owner.id,
  p_payload: dossier,
  p_run_id: runId,
  p_attestation_state: "analyst_submitted",
  p_verdict: dossier.report.composite_verdict,
  p_score: dossier.report.governing_score,
  p_completeness_state: "partial",
  p_methodology_version: process.env.ARGUS_METHODOLOGY_VERSION || "local-design-audit",
  p_provider_snapshot: { mode: "curated-local-fixture" },
  p_cost: {},
});
if (versionError) throw versionError;
const version = Array.isArray(versionData) ? versionData[0] : versionData;
const reportVersionId = version?.report_version_id;
if (typeof reportVersionId !== "string") throw new Error("Report version seed returned no id");

// The immutable fixture is deliberately incomplete: persist the exact same
// checklist outcomes the report will render, rather than implying that every
// provider path ran successfully.
const { error: clearChecksError } = await client
  .from("check_runs")
  .delete()
  .eq("organization_id", organizationId)
  .eq("report_version_id", reportVersionId);
if (clearChecksError) throw clearChecksError;

const { error: checkRunsError } = await client.from("check_runs").insert(
  checks.map((check, order) => ({
    organization_id: organizationId,
    report_version_id: reportVersionId,
    check_id: check.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120),
    provider: null,
    state: checkState(check),
    source_count: 0,
    error_code: check.status === "unavailable" ? "provider_unavailable" : null,
    error_detail: check.status === "unavailable" ? check.note ?? null : null,
    attestation_state: "analyst_submitted",
    metadata: {
      label: check.label,
      status: check.status,
      note: check.note ?? null,
      notApplicable: check.status === "not-applicable",
      order,
    },
  })),
);
if (checkRunsError) throw checkRunsError;

const { error: reportError } = await client.from("reports").upsert({
  organization_id: organizationId,
  ref,
  kind: "person",
  query: dossier.handle,
  contributor: ownerEmail.split("@")[0],
  created_by: owner.id,
  report_version_id: reportVersionId,
  attestation_state: "analyst_submitted",
  payload: dossier,
  verdict: dossier.report.composite_verdict,
  score: dossier.report.governing_score,
  ts: new Date().toISOString(),
}, { onConflict: "organization_id,ref,kind" });
if (reportError) throw reportError;

const { error: logError } = await client.from("audit_log").upsert({
  organization_id: organizationId,
  client_id: `local-curated:${ref}`,
  ts: new Date().toISOString(),
  kind: "person",
  query: dossier.handle,
  ref,
  verdict: dossier.report.composite_verdict,
  score: dossier.report.governing_score,
  summary: dossier.headline,
  coverage: "partial",
  flags: dossier.report.roles.map((role) => `role:${role}`),
  contributor: ownerEmail.split("@")[0],
  contributor_user_id: owner.id,
}, { onConflict: "client_id" });
if (logError) throw logError;

console.log(`Seeded ${dossier.handle} as partial immutable local report ${reportVersionId} with ${checks.length} check runs`);
