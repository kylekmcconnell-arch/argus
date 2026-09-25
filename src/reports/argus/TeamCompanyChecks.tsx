import type { TeamCompanyCheck } from "../../lib/teamCompanyBinding";
import { Badge, ExtLink, Panel } from "./primitives";
export function TeamCompanyChecks({ checks }: { checks?: TeamCompanyCheck[] }) {
  if (!checks?.length) return null;
  return <Panel className="space-top"><h2>Company identity checks</h2>
    <p>Employment candidates are checked against the company's official website. Matching the employer does not independently verify a person's identity or role.</p>
    {checks.map((check, index) => <details className="disclosure" key={`${check.name}:${index}`}><summary>{check.name} · {check.state === "rejected" ? "Employer mismatch" : check.state === "unresolved" ? "Unresolved match" : "Company source matched"}</summary>
      <Badge>{check.state}</Badge><p>{check.reason}</p>
      <p>Company anchor: {check.officialDomain ?? "Unresolved"} · Employer website: {check.employerDomain ?? "Not retrieved"}</p>
      <p>Business comparison: {check.activity} · Checked {check.capturedAt.slice(0, 10)}</p>
      {check.sources.map((source, i) => <div className="product-claim" key={`${source.url}:${i}`}><p>{source.excerpt}</p><ExtLink href={source.url}>Retrieved source</ExtLink><small> · {source.capturedAt.slice(0, 10)}</small></div>)}
    </details>)}
  </Panel>;
}
