import { useId } from "react";
import type { CollectedEvidence } from "../data/evidence";

type LaunchVenueSubject = NonNullable<CollectedEvidence["launchVenueSubject"]>;

// Launchpad ecosystem: the audited subject IS a launch venue. A launchpad
// without a native token is never judged on token metrics; what it answers for
// is the mechanics it imposes on every token it launches - who ends up holding
// the liquidity and who collects the fees. Everything renders from the frozen
// registry record; nothing is refetched on open.

const LP_LABEL: Record<string, string> = {
  locked: "Locked",
  burned: "Burned",
  "protocol-owned": "Protocol-owned",
  "creator-held": "Creator-held",
  unknown: "Unknown",
};

export function LaunchVenuePanel({
  snapshot,
  id = "launch-venue",
}: {
  snapshot: LaunchVenueSubject;
  id?: string;
}) {
  const generatedId = useId().replace(/:/g, "");
  const titleId = `${generatedId}-title`;
  const lpLabel = LP_LABEL[snapshot.lpDisposition] ?? snapshot.lpDisposition;
  const lpTone = snapshot.lpDisposition === "locked" || snapshot.lpDisposition === "burned" || snapshot.lpDisposition === "protocol-owned"
    ? "tint-pass"
    : "tint-caution";

  return (
    <section id={id} className="report-section mt-6 scroll-mt-28" aria-labelledby={titleId} data-testid="launch-venue">
      <header className="report-section-heading">
        <div>
          <p className="eyebrow text-signal-lift">Launchpad ecosystem</p>
          <h2 id={titleId} className="story-chapter-title mt-1 font-semibold tracking-tight text-ink">
            What this venue does to every token it launches
          </h2>
          <p className="story-chapter-description mt-2 max-w-3xl leading-relaxed text-ink-dim">
            The verified official domain ({snapshot.matchedDomain}) is the {snapshot.venue} launchpad. A venue is not
            judged on a native token it does not have; it is judged on its launch mechanics, and every token launched
            through it carries its own provenance when scanned.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
          <span className={`chip ${lpTone}`}>Liquidity: {lpLabel}</span>
          <span className="chip tint-neutral">
            {snapshot.platformPaysCreator ? "Creators earn ongoing fees" : "No creator fee stream"}
          </span>
        </div>
      </header>

      <div className="panel mt-3 overflow-hidden">
        <div className="border-b border-line/70 px-4 py-4 sm:px-5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-dim">What happens to launch liquidity</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{snapshot.lpNote}</p>
        </div>
        <div className="border-b border-line/70 px-4 py-4 sm:px-5">
          <div className="text-[10.5px] uppercase tracking-wide text-ink-dim">Who collects trading fees</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink">{snapshot.feeNote}</p>
        </div>
        <div className="px-4 py-3 text-[11.5px] leading-relaxed text-ink-dim sm:px-5">
          {snapshot.chains.length ? `Launches on ${snapshot.chains.join(", ")}. ` : ""}
          Mechanics come from ARGUS&apos;s verified venue registry (venue docs plus live launch reads), frozen with this
          report on {snapshot.capturedAt.slice(0, 10)}.
        </div>
      </div>
    </section>
  );
}
