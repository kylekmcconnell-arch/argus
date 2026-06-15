// Bundle entry: the public surface the Vercel API functions need. esbuild
// inlines the whole collector (orchestrate + adapters + agent + engine) into a
// single api/_collector.js so the serverless functions have no unresolved
// cross-directory ESM imports at runtime.
export { providerStatus } from "./config";
export { runAudit } from "./orchestrate";
