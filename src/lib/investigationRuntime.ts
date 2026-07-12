// Keep the browser's stream liveness policy and the deployed function ceiling
// explicit and regression-tested together. Vercel requires maxDuration itself to
// remain a statically analyzable literal in each route config.
export const DEEP_INVESTIGATION_MAX_DURATION_SECONDS = 600;

// SSE comments keep browsers and intermediaries aware that a long provider
// stage is alive without creating user-visible progress events.
export const AUDIT_SSE_HEARTBEAT_MS = 15_000;

// This is an inactivity deadline, not a cap on the whole investigation. Every
// provider and analyst call is bounded to 60 seconds or less, so 90 seconds with
// no streamed bytes means the connection is genuinely stalled while still
// allowing a healthy investigation to run for the full server budget.
export const AUDIT_STREAM_INACTIVITY_TIMEOUT_MS = 90_000;
