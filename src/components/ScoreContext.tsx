import { useState } from "react";
import { getLog, type AuditKind } from "../lib/auditlog";
import type { Dossier } from "../data/dossier";

/**
 * Org-wide "since last scan" deltas, stamped into the immutable payload at
 * finalize. Complements the local-history sparkline: this is what changed
 * between the two persisted versions, visible to every teammate who opens
 * the report, not just the browser that ran the scans.
 */
export function OutcomeDeltaStrip({
  prior,
  score,
  verdict,
  coverage,
}: {
  prior: NonNullable<Dossier["priorOutcome"]>;
  score: number | null;
  verdict: string | null;
  coverage?: string | null;
}) {
  const scoreDelta = prior.score != null && score != null ? score - prior.score : null;
  const when = prior.capturedAt
    ? new Date(prior.capturedAt).toLocaleDateString(undefined, { dateStyle: "medium" })
    : null;
  const verdictChanged = Boolean(prior.verdict && verdict && prior.verdict !== verdict);
  const coverageChanged = Boolean(prior.completeness && coverage && prior.completeness !== coverage);
  if (scoreDelta == null && !verdictChanged && !coverageChanged) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-faint" aria-label="Changes since the previous scan">
      <span className="eyebrow">since v{prior.version}{when ? ` · ${when}` : ""}</span>
      {scoreDelta != null && (
        <span className={`chip tabular normal-case tracking-normal ${scoreDelta > 0 ? "tint-pass" : scoreDelta < 0 ? "tint-caution" : ""}`}>
          {scoreDelta === 0
            ? `score steady at ${score}`
            : `score ${prior.score} → ${score} (${scoreDelta > 0 ? "+" : ""}${scoreDelta})`}
        </span>
      )}
      {verdictChanged && <span className="chip normal-case tracking-normal">verdict {prior.verdict} → {verdict}</span>}
      {coverageChanged && <span className="chip normal-case tracking-normal">coverage {prior.completeness} → {coverage}</span>}
    </div>
  );
}

/**
 * The score's memory and context, from this browser's own audit log: a
 * history sparkline, the delta vs the previous scan, and where the score sits
 * among the library's other subjects of the same kind. Renders nothing until
 * there is real local history to show, and never claims a global percentile.
 */
export function ScoreContextStrip({
  subjectRef,
  score,
  peerKind = "person",
  align = "center",
}: {
  subjectRef?: string;
  score: number | null;
  peerKind?: AuditKind;
  align?: "center" | "start";
}) {
  const norm = (value?: string) => (value ?? "").trim().toLowerCase().replace(/^@/, "");
  const key = norm(subjectRef);
  if (!key || score == null) return null;
  const entries = getLog().filter((entry) => typeof entry.score === "number");
  const mine = entries
    .filter((entry) => norm(entry.ref ?? entry.query) === key)
    .sort((a, b) => a.ts - b.ts);
  const history = mine.map((entry) => entry.score as number).slice(-10);
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const latestByPeer = new Map<string, number>();
  for (const entry of entries.filter((entry) => entry.kind === peerKind).sort((a, b) => a.ts - b.ts)) {
    latestByPeer.set(norm(entry.ref ?? entry.query), entry.score as number);
  }
  latestByPeer.delete(key);
  const peers = [...latestByPeer.values()];
  const beaten = peers.filter((peerScore) => peerScore < score).length;
  const peerNoun = peerKind === "token" ? "tokens" : "subjects";
  const delta = prev == null ? null : score - prev;
  if (history.length < 2 && peers.length < 3) return null;
  const w = 96, h = 22, pad = 2;
  const lo = Math.min(...history), hi = Math.max(...history);
  const span = Math.max(1, hi - lo);
  const points = history.map((value, index) => ({
    x: pad + (index * (w - pad * 2)) / Math.max(1, history.length - 1),
    y: h - pad - ((value - lo) * (h - pad * 2)) / span,
  }));
  const last = points[points.length - 1];
  return (
    <div className="mt-2 text-[10.5px] leading-relaxed text-ink-faint">
      {history.length >= 2 && (
        <div className={`flex items-center gap-1.5 ${align === "center" ? "justify-center max-sm:justify-start" : "justify-start"}`}>
          <svg width={w} height={h} aria-label={`Score history across ${history.length} scans: ${history.join(", ")}`} className="overflow-visible text-signal-lift">
            <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="1.2" />
            <circle cx={last.x} cy={last.y} r="2" fill="currentColor" />
          </svg>
          {delta != null && (
            <span className="text-ink-dim">{delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "steady"} vs last scan</span>
          )}
        </div>
      )}
      {peers.length >= 3 && (
        <div className="mt-0.5">higher than {beaten} of {peers.length} {peerNoun} in your library</div>
      )}
    </div>
  );
}

/**
 * Provider operations that ended in failure during the scan, said plainly on
 * screen. Recovered physical retries stay visible in the cost ledger but do
 * not produce this missing-evidence warning.
 */
export function ProviderFailureNotice({ failures }: {
  failures?: Array<{ provider: string; op: string; failed: number; meta?: string }>;
}) {
  if (!failures?.length) return null;
  const total = failures.reduce((sum, line) => sum + line.failed, 0);
  return (
    <div className="finding tint-avoid mt-3 px-4 py-3" role="alert">
      <p className="text-[12.5px] font-medium text-ink">
        {total} provider call{total === 1 ? "" : "s"} ended in failure during this scan.
      </p>
      <p className="mono mt-1 text-[10.5px] leading-relaxed text-ink-dim">
        {failures.slice(0, 5).map((line) => `${line.provider} · ${line.op}${line.meta ? ` · ${line.meta.slice(0, 70)}` : ""}`).join("  |  ")}
        {failures.length > 5 ? `  |  +${failures.length - 5} more` : ""}
      </p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Affected evidence lanes may be incomplete. Fix the provider and rescan to fill the gap.
      </p>
    </div>
  );
}

/**
 * One click, one paste: the report as three plain lines plus a link. When a
 * share link can be minted it is used (viewable without sign-in, and the
 * pasted link unfurls into the report card); otherwise the app URL stands in.
 */
export function CopyTldrButton({ base, mint, className = "mt-2" }: { base: string; mint?: () => Promise<string | null>; className?: string }) {
  const [state, setState] = useState<"idle" | "working" | "copied">("idle");
  return (
    <button
      type="button"
      disabled={state === "working"}
      onClick={() => {
        if (state === "working") return;
        setState("working");
        void (async () => {
          const link = (await mint?.().catch(() => null))
            ?? (typeof window !== "undefined" ? window.location.href : "");
          await navigator.clipboard?.writeText([base, link].filter(Boolean).join("\n"));
          setState("copied");
          setTimeout(() => setState("idle"), 1600);
        })().catch(() => setState("idle"));
      }}
      className={`mono ${className} rounded border border-line px-2 py-1 text-[10px] uppercase tracking-wider text-ink-dim transition hover:text-ink`}
      title="Copies a three-line verdict summary plus a 30-day share link anyone can open"
    >
      {state === "copied" ? "copied" : state === "working" ? "linking" : "copy tldr"}
    </button>
  );
}
