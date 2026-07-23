import { useState } from "react";
import { getLog, type AuditKind } from "../lib/auditlog";

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
