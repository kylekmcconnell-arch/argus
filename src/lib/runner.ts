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
import {
  tokenFromBio,
  tokenFromPromotions,
  tokenFromVerifiedProjectToken,
  type TokenCandidate,
} from "./projectTokenLeg";
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
}

type Listener = () => void;

const runs = new Map<string, BgRun>();
const aborts = new Map<string, () => void>();
const listeners = new Set<Listener>();
let onComplete: ((d: Dossier, priv: boolean) => void | Promise<void>) | null = null;

const norm = (h: string) => h.trim().toLowerCase().replace(/^@/, "");
function emit() { for (const l of listeners) l(); }

// App registers the data-side completion handler (log + persist + graph + cache).
// It must NOT change the view — a backgrounded audit finishing should not yank
// the user out of whatever they're doing. Gets the run's private flag so it can
// skip everything that would leave a trace.
export function setOnComplete(fn: (d: Dossier, priv: boolean) => void | Promise<void>) { onComplete = fn; }

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

// Start (or re-attach to) a background person audit. Idempotent per handle: if one
// is already streaming, the existing run is returned so we never double-stream.
export function startPersonAudit(
  handle: string,
  priv = false,
  intent: ResearchIntent = "investment_due_diligence",
): BgRun {
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
    priv,
    intent,
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
  let threatCandidate: TokenCandidate | null = null;
  let threatSettled = false;
  let threatNote = "";
  let threatFailure = "";
  const pushStep = (s: TraceStep) => {
    run.steps = [...run.steps, s];
    run.pct = Math.min(92, Math.max(run.pct, run.steps.length * 11));
    emit();
  };
  const startThreatLeg = (cand: TokenCandidate) => {
    if (threatLeg) return;
    threatCandidate = cand;
    threatNote = `Token attributed via ${cand.source}.`;
    pushStep({ phase: "ARGUS · Threat", label: "Token threat leg", detail: `Full scan includes the token threat pipeline - scanning ${cand.address.slice(0, 10)}… (${cand.via}) in parallel.`, source: "argus", tone: "neutral" });
    threatLeg = threatScan({ kind: "token", ref: cand.address, via: cand.via }, pushStep)
      .catch((error: unknown) => {
        threatFailure = error instanceof Error ? error.message : String(error);
        pushStep({
          phase: "ARGUS · Threat",
          label: "Token safety leg failed",
          detail: threatFailure || "The token-safety scanner returned an unknown error.",
          source: "argus",
          tone: "warn",
        });
        return null;
      })
      .then((r) => { threatSettled = true; return r; });
  };

  const finalize = async (d: Dossier) => {
    // Fallback attribution when the server never announced a token: the
    // verified project token, then the contract in the subject's own bio, then
    // a claimed promotion. Nothing else. A CoinGecko name match used to be the
    // last resort here; it is gone on purpose (#321): anyone can mint a token
    // in anyone's name, so a same-name listing is never evidence that the
    // token is the subject's, and the server rightly refused to save it.
    if (!threatLeg) {
      const cand = tokenFromVerifiedProjectToken(d.projectToken)
        ?? tokenFromBio(d.bio)
        ?? tokenFromPromotions(d.evidence?.promotions);
      if (cand) startThreatLeg(cand);
      else {
        threatNote = "No project token could be attributed to this subject (no verified project token, no contract in the bio, no claimed promotion). ARGUS does not attach tokens by name match, so the token threat leg was skipped.";
      }
    }
    if (threatLeg) {
      if (!threatSettled) pushStep({ phase: "ARGUS · Threat", label: "Finalizing token leg", detail: "Person collection is done - finishing the token threat scan…", source: "argus", tone: "neutral" });
      // Bounded wait: the threat scanner's own fetches are all timeout-capped,
      // so this only guards against a pathological hang - never block a
      // finished person audit indefinitely on the token leg.
      let scan = await Promise.race([
        threatLeg,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 120_000)),
      ]);
      // Newly launched tokens can reach the server's identity-bound search a
      // moment before DexScreener's by-token endpoint reaches the browser. The
      // first lookup then caches an empty result. Once the completed dossier
      // confirms the exact token, retry that resolution once without the null
      // cache. A completed token assessment is never rerun here.
      if (!scan) {
        const retryCandidate = tokenFromVerifiedProjectToken(d.projectToken) ?? threatCandidate;
        if (retryCandidate) {
          const projectPairAddress = d.projectToken?.pairAddress?.trim();
          const projectPairChain = d.projectToken?.chain?.trim().toLowerCase();
          const retryInput = projectPairAddress && projectPairChain
            ? {
                kind: "token" as const,
                ref: `https://dexscreener.com/${encodeURIComponent(projectPairChain)}/${encodeURIComponent(projectPairAddress)}`,
                via: "dexscreener" as const,
              }
            : { kind: "token" as const, ref: retryCandidate.address, via: retryCandidate.via };
          pushStep({
            phase: "ARGUS · Threat",
            label: "Retrying the token safety check",
            detail: "The first market lookup returned before the new token was fully indexed. Retrying the verified contract once.",
            source: "argus",
            tone: "neutral",
          });
          scan = await threatScan(
            retryInput,
            pushStep,
            { force: true },
          ).catch((error: unknown) => {
            threatFailure = error instanceof Error ? error.message : String(error);
            return null;
          });
        }
      }
      d.threat = scan;
      threatNote = scan
        ? `${threatNote} $${scan.symbol}: ${scan.call.verdict} · ${scan.call.risk}/100 risk.`
        : `${threatNote} The token scan did not complete${threatFailure ? `: ${threatFailure}` : " (no DEX pair or no completed scanner result)"} - it can be rerun from the Threat tab.`;
    }
    if (threatNote) d.threatNote = threatNote;
    if (runs.get(key) !== run) return; // cancelled / purged while the token leg ran

    // A scan is not complete until its final, token-enriched payload is durable.
    // Previously we emitted `done` first and only then queued the combined save.
    // Opening the report, refreshing, or receiving a deployment in that window
    // abandoned the save and left the active immutable version with an N/A token
    // score even though the token leg had run. Keep the run live while the owner
    // persists it, and surface a real failure rather than publishing the earlier
    // project-only snapshot as a completed report.
    try {
      await onComplete?.(d, !!run.priv);
    } catch (error) {
      run.status = "error";
      run.error = error instanceof Error
        ? error.message
        : "The combined project and token report could not be saved.";
      aborts.delete(key);
      emit();
      return;
    }

    if (runs.get(key) !== run) return;
    run.status = "done";
    run.dossier = d;
    run.pct = 100;
    aborts.delete(key);
    emit();
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
  }, intent);
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
