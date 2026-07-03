// Background runner for TOKEN and INVESTIGATION scans — the analog of runner.ts
// (person audits). The run executes at module scope, not inside the view, so
// navigating away no longer aborts it: it keeps going, stays in the sidebar as
// "scanning…", and lands in the library the moment it finishes. The owning view
// (TokenRun / InvestigationRun) attaches and renders; on completion the runner's
// onComplete does the data-side work (cache / persist / log / graph) regardless
// of what the user is looking at.
import { auditToken, type TokenDossier } from "../token/audit";
import { streamInvestigation, type Investigation } from "./investigation";
import { resolveInput, type ResolvedInput } from "./resolveInput";
import type { TraceStep } from "../data/evidence";

export type ScanKind = "token" | "investigation";
export interface ScanRun {
  id: string;
  kind: ScanKind;
  ref: string;        // normalized subject id (contract address)
  input: string;      // raw input
  label: string;      // sidebar label (truncated address)
  priv: boolean;
  steps: TraceStep[];
  pct: number;
  status: "running" | "done" | "error";
  result?: TokenDossier | Investigation;
  error?: string;
  hop?: string;       // investigation subtitle
  startedAt: number;
}

type Listener = () => void;
const runs = new Map<string, ScanRun>();       // keyed by `${kind}:${ref}`
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((run: ScanRun) => void) | null = null;

const norm = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
const trunc = (s: string) => (s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-4) : s);
function emit() { for (const l of listeners) l(); }

// Data-side completion (cache/persist/log/graph); must NOT change the view.
export function setScanOnComplete(fn: (run: ScanRun) => void) { onComplete = fn; }
export function subscribeScanRuns(cb: Listener): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function activeScanRuns(): ScanRun[] {
  return [...runs.values()].filter((r) => r.status === "running" && !r.priv).sort((a, b) => b.startedAt - a.startedAt);
}
export function getScanRun(kind: ScanKind, ref: string): ScanRun | undefined { return runs.get(`${kind}:${norm(ref)}`); }

export function cancelScanRun(kind: ScanKind, ref: string) {
  const key = `${kind}:${norm(ref)}`;
  aborts.get(key)?.();
  aborts.delete(key);
  runs.delete(key);
  emit();
}

// Start (or re-attach to) a background token audit.
export function startTokenScan(input: ResolvedInput, priv = false): ScanRun {
  const ref = norm(input.ref);
  const key = `token:${ref}`;
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;

  const run: ScanRun = { id: `tok:${ref}:${Date.now()}`, kind: "token", ref, input: input.ref, label: trunc(input.ref), priv, steps: [], pct: 0, status: "running", startedAt: Date.now() };
  runs.set(key, run);
  emit();

  let cancelled = false;
  aborts.set(key, () => { cancelled = true; });
  (async () => {
    try {
      let count = 0;
      const d = await auditToken(input, (s) => { if (cancelled) return; count += 1; run.steps = [...run.steps, s]; run.pct = Math.min(92, count * 18); emit(); });
      if (cancelled) return;
      if (!d) { run.status = "error"; run.error = "not_found"; emit(); }
      else { run.status = "done"; run.result = d; run.pct = 100; emit(); onComplete?.(run); }
    } catch (e) {
      if (!cancelled) { run.status = "error"; run.error = String(e); emit(); }
    } finally { aborts.delete(key); }
  })();
  return run;
}

// Start (or re-attach to) a background token investigation.
export function startInvestigationScan(rawInput: string, priv = false): ScanRun {
  const ref = norm(resolveInput(rawInput).ref);
  const key = `investigation:${ref}`;
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;

  const run: ScanRun = { id: `inv:${ref}:${Date.now()}`, kind: "investigation", ref, input: rawInput, label: trunc(rawInput.replace(/^[@$]/, "")), priv, steps: [], pct: 0, status: "running", startedAt: Date.now() };
  runs.set(key, run);
  emit();

  let count = 0;
  const abort = streamInvestigation(rawInput, {
    onStep: (s) => { count += 1; run.steps = [...run.steps, s]; run.pct = Math.min(94, count * 7); emit(); },
    onHop: (sub) => { run.hop = sub; emit(); },
    onDone: (inv) => { run.status = "done"; run.result = inv; run.pct = 100; aborts.delete(key); emit(); onComplete?.(run); },
    onError: () => { run.status = "error"; run.error = "error"; aborts.delete(key); emit(); },
  });
  aborts.set(key, abort);
  return run;
}
