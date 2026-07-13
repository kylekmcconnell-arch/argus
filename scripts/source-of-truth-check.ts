import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const files = {
  source: readFileSync(resolve(root, "ARGUS-SOURCE-OF-TRUTH.md"), "utf8"),
  benchmark: readFileSync(resolve(root, "QUALITY-BENCHMARK.md"), "utf8"),
  manual: readFileSync(resolve(root, "ARGUS-METHODOLOGY.html"), "utf8"),
};

const failures: string[] = [];
const requireText = (name: keyof typeof files, value: string, description = value): void => {
  if (!files[name].includes(value)) failures.push(`${name} is missing ${description}`);
};

const artifactUrl = "https://claude.ai/code/artifact/4599c1f2-73cb-462c-9382-65282945a087";
requireText("source", artifactUrl, "the canonical Claude artifact URL");
requireText("manual", artifactUrl, "the canonical Claude artifact URL");
requireText("source", "Product version: 3.0", "product version 3.0");
requireText("manual", "v3.0", "product version 3.0");
requireText("source", "Release state: implementation in validation", "an honest validation release state");
requireText("source", "Implemented and regression-tested", "proof-status boundaries");
requireText("benchmark", "Generic-model comparison", "the generic-model comparison contract");
requireText("manual", "what is true, what is material, what could change the decision", "the adviser decision standard");

for (const subject of ["Brian Armstrong", "Hayden Adams", "Sam Bankman-Fried", "Jupiter"]) {
  for (const name of Object.keys(files) as Array<keyof typeof files>) {
    requireText(name, subject, `${subject} live-canary coverage`);
  }
}

const sourceDate = /Last reconciled:\s*([^\n]+)/.exec(files.source)?.[1]?.trim();
const manualDate = /Living document\s*·\s*updated\s+([^<]+)/.exec(files.manual)?.[1]?.trim();
if (!sourceDate || !manualDate || sourceDate !== manualDate) {
  failures.push(`reconciliation dates disagree (source=${sourceDate ?? "missing"}, manual=${manualDate ?? "missing"})`);
}

if (/People Data Labs\s*·\s*Crunchbase/i.test(files.manual)) {
  failures.push("manual still presents Crunchbase as a configured provider dependency");
}
if (files.manual.includes("—")) {
  failures.push("manual contains an em dash");
}

if (failures.length) {
  console.error("ARGUS source-of-truth check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("ARGUS source-of-truth contract passed");
}
