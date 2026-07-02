import { useState } from "react";

// GitHub commit forensics (/api/github-forensics): the real people behind a repo
// or org, recovered from commit-author metadata. Personal-email leaks tie a
// pseudonymous project to real identities; forks reveal copied code. On-click
// (a few API calls), like the other deep tools.
type Ident = { name: string; email: string; login?: string; commits: number; kind: "personal" | "corporate" | "unknown" };

export function GithubForensics({ org, login }: { org?: string; login?: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const label = org ? `github.com/${org}` : `github.com/${login}`;
  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    try {
      const qs = org ? `org=${encodeURIComponent(org)}` : `login=${encodeURIComponent(login ?? "")}`;
      const r = await fetch(`/api/github-forensics?${qs}`);
      const d = await r.json();
      setData(d?.available === false ? { note: d.note ?? "GitHub forensics unavailable (no GITHUB_TOKEN)." } : d);
    } catch {
      setData({ note: "GitHub forensics failed." });
    } finally {
      setLoading(false);
    }
  };

  if (!data) {
    return (
      <div className="mt-3 rounded-xl border border-line bg-panel p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Commit forensics · {label}</span>
          <button onClick={run} disabled={loading} className="mono rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-dim transition hover:text-ink disabled:opacity-50">
            {loading ? "mining commits…" : "reveal the devs →"}
          </button>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
          Mine commit-author metadata for real names and personal emails the team left in git history — the identities
          behind a pseudonymous project.
        </p>
      </div>
    );
  }

  const leaks: Ident[] = data.emailLeaks ?? [];
  const idents: Ident[] = data.identities ?? [];
  const forks: { repo: string; parent: string }[] = data.forks ?? [];
  const others = idents.filter((i) => i.kind !== "personal");

  return (
    <div className="mt-3 rounded-xl border border-line bg-panel p-4">
      <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Commit forensics · {label}</div>
      {data.note && <div className={`mt-1.5 text-[12px] leading-relaxed ${leaks.length ? "text-avoid" : "text-ink-dim"}`}>{data.note}</div>}

      {leaks.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Real-identity leaks ({leaks.length})</div>
          <div className="mt-1 space-y-1">
            {leaks.map((p) => (
              <div key={p.email} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-[12.5px] text-ink">{p.name}</span>
                <a href={`mailto:${p.email}`} className="mono text-[11.5px] text-signal underline-offset-2 hover:underline">{p.email}</a>
                {p.login && <a href={`https://github.com/${p.login}`} target="_blank" rel="noreferrer" className="mono text-[10.5px] text-ink-faint hover:text-ink">@{p.login}</a>}
                <span className="mono text-[10px] text-ink-faint">{p.commits} commits</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Other committers ({others.length})</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {others.slice(0, 16).map((p) => (
              <span key={p.email || p.name} className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim" title={`${p.email} · ${p.commits} commits`}>
                {p.name || p.email}
              </span>
            ))}
          </div>
        </div>
      )}

      {forks.length > 0 && (
        <div className="mt-2.5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-faint">Forked / copied code ({forks.length})</div>
          <div className="mt-1 space-y-0.5">
            {forks.slice(0, 6).map((f) => (
              <div key={f.repo} className="mono text-[11px] text-ink-dim">
                {f.repo.split("/")[1]} <span className="text-ink-faint">← forked from</span>{" "}
                <a href={`https://github.com/${f.parent}`} target="_blank" rel="noreferrer" className="text-signal hover:underline">{f.parent}</a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
