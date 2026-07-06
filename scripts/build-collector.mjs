// Bundles the collector into api/_collector.js (single ESM file, everything
// inlined) so the Vercel serverless functions resolve cleanly at runtime.
import { build } from "esbuild";

const common = {
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  legalComments: "none",
  logLevel: "info",
};

await build({ ...common, entryPoints: ["server/_entry.ts"], outfile: "api/_collector.js" });
// The on-demand watchlist sweep (manual trigger only — no cron by design).
await build({ ...common, entryPoints: ["server/sweep.ts"], outfile: "api/_sweep.js" });

console.log("[argus] bundled collector -> api/_collector.js, sweep -> api/_sweep.js");
