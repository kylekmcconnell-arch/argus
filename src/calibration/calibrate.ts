// CLI: npm run calibrate
// Prints the golden-set verdict table and exits non-zero on any drift, so it
// can gate model changes in CI.

import { runCalibration } from "./run";

const { results, passed, total } = runCalibration();

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

console.log("\n  ARGUS calibration — golden set\n");
console.log("  " + pad("CASE", 24) + pad("EXPECTED", 24) + pad("ACTUAL", 24) + "OK");
console.log("  " + "-".repeat(74));
for (const r of results) {
  const exp = `${r.expected.verdict}${r.expected.cap ? ` (${r.expected.cap})` : ""}`;
  const act = `${r.actual.verdict}${r.actual.cap ? ` (${r.actual.cap})` : ""}`;
  console.log("  " + pad(r.name, 24) + pad(exp, 24) + pad(act, 24) + (r.pass ? "✓" : "✗"));
  if (!r.pass) for (const m of r.mismatches) console.log("      ! " + m);
}
console.log("\n  " + `${passed}/${total} matched` + (passed === total ? "  ✓ no drift" : "  ✗ DRIFT") + "\n");

process.exit(passed === total ? 0 : 1);
