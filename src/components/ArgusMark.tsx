// ARGUS mark — the all-seeing eye of Argus Panoptes, rendered as a halftone field
// of dots forming an almond eye, dense on the left and fading right, with a solid
// cobalt iris. Generated deterministically so it scales cleanly at any size.

interface Dot { x: number; y: number; r: number; o: number }

export type ArgusEyeMotion = "idle" | "searching" | "focused" | "settling";

// Builds the dot field for an eye spanning x∈[x0,x1], centered at cy, amplitude A.
function eyeDots(
  x0: number,
  x1: number,
  cy: number,
  A: number,
  step: number,
  irisFrac = 0.66,
  clearIris = true,
): { dots: Dot[]; irisX: number; irisY: number; irisR: number } {
  const W = x1 - x0;
  const h = (x: number) => A * Math.sin((Math.PI * (x - x0)) / W); // 0 at the corners
  const irisX = x0 + W * irisFrac;
  const irisY = cy;
  const irisR = A * 0.3;
  const dots: Dot[] = [];
  for (let x = x0; x <= x1 + 0.001; x += step) {
    const hh = h(x);
    if (hh <= step * 0.4) continue;
    const tx = (x - x0) / W; // 0 left … 1 right
    for (let y = cy - hh; y <= cy + hh + 0.001; y += step) {
      const edge = 1 - Math.abs(y - cy) / hh; // 1 at midline, 0 at the lid
      const nearLid = 1 - edge;
      const r = (step * 0.46) * (1 - tx * 0.82) * (0.55 + 0.8 * nearLid);
      if (clearIris && Math.hypot(x - irisX, y - irisY) < irisR * 2.1) continue; // clear space around a static iris
      if (r < step * 0.12) continue; // drop the faint far-right dots → sparse outline
      dots.push({ x, y, r, o: 0.34 + 0.62 * (1 - tx) });
    }
  }
  return { dots, irisX, irisY, irisR };
}

export function ArgusMark({
  size = 28,
  live = false,
  motion = live ? "searching" : "idle",
  eventKey,
}: {
  size?: number;
  live?: boolean;
  motion?: ArgusEyeMotion;
  eventKey?: string;
}) {
  // The live eye keeps a complete dotted field behind the moving iris. Static
  // brand marks retain the tailored cutout around their fixed iris position.
  const { dots, irisX, irisY, irisR } = eyeDots(12, 88, 50, 23, 4.6, 0.66, !live);
  const eyeState: ArgusEyeMotion = live ? motion : "idle";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className="argus-eye-mark"
      data-argus-eye-state={eyeState}
    >
      <g fill="var(--color-ink-faint)" className={live ? "argus-eye-field argus-eye-field--live" : "argus-eye-field"}>
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
        ))}
      </g>
      <g className={`argus-eye-iris argus-eye-iris--${eyeState}`}>
        {live && (
          <circle
            cx={irisX}
            cy={irisY}
            r={irisR * 1.28}
            fill="none"
            stroke="var(--color-signal)"
            strokeWidth="1.1"
            className="argus-eye-live-ring"
          />
        )}
        {live && eventKey && (
          <circle
            key={eventKey}
            cx={irisX}
            cy={irisY}
            r={irisR * 1.2}
            fill="none"
            stroke="var(--color-signal-lift)"
            strokeWidth="1.3"
            className="argus-eye-evidence-pulse"
          />
        )}
        <circle cx={irisX} cy={irisY} r={irisR} fill="var(--color-signal)" />
        {live ? (
          <>
            <circle cx={irisX} cy={irisY} r={irisR * 0.42} fill="var(--color-eye-pupil)" opacity="0.9" />
            <circle
              cx={irisX - irisR * 0.34}
              cy={irisY - irisR * 0.36}
              r={irisR * 0.27}
              fill="var(--color-on-signal)"
              opacity="0.88"
            />
          </>
        ) : (
          <circle
            cx={irisX - irisR * 0.32}
            cy={irisY - irisR * 0.32}
            r={irisR * 0.3}
            fill="var(--color-on-signal)"
            opacity="0.75"
          />
        )}
      </g>
    </svg>
  );
}

// A faint, oversized dotted eye for the hero canvas — the hundred eyes at rest.
export function HeroBackdrop({ className = "" }: { className?: string }) {
  const { dots } = eyeDots(120, 1080, 300, 200, 30);
  return (
    <svg className={className} viewBox="0 0 1200 600" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g fill="var(--color-ink-faint)" opacity="0.16">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
        ))}
      </g>
    </svg>
  );
}
