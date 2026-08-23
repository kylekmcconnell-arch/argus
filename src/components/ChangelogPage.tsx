import { useEffect, useMemo, useState } from "react";
import {
  ArrowSquareOutIcon,
  CalendarBlankIcon,
  GitCommitIcon,
  SparkleIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { ArgusMark } from "./ArgusMark";

export interface ChangelogCommit {
  sha: string;
  subject: string;
  category: string;
  author: string;
  email: string;
  login?: string;
  date: string | null;
}

export interface ChangelogData {
  commits: ChangelogCommit[];
  available?: boolean;
  error?: string;
  note?: string;
}

type AuthorFilter = "all" | "kyle" | "enigma" | "team";

const isKyle = (commit: ChangelogCommit) => (
  /kylekmcconnell@gmail\.com/i.test(commit.email)
  || /^kyle(?: mcconnell)?$/i.test(commit.author)
  || commit.login === "kylekmcconnell-arch"
);

const isEnigma = (commit: ChangelogCommit) => (
  /enigma/i.test(commit.email)
  || /enigma/i.test(commit.author)
  || /enigma/i.test(commit.login ?? "")
);

function authorLabel(commit: ChangelogCommit): string {
  if (isKyle(commit)) return "Kyle";
  if (isEnigma(commit)) return "Enigma";
  return commit.author || "Team";
}

function authorFilter(commit: ChangelogCommit): Exclude<AuthorFilter, "all"> {
  if (isKyle(commit)) return "kyle";
  if (isEnigma(commit)) return "enigma";
  return "team";
}

function dayLabel(iso: string | null): string {
  if (!iso) return "Date unavailable";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function shortDate(iso: string | null): string {
  if (!iso) return "Unknown";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

function utcTime(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.toISOString().slice(11, 16)} UTC`;
}

function cleanSubject(commit: ChangelogCommit): string {
  if (!commit.category) return commit.subject;
  const escaped = commit.category.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return commit.subject.replace(new RegExp(`^${escaped}:\\s*`, "i"), "");
}

export function ChangelogPage({ initialData = null }: { initialData?: ChangelogData | null }) {
  const [data, setData] = useState<ChangelogData | null>(initialData);
  const [filter, setFilter] = useState<AuthorFilter>("all");

  useEffect(() => {
    if (initialData) return;
    const controller = new AbortController();
    void fetch("/api/changelog", { signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => ({})) as ChangelogData & { message?: string };
        if (!response.ok) throw new Error(body.message || "The release history could not be loaded.");
        setData(body);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setData({ commits: [], available: false, error: error instanceof Error ? error.message : "The release history could not be loaded." });
      });
    return () => controller.abort();
  }, [initialData]);

  const commits = useMemo(() => data?.commits ?? [], [data]);
  const filtered = useMemo(() => (
    filter === "all" ? commits : commits.filter((commit) => authorFilter(commit) === filter)
  ), [commits, filter]);
  const groups = useMemo(() => {
    const result: Array<{ day: string; items: ChangelogCommit[] }> = [];
    for (const commit of filtered) {
      const day = commit.date?.slice(0, 10) || "unknown";
      const last = result.at(-1);
      if (last?.day === day) last.items.push(commit);
      else result.push({ day, items: [commit] });
    }
    return result;
  }, [filtered]);

  const latest = commits[0];
  const contributors = new Set(commits.map(authorLabel)).size;
  const categories = new Set(commits.map((commit) => commit.category).filter(Boolean)).size;
  const filterOptions: Array<{ id: AuthorFilter; label: string; count: number }> = [
    { id: "all", label: "All", count: commits.length },
    { id: "kyle", label: "Kyle", count: commits.filter(isKyle).length },
    { id: "enigma", label: "Enigma", count: commits.filter(isEnigma).length },
    { id: "team", label: "Team", count: commits.filter((commit) => !isKyle(commit) && !isEnigma(commit)).length },
  ];

  return (
    <div className="workspace-frame">
      <header className="panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
        <div className="pointer-events-none absolute -right-20 -top-28 h-72 w-72 rounded-full bg-signal/10 blur-3xl" aria-hidden />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <ArgusMark size={30} live motion="focused" />
              <span className="eyebrow text-signal-lift">Admin release log</span>
            </div>
            <h1 className="display-sm mt-4 text-[clamp(30px,4vw,46px)] leading-none tracking-[-0.04em] text-ink">What changed in ARGUS</h1>
            <p className="mt-3 max-w-xl text-[13.5px] leading-relaxed text-ink-dim">
              A live record of reviewed code shipped to the main repository. New commits appear here automatically, with the author and source attached.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-signal/25 bg-signal/8 px-3 py-1.5 text-[11.5px] font-medium text-signal-lift">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden />
            Live from GitHub
          </div>
        </div>

        {latest && (
          <div className="relative mt-7 grid gap-4 border-t border-line pt-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <div className="eyebrow">Latest change</div>
              <div className="mt-2 text-[18px] font-medium leading-snug text-ink">{cleanSubject(latest)}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
                <span className="chip tint-signal">{authorLabel(latest)}</span>
                {latest.category && <span className="chip">{latest.category}</span>}
                <span>{shortDate(latest.date)} at {utcTime(latest.date)}</span>
              </div>
            </div>
            <a href={`https://github.com/kylekmcconnell-arch/argus/commit/${latest.sha}`} target="_blank" rel="noreferrer" className="btn-chip inline-flex items-center justify-center gap-2">
              Open commit <ArrowSquareOutIcon size={14} aria-hidden />
            </a>
          </div>
        )}
      </header>

      <section className="mt-4 grid gap-3 sm:grid-cols-3" aria-label="Release history summary">
        <div className="stat-tile flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-signal/10 text-signal-lift"><GitCommitIcon size={20} weight="duotone" aria-hidden /></span>
          <div><div className="stat-value text-[22px]">{commits.length}</div><div className="stat-label">Recent commits</div></div>
        </div>
        <div className="stat-tile flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel-2 text-ink-dim"><UsersThreeIcon size={20} weight="duotone" aria-hidden /></span>
          <div><div className="stat-value text-[22px]">{contributors}</div><div className="stat-label">Contributors</div></div>
        </div>
        <div className="stat-tile flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-panel-2 text-ink-dim"><SparkleIcon size={20} weight="duotone" aria-hidden /></span>
          <div><div className="stat-value text-[22px]">{categories}</div><div className="stat-label">Tagged areas</div></div>
        </div>
      </section>

      <section className="mt-6" aria-labelledby="release-history-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="eyebrow">Repository timeline</div>
            <h2 id="release-history-title" className="mt-1 text-[22px] font-medium tracking-[-0.025em] text-ink">Release history</h2>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label="Filter release history by contributor">
            {filterOptions.filter((option) => option.id === "all" || option.count > 0).map((option) => (
              <button key={option.id} type="button" onClick={() => setFilter(option.id)} aria-pressed={filter === option.id} className={`btn-chip ${filter === option.id ? "tint-signal" : ""}`}>
                {option.label} <span className="mono text-[10px] opacity-70">{option.count}</span>
              </button>
            ))}
          </div>
        </div>

        {!data && (
          <div className="panel mt-4 flex min-h-48 items-center justify-center gap-3 text-[13px] text-ink-dim" role="status">
            <ArgusMark size={28} live motion="searching" /> Loading release history
          </div>
        )}
        {data && data.available === false && (
          <div className="empty-state mt-4" role="status">{data.note || data.error || "The GitHub release history is not available in this deployment."}</div>
        )}
        {data?.available !== false && data?.error && (
          <div className="tint-caution mt-4 rounded-lg border px-4 py-3 text-[12.5px]" role="alert">GitHub did not return the release history. Try again shortly.</div>
        )}
        {data && !data.error && filtered.length === 0 && (
          <div className="empty-state mt-4">No changes match this contributor filter.</div>
        )}

        {groups.length > 0 && (
          <div className="mt-4 space-y-4">
            {groups.map((group) => (
              <article key={group.day} className="panel overflow-hidden">
                <header className="flex items-center gap-2 border-b border-line bg-panel/45 px-4 py-3">
                  <CalendarBlankIcon size={16} className="text-ink-faint" aria-hidden />
                  <h3 className="text-[12.5px] font-medium text-ink">{dayLabel(group.items[0]?.date ?? null)}</h3>
                  <span className="mono ml-auto text-[10.5px] text-ink-faint">{group.items.length} {group.items.length === 1 ? "change" : "changes"}</span>
                </header>
                <div className="divide-y divide-line/80">
                  {group.items.map((commit) => (
                    <div key={commit.sha} className="group grid gap-2 px-4 py-3 transition hover:bg-panel/35 sm:grid-cols-[78px_100px_minmax(0,1fr)_auto] sm:items-center">
                      <span className="mono text-[10.5px] tabular-nums text-ink-faint" title={commit.date ?? undefined}>{utcTime(commit.date)}</span>
                      <span className={`chip w-fit ${isKyle(commit) || isEnigma(commit) ? "tint-signal" : ""}`}>{authorLabel(commit)}</span>
                      <div className="min-w-0">
                        <div className="text-[13.5px] leading-snug text-ink">{cleanSubject(commit)}</div>
                        {commit.category && <div className="mono mt-1 text-[10px] uppercase tracking-[0.1em] text-ink-faint">{commit.category}</div>}
                      </div>
                      <a href={`https://github.com/kylekmcconnell-arch/argus/commit/${commit.sha}`} target="_blank" rel="noreferrer" aria-label={`Open commit ${commit.sha}`} className="mono inline-flex items-center gap-1 text-[10.5px] text-ink-faint transition group-hover:text-signal-lift">
                        {commit.sha} <ArrowSquareOutIcon size={12} aria-hidden />
                      </a>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
