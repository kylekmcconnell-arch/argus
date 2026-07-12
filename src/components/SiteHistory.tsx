import { useState } from "react";

// Deleted-content archaeology (/api/site-history): diff a site's earliest archive
// against the live version and show what was REMOVED — scrubbed team/advisor
// sections, deleted LinkedIn/X/GitHub profile links, dropped names, and title
// pivots (a prior product on the same domain). On-click, keyless.
export function SiteHistory({ domain }: { domain: string }) {
  const [data, setData] = useState<any | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    if (loading || data) return;
    setLoading(true);
    // archive.org intermittently throttles; a "no history" result for a domain
    // that has history is usually a transient blip, so retry a couple of times.
    let last: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(`/api/site-history?url=${encodeURIComponent(domain)}`);
        last = await r.json();
      } catch {
        last = { note: "Site-history lookup failed." };
      }
      const empty = !last || (!last.error && (last.removedSections?.length ?? 0) === 0 && (last.removedProfileLinks?.length ?? 0) === 0 && !last.titleChange);
      if (!empty) break;
      if (attempt < 2) await new Promise((res) => setTimeout(res, 2500));
    }
    setData(last);
    setLoading(false);
  };

  if (!data) {
    return (
      <div className="mt-3 panel p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">Deleted-content archaeology</span>
          <button onClick={run} disabled={loading} className="btn-chip tint-signal disabled:opacity-50">
            {loading ? "diffing archives…" : "what did they remove? →"}
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">
          Diff this site's earliest archive against the live version. Look for scrubbed team pages, deleted advisor sections,
          removed LinkedIn links, and prior-product pivots. Removed content is the highest-signal content.
        </p>
      </div>
    );
  }

  const sections: string[] = data.removedSections ?? [];
  const profiles: string[] = data.removedProfileLinks ?? [];
  const names: string[] = data.removedNames ?? [];
  const pivot = data.titleChange;
  const damning = sections.length > 0 || profiles.length > 0 || pivot;

  return (
    <div className="mt-3 panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="eyebrow">Deleted-content archaeology</span>
        {data.firstArchived && <span className="mono text-[11px] text-ink-faint">archived {data.firstArchived}{data.lastArchived ? `–${data.lastArchived}` : ""} · vs {data.comparedTo}</span>}
      </div>
      {data.note && <div className={`mt-1.5 text-[12.5px] leading-relaxed ${damning ? "text-avoid" : "text-ink-dim"}`}>{data.note}</div>}

      {pivot && (
        <div className="mt-2.5">
          <div className="eyebrow">Title pivot</div>
          <div className="mt-1 text-[12.5px] text-ink-dim">
            <span className="text-ink-faint line-through">{pivot.from}</span> <span className="text-ink-faint">→</span> <span className="text-ink">{pivot.to}</span>
          </div>
        </div>
      )}

      {sections.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Removed sections ({sections.length})</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {sections.map((s) => <span key={s} className="chip tint-avoid">{s}</span>)}
          </div>
        </div>
      )}

      {profiles.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Deleted team / social links ({profiles.length})</div>
          <div className="mt-1 space-y-0.5">
            {profiles.map((p) => (
              <a key={p} href={`https://${p}`} target="_blank" rel="noreferrer" className="link-ext mono flex max-w-full items-center text-[11px]"><span className="min-w-0 truncate">{p}</span></a>
            ))}
          </div>
        </div>
      )}

      {names.length > 0 && (
        <div className="mt-2.5">
          <div className="eyebrow">Names gone from the site ({names.length}) · approximate</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {names.map((n) => <span key={n} className="chip">{n}</span>)}
          </div>
        </div>
      )}
    </div>
  );
}
