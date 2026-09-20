import type { ReactNode } from "react";
import { Badge, ChallengeButton, ChallengePanel, ChapterHead, ExtLink, Panel, ReviewBanner } from "../primitives";
import { findingId, utcDay, utcStamp } from "../model";
import type { CodeAreaView, CodeCommitterView, CodeView } from "../codeView";
import type { ReportView } from "../view";
import { ActivityChart, BurstMeter, OutsideUseBar, ShareBar } from "./CodeCharts";

/* Code & shipping.

   The spine of this chapter is the development read the scan froze into the
   saved report: who commits, how often, how substantial the work is, whether
   the code is theirs, whether it reaches production, whether anyone outside
   uses it, and whether the stars stand up. The deeper live tools (the roster
   chart, the commit forensics) stay where they already live and are mounted
   below as the existing panels. */

function Area({ area, figure }: { area: CodeAreaView; figure?: ReactNode }) {
  return (
    <Panel
      className="code-area"
      challenge={{ id: findingId("code", area.id), title: area.question, claim: `${area.question} ${area.badge.label}. ${area.answer}` }}
    >
      <div className="section-top">
        <div>
          <div className="eyebrow">{area.question}</div>
          <h3 className="code-area-verdict">{area.badge.label}</h3>
        </div>
        <Badge tone={area.badge.tone}>{area.badge.label}</Badge>
      </div>
      <p>{area.answer}</p>
      {figure}
      {area.detail && <p className="subtle-note">{area.detail}</p>}
      {area.next && <div className="status-box">{area.next}</div>}
    </Panel>
  );
}

function CommitterRow({ person }: { person: CodeCommitterView }) {
  const challenge = {
    id: findingId("code", `committer-${person.key}`),
    title: `${person.name} · ${person.match.label}`,
    claim: `${person.name}${person.login ? ` (${person.login})` : ""}: ${person.commits} commits, ${Math.round(person.sharePct)}% of the window. ${person.match.detail}`,
  };
  return (
    <>
      <tr>
        <td>
          <strong>{person.name}</strong>
          {person.login && <> <small>{person.githubUrl ? <ExtLink href={person.githubUrl}>{person.login}</ExtLink> : person.login}</small></>}
          {person.company && <small className="committer-sub">{person.company}</small>}
          {person.orgs && person.orgs.length > 0 && <small className="committer-sub">Public orgs: {person.orgs.join(", ")}</small>}
        </td>
        <td>
          {person.xHandle && person.xUrl
            ? <ExtLink href={person.xUrl}>@{person.xHandle.replace(/^@/, "")}</ExtLink>
            : <span className="contact-missing">No X account recorded</span>}
        </td>
        <td className="num">{person.commits.toLocaleString("en-US")} <small>({Math.round(person.sharePct)}%)</small></td>
        <td className="num">
          {person.last30.toLocaleString("en-US")} / {person.prior60.toLocaleString("en-US")}
          {person.quiet && <> <Badge tone="amber">Stopped</Badge></>}
        </td>
        <td>
          <Badge tone={person.match.tone}>{person.match.label}</Badge>
          {person.freshAccount && <> <Badge tone="amber">New account</Badge></>}
          <small className="committer-sub">{person.match.detail}</small>
          <ChallengeButton target={challenge} />
        </td>
      </tr>
      <tr className="committer-challenge-row">
        <td colSpan={5}><ChallengePanel target={challenge} /></td>
      </tr>
    </>
  );
}

