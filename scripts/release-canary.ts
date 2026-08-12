import { runOfflineReleaseCanary } from "../src/release-canary/matrix";

const summary = await runOfflineReleaseCanary();

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log("\n  ARGUS deterministic release canary — offline fixtures\n");
  for (const result of summary.results) {
    console.log(`  ${result.pass ? "✓" : "✗"} ${result.id}`);
    console.log(`    ${result.actual}`);
    if (!result.pass) console.log(`    ${result.detail}`);
  }
  console.log(`\n  ${summary.passed}/${summary.total} matched · ${summary.interceptedFixtureRequests} provider requests intercepted locally · ${summary.unexpectedUrls.length} unexpected URLs\n`);
}

process.exit(summary.passed === summary.total && summary.unexpectedUrls.length === 0 ? 0 : 1);
