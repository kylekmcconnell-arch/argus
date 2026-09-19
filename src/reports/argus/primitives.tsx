import type { ReactNode } from "react";
import { DisclosureButton, InlinePanel, InlineRow } from "./disclosure";
import type { Tone } from "./model";
import { useArgusReport } from "./context";
import type { ChallengeTarget } from "./challengeText";
import { ChallengeForm, SignupGate } from "./challenge";

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <span className={`badge${tone === "neutral" ? "" : ` ${tone}`}`}>{children}</span>;
}

/** An explicit external destination. Opens in a new tab; never wraps a card. */
export function ExtLink({ href, children, className }: { href: string | null | undefined; children: ReactNode; className?: string }) {
  if (!href) return <>{children}</>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function XLogo() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
      <path d="M18.9 2H22l-6.8 7.8L23.2 22H17l-4.8-7.3L5.8 22H2.7l8-9.2L.8 2h6.4l4.4 6.7L18.9 2Zm-1.1 18h1.7L6.2 3.9H4.4L17.8 20Z" />
    </svg>
  );
}

export function CopyGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V4H4v12h4" />
    </svg>
  );
}

export function ChapterHead({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: ReactNode; action?: ReactNode }) {
  return (
    <div className="chapter-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

export type { ChallengeTarget } from "./challengeText";

/** Single-line, independent "Challenge this" action. */
export function ChallengeButton({ target }: { target: ChallengeTarget }) {
  return (
    <DisclosureButton id={`challenge:${target.id}`} className="textbtn challenge-link" aria-label={`Challenge this: ${target.title}`}>
      Challenge this
    </DisclosureButton>
  );
}

/** The inline form (or the shared-view sign-up gate) for one challenge target. */
export function ChallengePanel({ target }: { target: ChallengeTarget }) {
  const report = useArgusReport();
  return (
    <InlinePanel id={`challenge:${target.id}`} label={`Challenge ${target.title}`}>
      {() => (report.readOnly ? <SignupGate /> : <ChallengeForm target={target} />)}
    </InlinePanel>
  );
}

/** The table variant: the challenge form opens in a full-width row. */
export function ChallengeRow({ target, colSpan }: { target: ChallengeTarget; colSpan: number }) {
  const report = useArgusReport();
  return (
    <InlineRow id={`challenge:${target.id}`} label={`Challenge ${target.title}`} colSpan={colSpan}>
      {() => (report.readOnly ? <SignupGate /> : <ChallengeForm target={target} />)}
    </InlineRow>
  );
}

export function ReviewBanner({
  title,
  body,
  action,
  challenge,
}: {
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  challenge?: ChallengeTarget;
}) {
  return (
    <>
      <div className="review-banner">
        <span className="review-icon" aria-hidden="true">△</span>
        <div>
          <strong>{title}</strong>
          {body && <p>{body}</p>}
        </div>
        {action}
        {challenge && <ChallengeButton target={challenge} />}
      </div>
      {challenge && <ChallengePanel target={challenge} />}
    </>
  );
}

/** A report surface with its own challenge control appended, panel directly after. */
export function Panel({
  children,
  className = "",
  challenge,
  as = "section",
  id,
}: {
  children: ReactNode;
  className?: string;
  challenge?: ChallengeTarget | null;
  as?: "section" | "article" | "div";
  id?: string;
}) {
  const Tag = as;
  return (
    <>
      <Tag className={`panel ${className}`.trim()} id={id}>
        {children}
        {challenge && <ChallengeButton target={challenge} />}
      </Tag>
      {challenge && <ChallengePanel target={challenge} />}
    </>
  );
}

/** Existing evidence panels, kept whole under their chapter. */
export function LegacySection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const hasContent = Array.isArray(children) ? children.some(Boolean) : Boolean(children);
  if (!hasContent) return null;
  return (
    <section className="rd-legacy-section" aria-label={title}>
      <div className="rd-legacy-head">
        <h2>{title}</h2>
        {note && <p>{note}</p>}
      </div>
      <div className="rd-legacy">{children}</div>
    </section>
  );
}

/** Copy the exact full contract; the visible address stays selectable. */
export function CopyContract({ address, label }: { address: string; label: string }) {
  const report = useArgusReport();
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(address);
      report.toast(`${label.charAt(0).toUpperCase()}${label.slice(1)} copied.`);
    } catch {
      // Never claim success: the full address stays selectable beside the icon.
      report.toast("Copy was blocked. Select the address to copy it.");
    }
  };
  return (
    <button type="button" className="btn copy-icon" aria-label={`Copy ${label}`} title="Copy contract address" onClick={() => void copy()}>
      <CopyGlyph />
    </button>
  );
}
