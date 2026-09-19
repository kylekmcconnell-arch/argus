import { useState, type ReactNode } from "react";
import { Badge, ChapterHead, ExtLink, Panel } from "../primitives";
import { countShort, findingId, utcStamp } from "../model";
import type { ReportView } from "../view";
import type { SocialActivitySnapshot } from "../../../data/socialActivity";
import { dailyBins, hourlyBins } from "../socialBins";

function hourLabel(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function Activity({ snapshot }: { snapshot: SocialActivitySnapshot }) {
  const [windowKey, setWindowKey] = useState<"24h" | "7d">("24h");
  const last24 = snapshot.windows.last24Hours;
  const previous = snapshot.windows.previous24Hours;
  const week = snapshot.windows.last7Days;
  const hours = hourlyBins(snapshot);
  const days = dailyBins(snapshot);
  const current = windowKey === "24h" ? last24 : week;
  const floor = !current.authorCoverageComplete;
  const change = last24.uniqueAccounts != null && previous.uniqueAccounts != null && previous.uniqueAccounts > 0
    ? ((last24.uniqueAccounts - previous.uniqueAccounts) / previous.uniqueAccounts) * 100
    : null;
  const binTotal = hours.reduce((sum, bucket) => sum + bucket.postCount, 0);
  const maxHour = Math.max(1, ...hours.map((bucket) => bucket.postCount));
  const maxDay = Math.max(1, ...(days ?? []).map((day) => day.postCount));
  return (
    <>
      <div className="section-top">
        <h2>Conversation activity</h2>
        <div className="segmented" role="group" aria-label="Activity window">
          <button type="button" aria-pressed={windowKey === "24h"} onClick={() => setWindowKey("24h")}>24 hours</button>
          <button type="button" aria-pressed={windowKey === "7d"} onClick={() => setWindowKey("7d")}>7 days</button>
        </div>
      </div>
      <div className="stat-large">
        {current.uniqueAccounts != null ? current.uniqueAccounts.toLocaleString("en-US") : "n/a"}{" "}
        <small>{current.uniqueAccounts != null ? `${floor ? "at least " : ""}unique accounts` : "unique accounts not recorded"}</small>
      </div>
      <p>
        {windowKey === "24h"
          ? change != null
            ? `${Math.abs(Math.round(change))}% ${change < 0 ? "below" : change > 0 ? "above" : "level with"} the preceding 24 hours (${previous.uniqueAccounts} unique accounts).`
            : "No preceding 24-hour comparison is recorded."
          : week.postCount != null
            ? `${floor ? "At least " : ""}${week.postCount.toLocaleString("en-US")} posts captured across seven days.`
            : `${week.inspectedPosts.toLocaleString("en-US")} posts inspected across seven days.`}
      </p>
      {windowKey === "24h" ? (
        hours.length > 0 ? (
          <>
            <div className="bar-chart" role="img" aria-label={`Hourly matched posts from ${utcStamp(last24.start)} to ${utcStamp(last24.end)}. Counts ${hours.map((bucket) => bucket.postCount).join(", ")}`}>
              {hours.map((bucket) => (
                <div key={bucket.start} style={{ height: `${(bucket.postCount / maxHour) * 100}%` }} data-value={`${hourLabel(bucket.start)} · ${bucket.postCount} posts`} />
              ))}
            </div>
            <div className="legend-row"><span>{utcStamp(last24.start)}</span><span>{utcStamp(last24.end)}</span></div>
          </>
        ) : (
          <div className="status-box">Hourly bins were not captured for this window, so no chart is drawn.</div>
        )
      ) : days && days.length > 0 ? (
        <>
          <div className="bar-chart" role="img" aria-label={`Daily matched posts, summed from recorded hourly bins. Counts ${days.map((day) => day.postCount).join(", ")}`}>
            {days.map((day) => (
              <div key={day.day} style={{ height: `${(day.postCount / maxDay) * 100}%` }} data-value={`${day.day} · ${day.postCount} posts`} />
            ))}
          </div>
          <div className="legend-row"><span>{utcStamp(week.start)}</span><span>{utcStamp(week.end)}</span></div>
        </>
      ) : (
        <div className="status-box">The report exposes a seven-day total. Daily bins were not captured, so the view does not draw a seven-day chart.</div>
      )}
      <p className="subtle-note">
        Minimum observed counts; reposts excluded.{hours.length ? ` The ${hours.length} hourly bins sum to ${binTotal} posts.` : ""} Posts and unique authors are different measures. {snapshot.note}
      </p>
    </>
  );
}

export function SocialChapter({ view, legacy }: { view: ReportView; legacy?: ReactNode }) {
  const social = view.social;
  if (!social) {
    return (
      <>
        <ChapterHead
          eyebrow="Social intelligence"
          title="Attention is not endorsement."
          description="No subject-bound social activity snapshot is saved with this report. Missing activity data is not a finding about the subject."
        />
        {legacy}
      </>
    );
  }
  const snapshot = social.snapshot;
  const mentions = snapshot.mentioners ?? [];
  const warnings = snapshot.adverseMentions ?? [];
  const concentration = snapshot.top10AccountSharePct;
  return (
    <>
      <ChapterHead
        eyebrow="Social intelligence"
        title="Attention is not endorsement."
        description="Public X activity is useful context. Audience size, mentions and follow-backs do not establish product quality, backing, sentiment or coordinated behavior."
      />
      <div className="chapter-grid wide-left">
        <Panel challenge={{ id: findingId("social", "activity"), title: "Conversation activity", claim: `${snapshot.windows.last24Hours.uniqueAccounts ?? "n/a"} unique accounts in 24 hours; ${snapshot.windows.last7Days.uniqueAccounts ?? "n/a"} in 7 days (captured ${utcStamp(snapshot.capturedAt)}).` }}>
          <Activity snapshot={snapshot} />
        </Panel>
        <Panel challenge={{ id: findingId("social", "authenticity"), title: "Authenticity & coordination", claim: "Author concentration, coordinated promotion, prior handle history and sentiment coverage." }}>
          <h2>Authenticity &amp; coordination</h2>
          <div className="coverage-row">
            <span>Author concentration</span>
            {concentration != null ? <strong>{concentration.toFixed(1)}% of posts from the top 10 accounts</strong> : <Badge>Not measured</Badge>}
          </div>
          <div className="coverage-row"><span>Coordinated promotion</span><Badge>Not established</Badge></div>
          <div className="coverage-row"><span>Prior handle history</span><Badge tone={social.handleHistory.tone}>{social.handleHistory.label}</Badge></div>
          <div className="coverage-row"><span>Sentiment</span><Badge>Not scored</Badge></div>
          <p className="subtle-note">
            {social.handleHistory.note} A coordination assessment needs dated handle changes, author overlap, timing patterns and identity-bound wallet evidence. A share of posts is not a coordination finding.
          </p>
        </Panel>
      </div>
      <div className="chapter-grid space-top">
        <Panel challenge={{ id: findingId("social", "mentions"), title: "Notable mentions", claim: mentions.map((mention) => `${mention.handle}: ${mention.text}`).join(" | ").slice(0, 1200) }}>
          <h2>Notable mentions</h2>
          <p style={{ marginTop: 8 }}>
            {mentions.length
              ? `${mentions.length} saved post${mentions.length === 1 ? "" : "s"}, ranked by reported audience. Mentions are not independent endorsements.`
              : "No notable mention was saved with this snapshot."}
          </p>
          {mentions.map((mention) => (
            <div className="quote-row" key={mention.postId}>
              <ExtLink href={mention.tweetUrl}>Post</ExtLink>
              <strong>{mention.handle.startsWith("@") ? mention.handle : `@${mention.handle}`}</strong>
              {mention.followers != null && <small> · {countShort(mention.followers)} followers</small>}
              <p>{mention.text.length > 240 ? `${mention.text.slice(0, 239)}…` : mention.text}</p>
            </div>
          ))}
        </Panel>
        <Panel challenge={{ id: findingId("social", "warnings"), title: "Read warnings in context", claim: warnings.map((warning) => `${warning.handle}: ${warning.text}`).join(" | ").slice(0, 1200) }}>
          <h2>Read warnings in context</h2>
          <p style={{ marginTop: 14 }}>
            {warnings.length
              ? `The saved search flags ${warnings.length} warning post${warnings.length === 1 ? "" : "s"}, with ${warnings.filter((warning) => warning.specificity === "specific").length} specific checkable claim${warnings.filter((warning) => warning.specificity === "specific").length === 1 ? "" : "s"}. Some may contain negation or discuss several assets. No warning affects the score without independent corroboration.`
              : "No warning post was saved with this snapshot. That is a result of this search window, not a clean bill of health."}
          </p>
          {warnings.map((warning) => (
            <div className="quote-row" key={warning.postId}>
              <ExtLink href={warning.tweetUrl}>Post</ExtLink>
              <strong>{warning.handle.startsWith("@") ? warning.handle : `@${warning.handle}`}</strong>
              <small> · {warning.category.replace(/_/g, " ")} · {warning.specificity}</small>
              <p>{warning.text.length > 280 ? `${warning.text.slice(0, 279)}…` : warning.text}</p>
            </div>
          ))}
          <details className="disclosure">
            <summary>What the notable sample can and cannot say</summary>
            <p>Mentions and warnings are selected posts from a bounded search window, ranked by audience or matched by keywords. They are not a representative estimate of the whole conversation, and a keyword match does not establish an allegation about this subject.</p>
          </details>
        </Panel>
      </div>
      {legacy}
    </>
  );
}
