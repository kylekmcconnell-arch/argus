import type { ReactNode } from "react";
import { Badge, ChapterHead, ExtLink, Panel, ReviewBanner } from "../primitives";
import { findingId } from "../model";
import type { ReportView } from "../view";

export function ProductChapter({ view, legacy }: { view: ReportView; legacy?: ReactNode }) {
  const product = view.product;
  return (
    <>
      <ChapterHead
        eyebrow="Product & execution"
        title="Claims meet evidence."
        description="A product, a public website and a code repository are different surfaces. Each needs its own evidence and scope."
      />
      <div className="chapter-grid wide-left">
        <Panel challenge={{ id: findingId("product", "claims"), title: product.heading, claim: product.description }}>
          <div className="eyebrow">What the {view.subjectKind === "person" ? "subject" : "company"} says it does</div>
          <h2 style={{ margin: "12px 0" }}>{product.heading}</h2>
          <p>{product.description}</p>
          {product.tags.length > 0 && (
            <div className="tag-list">{product.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
          )}
          {product.claims.map((claim) => (
            <div className="product-claim" key={claim.key}>
              <strong>{claim.title}</strong>
              <p>{claim.text}</p>
              <Badge tone={claim.badge.tone}>{claim.badge.label}</Badge>
              {claim.sourceUrl && <>{" "}<ExtLink href={claim.sourceUrl} className="textbtn">{claim.sourceLabel ?? "View evidence"}</ExtLink></>}
            </div>
          ))}
        </Panel>
        <Panel challenge={{ id: findingId("product", "technical"), title: product.repoHeading, claim: product.repoSummary ?? product.repoHeading }}>
          <div className="eyebrow">Technical diligence</div>
          <h2 style={{ margin: "12px 0" }}>{product.repoHeading}</h2>
          {product.repoSummary && <p>{product.repoSummary}</p>}
          {product.repos.map((repo) => (
            <div className="product-claim" key={repo.name}>
              <strong>{repo.name} {repo.language && <Badge>{repo.language}</Badge>}{repo.fork && <> <Badge tone="amber">Fork</Badge></>}</strong>
              <p>
                {[repo.lastPush ? `Last push: ${repo.lastPush}` : null, repo.stars != null ? `${repo.stars} star${repo.stars === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}
              </p>
              {repo.url && <ExtLink href={repo.url}>Open repository</ExtLink>}
            </div>
          ))}
          {product.repoNote && <p className="subtle-note">{product.repoNote}</p>}
          <details className="disclosure">
            <summary>What a complete code review should answer</summary>
            <ul className="compact-list">
              <li>Which repository implements each advertised feature?</li>
              <li>Which deployed build or contract corresponds to the reviewed commit?</li>
              <li>What do tests, security review, contributor continuity and dependencies show?</li>
              <li>Is important implementation private? If so, label it unavailable for public review.</li>
            </ul>
          </details>
          <div className="status-box">{product.auditStatus}</div>
        </Panel>
      </div>
      {(product.timeline.length > 0 || product.historyLead) && (
        <Panel className="space-top" challenge={{ id: findingId("product", "history"), title: "History", claim: product.timeline.map((event) => `${event.when}: ${event.text}`).join(" ") }}>
          <div className="section-top">
            <h2>History, with uncertainty intact</h2>
            <Badge>Saved source dates</Badge>
          </div>
          <div className="timeline">
            {product.timeline.map((event) => (
              <div key={event.key}>
                <small>{event.when} · {event.label}</small>
                <p>{event.text}</p>
              </div>
            ))}
          </div>
          {product.historyLead && (
            <ReviewBanner title={product.historyLead.title} body={product.historyLead.text} />
          )}
        </Panel>
      )}
      {legacy}
    </>
  );
}
