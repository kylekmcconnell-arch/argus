import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChatsCircle, UsersThree } from "@phosphor-icons/react";
import type { SocialActivityBucket, SocialActivitySnapshot } from "../data/socialActivity";

type WindowChoice = "24h" | "7d";

const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function aggregateDaily(buckets: SocialActivityBucket[]): SocialActivityBucket[] {
  const grouped = new Map<string, SocialActivityBucket>();
  for (const bucket of buckets) {
    const day = bucket.start.slice(0, 10);
    const prior = grouped.get(day);
    grouped.set(day, prior
      ? { ...prior, end: bucket.end, postCount: prior.postCount + bucket.postCount }
      : { start: bucket.start, end: bucket.end, postCount: bucket.postCount });
  }
  return [...grouped.values()].sort((left, right) => left.start.localeCompare(right.start));
}

function Chart({ buckets, label }: { buckets: SocialActivityBucket[]; label: string }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.postCount));
  if (!buckets.length) return null;
  return (
    <div className="mt-4" role="img" aria-label={label}>
      <div className="flex h-28 items-end gap-1.5 border-b border-line/70 px-1">
        {buckets.map((bucket) => (
          <div key={bucket.start} className="group relative flex min-w-0 flex-1 items-end self-stretch" title={`${integer.format(bucket.postCount)} posts`}>
            <div
              className="mt-auto w-full rounded-t-sm bg-brand transition-[height,opacity] duration-200 group-hover:opacity-75 motion-reduce:transition-none"
              style={{ height: `${Math.max(4, (bucket.postCount / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-ink-faint">
        <span>{new Date(buckets[0].start).toLocaleString("en-US", { month: "short", day: "numeric", hour: buckets.length > 8 ? "numeric" : undefined, timeZone: "UTC" })}</span>
        <span>UTC</span>
        <span>{new Date(buckets[buckets.length - 1].end).toLocaleString("en-US", { month: "short", day: "numeric", hour: buckets.length > 8 ? "numeric" : undefined, timeZone: "UTC" })}</span>
      </div>
    </div>
  );
}

function unavailableCopy(snapshot: SocialActivitySnapshot): string {
  if (snapshot.unavailableReason === "not_configured") {
    return "Official X search is not connected, so this report cannot measure the conversation yet.";
  }
  if (snapshot.unavailableReason === "invalid_identity") {
    return "ARGUS could not bind an official X account for this project, so it did not run a broad social search.";
  }
  return "X did not return usable activity data. ARGUS left the numbers unknown instead of showing zero.";
}

export function SocialActivityPanel({ snapshot, className = "" }: { snapshot: SocialActivitySnapshot; className?: string }) {
  const [choice, setChoice] = useState<WindowChoice>("24h");
  const window = choice === "24h" ? snapshot.windows.last24Hours : snapshot.windows.last7Days;
  const chartBuckets = useMemo(() => {
    if (choice === "7d") return aggregateDaily(snapshot.hourlyPostCounts);
    const start = Date.parse(snapshot.windows.last24Hours.start);
    return snapshot.hourlyPostCounts.filter((bucket) => Date.parse(bucket.start) >= start);
  }, [choice, snapshot]);
  const previous = snapshot.windows.previous24Hours;
  const change = choice === "24h" && window.uniqueAccounts !== null && previous.uniqueAccounts !== null
    ? Math.round(((window.uniqueAccounts - previous.uniqueAccounts) / Math.max(1, previous.uniqueAccounts)) * 100)
    : null;
  const people = window.uniqueAccounts;
  const peoplePrefix = window.authorCoverageComplete ? "" : "at least ";
  const period = choice === "24h" ? "in the last 24 hours" : "over the last 7 days";
  const subject = snapshot.queryBasis.projectName || "this project";

  return (
    <section id="social-activity" className={`panel scroll-mt-28 px-5 py-5 ${className}`} aria-labelledby="social-activity-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line/70 pb-3">
        <h2 id="social-activity-title" className="text-[20px] font-semibold text-ink">Social activity</h2>
        <div className="flex rounded-md border border-control-line p-0.5" aria-label="Social activity time window">
          <button type="button" aria-pressed={choice === "24h"} onClick={() => setChoice("24h")} className={`min-h-8 rounded px-3 text-[12.5px] ${choice === "24h" ? "bg-panel-2 font-medium text-ink" : "text-ink-dim hover:text-ink"}`}>24 hours</button>
          <button type="button" aria-pressed={choice === "7d"} onClick={() => setChoice("7d")} className={`min-h-8 rounded px-3 text-[12.5px] ${choice === "7d" ? "bg-panel-2 font-medium text-ink" : "text-ink-dim hover:text-ink"}`}>7 days</button>
        </div>
      </div>

      {snapshot.state === "unavailable" ? (
        <div className="empty-state mt-4">
          <p className="text-[15px] font-medium text-ink">Social activity is unavailable</p>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">{unavailableCopy(snapshot)}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 border-b border-line/70 py-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(180px,.55fr)_minmax(170px,.5fr)] lg:items-end">
            <div className="flex min-w-0 items-end gap-4">
              <div className="mono text-[44px] font-semibold leading-none text-ink">{people === null ? "Unknown" : integer.format(people)}</div>
              <p className="max-w-sm pb-1 text-[18px] font-semibold leading-tight text-ink">
                {people === null ? "Unique accounts could not be counted" : `${peoplePrefix}unique accounts talked about ${subject} ${period}`}
              </p>
            </div>
            <div className="pb-1">
              {change !== null ? (
                <div className={`flex items-center gap-2 ${change >= 0 ? "text-pass" : "text-caution"}`}>
                  {change >= 0 ? <ArrowUp aria-hidden="true" size={18} weight="bold" /> : <ArrowDown aria-hidden="true" size={18} weight="bold" />}
                  <span className="mono text-[18px] font-semibold">{change > 0 ? "+" : ""}{change}%</span>
                </div>
              ) : (
                <div className="text-[12.5px] text-ink-dim">Seven-day captured view</div>
              )}
              <p className="mt-1 text-[11px] text-ink-faint">{change !== null ? "compared with the previous 24 hours" : "switch to 24 hours for the short-term change"}</p>
            </div>
            <div className="pb-1 lg:border-l lg:border-line/70 lg:pl-5">
              <div className="stat-label">Activity score</div>
              {snapshot.activityScore === null ? (
                <div className="mono mt-1 text-[18px] font-semibold text-ink">Withheld</div>
              ) : (
                <div className="mono mt-1 inline-flex items-baseline gap-1 rounded border border-line-2 px-2 py-1 text-[15px] font-semibold">
                  <span className="text-pass">{snapshot.activityScore}</span>
                  <span className="text-ink">/ 100</span>
                </div>
              )}
              <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">Measures conversation activity, not project quality or safety.</p>
            </div>
          </div>

          <div className="grid divide-y divide-line/60 border-b border-line/70 py-1 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            <div className="flex items-center gap-3 py-3 sm:pr-4">
              <UsersThree aria-hidden="true" size={20} weight="duotone" className="text-signal-lift" />
              <div><span className="mono text-[15px] font-semibold text-ink">{snapshot.windows.last7Days.uniqueAccounts === null ? "Unknown" : `${snapshot.windows.last7Days.authorCoverageComplete ? "" : "At least "}${integer.format(snapshot.windows.last7Days.uniqueAccounts)}`}</span><span className="ml-1 text-[12.5px] text-ink-dim">unique accounts</span></div>
            </div>
            <div className="flex items-center gap-3 py-3 sm:px-4">
              <ChatsCircle aria-hidden="true" size={20} weight="duotone" className="text-signal-lift" />
              <div><span className="mono text-[15px] font-semibold text-ink">{snapshot.windows.last7Days.postCount === null ? "Unknown" : integer.format(snapshot.windows.last7Days.postCount)}</span><span className="ml-1 text-[12.5px] text-ink-dim">posts in 7 days</span></div>
            </div>
            <div className="py-3 sm:pl-4">
              <span className="mono text-[15px] font-semibold text-ink">{snapshot.top10AccountSharePct === null ? "Unknown" : `${snapshot.top10AccountSharePct}%`}</span>
              <span className="ml-1 text-[12.5px] text-ink-dim">from the 10 most active accounts</span>
            </div>
          </div>

          <Chart buckets={chartBuckets} label={`Public X posts matched to this project ${period}`} />
          {snapshot.state === "partial" && (
            <p className="mt-3 text-[11px] font-medium text-caution">ARGUS reached its post limit. Unique-account figures are minimums, and the activity score stays withheld.</p>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-start justify-between gap-2 border-t border-line/70 pt-3 text-[11px] leading-relaxed text-ink-faint">
        <p className="max-w-3xl">{snapshot.note} Matches use the bound project identifiers saved with this report.</p>
        <a href={snapshot.sourceUrl} target="_blank" rel="noreferrer" className="link-ext shrink-0">View matching X posts</a>
        <p className="w-full mono">Updated {new Date(snapshot.capturedAt).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</p>
        <details className="w-full">
          <summary className="cursor-pointer text-[11px] text-ink-dim">Search details</summary>
          <p className="mono mt-2 break-words text-[10px] text-ink-faint">{snapshot.queryBasis.query}</p>
        </details>
      </div>
    </section>
  );
}
