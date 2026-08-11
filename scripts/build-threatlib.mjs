// Bundles the server-side threat pipeline (src/threat/serverScan.ts) into
// api/_threatlib.mjs - one self-contained ESM file the Telegram webhook
// dynamic-imports at runtime. Runs as part of `npm run build`, so the artifact
// exists before Vercel compiles the api functions. See serverScan.ts for why
// this exists (the function builder does not bundle out-of-dir TS imports).
import { build } from "esbuild";

await build({
  entryPoints: ["src/threat/serverScan.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node18",
  outfile: "api/_threatlib.mjs",
  logLevel: "info",
});
