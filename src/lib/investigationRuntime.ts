// Keep the browser's stream liveness policy and the deployed function ceiling
// explicit and regression-tested together. Vercel requires maxDuration itself to
// remain a statically analyzable literal in each route config.
export const DEEP_INVESTIGATION_MAX_DURATION_SECONDS = 600;

// SSE comments keep browsers and intermediaries aware that a long provider
// stage is alive without creating user-visible progress events.
export const AUDIT_SSE_HEARTBEAT_MS = 15_000;

// The flagship scorer has to return a complete, citation-rich axis set. Large
// multi-role subjects need more time than short extraction calls, while still
// remaining well inside the deployed function ceiling.
export const ANALYST_SCORING_TIMEOUT_MS = 120_000;

// This is an inactivity deadline, not a cap on the whole investigation. The
// route emits heartbeats every 15 seconds even while the longer scorer is
// working, so 90 seconds with no streamed bytes means the connection itself is
// genuinely stalled while a healthy investigation can use the server budget.
export const AUDIT_STREAM_INACTIVITY_TIMEOUT_MS = 90_000;
