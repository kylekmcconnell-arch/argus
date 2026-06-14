// Server-side contract for the autonomous collector.
//
// Every data-provider adapter takes a CollectContext and contributes typed
// evidence to the shared CollectedEvidence bag. The orchestrator then builds an
// Audit from the bag and the engine produces the verdict. Adapters never score;
// they only acquire. This is the seam that makes every provider swappable.

import type { CollectedEvidence, TraceStep } from "../../src/data/evidence";

export type { CollectedEvidence, TraceStep, SubjectProfile, AxisInput } from "../../src/data/evidence";
export { emptyEvidence } from "../../src/data/evidence";

// Progress sink: adapters and the orchestrator push TraceStep events as work
// happens, streamed to the client over SSE.
export type Emit = (step: TraceStep) => void;

export interface CollectContext {
  handle: string;
  evidence: CollectedEvidence;
  emit: Emit;
}

// An adapter declares which provider key(s) it needs and a run() that mutates
// the evidence bag. `available` lets the orchestrator skip and report cleanly.
export interface Adapter {
  id: string;
  label: string;
  available: () => boolean;
  run: (ctx: CollectContext) => Promise<void>;
}
