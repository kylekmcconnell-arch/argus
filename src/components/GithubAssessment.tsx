import type { GithubAssessment as Assessment, GithubClaimCheck } from "../data/evidence";

// The server-computed read of a resolved GitHub account: account history, how
// much of the work is original vs forked, stars/languages, recency, and how the
// X bio's self-claims hold up against it. Pure props — the audit run already
// resolved and assessed the account (dossier.githubAssessment), so no fetch here.
// Complements <PersonGithub> (commit-author forensics) rather than replacing it.

const gradeColor = (g: GithubClaimCheck["grade"]) =>
  g === "consistent" ? "var(--color-pass)"
  : g === "contradicted" ? "var(--color-avoid)"
  : g === "unsupported" ? "var(--color-caution)"
  : "var(--color-ink-faint)";

const fmtDate = (iso?: string) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-US", { month: "short", year: "numeric" });
};

const recency = (days?: number) =>
  days == null ? "" : days < 60 ? "active" : days < 365 ? `${Math.round(days / 30)}mo since last push` : `${Math.round(days / 365)}y since last push`;

// A one-line inline variant for a team-member row.
export function GithubAssessmentInline({ a }: { a: Assessment }) {
  const warn = a.forkRatio > 0.8 || a.originalCount === 0;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-[26px] text-[10.5px] text-ink-faint">
      <a href={`https://github.com/${a.login}`} target="_blank" rel="noreferrer" className="mono text-signal-dim underline-offset-2 hover:underline">github.com/{a.login} ↗</a>
      <span>·</span>
      <span style={warn ? { color: "var(--color-caution)" } : undefined}>{a.originalCount} original / {a.forkCount} fork</span>
      {a.totalStarsOnOriginals > 0 && <span>· {a.totalStarsOnOriginals}★</span>}
      {a.accountAgeYears != null && <span>· ~{Math.round(a.accountAgeYears)}y old</span>}
      {a.claimChecks.some((c) => c.grade === "contradicted" || c.grade === "unsupported") && (
        <span style={{ color: "var(--color-caution)" }}>· bio claim unsupported</span>
      )}
    </div>
  );
}

export function GithubAssessment({ a }: { a: Assessment }) {
  const total = a.originalCount + a.forkCount;
  const origPct = total ? Math.round((a.originalCount / total) * 100) : 0;
  return (
    <div className="space-y-3 text-[12px]">
      <div className="flex flex-wrap items-center gap-2">
        <a href={`https://github.com/${a.login}`} target="_blank" rel="noreferrer" className="mono text-signal-dim underline-offset-2 hover:underline">github.com/{a.login} ↗</a>
        <span className="mono rounded px-1.5 py-0.5 text-[9.5px]" style={{ background: a.confidence === "gold" ? "var(--color-pass)14" : "var(--color-caution)14", color: a.confidence === "gold" ? "var(--color-pass)" : "var(--color-caution)" }}>{a.confidence === "gold" ? "verified via X link" : "unconfirmed"}</span>
        {a.createdAt && <span className="text-ink-faint">joined {fmtDate(a.createdAt)}{a.accountAgeYears != null ? ` · ~${Math.round(a.accountAgeYears)}y old` : ""}</span>}
        {a.daysSinceActivity != null && <span className="text-ink-faint">· {recency(a.daysSinceActivity)}</span>}
      </div>

      {/* original vs fork mix — the core "is this a builder" signal */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[10.5px] text-ink-faint">
          <span>{a.originalCount} original · {a.forkCount} fork · {a.totalStarsOnOriginals}★ on originals</span>
          <span>{origPct}% original</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-line-2)" }}>
          <div className="h-full rounded-full" style={{ width: `${origPct}%`, background: origPct >= 40 ? "var(--color-pass)" : origPct > 0 ? "var(--color-caution)" : "var(--color-avoid)" }} />
        </div>
      </div>

      {a.topLanguages.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {a.topLanguages.map((l) => (
            <span key={l.language} className="mono rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-dim">{l.language} · {l.repos}</span>
          ))}
        </div>
      )}

      {a.notableRepos.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Notable original repos</div>
          {a.notableRepos.map((r) => (
            <div key={r.name} className="flex flex-wrap items-center gap-1.5">
              <a href={r.url} target="_blank" rel="noreferrer" className="mono text-signal-dim underline-offset-2 hover:underline">{r.name} ↗</a>
              <span className="text-ink-faint">{r.stars}★</span>
              {r.language && <span className="text-ink-faint">· {r.language}</span>}
              {r.lastPush && <span className="text-ink-faint">· pushed {fmtDate(r.lastPush)}</span>}
            </div>
          ))}
        </div>
      )}

      {a.claimChecks.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Bio claims vs GitHub</div>
          {a.claimChecks.map((c, i) => {
            const col = gradeColor(c.grade);
            return (
              <div key={i} className="flex items-start gap-2">
                <span className="mono mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9.5px] uppercase" style={{ background: `${col}1a`, color: col }}>{c.grade}</span>
                <span className="text-ink-dim">{c.claim} — <span className="text-ink-faint">{c.observation}</span></span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
