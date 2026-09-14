import { tokenSubjectIdentity } from "./tokenIdentity";
import { normalizeSubjectRef } from "./subjectRef";
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
  /**
   * The exact chain-qualified subject once the collector has resolved it.
   * Set on completion for runs that started from a looser form (a bare
   * address, a DexScreener URL), so a later lookup by the canonical ref
   * still finds this run.
   */
  canonicalRef?: string;
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
  /** Credits the reservation actually charged; 0 until the server confirms one. */
  chargedCredits: number;
}

type Listener = () => void;
const runs = new Map<string, ScanRun>();       // keyed by `${kind}:${ref}`
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((run: ScanRun) => void) | null = null;

const EVM_ADDRESS = /^0x[0-9a-f]{40}$/i;
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const norm = (s: string) => {
  const clean = s.trim().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  return EVM_ADDRESS.test(clean) ? clean.toLowerCase() : clean;
};
const trunc = (s: string) => (s.length > 20 ? s.slice(0, 8) + "…" + s.slice(-4) : s);
const runKey = (kind: ScanKind, priv: boolean, ref: string) => `${kind}:${priv ? "private" : "public"}:${ref}`;
const keyOf = (run: ScanRun) => runKey(run.kind, run.priv, run.ref);
function emit() { for (const l of listeners) l(); }

// The address component of a subject ref, bare ("0xabc…") or chain-qualified
// ("ethereum:0xabc…"). Null for anything that is not a contract address (a
// DexScreener URL, a ticker), which can only match a run exactly.
function subjectAddress(ref: string): string | null {
  const normalized = normalizeSubjectRef(ref);
  const qualified = normalized.match(/^[a-z0-9_-]+:(.+)$/);
  const address = qualified ? qualified[1] : normalized;
  return EVM_ADDRESS.test(address) || SOLANA_ADDRESS.test(address) ? address : null;
}

/**
 * One canonicalizer for every entry point. Three ref forms coexist in the
 * client (bare address on audit-log rows and report rescans, `chain:address`
 * on durable cases and Dossiers, the raw DexScreener URL when pasted), and an
 * exact string match between them silently fell through to the previous
 * stored report while the paid rescan kept running unseen. A run matches when
 * its key, raw input or resolved canonical ref equals the lookup, or when the
 * address component of both is the same contract.
 */
export function scanRunMatchesRef(run: Pick<ScanRun, "ref" | "input" | "canonicalRef">, ref: string): boolean {
  const target = norm(ref);
  if (!target) return false;
  if (norm(run.ref) === target || norm(run.input) === target) return true;
  if (run.canonicalRef && norm(run.canonicalRef) === target) return true;
  const address = subjectAddress(ref);
  if (!address) return false;
  const runAddress = subjectAddress(run.ref) ?? (run.canonicalRef ? subjectAddress(run.canonicalRef) : null);
  return runAddress === address;
}

function findScanRun(kind: ScanKind, ref: string, priv: boolean): ScanRun | undefined {
  const exact = runs.get(runKey(kind, priv, norm(ref)));
  if (exact?.status === "running") return exact;
  // Prefer a run still collecting, then the exact key, then the most recent,
  // so a completed earlier run can never hide an in-flight rescan of the same
  // subject started from another ref form.
  const matches = [...runs.values()]
    .filter((run) => run.kind === kind && run.priv === priv && scanRunMatchesRef(run, ref))
    .sort((a, b) => b.startedAt - a.startedAt);
  return matches.find((run) => run.status === "running") ?? exact ?? matches[0];
}

// Data-side completion (cache/persist/log/graph); must NOT change the view.
export function setScanOnComplete(fn: (run: ScanRun) => void) { onComplete = fn; }
export function subscribeScanRuns(cb: Listener): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }

export function activeScanRuns(): ScanRun[] {
  return [...runs.values()].filter((r) => r.status === "running" && !r.priv).sort((a, b) => b.startedAt - a.startedAt);
}
export function getScanRun(kind: ScanKind, ref: string, priv = false): ScanRun | undefined { return findScanRun(kind, ref, priv); }

// Once the collector has resolved the exact subject, remember it on the run so
// every later lookup form (chain-qualified case ref, bare address) re-attaches.
function bindCanonicalRef(run: ScanRun, chain: unknown, address: unknown): void {
  const identity = tokenSubjectIdentity(chain, address);
  if (identity) run.canonicalRef = identity.ref;
}

// Wall clocks for the two awaits that previously had none. A stalled
// reservation request (serverless cold-start hang, proxy) never rejected, so
// the run stayed "running" with zero steps and, being idempotent by key, blocked
// every later scan of that subject until it was cancelled by hand.
export const CREDIT_RESERVATION_TIMEOUT_MS = 15_000;

const receiptRef = (run: ScanRun) => (/^([a-z0-9_-]+):([a-z0-9]+)$/i.test(run.ref) ? run.ref.split(":")[1] : run.ref);

