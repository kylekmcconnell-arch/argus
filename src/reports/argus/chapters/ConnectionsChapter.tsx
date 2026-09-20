import { useMemo, useState, type ReactNode } from "react";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { Badge, ChallengeButton, ChallengePanel, ChapterHead, ExtLink, Panel } from "../primitives";
import { findingId } from "../model";
import type { ConnectionView, ReportView } from "../view";

const FILTERS = ["All", "People", "Backers", "Advisors", "Assets", "Identity"] as const;

function ConnectionNode({ item }: { item: ConnectionView }) {
  const panelId = `connection:${item.key}`;
  const challenge = { id: findingId("connections", item.key), title: `${item.name} · ${item.role}`, claim: `${item.name}: ${item.role}. ${item.tier}. ${item.detail}` };
  return (
    <>
      <DisclosureButton id={panelId} className="connection-node">
        <span className="eyebrow">{item.group} · {item.tier}</span>
        <strong>{item.name}</strong>
        <p>{item.role}</p>
      </DisclosureButton>
      <InlinePanel id={panelId} label={item.name}>
        {() => (
          <>
            <Badge tone="amber">{item.tier}</Badge>
            <h2 className="dialog-title">{item.name}</h2>
            <h3>{item.role}</h3>
            <p className="dialog-body" style={{ marginTop: 16 }}>{item.detail}</p>
            {item.source && (
              <div className="dialog-section">
                <h3>Evidence basis</h3>
                <p>{item.source.title}{item.source.provider ? ` · ${item.source.provider}` : ""}</p>
                {item.source.excerpt && <p style={{ marginTop: 6 }}>{item.source.excerpt}</p>}
              </div>
            )}
            {item.url ? <ExtLink href={item.url}>Inspect evidence basis</ExtLink> : <p className="status-box">No direct public artifact link is recorded for this relationship in the saved report.</p>}
            <ChallengeButton target={challenge} />
            <ChallengePanel target={challenge} />
          </>
        )}
      </InlinePanel>
    </>
  );
}

export function ConnectionsChapter({ view, legacy }: { view: ReportView; legacy?: ReactNode }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [query, setQuery] = useState("");
  const items = view.connections.items;
  const visible = useMemo(() => items.filter((item) =>
    (filter === "All" || item.group === filter)
    && `${item.name} ${item.role} ${item.tier}`.toLowerCase().includes(query.trim().toLowerCase())), [filter, items, query]);
  const funding = view.connections.funding;
  const graph = view.connections.graph;
  return (
    <>
      <ChapterHead
        eyebrow="Connections & backing"
        title="Show the relationship. Show the proof."
        description="Claims, provider records and confirmed identity links stay distinct. Shared people, follows or wallets do not by themselves prove common control."
      />
      <div className="panel">
        <div className="section-top">
          <div>
            <h2>{view.subjectName}'s evidence map</h2>
            <p style={{ marginTop: 6 }}>{items.length} recorded counterpart{items.length === 1 ? "y" : "ies"} and linked asset{items.length === 1 ? "" : "s"} · open any item to inspect its basis</p>
          </div>
          <Badge tone="green">Evidence-first view</Badge>
        </div>
        <div className="connection-controls">
          {FILTERS.map((value) => (
            <button key={value} type="button" className="filter-btn" aria-pressed={filter === value} onClick={() => setFilter(value)}>{value}</button>
          ))}
          <input className="search" aria-label="Search connections" placeholder="Search people, backers, assets…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <div className="connection-grid">
          {visible.map((item) => <ConnectionNode key={item.key} item={item} />)}
        </div>
        {visible.length === 0 && <p className="empty">No connections match these filters.</p>}
        <p className="subtle-note">This view lists the saved roster, claimed relationships, funding records, linked assets and identity links. Every card has a named evidence state; none implies endorsement.</p>
      </div>
      {(funding || graph) && (
        <div className="chapter-grid space-top">
          {funding && (
            <Panel challenge={{ id: findingId("connections", "funding"), title: funding.heading, claim: `${funding.heading}. ${funding.detail} ${funding.tags.join(", ")}` }}>
              <div className="eyebrow">Funding record</div>
              <h2 style={{ marginTop: 12 }}>{funding.heading}</h2>
              <p style={{ marginTop: 8 }}>{funding.detail}</p>
              {funding.tags.length > 0 && <div className="tag-list">{funding.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
              <p className="subtle-note">{funding.note}</p>
              {funding.sourceUrl && <ExtLink href={funding.sourceUrl} className="textbtn">Inspect funding provenance</ExtLink>}
            </Panel>
          )}
          {graph && (
            <Panel challenge={{ id: findingId("connections", "graph-screen"), title: "Graph screening", claim: `${graph.qualified} of ${graph.total} records qualified. ${graph.line}` }}>
              <h2>Graph screening has a boundary</h2>
              <div className="stat-large" style={{ margin: "13px 0" }}>{graph.qualified} <small>of {graph.total} records qualified</small></div>
              <p>{graph.line} This does not clear every associate or establish that no concerning connection exists.</p>
              {graph.leadsNote && <div className="status-box">{graph.leadsNote}</div>}
            </Panel>
          )}
        </div>
      )}
      {legacy}
    </>
  );
}
