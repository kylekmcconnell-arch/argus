// Bundles the collector into api/_collector.js (single ESM file, everything
// inlined) so the Vercel serverless functions resolve cleanly at runtime.
import { copyFileSync } from "node:fs";
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

// Mirror the shareable architecture map into public/ so Vite ships it at
// /architecture.html (static, unauthenticated — middleware only gates /api/*).
// docs/ stays the single source of truth; the mirror is generated, gitignored.
copyFileSync("docs/architecture.html", "public/architecture.html");

console.log("[argus] bundled collector -> api/_collector.js, sweep -> api/_sweep.js, map -> public/architecture.html");
