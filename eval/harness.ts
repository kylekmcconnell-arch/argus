// ARGUS eval harness: record once (live), replay forever (offline, free).
//
// Every provider (Claude, Grok, twitterapi, PDL, web) funnels through global
// `fetch`. RECORD tees every request/response to a fixture while running a real
// audit; REPLAY serves those fixtures back and re-runs the exact same audit
// code offline. This pins PROVIDER RESPONSES so the harness isolates OUR
// pipeline logic from model drift, and turns "Vitalik must score as a founder"
// and "the Do Kwon report must surface his fraud" into offline assertions.
//
// Usage:
//   tsx eval/harness.ts record @VitalikButerin   (live, costs money, writes fixtures)
//   tsx eval/harness.ts replay @VitalikButerin   (offline, free, asserts labels)
//   tsx eval/harness.ts replay-all              (offline, every recorded subject)

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAudit } from "../server/orchestrate";
import type { Dossier } from "../src/data/dossier";
import { DEEP_INVESTIGATION_MAX_DURATION_SECONDS, ANALYST_FINALIZATION_RESERVE_MS } from "../src/lib/investigationRuntime";
import { LABELS, labelFor, type SubjectLabel } from "./labels";

// Mirror the production collection budget exactly. A shorter deadline starves
// the post-barrier passes (basic-facts especially) and manufactures INCOMPLETE
// verdicts that never happen in prod. This is what the API route passes.
const prodAnalystDeadline = () => Date.now() + DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 1000 - ANALYST_FINALIZATION_RESERVE_MS;

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(HERE, "fixtures");
const SNAPSHOT_DIR = join(HERE, "snapshots");

interface FixtureEntry {
  method: string;
  url: string;
  bodyHash: string;
  status: number;
  body: string;
}
interface FixtureFile {
  handle: string;
  recordedAt: string;
  entries: FixtureEntry[];
}

const norm = (handle: string): string => handle.replace(/^@/, "").toLowerCase();

// Normalize a URL for replay matching: web fetches follow redirects and appear
// under www / trailing-slash variants between record and replay, so key the
// fallback index on a canonical form.
function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname.replace(/\/$/, "");
    return `${u.protocol}//${host}${path}${u.search}`;
  } catch { return raw; }
}
function hostOf(raw: string): string {
  try { return new URL(raw).hostname.replace(/^www\./, ""); } catch { return "invalid"; }
}
const fixturePath = (handle: string): string => join(FIXTURE_DIR, `${norm(handle)}.json`);
const snapshotPath = (handle: string): string => join(SNAPSHOT_DIR, `${norm(handle)}.json`);

// Strip volatile substrings (ISO timestamps, long digit runs) so a request body
// hashes stably across runs. Provider prompts embed capture times and post IDs
// that change run-to-run but do not change the provider's answer.
function normalizeBody(body: string): string {
  return body
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<ts>")
    .replace(/\b\d{10,}\b/g, "<num>");
}
function hashBody(body: string): string {
  return createHash("sha256").update(normalizeBody(body)).digest("hex").slice(0, 16);
}

function describeRequest(input: unknown, init?: { method?: string; body?: unknown }): { method: string; url: string; body: string } {
  let url = "";
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.href;
  else if (input && typeof input === "object" && "url" in input) url = String((input as { url: unknown }).url);
  const method = (init?.method ?? "GET").toUpperCase();
  const body = typeof init?.body === "string" ? init.body : "";
  return { method, url, body };
}

// --- searchable projection of a dossier for must-surface / must-not-appear ---
function searchableText(dossier: Dossier): string {
  const r = dossier.report;
  return [
    dossier.headline,
    dossier.identity_note,
    dossier.bio,
    JSON.stringify(r.publishable_findings ?? []),
    JSON.stringify(r.role_reports ?? []),
    JSON.stringify(dossier.axisEvidenceCatalog ?? []),
    JSON.stringify((dossier as unknown as { basicFacts?: unknown }).basicFacts ?? []),
  ].join("\n");
}

interface LabelResult { pass: boolean; failures: string[]; summary: Record<string, unknown>; }

