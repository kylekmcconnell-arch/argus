import { useEffect, useState } from "react";

// Joint changelog: live commit history from GitHub, labeled by author so Kyle and
// Enigma can see what each other shipped. Attribution is by commit author, so it
// splits correctly once each person commits under their own git identity.
type Commit = { sha: string; subject: string; category: string; author: string; email: string; login?: string; date: string | null };

const isKyle = (c: Commit) => /kylekmcconnell@gmail\.com/i.test(c.email) || /^kyle$/i.test(c.author) || c.login === "kylekmcconnell-arch";

// GitHub returns ISO-8601 in UTC (Z), so slicing IS the UTC date/time.
function dayLabel(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}
function utcTime(iso: string | null): string {
  if (!iso) return "";
  try { return new Date(iso).toISOString().slice(11, 16) + " UTC"; } catch { return ""; }
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
      <h1 className="display-sm text-[24px] text-ink">Changelog</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        Everything shipped to ARGUS, newest first, labeled by who pushed it. Live from the repo.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="chip tint-signal">{kyleCount} Kyle</span>
        <span className="chip">{otherCount} Enigma / others</span>
        {otherCount === 0 && <span className="text-ink-faint">— once Enigma commits under his own git name, his pushes split out here.</span>}
      </div>

      <div className="mt-6 space-y-6">
        {groups.map((g) => (
          <div key={g.day}>
            <div className="eyebrow">{g.day} <span className="normal-case tracking-normal">UTC</span></div>
            <div className="mt-2 space-y-1">
              {g.items.map((c) => {
                const mine = isKyle(c);
                return (
                  <div key={c.sha} className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-md px-2 py-1.5 hover:bg-panel/60">
                    <span className="mono shrink-0 text-[11px] tabular text-ink-faint" title={c.date ?? undefined}>{utcTime(c.date)}</span>
                    <span className={`chip shrink-0 ${mine ? "tint-signal" : ""}`}>
                      {mine ? "Kyle" : c.author}
                    </span>
                    {c.category && <span className="chip chip-sm shrink-0">{c.category}</span>}
                    <span className="min-w-0 flex-1 text-[13.5px] text-ink">{c.category ? c.subject.replace(new RegExp(`^${c.category}:\\s*`), "") : c.subject}</span>
                    <a href={`https://github.com/kylekmcconnell-arch/argus/commit/${c.sha}`} target="_blank" rel="noreferrer" className="link-ext mono shrink-0 text-[11px]">{c.sha}</a>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {!data && <div className="text-center text-[12.5px] text-ink-faint">loading changelog…</div>}
        {data && commits.length === 0 && <div className="empty-state">No commits found (or GITHUB_TOKEN not configured).</div>}
      </div>
    </div>
  );
}
