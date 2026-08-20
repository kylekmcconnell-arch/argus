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
import { threatScan } from "../threat/scan";
import type { ThreatScan } from "../threat/types";
import { tokenFromBio, tokenFromPromotions, type TokenCandidate } from "./projectTokenLeg";
import type { TraceStep } from "../data/evidence";
import type { Dossier } from "../data/dossier";
import type { ResearchIntent } from "./researchDirector";

export interface BgRun {
  handle: string;   // display handle, with leading @
  key: string;      // normalized (lowercase, no @) — the map key + cache key
  steps: TraceStep[];
  pct: number;
  status: "running" | "done" | "error";
  error?: string;
  dossier?: Dossier;
  startedAt: number;
  priv?: boolean;   // private/incognito: never persisted, logged, graphed, or shown in the sidebar
  intent?: ResearchIntent;
  fresh?: boolean;
  /** Present only on a non-destructive start attempt that cannot reuse this run. */
  startConflict?: "full-rescan-waits-for-standard";
}

type Listener = () => void;

const runs = new Map<string, BgRun>();
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((d: Dossier, priv: boolean) => void) | null = null;

const norm = (h: string) => h.trim().toLowerCase().replace(/^@/, "");
// The browser threat pipeline currently has dedicated Solana handling and EVM
// safety coverage for these chain ids. Never reinterpret an unknown chain as
// EVM merely because it is not Solana (Sui, TON and Tron are counterexamples).
const THREAT_EVM_CHAINS = new Set([
  "ethereum",
  "bsc",
  "base",
  "polygon",
  "arbitrum",
  "optimism",
  "avalanche",
  "fantom",
  "cronos",
  "zksync",
  "linea",
  "scroll",
  "robinhood",
]);

function frozenProjectTokenCandidate(d: Dossier): TokenCandidate | null {
  const token = d.projectToken;
  if (token?.verified !== true || !token.address) return null;
  const chain = token.chain.trim().toLowerCase();
  const via: TokenCandidate["via"] | null = chain === "solana"
    ? "solana"
    : THREAT_EVM_CHAINS.has(chain)
      ? "evm"
      : null;
  return via
    ? {
        address: token.address,
        via,
        source: `the server-frozen canonical project token (${token.verification.replace(/_/g, " ")})`,
      }
    : null;
}
function emit() { for (const l of listeners) l(); }

// App registers the data-side completion handler (log + persist + graph + cache).
// It must NOT change the view — a backgrounded audit finishing should not yank
// the user out of whatever they're doing. Gets the run's private flag so it can
// skip everything that would leave a trace.
export function setOnComplete(fn: (d: Dossier, priv: boolean) => void) { onComplete = fn; }

