import { useEffect, useRef, useState } from "react";

// Press coverage from /api/news (Google News). A real project/founder leaves a
// press trail (funding, launches, hacks, exits); a fresh shell leaves none, and
// absence is itself a signal. Auto-runs on the report.
type Article = { title: string; source: string; url: string; publishedAt: number | null };
type NewsData = { available?: boolean; articles?: Article[]; note?: string };

const ago = (ms: number | null) => {
  if (!ms) return "";
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
};

export function NewsSection({ query, handle }: { query: string; handle?: string }) {
  const [articles, setArticles] = useState<Article[] | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "none" | "unavailable">("loading");
  const [note, setNote] = useState("");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    fetch(`/api/news?q=${encodeURIComponent(query)}${handle ? `&h=${encodeURIComponent(handle.replace(/^@/, ""))}` : ""}`)
      .then((r) => r.json())
      .then((d: NewsData) => {
        if (d?.available === false) {
          setNote(d.note ?? "Current news search is unavailable.");
          setState("unavailable");
          return;
        }
        const a = d?.articles ?? [];
        setArticles(a);
        setState(a.length ? "ok" : "none");
      })
      .catch(() => {
        setNote("Current news search is unavailable.");
        setState("unavailable");
      });
  }, [handle, query]);

  if (state === "loading") return <div className="panel p-4 text-[12.5px] text-ink-faint">searching news…</div>;
  if (state === "unavailable") {
    return (
      <div className="panel tint-caution p-4 text-[12.5px] text-ink-dim" role="status">
        <span className="font-medium text-ink">Current news search unavailable.</span> {note} The frozen report remains the source of truth.
      </div>
    );
  }
  if (state === "none" || !articles) {
    return (
      <div className="panel p-4 text-[12.5px] text-ink-dim">
        No press coverage found. For a project claiming traction, an empty news trail is itself a soft flag.
      </div>
    );
  }

  return (
    <div className="panel divide-y divide-line/60 p-2">
      {articles.map((a, i) => (
        <a
          key={i}
          href={a.url}
          target="_blank"
          rel="noreferrer"
          className="group flex items-start gap-3 rounded-lg px-2.5 py-2 transition hover:bg-panel-2"
        >
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-signal/50 group-hover:bg-signal" />
          <span className="min-w-0 flex-1">
            <span className="block text-[12.5px] leading-snug text-ink group-hover:text-signal-dim">{a.title}</span>
            <span className="mono mt-0.5 block text-[11px] text-ink-faint">
              {a.source}{a.source && a.publishedAt ? " · " : ""}{ago(a.publishedAt)}
            </span>
          </span>
          <svg className="mt-1 shrink-0 text-ink-faint opacity-0 transition group-hover:opacity-100" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M7 17L17 7M9 7h8v8" /></svg>
        </a>
      ))}
    </div>
  );
}
