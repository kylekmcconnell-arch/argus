import { ArrowSquareOut, MagnifyingGlass, ShieldWarning } from "@phosphor-icons/react";
import type { SocialActivityAdverseCategory, SocialActivityAdverseMention } from "../data/socialActivity";
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
  socialLeads = [],
  subject,
  summary,
  panelCostToken,
}: {
  leads: Finding[];
  socialLeads?: SocialActivityAdverseMention[];
  subject: string;
  summary?: string;
  panelCostToken?: string;
}) {
  const socialUrls = new Set(socialLeads.map((lead) => lead.tweetUrl));
  const modelLeads = leads.filter((lead) => !lead.source_url || !socialUrls.has(lead.source_url));
  const total = socialLeads.length + modelLeads.length;
  if (!total) return null;
  const specificCount = socialLeads.filter((lead) => lead.specificity === "specific").length;
  const groups: Array<{ category: SocialActivityAdverseCategory; title: string; detail: string }> = [
    { category: "wallet_cluster", title: "Ownership and trading claims", detail: "Posts making checkable claims about wallets, funding, liquidity, holders, or deployer behavior." },
    { category: "operator_history", title: "Operator-history claims", detail: "Posts alleging a link to a prior project, developer, exploit, or launch." },
    { category: "fraud_accusation", title: "Direct fraud warnings", detail: "Posts using explicit scam or rug language without enough structured detail to classify elsewhere." },
    { category: "general_warning", title: "General warnings", detail: "Warnings that provide little or no supporting detail in the post itself." },
  ];
  return (
    <section aria-labelledby="subject-accusation-title">
      <div className="overflow-hidden rounded-[22px] border border-caution/30 bg-[linear-gradient(135deg,rgba(181,107,0,0.09),rgba(255,255,255,0)_52%)]">
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-caution/35 bg-panel text-caution shadow-sm">
            <ShieldWarning size={23} weight="duotone" aria-hidden="true" />
          </div>
          <div>
            <p className="eyebrow text-caution">Risk conversation · direct posts</p>
            <h3 id="subject-accusation-title" className="mt-1 text-[21px] font-semibold tracking-tight text-ink">Warnings people are sharing</h3>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-dim">
              {summary && `${summary} `}
              ARGUS verified that the linked posts exist, not that their allegations are true. Nothing here changes the score until independent evidence corroborates it.
            </p>
          </div>
          <div className="mono w-fit rounded-full border border-caution/30 bg-panel px-3 py-1.5 text-[10px] uppercase tracking-[0.08em] text-caution">
            {total} warning{total === 1 ? "" : "s"} · not scored
          </div>
        </div>
        <div className="grid border-t border-caution/20 bg-panel/70 sm:grid-cols-3">
          <div className="px-5 py-3.5"><p className="stat-label">Direct warnings found</p><p className="mt-1 text-[19px] font-semibold text-ink">{total}</p></div>
          <div className="border-y border-caution/15 px-5 py-3.5 sm:border-x sm:border-y-0"><p className="stat-label">Specific, checkable claims</p><p className="mt-1 text-[19px] font-semibold text-caution">{specificCount}</p></div>
          <div className="px-5 py-3.5"><p className="stat-label">Effect on score</p><p className="mt-1 text-[13px] font-semibold text-ink">None until verified</p></div>
        </div>
      </div>
      {groups.map((group) => {
        const items = socialLeads.filter((lead) => lead.category === group.category);
        if (!items.length) return null;
        return (
          <div key={group.category} className="mt-5">
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h4 className="text-[15px] font-semibold text-ink">{group.title}</h4>
                <p className="mt-0.5 text-[11.5px] text-ink-faint">{group.detail}</p>
              </div>
              <span className="chip">{items.length} post{items.length === 1 ? "" : "s"}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {items.map((lead) => (
                <article key={lead.postId} className="panel relative overflow-hidden p-4" aria-label={`Unverified warning from ${lead.handle}`}>
                  <div className={`absolute inset-y-0 left-0 w-1 ${lead.specificity === "specific" ? "bg-caution" : "bg-ink-faint/35"}`} />
                  <div className="flex items-start gap-3 pl-1">
                    {lead.avatarUrl ? (
                      <img src={lead.avatarUrl} alt="" className="h-12 w-12 shrink-0 rounded-full border border-line object-cover" />
                    ) : (
                      <PfpAvatar handle={lead.handle.replace(/^@/, "")} panelCostToken={panelCostToken} size={48} />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-[14px] font-semibold text-ink">{lead.displayName || lead.handle}</p>
                        {lead.displayName && <span className="mono text-[10.5px] text-ink-faint">{lead.handle}</span>}
                        <span className={`chip ${lead.specificity === "specific" ? "tint-caution" : ""}`}>{lead.specificity === "specific" ? "specific claim" : "general warning"}</span>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-faint">
                        {lead.followers !== undefined ? `${lead.followers.toLocaleString()} followers · audience size, not credibility` : "Audience size unavailable"}
                      </p>
                      <blockquote className="mt-3 text-[13.5px] leading-relaxed text-ink">“{lead.text}”</blockquote>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {lead.signals.slice(0, 3).map((signal) => <span key={signal} className="chip">{signal}</span>)}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3">
                        <p className="text-[11.5px] text-ink-dim">Post verified · claim uncorroborated</p>
                        <a href={lead.tweetUrl} target="_blank" rel="noopener noreferrer" className="link-ext mono inline-flex items-center gap-1.5 text-[11px]">
                          View post <ArrowSquareOut size={12} weight="bold" aria-hidden="true" />
                        </a>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        );
      })}
      {modelLeads.length > 0 && <div className="mt-5 grid gap-3 md:grid-cols-2">
        {modelLeads.map((lead, index) => {
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
      </div>}
    </section>
  );
}
