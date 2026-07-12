// A compact row of the project's official links — website + socials — for the top
// of a report. Shared across the token, investigation, and site reports so the
// same links show in the same place everywhere. Classifies each URL to a clean
// platform label, dedupes (one X, one Telegram, one per website host), and orders
// website-first.
type RawLink = { label?: string; url: string };

const RULES: [RegExp, string, number][] = [
  [/(?:x\.com|twitter\.com)\//i, "X", 1],
  [/t\.me|telegram/i, "Telegram", 2],
  [/discord(?:\.gg|app\.com|\.com)/i, "Discord", 3],
  [/github\.com/i, "GitHub", 4],
  [/(?:docs\.|gitbook|readthedocs)/i, "Docs", 5],
  [/medium\.com|mirror\.xyz|substack\.com/i, "Blog", 6],
  [/youtube\.com|youtu\.be/i, "YouTube", 7],
  [/reddit\.com/i, "Reddit", 8],
  [/linkedin\.com/i, "LinkedIn", 9],
  [/warpcast\.com|farcaster/i, "Farcaster", 10],
];

function classify(url: string): { label: string; pri: number } {
  for (const [re, name, pri] of RULES) if (re.test(url)) return { label: name, pri };
  try { return { label: new URL(url).hostname.replace(/^www\./, ""), pri: 0 }; } catch { return { label: "Link", pri: 11 }; }
}

export function ProjectLinks({
  links,
  website,
  xHandle,
  className,
}: {
  links?: RawLink[];
  website?: string | null;
  xHandle?: string | null;
  className?: string;
}) {
  const urls: string[] = [];
  const push = (u?: string | null) => { if (u) { const full = /^https?:\/\//i.test(u) ? u : `https://${u}`; if (/^https?:\/\/\S+$/.test(full)) urls.push(full); } };
  push(website);
  if (xHandle) push(`https://x.com/${xHandle.replace(/^@/, "")}`);
  for (const l of links ?? []) push(l.url);

  // Dedupe by label — one chip per platform (and one per distinct website host).
  const seen = new Set<string>();
  const items = urls
    .map((url) => ({ url, ...classify(url) }))
    .filter((it) => { const k = it.label.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.pri - b.pri);

  if (!items.length) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>
      {items.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="chip normal-case tracking-normal transition hover:text-ink"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}
