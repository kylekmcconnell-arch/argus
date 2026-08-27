/* eslint-disable react-refresh/only-export-components -- motion math is exported for deterministic tests */
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { verdictMeta } from "../lib/verdict";
import { compositionRowColor, type CompositionRow } from "./ScoreComposition";

/* THE score ring — the one idiom for a 0-100 score with its verdict color
   (DESIGN.md: one concept, one idiom). Previously duplicated privately in
   Report.tsx and TokenReport.tsx. `bands` draws the published rubric zones
   (FAIL 0-39, CAUTION 40-69, PASS 70-100) on the track with 3px gaps at the
   40 and 70 thresholds so the arc tip visibly lands inside its zone.

   Hero rings (InvestigationDecisionCanvas) also accept real CompositionRow
   pieces and play one weighted entrance: quiet track, then each row.score
   as an arc segment out of 100, then the saved numeral, then the verdict
   word. Tiny list rings stay static. */

export const HERO_SCORE_RING_SIZE = 280;
export const SCORE_RING_MOTION_MIN_SIZE = 200;

export const SCORE_RING_ENTRANCE_MS = {
  track: 420,
  pieceBase: 360,
  piecePerPoint: 8,
  pieceMax: 720,
  pieceGap: 48,
  scoreArc: 760,
  numeral: 780,
  verdict: 420,
} as const;

export type ScoreRingCompositionRow = Pick<CompositionRow, "axis" | "score" | "weight" | "tone"> & {
  /** Human label announced while this segment is filling. */
  label?: string;
};

export type ScoreRingPiece = {
  axis: string;
  label: string;
  score: number;
  from: number;
  to: number;
  color: string;
};

export type ScoreRingPhase = "static" | "done" | "awaiting" | "track" | "pieces" | "numeral" | "verdict";

export type ScoreRingMotion = {
  phase: ScoreRingPhase;
  track: number;
  fills: number[];
  scoreArc: number;
  numeral: number | null;
  verdict: number;
};

export function easeOutQuint(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return 1 - (1 - x) ** 5;
}

export function scoreRingPieceDuration(score: number): number {
  return Math.min(
    SCORE_RING_ENTRANCE_MS.pieceMax,
    SCORE_RING_ENTRANCE_MS.pieceBase + Math.max(0, score) * SCORE_RING_ENTRANCE_MS.piecePerPoint,
  );
}

export function scoreRingCompositionPieces(rows: ScoreRingCompositionRow[]): ScoreRingPiece[] {
  const pieces: ScoreRingPiece[] = [];
  let cursor = 0;
  for (const row of rows) {
    const score = Math.max(0, row.score);
    if (score <= 0) continue;
    const remaining = 100 - cursor;
    if (remaining <= 0) break;
    const length = Math.min(score, remaining);
    pieces.push({
      axis: row.axis,
      label: row.label?.trim() || row.axis,
      score,
      from: cursor,
      to: cursor + length,
      color: compositionRowColor(row),
    });
    cursor += length;
  }
  return pieces;
}

export function scoreRingEntrancePlan(pieceScores: number[]): {
  trackEnd: number;
  pieces: { start: number; end: number }[];
  scoreArcStart: number;
  scoreArcEnd: number;
  numeralStart: number;
  numeralEnd: number;
  verdictStart: number;
  verdictEnd: number;
} {
  const trackEnd = SCORE_RING_ENTRANCE_MS.track;
  const pieces: { start: number; end: number }[] = [];
  let t = trackEnd;
  if (pieceScores.length > 0) {
    for (const score of pieceScores) {
      const start = t;
      const end = t + scoreRingPieceDuration(score);
      pieces.push({ start, end });
      t = end + SCORE_RING_ENTRANCE_MS.pieceGap;
    }
  } else {
    t += SCORE_RING_ENTRANCE_MS.scoreArc;
  }
  const numeralStart = t;
  const numeralEnd = t + SCORE_RING_ENTRANCE_MS.numeral;
  const verdictStart = numeralEnd;
  const verdictEnd = numeralEnd + SCORE_RING_ENTRANCE_MS.verdict;
  return {
    trackEnd,
    pieces,
    scoreArcStart: pieceScores.length > 0 ? 0 : trackEnd,
    scoreArcEnd: pieceScores.length > 0 ? 0 : trackEnd + SCORE_RING_ENTRANCE_MS.scoreArc,
    numeralStart,
    numeralEnd,
    verdictStart,
    verdictEnd,
  };
}

function unit(elapsed: number, start: number, end: number): number {
  if (end <= start) return elapsed >= start ? 1 : 0;
  return easeOutQuint((elapsed - start) / (end - start));
}

