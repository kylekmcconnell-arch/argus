import type { ReactNode } from "react";
import { DisclosureButton, InlinePanel } from "../disclosure";
import { useArgusReport } from "../context";
import { Badge, ChallengeButton, ChallengePanel, ChapterHead, ExtLink, Panel, ReviewBanner, type ChallengeTarget } from "../primitives";
import { findingId, initials, type PersonContacts } from "../model";
import type { PersonCardView, ReportView } from "../view";

export function ContactList({ name, contacts }: { name: string; contacts: PersonContacts }) {
  const rows: Array<[keyof Pick<PersonContacts, "x" | "telegram" | "linkedin" | "email">, string]> = [
    ["x", "X"],
    ["telegram", "Telegram"],
    ["linkedin", "LinkedIn"],
    ["email", "Email"],
  ];
  return (
    <dl className="person-contacts" aria-label={`Contact links for ${name}`}>
      {rows.map(([key, label]) => {
        const value = contacts[key];
        const needsCorrection = key === "linkedin" && !value && contacts.linkedinIssue;
        return (
          <div key={key}>
            <dt>{label}</dt>
            <dd>
              {value
                ? key === "email"
                  ? <a href={value.url}>{value.label} <span aria-hidden="true">↗</span></a>
                  : <ExtLink href={value.url}>{value.label}</ExtLink>
                : <span className="contact-missing">{needsCorrection ? "Link needs correction" : "Not available"}</span>}
              {key === "linkedin" && contacts.linkedinIssue && <small className="contact-warning">{contacts.linkedinIssue}</small>}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

function PersonCard({ person }: { person: PersonCardView }) {
  const panelId = `person:${person.key}`;
  const challenge: ChallengeTarget = {
    id: findingId("people", person.key),
    title: `${person.name} · ${person.role}`,
    claim: `${person.name}, ${person.role}. ${person.badge.label}. ${person.text}`,
  };
  return (
    <>
      <article className="panel person">
        <div className="person-top">
          <span className="avatar" aria-hidden="true">
            {person.avatarUrl ? <img src={person.avatarUrl} alt="" referrerPolicy="no-referrer" /> : initials(person.name)}
          </span>
          <div>
            <h3>{person.name}</h3>
            <p>{person.role}</p>
          </div>
        </div>
        <Badge tone={person.badge.tone}>{person.badge.label}</Badge>
        <p>{person.text}</p>
        <ContactList name={person.name} contacts={person.contacts} />
        <div className="person-actions">
          <small>Contacts from the saved report</small>
          <DisclosureButton id={panelId} className="textbtn">Review evidence →</DisclosureButton>
        </div>
        <ChallengeButton target={challenge} />
      </article>
      <InlinePanel id={panelId} label={person.name}>
        {() => (
          <>
            <Badge tone={person.badge.tone}>{person.badge.label}</Badge>
            <h2 className="dialog-title">{person.name}</h2>
            <h3>{person.role}</h3>
            <p className="dialog-body" style={{ marginTop: 16 }}>{person.text}</p>
            <ContactList name={person.name} contacts={person.contacts} />
            {person.developerProfiles && person.developerProfiles.length > 0 && (
              <div className="dialog-section">
                <h3>Developer profiles</h3>
                <p>
                  {person.developerProfiles.map((profile) => (
                    <span key={profile.url}>
                      <ExtLink href={profile.url}>{profile.label}</ExtLink>
                      {profile.proofUrl && <> <a href={profile.proofUrl} target="_blank" rel="noopener noreferrer">(profile link proof ↗)</a></>}{" "}
                    </span>
                  ))}
                </p>
              </div>
            )}
            <div className="dialog-section">
              <h3>Verification needed</h3>
              <p>Confirm exact platform identity, current role, start and end dates, and first-party or independently corroborated employment evidence. Do not infer prior misconduct or a departure from an absent provider match.</p>
            </div>
            {person.sourceUrl
              ? <ExtLink href={person.sourceUrl}>Open recorded role source ({person.sourceLabel})</ExtLink>
              : <p className="status-box">Recorded by {person.sourceLabel}. The saved report has no direct public artifact link for this role.</p>}
          </>
        )}
      </InlinePanel>
      <ChallengePanel target={challenge} />
    </>
  );
}

export function PeopleChapter({ view, legacy }: { view: ReportView; legacy?: ReactNode }) {
  const report = useArgusReport();
  const people = view.people;
  const isPerson = view.subjectKind === "person";
  return (
    <>
      <ChapterHead
        action={people.identity ? <Badge tone={people.identity.tone}>{people.identity.label}</Badge> : undefined}
        eyebrow="People & control"
        title={isPerson ? "Who this is, and who they work with." : "A named team is the start of diligence."}
        description={people.cards.length
          ? `The roster below preserves all ${people.cards.length} reported ${people.cards.length === 1 ? "person" : "people"}. Contact links are recorded references, not independent identity verification. “Not available” means no contact was retained in the saved report.`
          : "No source-grounded person is published in this saved report. Identity notes and unresolved leads are kept below."}
      />
      {people.verificationConflict && (
        <ReviewBanner
          title="Verification status conflicts across the saved report."
          body={people.verificationConflict}
          challenge={{ id: findingId("people", "verification-conflict"), title: "Verification status conflict", claim: people.verificationConflict }}
        />
      )}
      <div id="identity-evidence" className="scroll-mt-28">
      {people.cards.length > 0 ? (
        <div className="person-grid">
          {people.cards.map((person) => <PersonCard key={person.key} person={person} />)}
        </div>
      ) : people.identityNote ? (
        <Panel challenge={{ id: findingId("people", "identity-note"), title: "Identity note", claim: people.identityNote }}>
          <h2>Identity</h2>
          <p style={{ marginTop: 12 }}>{people.identityNote}</p>
        </Panel>
      ) : null}
      {!isPerson && (
        <div className="chapter-grid space-top">
          <Panel challenge={{ id: findingId("people", "continuity"), title: "Continuity & track record", claim: people.continuity.map((row) => `${row.label}: ${row.value}`).join("; ") }}>
            <h2>Continuity &amp; track record</h2>
            {people.continuity.map((row) => (
              <div className="coverage-row" key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>
            ))}
            <p className="subtle-note">No match in a licensed employment record is neither a confirmed departure nor proof of a false role. The record may lag. No previous-company outcome or prior misconduct finding is established by these rows.</p>
          </Panel>
          <Panel challenge={{ id: findingId("people", "control"), title: "Who controls the company?", claim: people.control }}>
            <h2>Who controls the company?</h2>
            <p style={{ marginTop: 15 }}>{people.control}</p>
            <div className="status-box">Request the corporate registration, current director records, ownership and related-party disclosures. Bind each to the same legal entity.</div>
            <button type="button" className="textbtn" style={{ display: "inline-block", marginTop: 20 }} onClick={() => report.goTo("evidence")}>Review legal and control gaps →</button>
          </Panel>
        </div>
      )}
      {legacy}
      </div>
    </>
  );
}
