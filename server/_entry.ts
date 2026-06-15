// Bundle entry: the public surface the Vercel API functions need. esbuild
// inlines the whole collector (orchestrate + adapters + agent + engine + the
// token auditor) into a single api/_collector.js so the serverless functions
// have no unresolved cross-directory ESM imports at runtime.
export { providerStatus } from "./config";
export { runAudit } from "./orchestrate";
export { auditToken } from "../src/token/audit";
export { resolveInput } from "../src/lib/resolveInput";