function failedReceipt(run: ScanRun, failureCode: string, failureDetail: string) {
  return finishScanReceipt({
    runKey: run.creditKey, kind: run.kind, canonicalRef: receiptRef(run), displayQuery: run.input,
    privateRun: run.priv, startedAt: run.startedAt, status: "failed", failureCode, failureDetail,
    creditsCharged: run.chargedCredits,
  });
}

// The reservation has its own outcome: when the server refuses or cannot be
// reached, no provider was started and no credit was taken, so the receipt
// must not say the run failed during collection with one credit charged.
async function reserveCredit(run: ScanRun, canonicalRef: string): Promise<boolean> {
  try {
    const reservation = await reserveInvestigationCredit(
      run.creditKey, run.kind, canonicalRef, run.input, run.priv, new Date(run.startedAt).toISOString(),
      { signal: AbortSignal.timeout(CREDIT_RESERVATION_TIMEOUT_MS) },
    );
    run.chargedCredits = reservation.chargedCredits;
    return true;
  } catch (error) {
    run.status = "error";
    run.error = error instanceof Error ? error.message : String(error);
    emit();
    void failedReceipt(run, "credit_reservation_failed", run.error);
    return false;
  }
}

export function cancelScanRun(kind: ScanKind, ref: string, priv = false) {
  const run = findScanRun(kind, ref, priv);
  const key = run ? keyOf(run) : runKey(kind, priv, norm(ref));
  aborts.get(key)?.();
  aborts.delete(key);
  if (run?.status === "running") {
    run.status = "error";
    run.error = "cancelled";
    void failedReceipt(run, "cancelled", "Scan cancelled by the user.");
  }
  runs.delete(key);
  emit();
}

// Start (or re-attach to) a background token audit.
export function startTokenScan(input: RunnableTokenInput, priv = false, opts?: { force?: boolean }): ScanRun {
  const ref = tokenSubjectIdentity(input.chain, input.ref)?.ref ?? norm(input.ref);
  const key = runKey("token", priv, ref);
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;

  const run: ScanRun = { id: `tok:${ref}:${Date.now()}`, kind: "token", ref, input: input.ref, label: trunc(input.ref), priv, steps: [], pct: 0, status: "running", startedAt: Date.now(), creditKey: crypto.randomUUID(), chargedCredits: 0 };
  runs.set(key, run);
  emit();

  let cancelled = false;
  const controller = new AbortController();
  aborts.set(key, () => { cancelled = true; controller.abort(); });
  (async () => {
    try {
      if (!(await reserveCredit(run, input.ref))) return;
      if (cancelled) {
        void failedReceipt(run, "cancelled", "Scan cancelled.");
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
        void failedReceipt(run, "not_found", "No DEX pair was found for this contract.");
      }
      else { bindCanonicalRef(run, d.chain, d.address); run.status = "done"; run.result = d; run.pct = 100; emit(); onComplete?.(run); }
    } catch (e) {
      if (!cancelled) {
        run.status = "error";
        run.error = String(e);
        emit();
        void failedReceipt(run, "collection_failed", run.error);
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
  const key = runKey("investigation", priv, ref);
  const existing = runs.get(key);
  if (existing && existing.status === "running") return existing;
  if (existing) {
    aborts.get(key)?.();
    aborts.delete(key);
  }

  const creditKey = crypto.randomUUID();
  const run: ScanRun = { id: `inv:${ref}:${creditKey}`, kind: "investigation", ref, input: rawInput, label: trunc(rawInput.replace(/^[@$]/, "")), priv, steps: [], pct: 0, status: "running", startedAt: Date.now(), intent: opts?.intent, creditKey, chargedCredits: 0 };
  runs.set(key, run);
  emit();

  let cancelled = false;
  aborts.set(key, () => { cancelled = true; });
  void (async () => {
    try {
      if (!(await reserveCredit(run, input.ref))) return;
      if (cancelled) {
        void failedReceipt(run, "cancelled", "Scan cancelled.");
        return;
      }
      let count = 0;
      const abort = streamInvestigation(input, {
        onStep: (s) => { if (cancelled) return; count += 1; run.steps = [...run.steps, s]; run.pct = Math.min(94, count * 7); emit(); },
        onHop: (sub) => { if (cancelled) return; run.hop = sub; emit(); },
        onDone: (inv) => { if (cancelled) return; bindCanonicalRef(run, inv.token?.chain, inv.token?.address); run.status = "done"; run.result = inv; run.pct = 100; aborts.delete(key); emit(); onComplete?.(run); },
        onError: (error) => {
          if (cancelled) return;
          run.status = "error";
          run.error = error;
          aborts.delete(key);
          emit();
          void failedReceipt(run, "collection_failed", error);
        },
      }, { forceTokenAudit: opts?.force, intent: opts?.intent, creditKey: run.creditKey });
      if (run.status === "running") aborts.set(key, () => { cancelled = true; abort(); });
    } catch (error) {
      if (!cancelled) {
        run.status = "error";
        run.error = error instanceof Error ? error.message : String(error);
        aborts.delete(key);
        emit();
        void failedReceipt(run, "collection_failed", run.error);
      }
    }
  })();
  return run;
}
