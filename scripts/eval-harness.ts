// Full-pipeline eval harness CLI.
//
//   npm run eval:record -- @uniswap        one PAID live audit, traffic frozen to eval/recordings/<slug>/
//   npm run eval:replay -- @uniswap        free offline re-run against the frozen traffic
//   npm run eval:replay -- --all           every recorded subject
//   npm run eval:replay -- @uniswap --allow-live google.serper.dev,openrouter.ai
//                                          replay everything EXCEPT the listed hosts (A/B lane)
//   npm run eval:replay -- @uniswap --force-live-tool record_verdict
//                                          rerun only the identical analyst request for variance checks
//
// Replay asserts eval/expectations.json and reports drift against the
// recording-time snapshot. Record mode needs provider keys in .env (never
// committed); replay needs none.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { withRecordedFetch, writeSnapshot, readSnapshot, type EvalSnapshot } from "../server/evalHarness";
import { parseEvalHarnessArgs } from "./evalHarnessArgs";
import {
  ANALYST_FINALIZATION_RESERVE_MS,
  DEEP_INVESTIGATION_MAX_DURATION_SECONDS,
} from "../src/lib/investigationRuntime";

const RECORDINGS_ROOT = join(process.cwd(), "eval", "recordings");
const EXPECTATIONS_PATH = join(process.cwd(), "eval", "expectations.json");

interface Expectation {
  verdictIn?: string[];
  scoreMin?: number;
  scoreMax?: number;
  minVerifiedFacts?: number;
  neverIncomplete?: boolean;
  /** Expected governing role (product judgment, e.g. FOUNDER for Vitalik). */
  expectedRole?: string;
  /** Case-insensitive regex sources that MUST appear somewhere in the report. */
  mustSurface?: string[];
  /** Regex sources that must NOT appear (false attribution, wrong adverse finding). */
  mustNotAppear?: string[];
}

