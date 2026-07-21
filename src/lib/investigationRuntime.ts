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
export const ANALYST_SCORING_TIMEOUT_MS = 180_000;

// A repair reuses the same strict schema, so its compiled grammar should be
// warm. Bound it separately and preserve time for persistence/certification.
export const ANALYST_REPAIR_TIMEOUT_MS = 90_000;
export const ANALYST_FINALIZATION_RESERVE_MS = 90_000;

// Evidence collection (every provider pass) must STOP LAUNCHING new work with
// this much of the analyst-deadline budget still in hand, so the analyst call
// plus finalization/persistence always fit inside the function ceiling. Without
// it, a large multi-venture/high-connectivity subject can let collection run to
// the ceiling and the function is killed with nothing persisted ("didn't
// finish"). Normal subjects finish collection long before this bites, so it is a
// no-op for them; a pathological subject instead degrades to a persisted partial
// report scored on whatever evidence was gathered by the cut-off.
//
// MUST leave >= ANALYST_SCORING_TIMEOUT_MS after the never-waive graph screen:
// the reserve is the ONLY guarantee the analyst gets its full scoring window.
// At 120s (< the 180s scorer timeout) a slow analyst on a high-connectivity
// subject ran past the deadline and the verdict call was cut off, publishing
// INCOMPLETE on already-collected evidence (observed: @Uniswap timed out at
// 510s with a full team + token in hand). The reserve now also front-loads a
// dedicated TRUST_GRAPH_SCREEN_RESERVE_MS window (see below), so the invariant
// is COLLECTION_ANALYST_RESERVE_MS - TRUST_GRAPH_SCREEN_RESERVE_MS >=
// ANALYST_SCORING_TIMEOUT_MS (220 - 30 = 190 >= 180).
export const COLLECTION_ANALYST_RESERVE_MS = 220_000;

// The trust-graph reconciliation is the LAST collection pass AND a never-waive
// safety screen (an unrecorded flagged-subject screen withholds clearance
// forever). On a high-connectivity subject the general adapters ahead of it burn
// the whole collection budget, so it was skipped and recorded `unavailable` ->
// the biggest, cleanest projects (Uniswap) published PROVISIONAL on a budget
// clip, not a real gap. This reserves a bounded window that general collection
// stops short of, so the fast (bounded, GRAPH_LIMIT-capped) screen always runs
// and records checked-empty/confirmed/finding. It is carved FROM the analyst
// reserve above, never from the analyst's own scoring window.
export const TRUST_GRAPH_SCREEN_RESERVE_MS = 30_000;

// This is an inactivity deadline, not a cap on the whole investigation. The
// route emits heartbeats every 15 seconds even while the longer scorer is
// working, so 90 seconds with no streamed bytes means the connection itself is
// genuinely stalled while a healthy investigation can use the server budget.
export const AUDIT_STREAM_INACTIVITY_TIMEOUT_MS = 90_000;
