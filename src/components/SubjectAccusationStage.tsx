import { ArrowSquareOut, MagnifyingGlass, ShieldWarning } from "@phosphor-icons/react";
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

function sourceQuality(source: { href: string; label: string } | null): string {
  if (!source) return "No inspectable source";
  const host = new URL(source.href).hostname.replace(/^www\./, "").toLowerCase();
  if (host === "x.com" || host === "twitter.com") return "Original social post";
  if (host.includes("sotwe") || host.includes("twstalker") || host.includes("nitter")) return "Social mirror · weak source";
  if (host.includes("reddit.com") || host.includes("trustpilot")) return "Community allegation";
  return "Candidate web source";
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
      <div className="grid gap-4 border-y border-caution/30 bg-caution/[0.045] px-4 py-4 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-caution/35 bg-panel text-caution">
          <ShieldWarning size={21} weight="duotone" aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow text-caution">Adverse conversation · unverified</p>
          <h3 id="subject-accusation-title" className="mt-1 text-[18px] font-semibold tracking-tight text-ink">What people accused</h3>
          <p className="mt-1 max-w-3xl text-[12.5px] leading-relaxed text-ink-dim">
            {summary && `${summary} `}
            These leads name the subject directly, but none is counted in the score unless independent evidence corroborates it.
          </p>
        </div>
        <div className="mono w-fit rounded-full border border-caution/30 bg-panel px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-caution">
          {leads.length} lead{leads.length === 1 ? "" : "s"} · not scored
        </div>
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
                    <span className="chip">{sourceQuality(source)}</span>
                    <span className="chip">unconfirmed · not scored</span>
                  </div>
                  <blockquote className="mt-2 text-[13.5px] leading-relaxed text-ink">
                    “{lead.claim}”
                  </blockquote>
                  <div className="mt-3 grid gap-2 border-t border-line/70 pt-3 sm:grid-cols-2">
                    <div>
                      <p className="stat-label text-caution">Verification status</p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                        {confirmed
                          ? `The artifact is real, but it does not establish conduct by ${subject}.`
                          : `Uncorroborated. ARGUS found no independent source confirming this claim about ${subject}.`}
                      </p>
                    </div>
                    <div>
                      <p className="stat-label">Check next</p>
                      <p className="mt-1 flex gap-1.5 text-[11.5px] leading-relaxed text-ink-dim">
                        <MagnifyingGlass className="mt-0.5 shrink-0" size={13} aria-hidden="true" />
                        Find an original post, independent report, or first-party response.
                      </p>
                    </div>
                  </div>
                  {source ? (
                    <a
                      href={source.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`Open candidate source for investigative lead ${index + 1}: ${lead.claim}`}
                      title={source.href}
                      className="link-ext mono mt-2 inline-flex max-w-full items-center gap-1.5 text-[11px]"
                    >
                      <span className="shrink-0 text-ink-faint">{confirmed ? "Verified target source" : "Open candidate"}</span>
                      <span className="truncate">{source.label}</span>
                      <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
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