function loadDotEnv(): void {
  const path = join(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith("#")) continue;
    if (process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}

function slugFor(handle: string): string {
  return handle.replace(/^@/, "").toLowerCase().replace(/[^a-z0-9._-]/g, "_");
}

function verifiedFactCount(dossier: { basicFacts?: Array<{ status?: string }> }): number {
  return (dossier.basicFacts ?? [])
    .filter((fact) => fact.status === "verified" || fact.status === "corroborated").length;
}

interface PipelineOutcome {
  snapshot: EvalSnapshot;
  reportText: string;
  governingRole: string | null;
  /**
   * Checks that could not run, with the reason each gave. Some of these are
   * facts about THIS ENVIRONMENT rather than about the subject: the trust graph
   * needs an authenticated organization id that prod supplies from the session
   * and an offline caller has none, so it fails closed on every recording. A
   * run that silently drops coverage for that reason reads as a product defect,
   * which is exactly the wrong conclusion to hand somebody.
   */
  unavailableChecks: Array<{ id: string; note: string }>;
}

/**
 * Which cost stack this process is actually running.
 *
 * Every cheap path is env-gated, and an offline shell has none of prod's
 * variables, so a harness run silently takes the most expensive branch: the
 * analyst default instead of ARGUS_ANALYST_MODEL, discovery following the
 * analyst instead of Haiku, and Claude web search instead of the grounded
 * Serper route. A recorded cost from that shell is not a fact about production
 * and must never be read as one. /api/health reports the same three fields for
 * the deployed environment, so the two can be compared without spending.
 */
function costStack(): { analyst: string; discovery: string; route: string; matchesProd: boolean } {
  const analyst = process.env.ARGUS_ANALYST_MODEL?.trim() || "claude-sonnet-4-6 (default)";
  const discovery = process.env.ARGUS_DISCOVERY_MODEL?.trim() || `${analyst} (follows analyst)`;
  const route = process.env.ARGUS_BASIC_FACTS_PRIMARY?.trim() || "claude-web-search (default)";
  return { analyst, discovery, route, matchesProd: route !== "claude-web-search (default)" };
}

async function runPipeline(handle: string, dir: string, mode: "record" | "replay"): Promise<PipelineOutcome> {
  // Offline callers must mirror prod's deadline SHAPE (a short analyst window
  // starves basic-facts and fakes INCOMPLETE), but record mode is not bound by
  // the serverless duration cap and a local machine plus home network runs the
  // same collection ~1.5-2x slower than Vercel's data center. A wider total
  // ceiling keeps prod's reserve proportions while guaranteeing the analyst
  // its full window; replay serves recorded responses instantly either way.
  const budgetSeconds = Number(process.env.ARGUS_EVAL_BUDGET_SECONDS || DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 2);
  const { runAudit } = await import("../server/orchestrate");
  const emits: string[] = [];
  // A replay must not write into the recording it is reading. Appending here
  // meant every replay grew the recorded emit stream, so after one replay the
  // live run's emits could no longer be told from a replay's, and the fixture
  // showed as modified in git. Replays get their own file, replaced each run.
  const emitPath = join(dir, mode === "record" ? "emits.jsonl" : "last-replay-emits.jsonl");
  const startedAt = Date.now();
  const unavailableChecks: Array<{ id: string; note: string }> = [];
  const dossier = await runAudit(handle, (step) => {
    emits.push(JSON.stringify(step));
  }, {
    analystDeadlineAt: startedAt
      + budgetSeconds * 1000
      - ANALYST_FINALIZATION_RESERVE_MS,
  });
  mkdirSync(dir, { recursive: true });
  writeFileSync(emitPath, `${emits.join("\n")}\n`);
  if (!dossier) throw new Error(`runAudit returned null for ${handle}`);
  // runAudit opens its own cost ledger; the honest spend is what finalize
  // attached to the dossier, not an outer ledger this script could open.
  for (const run of dossier.checkRuns ?? []) {
    if (run.status === "unavailable") unavailableChecks.push({ id: run.label, note: run.note ?? "" });
  }
  const costUsd = dossier.cost && typeof dossier.cost.usd === "number" ? dossier.cost.usd : null;
  return {
    snapshot: {
      subject: handle,
      recordedAt: new Date().toISOString(),
      score: typeof dossier.report.governing_score === "number" ? dossier.report.governing_score : null,
      verdict: dossier.report.composite_verdict ?? null,
      completeness: dossier.completeness_state ?? null,
      verifiedFactCount: verifiedFactCount(dossier),
      costUsd,
    },
    unavailableChecks,
    reportText: JSON.stringify(dossier),
    governingRole: dossier.report.governing_role ? String(dossier.report.governing_role) : null,
  };
}

function checkExpectations(slug: string, snapshot: EvalSnapshot, reportText?: string, governingRole?: string | null): string[] {
  if (!existsSync(EXPECTATIONS_PATH)) return [];
  const expectations = JSON.parse(readFileSync(EXPECTATIONS_PATH, "utf8")) as Record<string, Expectation>;
  const expected = expectations[slug];
  if (!expected) return [`no expectations recorded for ${slug} (add to eval/expectations.json)`];
  const failures: string[] = [];
  if (expected.expectedRole && governingRole !== undefined && governingRole !== expected.expectedRole) {
    failures.push(`governing role ${governingRole} != ${expected.expectedRole}`);
  }
  if (reportText !== undefined) {
    for (const pattern of expected.mustSurface ?? []) {
      if (!new RegExp(pattern, "i").test(reportText)) failures.push(`report never surfaces /${pattern}/i`);
    }
    for (const pattern of expected.mustNotAppear ?? []) {
      if (new RegExp(pattern, "i").test(reportText)) failures.push(`report contains forbidden /${pattern}/i`);
    }
  }
  if (expected.verdictIn && (!snapshot.verdict || !expected.verdictIn.includes(snapshot.verdict))) {
    failures.push(`verdict ${snapshot.verdict} not in [${expected.verdictIn.join(", ")}]`);
  }
  if (expected.scoreMin !== undefined && (snapshot.score === null || snapshot.score < expected.scoreMin)) {
    failures.push(`score ${snapshot.score} below ${expected.scoreMin}`);
  }
  if (expected.scoreMax !== undefined && snapshot.score !== null && snapshot.score > expected.scoreMax) {
    failures.push(`score ${snapshot.score} above ${expected.scoreMax}`);
  }
  if (expected.minVerifiedFacts !== undefined && snapshot.verifiedFactCount < expected.minVerifiedFacts) {
    failures.push(`verified facts ${snapshot.verifiedFactCount} below ${expected.minVerifiedFacts}`);
  }
  if (expected.neverIncomplete && snapshot.verdict === "INCOMPLETE") {
    failures.push("verdict is INCOMPLETE for a never-incomplete subject");
  }
  return failures;
}

async function main(): Promise<void> {
  loadDotEnv();
  const [command, ...rest] = process.argv.slice(2);
  const {
    flags,
    subjects,
    allowLiveHosts,
    forceLiveHosts,
    forceLiveTools,
  } = parseEvalHarnessArgs(rest);

  if (command === "record") {
    const handle = subjects[0];
    if (!handle) throw new Error("usage: eval-harness record @handle");
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("record mode is a PAID live run and needs provider keys in .env (ANTHROPIC_API_KEY at minimum)");
    }
    // Preflight the Anthropic key with a FREE count_tokens call. A dead or
    // credit-empty key does not stop the pipeline: it silently fails over to
    // Grok live-search (billed per source), which both corrupts the ground
    // truth and runs up the exact bill this harness exists to prevent.
    if (!flags.has("--allow-degraded-providers")) {
      const preflight = await fetch("https://api.anthropic.com/v1/messages/count_tokens", {
        method: "POST",
        headers: {
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: "claude-haiku-4-5", messages: [{ role: "user", content: "ping" }] }),
      });
      if (!preflight.ok) {
        const detail = (await preflight.text().catch(() => "")).slice(0, 200);
        throw new Error(
          `ANTHROPIC_API_KEY preflight failed (${preflight.status}): ${detail}\n`
          + "Aborting so the run cannot silently fall back to Grok live-search. "
          + "Fund or replace the key, or pass --allow-degraded-providers to record anyway.",
        );
      }
    }
    const slug = slugFor(handle);
    const dir = join(RECORDINGS_ROOT, slug);
    if (existsSync(join(dir, "calls.jsonl"))) {
      rmSync(dir, { recursive: true });
      console.log(`  replaced prior recording for ${slug}`);
    }
    const { result: outcome, recordedCalls } = await withRecordedFetch("record", dir, () => runPipeline(handle, dir, "record"));
    const snapshot = outcome.snapshot;
    writeSnapshot(dir, snapshot);
    const stack = costStack();
    console.log(`  ✓ recorded ${slug}: ${recordedCalls} provider calls, score ${snapshot.score} ${snapshot.verdict}, $${snapshot.costUsd?.toFixed(2)}`);
    console.log(`  · cost stack: analyst ${stack.analyst} · discovery ${stack.discovery} · route ${stack.route}`);
    if (!stack.matchesProd) {
      console.log("  ! this shell has no ARGUS_* cost flags set, so the figure above is the UNOPTIMISED path.");
      console.log("    Production's stack is whatever /api/health reports; do not quote this cost as production's.");
    }
    const failures = checkExpectations(slug, snapshot, outcome.reportText, outcome.governingRole);
    for (const failure of failures) console.log(`  ▲ ${failure}`);
    // Name what this environment could not run. A recording made offline has no
    // authenticated session, so an org-scoped check fails closed and drags
    // coverage down for a reason that says nothing about the subject.
    for (const check of outcome.unavailableChecks) console.log(`  · could not run here: ${check.id}${check.note ? ` (${check.note})` : ""}`);
    process.exit(0);
  }

  if (command === "replay") {
    const slugs = flags.has("--all") || subjects.length === 0
      ? (existsSync(RECORDINGS_ROOT) ? readdirSync(RECORDINGS_ROOT) : [])
      : subjects.map(slugFor);
    if (!slugs.length) throw new Error("no recordings found; run eval:record first");
    let failed = 0;
    for (const slug of slugs) {
      const dir = join(RECORDINGS_ROOT, slug);
      const baseline = readSnapshot(dir);
      const { result: outcome, fidelity } = await withRecordedFetch(
        "replay",
        dir,
        () => runPipeline(`@${slug}`, dir, "replay"),
        { allowLiveHosts, forceLiveHosts, forceLiveTools },
      );
      const snapshot = outcome.snapshot;
      const failures = checkExpectations(slug, snapshot, outcome.reportText, outcome.governingRole);
      const drift = baseline
        ? ` · drift vs recording: score ${baseline.score}→${snapshot.score}, facts ${baseline.verifiedFactCount}→${snapshot.verifiedFactCount}`
        : "";
      const fidelityLine = `exact ${fidelity.exactHits} · tool-fallback ${fidelity.toolFallbackHits} · url-fallback ${fidelity.urlFallbackHits} · live ${fidelity.liveAllowed} · forced-live ${fidelity.liveForced} · misses ${fidelity.misses.length}`;
      console.log(`  ${failures.length ? "✗" : "✓"} ${slug}: score ${snapshot.score} ${snapshot.verdict} · ${snapshot.verifiedFactCount} facts (${fidelityLine})${drift}`);
      for (const failure of failures) console.log(`      ▲ ${failure}`);
      for (const check of outcome.unavailableChecks) console.log(`      · could not run: ${check.id}${check.note ? ` (${check.note})` : ""}`);
      // A miss count alone cannot be acted on. Naming the hosts, and how many
      // each lost, is the difference between "42 misses" and "the model lane
      // asked for 42 calls this recording never made".
      if (fidelity.misses.length) {
        const byHost = new Map<string, number>();
        for (const miss of fidelity.misses) {
          const host = (() => { try { return new URL(miss.url).host; } catch { return miss.url; } })();
          byHost.set(host, (byHost.get(host) ?? 0) + 1);
        }
        const ranked = [...byHost.entries()].sort((a, b) => b[1] - a[1]);
        console.log(`      · uncovered requests: ${ranked.map(([host, n]) => `${host} x${n}`).join(", ")}`);
        if (process.env.ARGUS_EVAL_SHOW_MISSES) {
          for (const miss of fidelity.misses) console.log(`        ${miss.method} ${miss.url}`);
        }
      }
      if (failures.length) failed += 1;
    }
    process.exit(failed ? 1 : 0);
  }

  throw new Error(`unknown command: ${command ?? "(none)"} — use record or replay`);
}

main().catch((error) => {
  console.error(String(error instanceof Error ? error.message : error));
  process.exit(1);
});
