// Bundles the collector into api/_collector.js (single ESM file, everything
// inlined) so the Vercel serverless functions resolve cleanly at runtime.
import { build } from "esbuild";

await build({
  entryPoints: ["server/_entry.ts"],
  outfile: "api/_collector.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  legalComments: "none",
  logLevel: "info",
});

console.log("[argus] bundled collector -> api/_collector.js");