export function scoreRingMotionAt(
  elapsed: number,
  pieceScores: number[],
  savedScore: number | null,
): ScoreRingMotion {
  const plan = scoreRingEntrancePlan(pieceScores);
  if (!Number.isFinite(elapsed) || elapsed >= plan.verdictEnd) {
    return {
      phase: "done",
      track: 1,
      fills: pieceScores.map(() => 1),
      scoreArc: pieceScores.length > 0 ? 0 : 1,
      numeral: savedScore,
      verdict: 1,
    };
  }
  if (elapsed < 0) {
    return {
      phase: "awaiting",
      track: 0,
      fills: pieceScores.map(() => 0),
      scoreArc: 0,
      numeral: savedScore == null ? null : 0,
      verdict: 0,
    };
  }

  const track = unit(elapsed, 0, plan.trackEnd);
  const fills = plan.pieces.map((piece) => unit(elapsed, piece.start, piece.end));
  const scoreArc = pieceScores.length > 0 ? 0 : unit(elapsed, plan.scoreArcStart, plan.scoreArcEnd);
  const numeralT = unit(elapsed, plan.numeralStart, plan.numeralEnd);
  const numeral = savedScore == null ? null : Math.round(savedScore * numeralT);
  const verdict = unit(elapsed, plan.verdictStart, plan.verdictEnd);
  const phase: ScoreRingPhase = elapsed < plan.trackEnd
    ? "track"
    : elapsed < plan.numeralStart
      ? "pieces"
      : elapsed < plan.numeralEnd
        ? "numeral"
        : "verdict";

  return { phase, track, fills, scoreArc, numeral, verdict };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function numeralClass(size: number): string {
  if (size >= 260) return "text-[56px]";
  if (size >= 220) return "text-[48px]";
  if (size >= 160) return "text-[38px]";
  if (size >= 120) return "text-[32px]";
  if (size >= 80) return "text-[22px]";
  return "text-[18px]";
}

function segmentDash(circumference: number, from: number, to: number, gap: number): {
  strokeDasharray: string;
  strokeDashoffset: number;
} {
  const start = (from / 100) * circumference;
  const raw = ((to - from) / 100) * circumference;
  const inset = raw > gap * 2 ? gap : 0;
  return {
    strokeDasharray: `${Math.max(0, raw - inset)} ${circumference}`,
    strokeDashoffset: -(start + inset / 2),
  };
}

export function ScoreRing({
  score,
  verdict,
  size = 86,
  bands = false,
  color,
  composition,
  fallbackLabel = "Saved score",
  children,
}: {
  score: number | null;
  verdict: string;
  size?: number;
  bands?: boolean;
  /** Overrides the verdict color (e.g. a presentation-gated tint). */
  color?: string;
  /** Real ScoreComposition rows. Each row.score is an arc segment out of 100. */
  composition?: ScoreRingCompositionRow[] | undefined;
  /** What the single fallback arc represents when dimension rows were not saved. */
  fallbackLabel?: string;
  /** Hero lockup copy whose `.score-ring-verdict` waits for the numeral. */
  children?: ReactNode;
}) {
  const m = verdictMeta(verdict);
  const ringColor = color ?? m.color;
  const hero = size >= SCORE_RING_MOTION_MIN_SIZE;
  const stroke = hero ? 5.5 : 4;
  const r = size / 2 - (hero ? 8 : 6);
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const pieces = useMemo(
    () => (hero && composition && composition.length > 0 ? scoreRingCompositionPieces(composition) : []),
    [hero, composition],
  );
  const pieceScores = useMemo(() => pieces.map((piece) => piece.score), [pieces]);
  const pieceKey = pieces.map((piece) => `${piece.axis}:${piece.from}:${piece.to}`).join("|");
  const rootRef = useRef<HTMLDivElement>(null);
  const [elapsed, setElapsed] = useState(Number.POSITIVE_INFINITY);

  useLayoutEffect(() => {
    if (!hero) return;

    const snapToEnd = () => setElapsed(Number.POSITIVE_INFINITY);
    if (prefersReducedMotion() || typeof IntersectionObserver !== "function") {
      snapToEnd();
      return;
    }

    // Reset the entrance whenever the score composition changes; subsequent
    // updates happen only from observer/animation callbacks.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsed(-1);
    let raf = 0;
    let started = false;
    let startTs = 0;
    const total = scoreRingEntrancePlan(pieceScores).verdictEnd;

    const tick = (now: number) => {
      if (!startTs) startTs = now;
      const next = now - startTs;
      if (next >= total) {
        setElapsed(Number.POSITIVE_INFINITY);
        return;
      }
      setElapsed(next);
      raf = requestAnimationFrame(tick);
    };

    const io = new IntersectionObserver((entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return;
      started = true;
      io.disconnect();
      raf = requestAnimationFrame(tick);
    }, { threshold: 0.32 });

    if (rootRef.current) io.observe(rootRef.current);

    const media = typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    const onReduce = () => {
      if (media?.matches) {
        started = true;
        io.disconnect();
        cancelAnimationFrame(raf);
        snapToEnd();
      }
    };
    media?.addEventListener("change", onReduce);

    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
      media?.removeEventListener("change", onReduce);
    };
  }, [hero, pieceKey, pieceScores, score]);

  const motion = hero
    ? scoreRingMotionAt(elapsed, pieceScores, score)
    : {
        phase: "static" as const,
        track: 1,
        fills: [],
        scoreArc: 1,
        numeral: score,
        verdict: 1,
      };
  const zone = (from: number, to: number) => ({
    strokeDasharray: `${Math.max(0, ((to - from) / 100) * c - 3)} ${c}`,
    strokeDashoffset: -((from / 100) * c) - 1.5,
  });
  const numberSize = numeralClass(size);
  const showPieces = pieces.length > 0;
  const pieceGap = pieces.length > 1 ? 2.75 : 0;
  const numeralOpacity = motion.phase === "awaiting" || motion.phase === "track" || motion.phase === "pieces"
    ? 0
    : 1;
  const displayed = motion.numeral;
  const firstIncompletePiece = motion.fills.findIndex((fill) => fill < 1);
  const activePieceIndex = motion.phase === "pieces" && pieces.length > 0
    ? firstIncompletePiece >= 0 ? firstIncompletePiece : pieces.length - 1
    : -1;
  const activePiece = activePieceIndex >= 0 ? pieces[activePieceIndex] : null;
  const activePiecePoints = activePiece
    ? Math.round(activePiece.score * (motion.fills[activePieceIndex] ?? 0))
    : 0;

  const ring = (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <g style={{ opacity: motion.track }}>
          {bands ? (
            <>
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fail)" strokeOpacity="0.22" strokeWidth={stroke} style={zone(0, 40)} />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-caution)" strokeOpacity="0.22" strokeWidth={stroke} style={zone(40, 70)} />
              <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-pass)" strokeOpacity="0.25" strokeWidth={stroke} style={zone(70, 100)} />
            </>
          ) : (
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
          )}
        </g>
        {showPieces ? pieces.map((piece, index) => {
          const fill = motion.fills[index] ?? 1;
          const to = piece.from + (piece.to - piece.from) * fill;
          const dash = segmentDash(c, piece.from, to, pieceGap);
          return (
            <circle
              key={piece.axis}
              data-composition-piece={piece.axis}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={piece.color}
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeDasharray={dash.strokeDasharray}
              strokeDashoffset={dash.strokeDashoffset}
            />
          );
        }) : (
          <circle
            data-score-arc=""
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={ringColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct * motion.scoreArc)}
            style={hero ? undefined : { transition: "stroke-dashoffset 0.8s ease-out" }}
          />
        )}
      </svg>
      {hero && motion.phase === "track" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" data-score-ring-stage="composition">
          <span className="mono text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">{showPieces ? "Building score" : "Preparing score"}</span>
          <span className="mt-1 max-w-[13rem] text-[13px] font-medium leading-tight text-ink-dim">{showPieces ? "Score composition" : fallbackLabel}</span>
        </div>
      )}
      {hero && activePiece && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center" data-score-ring-active-label={activePiece.axis}>
          <span className="mono text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Adding dimension</span>
          <span className="mt-1 max-w-[14rem] text-[14px] font-semibold leading-tight text-ink">{activePiece.label}</span>
          <span className="mono mt-1 text-[10px] text-ink-dim">+{activePiecePoints} / {activePiece.score} pts</span>
        </div>
      )}
      {hero && !showPieces && motion.phase === "pieces" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center" data-score-ring-active-label="score">
          <span className="mono text-[9px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Filling score</span>
          <span className="mt-1 max-w-[13rem] text-[14px] font-semibold leading-tight text-ink">{fallbackLabel}</span>
          <span className="mono mt-1 text-[10px] text-ink-dim">{Math.round((score ?? 0) * motion.scoreArc)} / {score ?? 0} pts</span>
        </div>
      )}
      <div
        className="score-ring-numeral absolute inset-0 flex flex-col items-center justify-center"
        style={{ opacity: numeralOpacity }}
      >
        <span className={`mono ${numberSize} font-semibold leading-none tabular`} style={{ color: ringColor }}>
          {displayed == null ? "N/A" : displayed}
        </span>
        <span className={`mono text-ink-faint ${size >= 220 ? "mt-1 text-[12px]" : "text-[10px]"}`}>/ 100</span>
      </div>
    </div>
  );

  if (!hero && !children) return ring;

  return (
    <div
      ref={rootRef}
      className={children ? "relative flex shrink-0 flex-col items-center gap-2.5" : "relative shrink-0"}
      data-score-ring-entrance={motion.phase}
      style={children ? undefined : { width: size, height: size }}
    >
      {ring}
      {children}
    </div>
  );
}
