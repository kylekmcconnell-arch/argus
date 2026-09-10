import { tokenSubjectIdentity } from "./tokenIdentity";
// Background runner for TOKEN and INVESTIGATION scans — the analog of runner.ts
// (person audits). The run executes at module scope, not inside the view, so
// navigating away no longer aborts it: it keeps going, stays in the sidebar as
// "scanning…", and lands in the library the moment it finishes. The owning view
// (TokenRun / InvestigationRun) attaches and renders; on completion the runner's
// onComplete does the data-side work (cache / persist / log / graph) regardless
// of what the user is looking at.
import { auditToken, type TokenDossier } from "../token/audit";
import { collectTokenSocialActivity, scanScopedFetch } from "./socialActivityClient";
import { streamInvestigation, type Investigation } from "./investigation";
import type { RunnableTokenInput } from "./resolveInput";
import type { TraceStep } from "../data/evidence";
import type { ResearchIntent } from "./researchDirector";
import { reserveInvestigationCredit } from "./investigationCredits";
import { finishScanReceipt } from "./scanReceipts";

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
  intent?: ResearchIntent;
  creditKey: string;
}

type Listener = () => void;
const runs = new Map<string, ScanRun>();       // keyed by `${kind}:${ref}`
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((run: ScanRun) => void) | null = null;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const norm = (s: string) => {
  const clean = s.trim().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  return EVM_ADDRESS.test(clean) ? clean.toLowerCase() : clean;
};
const trunc = (s: string) => (s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-4) : s);
function emit() { for (const l of listeners) l(); }

// Data-side completion (cache/persist/log/graph); must NOT change the view.
export function setScanOnComplete(fn: (run: ScanRun) => void) { onComplete = fn; }
export function subscribeScanRuns(cb: Listener): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function activeScanRuns(): ScanRun[] {
  return [...runs.values()].filter((r) => r.status === "running" && !r.priv).sort((a, b) => b.startedAt - a.startedAt);
}
export function getScanRun(kind: ScanKind, ref: string, priv = false): ScanRun | undefined { return runs.get(`${kind}:${priv ? "private" : "public"}:${norm(ref)}`); }

export function cancelScanRun(kind: ScanKind, ref: string, priv = false) {
  const key = `${kind}:${priv ? "private" : "public"}:${norm(ref)}`;
  const run = runs.get(key);
  aborts.get(key)?.();
  aborts.delete(key);
  if (run?.status === "running") {
    run.status = "error";
    run.error = "cancelled";
    void finishScanReceipt({ runKey: run.creditKey, kind: run.kind, canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref,
      displayQuery: run.input, privateRun: run.priv, startedAt: run.startedAt,
      status: "failed", failureCode: "cancelled", failureDetail: "Scan cancelled by the user." });
  }
  runs.delete(key);
  emit();
}

// Start (or re-attach to) a background token audit.
export function startTokenScan(input: RunnableTokenInput, priv = false, opts?: { force?: boolean }): ScanRun {
  const ref = tokenSubjectIdentity(input.chain, input.ref)?.ref ?? norm(input.ref);
  const key = `token:${priv ? "private" : "public"}:${ref}`;
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;

  const run: ScanRun = { id: `tok:${ref}:${Date.now()}`, kind: "token", ref, input: input.ref, label: trunc(input.ref), priv, steps: [], pct: 0, status: "running", startedAt: Date.now(), creditKey: crypto.randomUUID() };
  runs.set(key, run);
  emit();

  let cancelled = false;
  const controller = new AbortController();
  aborts.set(key, () => { cancelled = true; controller.abort(); });
  (async () => {
    try {
      await reserveInvestigationCredit(run.creditKey, "token", input.ref, run.input, run.priv, new Date(run.startedAt).toISOString());
      if (cancelled) {
        void finishScanReceipt({ runKey: run.creditKey, kind: run.kind, canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
          privateRun: run.priv, startedAt: run.startedAt, status: "failed", failureCode: "cancelled", failureDetail: "Scan cancelled." });
        return;
      }
      let count = 0;
      const d = await auditToken(
        input,
        (s) => { if (cancelled) return; count += 1; run.steps = [...run.steps, s]; run.pct = Math.min(92, count * 18); emit(); },
        { signal: controller.signal, deadlineAt: run.startedAt + 120_000, force: opts?.force, collectSocialActivity: collectTokenSocialActivity, fetchImpl: scanScopedFetch(run.creditKey) },
      );
      if (cancelled) return;
      if (!d) {
        run.status = "error";
        run.error = "not_found";
        emit();
        void finishScanReceipt({
          runKey: run.creditKey, kind: "token", canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
          privateRun: run.priv, startedAt: run.startedAt, status: "failed",
          failureCode: "not_found", failureDetail: "No DEX pair was found for this contract.",
        });
      }
      else { run.status = "done"; run.result = d; run.pct = 100; emit(); onComplete?.(run); }
    } catch (e) {
      if (!cancelled) {
        run.status = "error";
        run.error = String(e);
        emit();
        void finishScanReceipt({
          runKey: run.creditKey, kind: "token", canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
          privateRun: run.priv, startedAt: run.startedAt, status: "failed",
          failureCode: "collection_failed", failureDetail: run.error,
        });
      }
    } finally { if (runs.get(key) === run) aborts.delete(key); }
  })();
  return run;
}

