import { useEffect, useState } from "react";

// Joint changelog: live commit history from GitHub, labeled by author so Kyle and
// Enigma can see what each other shipped. Attribution is by commit author, so it
// splits correctly once each person commits under their own git identity.
type Commit = { sha: string; subject: string; category: string; author: string; email: string; login?: string; date: string | null };

const isKyle = (c: Commit) => /kylekmcconnell@gmail\.com/i.test(c.email) || /^kyle$/i.test(c.author) || c.login === "kylekmcconnell-arch";

function dayLabel(iso: string | null): string {
  if (!iso) return "";
  const s = iso.slice(0, 10);
  return s;
}

export function ChangelogPage() {
  const [data, setData] = useState<{ commits: Commit[]; available?: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/changelog").then((r) => r.json()).then(setData).catch(() => setData({ commits: [] }));
  }, []);

  const commits = data?.commits ?? [];
  const kyleCount = commits.filter(isKyle).length;
  const otherCount = commits.length - kyleCount;

  // group by day for readability
  const groups: { day: string; items: Commit[] }[] = [];
  for (const c of commits) {
    const day = dayLabel(c.date);
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.items.push(c);
    else groups.push({ day, items: [c] });
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-[26px] font-medium tracking-[-0.02em] text-ink">Changelog</h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-ink-dim">
        Everything shipped to ARGUS, newest first, labeled by who pushed it. Live from the repo.
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-[11.5px]">
        <span className="mono rounded-md border px-2 py-0.5" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>{kyleCount} Kyle</span>
        <span className="mono rounded-md border border-line px-2 py-0.5 text-ink-dim">{otherCount} Enigma / others</span>
        {otherCount === 0 && <span className="text-ink-faint">— once Enigma commits under his own git name, his pushes split out here.</span>}
      </div>

      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-faint">{g.day}</div>
            <div className="mt-2 space-y-1">
              {g.items.map((c) => {
                const mine = isKyle(c);
                return (
                  <div key={c.sha} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-panel/60">
                    <span className="mono shrink-0 rounded px-1.5 py-0.5 text-[10px]" style={mine ? { background: "rgba(59,130,246,.12)", color: "var(--color-signal)" } : { background: "var(--color-line)", color: "var(--color-ink-dim)" }}>
                      {mine ? "Kyle" : c.author}
                    </span>
                    {c.category && <span className="mono shrink-0 rounded border border-line px-1 py-0.5 text-[9.5px] text-ink-faint">{c.category}</span>}
                    <span className="min-w-0 flex-1 text-[13px] text-ink">{c.category ? c.subject.replace(new RegExp(`^${c.category}:\\s*`), "") : c.subject}</span>
                    <a href={`https://github.com/kylekmcconnell-arch/argus/commit/${c.sha}`} target="_blank" rel="noreferrer" className="mono shrink-0 text-[10px] text-ink-faint underline-offset-2 hover:text-ink hover:underline">{c.sha}</a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!data && <div className="text-center text-[12.5px] text-ink-faint">loading changelog…</div>}
        {data && commits.length === 0 && <div className="text-[12.5px] text-ink-faint">No commits found (or GITHUB_TOKEN not configured).</div>}
      </div>
    </div>
  );
}
