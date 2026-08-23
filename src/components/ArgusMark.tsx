// ARGUS mark — the all-seeing eye of Argus Panoptes, rendered as a halftone field
// of dots forming an almond eye, dense on the left and fading right, with a solid
// cobalt iris. Generated deterministically so it scales cleanly at any size.

interface Dot { x: number; y: number; r: number; o: number }

export type ArgusEyeMotion = "idle" | "searching" | "focused" | "settling";
export type ArgusMarkVariant = "eye" | "seal";

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

// The instrument seal is a compact, rounded field of calibrated points. Its
// eye aperture is intentionally quiet so the brand iris remains the focal point.
function sealDots(): Dot[] {
  const dots: Dot[] = [];
  const step = 8;
  for (let x = 14; x <= 86; x += step) {
    for (let y = 14; y <= 86; y += step) {
      const cornerX = Math.max(0, 22 - Math.min(x, 100 - x));
      const cornerY = Math.max(0, 22 - Math.min(y, 100 - y));
      if (Math.hypot(cornerX, cornerY) > 11) continue;

      const dx = Math.abs(x - 50) / 35;
      const aperture = 16 * Math.max(0, 1 - dx ** 1.7);
      if (x >= 18 && x <= 82 && Math.abs(y - 50) <= aperture) continue;

      const drift = ((x * 17 + y * 11) % 9) / 9;
      const r = 2.25 + (1 - (x - 14) / 72) * 0.75 + drift * 0.32;
      dots.push({ x, y, r, o: 0.5 + (1 - (x - 14) / 72) * 0.26 });
    }
  }
  return dots;
}

export function ArgusMark({
  size = 28,
  live = false,
  motion = live ? "searching" : "idle",
  eventKey,
  tone = "neutral",
  variant = "eye",
  pupilMotion = "none",
}: {
  size?: number;
  live?: boolean;
  motion?: ArgusEyeMotion;
  eventKey?: string;
  tone?: "neutral" | "brand";
  variant?: ArgusMarkVariant;
  pupilMotion?: "none" | "observe";
}) {
  if (variant === "seal") {
    const dots = sealDots();
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
        focusable="false"
        className="argus-eye-mark argus-eye-mark--seal"
        data-argus-eye-state="idle"
        data-argus-eye-tone={tone}
        data-argus-eye-variant="seal"
      >
        <g fill="var(--color-ink-faint)" className="argus-eye-field argus-eye-seal-field">
          {dots.map((d, i) => (
            <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
          ))}
        </g>
        <path
          d="M17 50C28 35 40 29 53 29C66 29 77 37 84 50C76 63 65 71 52 71C39 71 28 64 17 50Z"
          fill="var(--color-sidebar)"
          className="argus-eye-seal-aperture"
        />
        <circle cx="54" cy="50" r="13.5" fill={tone === "brand" ? "var(--color-brand)" : "var(--color-signal)"} />
        <g className={`argus-eye-pupil${pupilMotion === "observe" ? " argus-eye-pupil--observe" : ""}`}>
          <circle cx="54" cy="50" r="6.25" fill="var(--color-eye-pupil)" />
          <circle cx="57.6" cy="46.4" r="2.3" fill="var(--color-on-brand)" opacity="0.96" />
        </g>
      </svg>
    );
  }

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
      data-argus-eye-tone={tone}
      data-argus-eye-variant="eye"
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
        <circle cx={irisX} cy={irisY} r={irisR} fill={tone === "brand" ? "var(--color-brand)" : "var(--color-signal)"} />
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
