// Background audit runner. A person audit streams over SSE for up to ~2 minutes;
// previously it lived inside the LiveRun view, so navigating away unmounted the
// component and aborted the stream — the audit died. This module owns the stream
// at module scope instead, so a run keeps going across navigation, shows up in
// the sidebar as "generating…", and lands in the library the moment it finishes.
//
// Only the run's OWNER view (LiveRun, when mounted on the same handle) transitions
// to the report on completion; the data-side logging (log + persist + graph) runs
// via onComplete regardless of what the user is looking at, so a backgrounded
// audit still appears in Recent audits and Dossiers.
import { streamAudit } from "./live";
import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";

export interface BgRun {
  handle: string;   // display handle, with leading @
  key: string;      // normalized (lowercase, no @) — the map key + cache key
  steps: TraceStep[];
  pct: number;
  status: "running" | "done" | "error";
  error?: string;
  dossier?: Dossier;
  startedAt: number;
}

type Listener = () => void;

const runs = new Map<string, BgRun>();
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((d: Dossier) => void) | null = null;

const norm = (h: string) => h.trim().toLowerCase().replace(/^@/, "");
function emit() { for (const l of listeners) l(); }

// App registers the data-side completion handler (log + persist + graph + cache).
// It must NOT change the view — a backgrounded audit finishing should not yank
// the user out of whatever they're doing.
export function setOnComplete(fn: (d: Dossier) => void) { onComplete = fn; }

export function subscribeRuns(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getRun(handle: string): BgRun | undefined { return runs.get(norm(handle)); }

// Runs still streaming, newest first — what the sidebar shows as "generating…".
export function activeRuns(): BgRun[] {
  return [...runs.values()].filter((r) => r.status === "running").sort((a, b) => b.startedAt - a.startedAt);
}

// Start (or re-attach to) a background person audit. Idempotent per handle: if one
// is already streaming, the existing run is returned so we never double-stream.
export function startPersonAudit(handle: string): BgRun {
  const key = norm(handle);
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;

  const run: BgRun = {
    handle: handle.startsWith("@") ? handle : "@" + key,
    key,
    steps: [],
    pct: 0,
    status: "running",
    startedAt: Date.now(),
  };
  runs.set(key, run);
  emit();

  const abort = streamAudit(key, {
    onStep: (s) => {
      run.steps = [...run.steps, s];
      // Open-ended progress: ramp asymptotically toward ~92% by step count.
      run.pct = Math.min(92, run.steps.length * 11);
      emit();
    },
    onDone: (d) => {
      run.status = "done";
      run.dossier = d;
      run.pct = 100;
      aborts.delete(key);
      emit();
      onComplete?.(d); // log + persist + graph, so it lands in Recent/Dossiers
    },
    onError: (e) => {
      run.status = "error";
      run.error = e;
      aborts.delete(key);
      emit();
    },
  });
  aborts.set(key, abort);
  return run;
}

// Hard-stop and forget a run (used on explicit cancel / purge, never on nav).
export function cancelRun(handle: string) {
  const key = norm(handle);
  aborts.get(key)?.();
  aborts.delete(key);
  runs.delete(key);
  emit();
}
