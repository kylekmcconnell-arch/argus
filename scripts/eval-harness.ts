// Full-pipeline eval harness CLI.
//
//   npm run eval:record -- @uniswap        one PAID live audit, traffic frozen to eval/recordings/<slug>/
//   npm run eval:replay -- @uniswap        free offline re-run against the frozen traffic
//   npm run eval:replay -- --all           every recorded subject
//   npm run eval:replay -- @uniswap --allow-live google.serper.dev,openrouter.ai
//                                          replay everything EXCEPT the listed hosts (A/B lane)
//
// Replay asserts eval/expectations.json and reports drift against the
// recording-time snapshot. Record mode needs provider keys in .env (never
// committed); replay needs none.
import { existsSync, mkdirSync, readFileSync, readdirSync, appendFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { withRecordedFetch, writeSnapshot, readSnapshot, type EvalSnapshot } from "../server/evalHarness";
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

async function runPipeline(handle: string, dir: string): Promise<EvalSnapshot> {
  // Offline callers must mirror prod's deadline SHAPE (a short analyst window
  // starves basic-facts and fakes INCOMPLETE), but record mode is not bound by
  // the serverless duration cap and a local machine plus home network runs the
  // same collection ~1.5-2x slower than Vercel's data center. A wider total
  // ceiling keeps prod's reserve proportions while guaranteeing the analyst
  // its full window; replay serves recorded responses instantly either way.
  const budgetSeconds = Number(process.env.ARGUS_EVAL_BUDGET_SECONDS || DEEP_INVESTIGATION_MAX_DURATION_SECONDS * 2);
  const { runAudit } = await import("../server/orchestrate");
  const emits: string[] = [];
  const emitPath = join(dir, "emits.jsonl");
  const startedAt = Date.now();
  const dossier = await runAudit(handle, (step) => {
    emits.push(JSON.stringify(step));
  }, {
    analystDeadlineAt: startedAt
      + budgetSeconds * 1000
      - ANALYST_FINALIZATION_RESERVE_MS,
  });
  mkdirSync(dir, { recursive: true });
  appendFileSync(emitPath, `${emits.join("\n")}\n`);
  if (!dossier) throw new Error(`runAudit returned null for ${handle}`);
  // runAudit opens its own cost ledger; the honest spend is what finalize
  // attached to the dossier, not an outer ledger this script could open.
  const costUsd = dossier.cost && typeof dossier.cost.usd === "number" ? dossier.cost.usd : null;
  return {
    subject: handle,
    recordedAt: new Date().toISOString(),
    score: typeof dossier.report.governing_score === "number" ? dossier.report.governing_score : null,
    verdict: dossier.report.composite_verdict ?? null,
    completeness: dossier.completeness_state ?? null,
    verifiedFactCount: verifiedFactCount(dossier),
    costUsd,
  };
}

function checkExpectations(slug: string, snapshot: EvalSnapshot): string[] {
  if (!existsSync(EXPECTATIONS_PATH)) return [];
  const expectations = JSON.parse(readFileSync(EXPECTATIONS_PATH, "utf8")) as Record<string, Expectation>;
  const expected = expectations[slug];
  if (!expected) return [`no expectations recorded for ${slug} (add to eval/expectations.json)`];
  const failures: string[] = [];
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
  const flags = rest.filter((arg) => arg.startsWith("--"));
  const subjects = rest.filter((arg) => !arg.startsWith("--"));
  const allowLive = flags.find((flag) => flag.startsWith("--allow-live"))?.split("=")[1]?.split(",")
    ?? (flags.includes("--allow-live") ? rest[rest.indexOf("--allow-live") + 1]?.split(",") : undefined);

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
    if (!flags.includes("--allow-degraded-providers")) {
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
    const { result: snapshot, recordedCalls } = await withRecordedFetch("record", dir, () => runPipeline(handle, dir));
    writeSnapshot(dir, snapshot);
    console.log(`  ✓ recorded ${slug}: ${recordedCalls} provider calls, score ${snapshot.score} ${snapshot.verdict}, $${snapshot.costUsd?.toFixed(2)}`);
    const failures = checkExpectations(slug, snapshot);
    for (const failure of failures) console.log(`  ▲ ${failure}`);
    process.exit(0);
  }

  if (command === "replay") {
    const slugs = flags.includes("--all") || subjects.length === 0
      ? (existsSync(RECORDINGS_ROOT) ? readdirSync(RECORDINGS_ROOT) : [])
      : subjects.map(slugFor);
    if (!slugs.length) throw new Error("no recordings found; run eval:record first");
    let failed = 0;
    for (const slug of slugs) {
      const dir = join(RECORDINGS_ROOT, slug);
      const baseline = readSnapshot(dir);
      const { result: snapshot, fidelity } = await withRecordedFetch(
        "replay",
        dir,
        () => runPipeline(`@${slug}`, dir),
        { allowLiveHosts: allowLive },
      );
      const failures = checkExpectations(slug, snapshot);
      const drift = baseline
        ? ` · drift vs recording: score ${baseline.score}→${snapshot.score}, facts ${baseline.verifiedFactCount}→${snapshot.verifiedFactCount}`
        : "";
      const fidelityLine = `exact ${fidelity.exactHits} · url-fallback ${fidelity.urlFallbackHits} · live ${fidelity.liveAllowed} · misses ${fidelity.misses.length}`;
      console.log(`  ${failures.length ? "✗" : "✓"} ${slug}: score ${snapshot.score} ${snapshot.verdict} · ${snapshot.verifiedFactCount} facts (${fidelityLine})${drift}`);
      for (const failure of failures) console.log(`      ▲ ${failure}`);
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
