// ARGUS mark — the all-seeing eye of Argus Panoptes, rendered as a halftone field
// of dots forming an almond eye, dense on the left and fading right, with a solid
// blue iris. Generated deterministically so it scales cleanly at any size.

interface Dot { x: number; y: number; r: number; o: number }

// Builds the dot field for an eye spanning x∈[x0,x1], centered at cy, amplitude A.
function eyeDots(x0: number, x1: number, cy: number, A: number, step: number, irisFrac = 0.66): { dots: Dot[]; irisX: number; irisY: number; irisR: number } {
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
      if (Math.hypot(x - irisX, y - irisY) < irisR * 2.1) continue; // clear space around the iris
      if (r < step * 0.12) continue; // drop the faint far-right dots → sparse outline
      dots.push({ x, y, r, o: 0.34 + 0.62 * (1 - tx) });
    }
  }
  return { dots, irisX, irisY, irisR };
}

export function ArgusMark({ size = 28, live = false }: { size?: number; live?: boolean }) {
  const { dots, irisX, irisY, irisR } = eyeDots(12, 88, 50, 23, 4.6);
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden>
      <g fill="var(--color-signal)">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
        ))}
      </g>
      {live && (
        <circle
          cx={irisX}
          cy={irisY}
          r={irisR}
          fill="none"
          stroke="var(--color-signal)"
          strokeWidth="1.4"
          opacity="0.5"
          className="origin-center motion-safe:animate-[pulse-ring_2.2s_ease-out_infinite] motion-reduce:opacity-0"
        />
      )}
      <circle cx={irisX} cy={irisY} r={irisR} fill="var(--color-signal)" />
      <circle cx={irisX - irisR * 0.32} cy={irisY - irisR * 0.32} r={irisR * 0.3} fill="#ffffff" opacity="0.75" />
    </svg>
  );
}

// A faint, oversized dotted eye for the hero canvas — the hundred eyes at rest.
export function HeroBackdrop({ className = "" }: { className?: string }) {
  const { dots, irisX, irisY, irisR } = eyeDots(120, 1080, 300, 200, 30);
  return (
    <svg className={className} viewBox="0 0 1200 600" fill="none" preserveAspectRatio="xMidYMid meet" aria-hidden>
      <g fill="var(--color-signal)" opacity="0.16">
        {dots.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r={d.r} opacity={d.o} />
        ))}
      </g>
      <circle cx={irisX} cy={irisY} r={irisR} fill="var(--color-signal)" opacity="0.2" />
    </svg>
  );
}
