// Entry point for the server-side threat pipeline bundle. esbuild bundles this
// file (scripts/build-threatlib.mjs) into api/_threatlib.mjs - a single
// self-contained ESM file the Telegram webhook can import at runtime. Vercel's
// function builder transpiles api/*.ts but does NOT bundle imports that reach
// outside api/, so an extensionless ../src import dies at runtime with
// ERR_MODULE_NOT_FOUND under "type": "module". An in-dir .mjs with a real
// extension resolves under any builder.
export { resolveInput } from "../lib/resolveInput";
export { threatScan } from "./scan";
export { aiCodeRead } from "./codereview";
export { configureThreatNet } from "./net";
export { formatScanMessage } from "./tgformat";