function assertLabels(dossier: Dossier | null, label: SubjectLabel): LabelResult {
  const failures: string[] = [];
  if (!dossier) {
    return { pass: false, failures: ["audit returned no dossier"], summary: { dossier: null } };
  }
  const r = dossier.report;
  const role = r.governing_role;
  const verdict = r.composite_verdict;
  const score = r.governing_score;
  const text = searchableText(dossier);

  if (label.mustNotBeIncomplete) {
    if (verdict === "INCOMPLETE") failures.push(`published INCOMPLETE (must produce a scored verdict)`);
    if (score == null) failures.push(`no governing score (must produce a scored verdict)`);
  }
  if (label.expectedRole && role !== label.expectedRole) {
    failures.push(`governing role ${role ?? "null"} != expected ${label.expectedRole}`);
  }
  for (const rx of label.mustSurface) {
    if (!rx.test(text)) failures.push(`must-surface ${rx} not found in the report`);
  }
  for (const rx of label.mustNotAppear ?? []) {
    if (rx.test(text)) failures.push(`must-NOT-appear ${rx} was present`);
  }
  if (label.minScore != null && score != null && score < label.minScore) {
    failures.push(`score ${score} below floor ${label.minScore}`);
  }
  if (label.maxScore != null && score != null && score > label.maxScore) {
    failures.push(`score ${score} above ceiling ${label.maxScore}`);
  }
  return {
    pass: failures.length === 0,
    failures,
    summary: { role, verdict, score, headline: dossier.headline },
  };
}

function dossierSnapshot(dossier: Dossier): Record<string, unknown> {
  const r = dossier.report;
  return {
    handle: dossier.handle,
    governing_role: r.governing_role,
    composite_verdict: r.composite_verdict,
    governing_score: r.governing_score,
    cap_applied: r.cap_applied,
    headline: dossier.headline,
    findings: (r.publishable_findings ?? []).map((f) => ({
      severity: (f as { severity?: string }).severity,
      title: (f as { title?: string }).title,
    })),
  };
}

async function record(handle: string): Promise<number> {
  const label = labelFor(handle);
  if (!label) { console.error(`no label for ${handle} (add it to eval/labels.ts)`); return 1; }
  mkdirSync(FIXTURE_DIR, { recursive: true });
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const realFetch = globalThis.fetch;
  const entries: FixtureEntry[] = [];
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const { method, url, body } = describeRequest(input, init);
    const res = await realFetch(input as Parameters<typeof fetch>[0], init as Parameters<typeof fetch>[1]);
    let text = "";
    try { text = await res.clone().text(); } catch { /* non-text body */ }
    entries.push({ method, url, bodyHash: hashBody(body), status: res.status, body: text });
    return res;
  }) as typeof fetch;

  let dossier: Dossier | null = null;
  const emits: Array<Record<string, unknown>> = [];
  const startedAt = Date.now();
  try {
    // runAudit wraps its OWN cost ledger and attaches the real spend to
    // dossier.cost, so read that (a wrapping withCostLedger here would see an
    // empty outer ledger and report $0). Capture the emit stream: it narrates
    // whether each pass (basic-facts especially) ran, was skipped, or errored.
    dossier = await runAudit(handle, (e: unknown) => {
      const ev = (e ?? {}) as Record<string, unknown>;
      emits.push({ phase: ev.phase, label: ev.label, detail: ev.detail, tone: ev.tone });
    }, { analystDeadlineAt: prodAnalystDeadline() });
  } finally {
    globalThis.fetch = realFetch;
  }
  const elapsedMs = Date.now() - startedAt;
  const cost = dossier?.cost ?? { usd: 0, grokUsd: 0, claudeUsd: 0, grokCalls: 0, claudeCalls: 0, sources: 0 };

  // Deep diagnostics: what did collection actually verify, and did basic-facts run?
  const d = dossier as unknown as {
    basicFacts?: Array<Record<string, unknown>>;
    basicFactQuestionLedger?: Array<Record<string, unknown>>;
    ventures?: Array<Record<string, unknown>>;
    report?: { roles?: unknown; governing_role?: unknown };
  } | null;
  const diagnostics = dossier ? {
    roles: d?.report?.roles,
    profile: { display_name: dossier.display_name, followers: dossier.followers, bio: dossier.bio, resolved_name: dossier.resolved_name },
    basicFacts: (d?.basicFacts ?? []).map((f) => ({ predicate: f.predicate, value: f.value, status: f.status, artifact_verified: f.artifact_verified, sources: (f.sources as unknown[])?.length ?? 0 })),
    basicFactQuestionLedger: (d?.basicFactQuestionLedger ?? []).map((q) => ({ questionId: q.questionId, status: q.status, providerRuns: (q.providerRuns as Array<Record<string, unknown>>)?.map((r) => `${r.phase}:${r.state}`) })),
    ventures: (d?.ventures ?? []).map((v) => ({ name: v.project_name ?? v.name, role: v.role, evidence_origin: v.evidence_origin, artifact_verified: v.artifact_verified })),
    emits: emits.filter((e) => e.phase || e.label),
  } : null;

  const fixture: FixtureFile = { handle, recordedAt: new Date().toISOString(), entries };
  writeFileSync(fixturePath(handle), JSON.stringify(fixture));
  if (dossier) writeFileSync(snapshotPath(handle), JSON.stringify({ ...dossierSnapshot(dossier), cost, diagnostics }, null, 2));

  const result = assertLabels(dossier, label);
  console.log(`\n=== RECORD ${handle} ===`);
  console.log(`  ${entries.length} provider requests captured -> ${fixturePath(handle)}`);
  console.log(`  ledger cost: $${cost.usd.toFixed(3)} total · Grok $${(cost.grokUsd ?? 0).toFixed(3)} (${cost.grokCalls ?? 0} calls, ${cost.sources ?? 0} sources) · Claude $${(cost.claudeUsd ?? 0).toFixed(3)} (${cost.claudeCalls ?? 0} calls) · ${elapsedMs}ms`);
  console.log(`  result: ${JSON.stringify(result.summary)}`);
  console.log(result.pass ? `  LABELS PASS` : `  LABELS FAIL:\n    - ${result.failures.join("\n    - ")}`);
  return result.pass ? 0 : 1;
}

