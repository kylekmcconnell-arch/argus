// CLI: npm run calibrate
// Prints the golden-set verdict table and exits non-zero on any drift, so it
// can gate model changes in CI.

import { runCalibration } from "./run";

const { results, passed, total, quality } = runCalibration();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({
    schemaVersion: 1,
    methodologyVersion: process.env.ARGUS_METHODOLOGY_VERSION || "development",
    generatedAt: new Date().toISOString(),
    passed,
    total,
    quality,
    results,
  }, null, 2));
  process.exit(passed === total ? 0 : 1);
}

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

console.log("\n  ARGUS calibration — golden set\n");
console.log("  " + pad("CASE", 29) + pad("TRUTH", 23) + pad("EXPECTED", 22) + pad("ACTUAL", 22) + pad("ACTUAL CAP", 34) + "OK");
console.log("  " + "-".repeat(132));
for (const r of results) {
  console.log(
    "  " +
    pad(r.name, 29) +
    pad(r.groundTruth, 23) +
    pad(r.expected.verdict, 22) +
    pad(r.actual.verdict, 22) +
    pad(r.actual.cap ?? "—", 34) +
    (r.pass ? "✓" : "✗"),
  );
  if (!r.pass) for (const m of r.mismatches) console.log("      ! " + m);
}
console.log("\n  Critical quality errors");
console.log(`  false passes:       ${quality.falsePasses.length}`);
console.log(`  false avoids:       ${quality.falseAvoids.length}`);
console.log(`  unsafe conclusions: ${quality.unsafeConclusions.length}`);
console.log(`  identity misses:    ${quality.identityMisses.length}`);
console.log("\n  " + `${passed}/${total} matched` + (passed === total ? "  ✓ no drift" : "  ✗ DRIFT") + "\n");

process.exit(passed === total ? 0 : 1);