export function subscribeRuns(cb: Listener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getRun(handle: string): BgRun | undefined { return runs.get(norm(handle)); }

// Runs still streaming, newest first — what the sidebar shows as "generating…".
// Private runs are excluded: a private audit leaves no sidebar trace.
export function activeRuns(): BgRun[] {
  return [...runs.values()].filter((r) => r.status === "running" && !r.priv).sort((a, b) => b.startedAt - a.startedAt);
}

// Start (or re-attach to) a background person audit. Reuse is mode-compatible:
// a running full rescan may satisfy a standard viewer, but a standard run cannot
// satisfy a requested full rescan. That mismatch returns an explicit conflict
// and never cancels or starts a second paid stream.
export function startPersonAudit(
  handle: string,
  priv = false,
  intent: ResearchIntent = "investment_due_diligence",
  options?: { force?: boolean },
): BgRun {
  const key = norm(handle);
  const existing = runs.get(key);
  if (existing && existing.status === "running") {
    // A fresh scan is not equivalent to the standard scan already spending.
    // Return an explicit, non-persisted conflict instead of silently attaching,
    // cancelling useful work, or launching a second paid stream.
    if (options?.force === true && existing.fresh !== true) {
      return { ...existing, startConflict: "full-rescan-waits-for-standard" };
    }
    return existing;
  }

  const run: BgRun = {
    handle: handle.startsWith("@") ? handle : "@" + key,
    key,
    steps: [],
    pct: 0,
    status: "running",
    startedAt: Date.now(),
    priv,
    intent,
    fresh: options?.force === true,
  };
  runs.set(key, run);
  emit();

  // -- The token threat leg of the FULL scan --
  // A full person audit and the token threat scan are ONE product. The server
  // announces the subject's token mid-stream (a step carrying a machine-readable
  // `token` field) and the browser-side threat scanner runs IN PARALLEL with the
  // rest of the collection, streaming into the same console. The dossier is
  // finalized only once both legs land, so a full-scan report always carries its
  // token verdict. The standalone Threat tab remains the cheap, token-only tier.
  let threatLeg: Promise<ThreatScan | null> | null = null;
  let threatSettled = false;
  let threatNote = "";
  const pushStep = (s: TraceStep) => {
    run.steps = [...run.steps, s];
    run.pct = Math.min(92, Math.max(run.pct, run.steps.length * 11));
    emit();
  };
  const startThreatLeg = (cand: TokenCandidate) => {
    if (threatLeg) return;
    threatNote = `Token attributed via ${cand.source}.`;
    pushStep({ phase: "ARGUS · Threat", label: "Token threat leg", detail: `Full scan includes the token threat pipeline - scanning ${cand.address.slice(0, 10)}… (${cand.via}) in parallel.`, source: "argus", tone: "neutral" });
    threatLeg = threatScan({ kind: "token", ref: cand.address, via: cand.via }, pushStep)
      .catch(() => null)
      .then((r) => { threatSettled = true; return r; });
  };

  const finalize = async (d: Dossier) => {
    // If the server did not announce a token mid-stream, hydrate only from the
    // frozen canonical token snapshot or from an explicit contract already
    // present in collected first-party/claimed evidence. Name, ticker and slug
    // discovery are never identity: a client-side CoinGecko lookup cannot bind
    // a same-name asset to the audited subject.
    if (!threatLeg) {
      const frozenProjectToken = d.projectToken?.verified === true
        ? d.projectToken
        : undefined;
      const frozen = frozenProjectTokenCandidate(d);
      // Once the server froze a canonical token, that receipt governs. An
      // unsupported frozen chain must not fall through to format guessing (a
      // Tron address, for example, can look like a Solana base58 mint).
      const cand = frozenProjectToken
        ? frozen
        : tokenFromBio(d.bio) ?? tokenFromPromotions(d.evidence?.promotions);
      if (cand) startThreatLeg(cand);
      else if (frozenProjectToken) {
        threatNote = `The server hard-bound ${frozenProjectToken.symbol} on ${frozenProjectToken.chain}, but the browser threat scanner does not support that chain - token threat leg skipped.`;
      } else {
        threatNote = "No project token was hard-bound by the server and no explicit contract was present in collected evidence - token threat leg skipped.";
      }
    }
    if (threatLeg) {
      if (!threatSettled) pushStep({ phase: "ARGUS · Threat", label: "Finalizing token leg", detail: "Person collection is done - finishing the token threat scan…", source: "argus", tone: "neutral" });
      // Bounded wait: the threat scanner's own fetches are all timeout-capped,
      // so this only guards against a pathological hang - never block a
      // finished person audit indefinitely on the token leg.
      const scan = await Promise.race([
        threatLeg,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
      ]);
      d.threat = scan;
      threatNote = scan
        ? `${threatNote} $${scan.symbol}: ${scan.call.verdict} · ${scan.call.risk}/100 risk.`
        : `${threatNote} The token scan did not complete (no DEX pair, or the scan errored) - it can be rerun from the Threat tab.`;
    }
    if (threatNote) d.threatNote = threatNote;
    if (runs.get(key) !== run) return; // cancelled / purged while the token leg ran
    run.status = "done";
    run.dossier = d;
    run.pct = 100;
    aborts.delete(key);
    emit();
    onComplete?.(d, !!run.priv); // log + persist + graph (skipped entirely when private)
  };

  const abort = streamAudit(key, priv, {
    onStep: (s) => {
      run.steps = [...run.steps, s];
      // Open-ended progress: ramp asymptotically toward ~92% by step count.
      run.pct = Math.min(92, run.steps.length * 11);
      emit();
      // The server's mid-stream token announcement - start the parallel leg.
      if (s.token) startThreatLeg(s.token);
    },
    onDone: (d) => { void finalize(d); },
    onError: (e) => {
      run.status = "error";
      run.error = e;
      aborts.delete(key);
      emit();
    },
  }, intent, undefined, { fresh: options?.force });
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