export function CodeChapter({ view, code, legacy }: { view: ReportView; code: CodeView; legacy?: ReactNode }) {
  const read = code.read;
  const committerArea = code.areas.find((area) => area.id === "committers");
  const subject = view.subjectKind === "person" ? "This person" : "This project";
  return (
    <>
      <ChapterHead
        action={code.grade ? <Badge tone={code.grade.tone}>{code.grade.label}</Badge> : undefined}
        eyebrow={`Code & shipping${code.capturedAt ? ` · read ${utcDay(code.capturedAt)}` : ""}`}
        title="Shipping is evidence. Marketing is not."
        description="This chapter reads the public code: how often it changes, who changes it, whether those people are the team this report names, whether the work is substantial, whether it reaches production and whether anyone outside the project uses it."
      />
      {code.noCodeFootprint ? (
        <Panel challenge={{ id: findingId("code", "absent"), title: "No code footprint", claim: "No public code repository is attributed to this subject in the saved report." }}>
          <h2>No public code is attributed to this subject.</h2>
          <p style={{ marginTop: 12 }}>
            {subject} has no repository bound to it in this saved report, so nothing here judges the code. Absence of a public repository is not a finding: closed-source companies are normal. It does mean the code cannot support or contradict any claim the project makes.
          </p>
          <div className="status-box">Bind a repository the project links from a site it controls. A name or ticker match is not an attribution.</div>
        </Panel>
      ) : (
        <>
          {read && code.headline && (
            <ReviewBanner
              title={code.headline}
              body={`${code.target ? `github.com/${code.target}. ` : ""}This is the read the scan froze on ${code.capturedAt ? utcStamp(code.capturedAt) : "the scan date"}, over a ${code.windowDays ?? 90}-day window. It is a saved fact, not a live reading of the repository today.`}
              challenge={{ id: findingId("code", "headline"), title: "Development read", claim: code.headline }}
            />
          )}
          {read && code.metrics.length > 0 && (
            <div className="metric-strip" style={{ margin: "0 0 22px", "--metric-count": code.metrics.length } as React.CSSProperties}>
              {code.metrics.map((metric) => (
                <div className="metric" key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                </div>
              ))}
            </div>
          )}
          {read && code.weeks.length > 1 && (
            <Panel className="code-activity" challenge={{ id: findingId("code", "activity"), title: "Development activity", claim: `Weekly commits over ${code.weeks.length} weeks: ${code.weeks.reduce((sum, week) => sum + week.commits, 0)} commits, ${code.weeks.reduce((sum, week) => sum + week.releases, 0)} releases, ${code.weeks.reduce((sum, week) => sum + week.deploys, 0)} deployments.` }}>
              <div className="section-top">
                <h2>Development over time</h2>
                <Badge tone={code.grade?.tone ?? "neutral"}>{read.cadenceStatus === "unknown" ? "Cadence not established" : `Cadence: ${read.cadenceStatus}`}</Badge>
              </div>
              <ActivityChart weeks={code.weeks} windowDays={code.windowDays ?? 90} source={code.trendSource ?? undefined} />
            </Panel>
          )}
          {!read && (
            <Panel challenge={{ id: findingId("code", "unread"), title: "No development read", claim: code.absentReason ?? "No development read is saved with this report." }}>
              <h2>No development read is saved with this report.</h2>
              <p style={{ marginTop: 12 }}>
                {code.absentReason ?? "This report was saved before the scan read the repository, or the GitHub lane was unavailable at scan time."} The account facts below are what the report does carry. Rescan to record commit cadence, committers, substance, star timing, outside use and production deployments.
              </p>
            </Panel>
          )}
          {code.committers.length > 0 && (
            <Panel className="space-top" challenge={{ id: findingId("code", "roster"), title: "Who commits", claim: code.committers.map((person) => `${person.name}: ${person.commits} commits, ${person.match.label}`).join("; ") }}>
              <div className="section-top">
                <h2>Who is writing this code</h2>
                <Badge tone={committerArea?.badge.tone ?? "neutral"}>{committerArea?.badge.label ?? "Committers"}</Badge>
              </div>
              {committerArea && <p>{committerArea.answer}</p>}
              <p>
                Each committer is matched against the people this report names, by GitHub account, X account and full name. A match is a link between records, not identity verification. No wallet is bound to a committer identity by this read.
              </p>
              <ShareBar committers={code.committers} />
              <div className="table-scroll">
                <table className="score-table committer-table">
                  <thead>
                    <tr>
                      <th scope="col">Committer</th>
                      <th scope="col">X account</th>
                      <th scope="col" className="num">Commits</th>
                      <th scope="col" className="num">Last 30 / prior 60</th>
                      <th scope="col">Named in this report?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {code.committers.map((person) => <CommitterRow key={person.key} person={person} />)}
                  </tbody>
                </table>
              </div>
              {committerArea?.next && <div className="status-box">{committerArea.next}</div>}
              {code.churnDetail && <p className="subtle-note">{code.churnDetail}</p>}
              {code.goneQuiet.length > 0 && (
                <p className="subtle-note">Active before and silent in the last 30 days: {code.goneQuiet.join(", ")}.</p>
              )}
            </Panel>
          )}
          {code.committerNote && <p className="subtle-note">{code.committerNote}</p>}
          {code.areas.length > 0 && (
            <div className="code-areas space-top">
              {code.areas.filter((area) => area.id !== "committers").map((area) => (
                <Area
                  key={area.id}
                  area={area}
                  figure={
                    area.id === "stars" && read?.starBurstSharePct != null
                      ? <BurstMeter burstSharePct={read.starBurstSharePct} total={read.starsTotal ?? null} launchBurst={read.starLaunchBurst} />
                      : area.id === "adoption"
                        ? <OutsideUseBar externalPrs={read?.externalPrs} externalIssues={read?.externalIssues} activeForks={read?.activeForks} downloads={read?.packageDownloadsLastMonth} />
                        : undefined
                  }
                />
              ))}
            </div>
          )}
          {code.account && (
            <Panel className="space-top" challenge={{ id: findingId("code", "account"), title: "The GitHub account", claim: code.account.summary }}>
              <div className="section-top">
                <h2>The account this report reads</h2>
                <Badge tone={code.account.confidence === "gold" ? "green" : "amber"}>
                  {code.account.confidence === "gold" ? "Account match recorded as verified" : "Account match recorded as weak"}
                </Badge>
              </div>
              <p>{code.account.summary}</p>
              <div className="coverage-row"><span>Account</span><strong><ExtLink href={code.account.url}>{code.account.login}</ExtLink></strong></div>
              <div className="coverage-row"><span>Public repositories</span><strong>{code.account.publicRepos.toLocaleString("en-US")} ({code.account.originalCount.toLocaleString("en-US")} original, {code.account.forkCount.toLocaleString("en-US")} forked)</strong></div>
              <div className="coverage-row"><span>Stars across original repositories</span><strong>{code.account.totalStarsOnOriginals.toLocaleString("en-US")}</strong></div>
              {code.account.accountAgeYears != null && (
                <div className="coverage-row"><span>Account age</span><strong>{code.account.accountAgeYears.toFixed(1)} years</strong></div>
              )}
              {code.account.lastActivity && (
                <div className="coverage-row"><span>Most recent push</span><strong>{utcDay(code.account.lastActivity)}</strong></div>
              )}
              {code.account.languages.length > 0 && (
                <div className="coverage-row"><span>Languages</span><strong>{code.account.languages.join(", ")}</strong></div>
              )}
              {code.account.repos.length > 0 && (
                <div className="repo-list">
                  {code.account.repos.map((repo) => (
                    <div className="product-claim" key={repo.url}>
                      <strong>
                        <ExtLink href={repo.url}>{repo.name}</ExtLink>
                        {repo.language && <> <Badge>{repo.language}</Badge></>}
                        {repo.fork && <> <Badge tone="amber">Fork</Badge></>}
                      </strong>
                      <p>{[repo.lastPush ? `Last push ${utcDay(repo.lastPush)}` : null, `${repo.stars.toLocaleString("en-US")} star${repo.stars === 1 ? "" : "s"}`].filter(Boolean).join(" · ")}</p>
                    </div>
                  ))}
                </div>
              )}
              {code.account.repoSampleState === "sample" && (
                <p className="subtle-note">The repositories above are a most-recently-pushed window of the account, not the whole account.</p>
              )}
              {code.account.claimChecks.length > 0 && (
                <details className="disclosure">
                  <summary>Claims checked against this account</summary>
                  <ul className="compact-list">
                    {code.account.claimChecks.map((check, index) => (
                      <li key={index}>{typeof check === "string" ? check : JSON.stringify(check)}</li>
                    ))}
                  </ul>
                </details>
              )}
            </Panel>
          )}
          {(code.coverageLine || code.coverage.length > 0) && (
            <Panel className="space-top" challenge={{ id: findingId("code", "coverage"), title: "What this read saw", claim: `${code.coverageLine ?? ""} ${code.coverage.join(" ")}`.trim() }}>
              <h2>What this read saw</h2>
              {code.coverageLine && <p style={{ marginTop: 12 }}>{code.coverageLine}</p>}
              {code.coverage.length > 0 && (
                <ul className="compact-list">
                  {code.coverage.map((note) => <li key={note}>{note}</li>)}
                </ul>
              )}
              <p className="subtle-note">
                A partial read is not a finding about the project. Where the read could not see something, this chapter says so rather than scoring it as absent.
              </p>
            </Panel>
          )}
        </>
      )}
      {legacy}
    </>
  );
}
