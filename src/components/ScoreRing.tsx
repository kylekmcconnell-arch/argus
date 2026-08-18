import { verdictMeta } from "../lib/verdict";

/* THE score ring — the one idiom for a 0-100 score with its verdict color
   (DESIGN.md: one concept, one idiom). Previously duplicated privately in
   Report.tsx and TokenReport.tsx. `bands` draws the published rubric zones
   (FAIL 0-39, CAUTION 40-69, PASS 70-100) on the track with 3px gaps at the
   40 and 70 thresholds so the arc tip visibly lands inside its zone. */
export function ScoreRing({ score, verdict, size = 86, bands = false, color }: {
  score: number | null;
  verdict: string;
  size?: number;
  bands?: boolean;
  /** Overrides the verdict color (e.g. a presentation-gated tint). */
  color?: string;
}) {
  const m = verdictMeta(verdict);
  const ringColor = color ?? m.color;
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const zone = (from: number, to: number) => ({
    strokeDasharray: `${Math.max(0, ((to - from) / 100) * c - 3)} ${c}`,
    strokeDashoffset: -((from / 100) * c) - 1.5,
  });
  const numberSize = size >= 120 ? "text-[32px]" : size >= 80 ? "text-[22px]" : "text-[18px]";
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {bands ? (
          <>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-fail)" strokeOpacity="0.22" strokeWidth="4" style={zone(0, 40)} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-caution)" strokeOpacity="0.22" strokeWidth="4" style={zone(40, 70)} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-pass)" strokeOpacity="0.25" strokeWidth="4" style={zone(70, 100)} />
          </>
        ) : (
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        )}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`mono ${numberSize} font-semibold leading-none tabular`} style={{ color: ringColor }}>
          {score == null ? "N/A" : score}
        </span>
        <span className="mono text-[10px] text-ink-faint">/ 100</span>
      </div>
    </div>
  );
}
