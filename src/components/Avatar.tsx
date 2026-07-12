import { useState } from "react";

// Subject thumbnail: the real photo/logo, falling back to a letter if it's
// missing or fails to load (unavatar / favicon / dexscreener can 404).
export function Avatar({
  src,
  letter,
  size = 24,
  rounded = "rounded-md",
  letterClass = "text-[11px]",
}: {
  src: string | null;
  letter: string;
  size?: number;
  rounded?: string;
  letterClass?: string;
}) {
  const [failed, setFailed] = useState(!src);
  const dim = { width: size, height: size };
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={`shrink-0 border border-line bg-panel-2 object-cover ${rounded}`}
        style={dim}
      />
    );
  }
  return (
    <span className={`flex shrink-0 items-center justify-center border border-line bg-panel-2 text-signal-lift ${rounded} ${letterClass}`} style={dim}>
      {letter}
    </span>
  );
}
