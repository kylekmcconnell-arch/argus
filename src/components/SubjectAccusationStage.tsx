import type { Finding } from "../engine/audit";
import { leadArtifactConfirmed, leadRelationshipLabel, speakerHandleFromLead } from "../lib/subjectLeads";
import { PfpAvatar } from "./PfpCheck";

function safeSourceLink(value?: string): { href: string; label: string } | null {
  if (!value) return null;
  try {
    const parsed = new URL(value.trim());
    if (
      (parsed.protocol === "https:" || parsed.protocol === "http:")
      && parsed.hostname
      && !parsed.username
      && !parsed.password
    ) {
      return {
        href: parsed.href,
        label: `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`,
      };
    }
  } catch {
    // Malformed sources stay visible as unavailable metadata.
  }
  return null;
}

export function SubjectAccusationStage({
  leads,
  subject,
  summary,
  panelCostToken,
}: {
  leads: Finding[];
  subject: string;
  summary?: string;
  panelCostToken?: string;
}) {
  if (!leads.length) return null;
  return (
    <section aria-labelledby="subject-accusation-title">
      <div className="finding tint-caution px-4 py-3">
        <p className="text-[12.5px] leading-relaxed text-ink-dim">
          {summary && `${summary} `}
          Read each one before you rely on this result. Not corroborated is not the same as untrue.
        </p>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {leads.map((lead, index) => {
          const speaker = speakerHandleFromLead(lead);
          const source = safeSourceLink(lead.source_url);
          const confirmed = leadArtifactConfirmed(lead);
          const speakerLabel = speaker
            ? `@${speaker}`
            : lead.source_author?.trim() || "Unnamed source";
          return (
            <article
              key={`${lead.claim}:${index}`}
              className="panel p-4"
              aria-label={`Unverified accusation ${index + 1}`}
            >
              <div className="flex items-start gap-3">
                <PfpAvatar
                  handle={speaker ?? undefined}
                  panelCostToken={speaker ? panelCostToken : undefined}
                  size={48}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[14px] font-semibold text-ink">{speakerLabel}</p>
                    <span className="chip tint-caution">{leadRelationshipLabel(lead, subject)}</span>
                    <span className="chip">unconfirmed · not scored</span>
                  </div>
                  <blockquote className="mt-2 text-[13.5px] leading-relaxed text-ink">
                    “{lead.claim}”
                  </blockquote>
                  <p className="mt-2 text-[12px] font-medium text-caution">
                    We cannot verify this.
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
                    {confirmed
                      ? `This artifact is verified about the named entity, but it is not evidence of conduct by ${subject}.`
                      : `Unverified: no source ARGUS could check corroborates this claim about ${subject}.`}
                  </p>
                  {source ? (
                    <a
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open candidate source for investigative lead ${index + 1}: ${lead.claim}`}
                      title={source.href}
                      className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                    >
                      <span className="shrink-0 text-ink-faint">{confirmed ? "Verified target source" : "Candidate source"}</span>
                      <span className="truncate">{source.label}</span>
                    </a>
                  ) : (
                    <p className="mt-2 text-[11px] text-ink-faint">Candidate source link unavailable</p>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
