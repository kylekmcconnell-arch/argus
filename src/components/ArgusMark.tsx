// ARGUS mark — a peacock ocellus (feather eye-spot). When Hera slew the
// hundred-eyed giant Argus Panoptes, she set his eyes into the peacock's tail.
// A single feather-eye: the myth, the all-seeing watch, and a clean scalable mark.
export function ArgusMark({ size = 28, live = false }: { size?: number; live?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      {/* feather barbs (texture), faint */}
      <g stroke="var(--color-line-2)" strokeWidth="0.9" opacity="0.55" strokeLinecap="round">
        <path d="M16 13 L19.5 16.5" /><path d="M14.5 19 L18.5 21" /><path d="M14.5 26 L18.5 25" />
        <path d="M32 13 L28.5 16.5" /><path d="M33.5 19 L29.5 21" /><path d="M33.5 26 L29.5 25" />
      </g>
      {/* feather blade (teardrop) */}
      <path d="M24 3 C35 12 36 28 24 40 C12 28 13 12 24 3 Z" stroke="var(--color-ink)" strokeWidth="1.6" fill="none" />
      {/* quill */}
      <path d="M24 40 L24 45.5" stroke="var(--color-ink)" strokeWidth="1.5" strokeLinecap="round" />
      {/* ocellus halo */}
      <path d="M24 10 C32 16 33 27 24 35 C15 27 16 16 24 10 Z" fill="var(--color-accent-tint)" stroke="var(--color-signal)" strokeWidth="1.1" />
      {/* the eye */}
      <circle cx="24" cy="24" r="5.4" fill="#fff" stroke="var(--color-ink)" strokeWidth="1.1" />
      <circle cx="24" cy="24" r="3.9" fill="var(--color-signal)" />
      <circle cx="24" cy="24" r="1.7" fill="var(--color-ink)">
        {live && <animate attributeName="opacity" values="1;0.35;1" dur="1.6s" repeatCount="indefinite" />}
      </circle>
      <circle cx="22.5" cy="22.5" r="0.8" fill="#fff" />
    </svg>
  );
}

// A faint peacock tail fan for the hero background: many feather-eyes radiating,
// the place the hundred eyes came to rest.
export function HeroBackdrop({ className = "" }: { className?: string }) {
  const feathers = Array.from({ length: 11 }, (_, i) => {
    const a = -75 + i * 15; // spread the fan
    const L = 330 + (i % 2 === 0 ? 70 : 0) - Math.abs(a) * 0.7;
    return { a, L };
  });
  return (
    <svg className={className} viewBox="0 0 1200 560" fill="none" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <g stroke="var(--color-line-2)" fill="none" opacity="0.7">
        {feathers.map(({ a, L }, i) => (
          <g key={i} transform={`translate(600 575) rotate(${a})`}>
            <line x1="0" y1="0" x2="0" y2={-L} strokeWidth="1" />
            <ellipse cx="0" cy={-(L - 26)} rx="20" ry="44" strokeWidth="1" />
            <circle cx="0" cy={-(L - 26)} r="9" strokeWidth="1" />
            <circle cx="0" cy={-(L - 26)} r="3.5" fill="var(--color-line-2)" stroke="none" />
          </g>
        ))}
      </g>
    </svg>
  );
}
