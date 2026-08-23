import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { evaluateEyeReplay, type EyeCorpusExpectation, type EyeReplayAnswer } from "../src/lib/argusEyeEvaluation.js";

interface CorpusCase { id: string; expected: EyeCorpusExpectation; replay: EyeReplayAnswer }
interface Corpus { schemaVersion: string; cases: CorpusCase[] }

const path = resolve(process.cwd(), process.argv[2] || "eval/argus-eye/corpus.v1.json");
const corpus = JSON.parse(readFileSync(path, "utf8")) as Corpus;
if (corpus.schemaVersion !== "argus-eye-corpus.v1" || !Array.isArray(corpus.cases)) {
  throw new Error("Unsupported ARGUS Eye corpus");
}

let failed = 0;
for (const testCase of corpus.cases) {
  const failures = evaluateEyeReplay(testCase.expected, testCase.replay);
  if (!failures.length) continue;
  failed += 1;
  console.error(`${testCase.id}: ${failures.map((failure) => `${failure.rule} (${failure.detail})`).join(", ")}`);
}
console.log(`ARGUS Eye offline replay: ${corpus.cases.length - failed}/${corpus.cases.length} adjudicated cases passed`);
if (failed) process.exitCode = 1;