// Start (or re-attach to) a background token investigation.
export function startInvestigationScan(
  input: RunnableTokenInput,
  priv = false,
  opts?: { force?: boolean; intent?: ResearchIntent },
): ScanRun {
  const rawInput = input.ref;
  const ref = tokenSubjectIdentity(input.chain, input.ref)?.ref ?? norm(input.ref);
  const key = `investigation:${priv ? "private" : "public"}:${ref}`;
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;
  if (existing) {
    aborts.get(key)?.();
    aborts.delete(key);
  }

  const creditKey = crypto.randomUUID();
  const run: ScanRun = { id: `inv:${ref}:${creditKey}`, kind: "investigation", ref, input: rawInput, label: trunc(rawInput.replace(/^[@$]/, "")), priv, steps: [], pct: 0, status: "running", startedAt: Date.now(), intent: opts?.intent, creditKey };
  runs.set(key, run);
  emit();

  let cancelled = false;
  aborts.set(key, () => { cancelled = true; });
  void (async () => {
    try {
      await reserveInvestigationCredit(run.creditKey, "investigation", input.ref, run.input, run.priv, new Date(run.startedAt).toISOString());
      if (cancelled) {
        void finishScanReceipt({ runKey: run.creditKey, kind: run.kind, canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
          privateRun: run.priv, startedAt: run.startedAt, status: "failed", failureCode: "cancelled", failureDetail: "Scan cancelled." });
        return;
      }
      let count = 0;
      const abort = streamInvestigation(input, {
        onStep: (s) => { if (cancelled) return; count += 1; run.steps = [...run.steps, s]; run.pct = Math.min(94, count * 7); emit(); },
        onHop: (sub) => { if (cancelled) return; run.hop = sub; emit(); },
        onDone: (inv) => { if (cancelled) return; run.status = "done"; run.result = inv; run.pct = 100; aborts.delete(key); emit(); onComplete?.(run); },
        onError: (error) => {
          if (cancelled) return;
          run.status = "error";
          run.error = error;
          aborts.delete(key);
          emit();
          void finishScanReceipt({
            runKey: run.creditKey, kind: "investigation", canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
            privateRun: run.priv, startedAt: run.startedAt, status: "failed",
            failureCode: "collection_failed", failureDetail: error,
          });
        },
      }, { forceTokenAudit: opts?.force, intent: opts?.intent, creditKey: run.creditKey });
      if (run.status === "running") aborts.set(key, () => { cancelled = true; abort(); });
    } catch (error) {
      if (!cancelled) {
        run.status = "error";
        run.error = error instanceof Error ? error.message : String(error);
        aborts.delete(key);
        emit();
        void finishScanReceipt({
          runKey: run.creditKey, kind: "investigation", canonicalRef: run.ref.includes(":") ? run.ref.split(":")[1] : run.ref, displayQuery: run.input,
          privateRun: run.priv, startedAt: run.startedAt, status: "failed",
          failureCode: "collection_failed", failureDetail: run.error,
        });
      }
    }
  })();
  return run;
}