async function replay(handle: string): Promise<number> {
  const label = labelFor(handle);
  if (!label) { console.error(`no label for ${handle}`); return 1; }
  if (!existsSync(fixturePath(handle))) { console.error(`no fixture for ${handle} (record it first)`); return 1; }
  const fixture = JSON.parse(readFileSync(fixturePath(handle), "utf8")) as FixtureFile;

  const byKey = new Map<string, FixtureEntry[]>();
  const byUrl = new Map<string, FixtureEntry[]>();
  for (const e of fixture.entries) {
    const key = `${e.method} ${e.url} ${e.bodyHash}`;
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(e);
    const uk = `${e.method} ${normalizeUrl(e.url)}`;
    (byUrl.get(uk) ?? byUrl.set(uk, []).get(uk)!).push(e);
  }
  const shift = (map: Map<string, FixtureEntry[]>, k: string): FixtureEntry | undefined => {
    const q = map.get(k);
    return q && q.length ? q.shift() : undefined;
  };

  const realFetch = globalThis.fetch;
  const misses: string[] = [];
  const missHosts = new Map<string, number>();
  globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
    const { method, url, body } = describeRequest(input, init);
    const key = `${method} ${url} ${hashBody(body)}`;
    const entry = shift(byKey, key) ?? shift(byUrl, `${method} ${normalizeUrl(url)}`);
    if (!entry) {
      misses.push(`${method} ${url}`);
      missHosts.set(hostOf(url), (missHosts.get(hostOf(url)) ?? 0) + 1);
      return new Response(JSON.stringify({ error: "eval replay: no fixture" }), { status: 599, headers: { "content-type": "application/json" } });
    }
    return new Response(entry.body, { status: entry.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  let dossier: Dossier | null = null;
  try {
    dossier = await runAudit(handle, () => {}, { analystDeadlineAt: prodAnalystDeadline() });
  } finally {
    globalThis.fetch = realFetch;
  }

  const result = assertLabels(dossier, label);
  console.log(`\n=== REPLAY ${handle} (offline) ===`);
  console.log(`  result: ${JSON.stringify(result.summary)}`);
  if (misses.length) {
    const byHost = [...missHosts.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h}:${n}`).join(", ");
    console.log(`  ${misses.length} fixture misses by host: ${byHost}`);
  }
  console.log(result.pass ? `  LABELS PASS` : `  LABELS FAIL:\n    - ${result.failures.join("\n    - ")}`);
  return result.pass ? 0 : 1;
}

async function main(): Promise<void> {
  const [mode, handle] = process.argv.slice(2);
  let code = 0;
  if (mode === "record" && handle) code = await record(handle);
  else if (mode === "replay" && handle) code = await replay(handle);
  else if (mode === "replay-all") {
    if (!existsSync(FIXTURE_DIR)) { console.error("no fixtures recorded yet"); process.exitCode = 1; return; }
    const handles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    for (const h of handles) code = (await replay(h)) || code;
  } else {
    console.error("usage: tsx eval/harness.ts <record|replay> @handle  |  replay-all");
    console.error(`labeled subjects: ${LABELS.map((l) => l.handle).join(", ")}`);
    code = 1;
  }
  process.exitCode = code;
}

main().catch((error: unknown) => {
  console.error(`eval harness crashed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
