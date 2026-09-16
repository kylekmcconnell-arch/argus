import type { MaterialReportDelta } from "../lib/reportDelta";
import { cadenceStatusLabel, shippingGradeLabel, type ShippingSummary } from "../threat/shipping";

// The frozen development read, printed with the report. This is the scan-time
// summary the engine scored and the checklist closed, so it survives into the
// PDF and the share link; the on-click panel below it carries the roster,
// the chart and the evidence. Everything here is a saved fact, not a live read.
const GRADE_TONE: Record<ShippingSummary["grade"], string> = {
  "shipping-team": "tint-good",
  "shipping-solo": "tint-signal",
  thin: "tint-caution",
  stalled: "tint-avoid",
  unknown: "",
};

const plain = (s: string) => s.replace(/-/g, " ");

function Cell({ label, value, tone }: { label: string; value: string; tone?: "good" | "caution" | "avoid" }) {
  const color = tone === "good" ? "text-good" : tone === "caution" ? "text-caution" : tone === "avoid" ? "text-avoid" : "text-ink";
  return (
    <div className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className={`text-[12.5px] ${color}`}>{value}</span>
    </div>
  );
}

export function ShippingScorecard({ shipping, delta, githubOrg }: { shipping?: ShippingSummary; delta?: MaterialReportDelta | null; githubOrg?: string | null }) {
  if (!shipping) {
    if (!githubOrg) return null;
    return (
      <section id="development" className="panel mt-4 scroll-mt-28 px-5 py-4">
        <div className="eyebrow">Development · github.com/{githubOrg}</div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">A repository is linked but the scan did not read it. Rescan with the GitHub lane configured, or run the shipping assessment below.</p>
      </section>
    );
  }
  const s = shipping;
  const dev = delta?.category === "development" ? delta : null;
  return (
    <section id="development" className="panel mt-4 scroll-mt-28 px-5 py-4" aria-label="Development read">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Development · github.com/{s.target} · frozen {s.capturedAt.slice(0, 10)}</span>
        <span className={`btn-chip ${GRADE_TONE[s.grade]}`}>{shippingGradeLabel(s.grade)}</span>
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{s.headline}</p>
      {dev && <p className="mt-1 text-[12.5px] leading-relaxed text-avoid">{dev.headline}. {dev.consequence}</p>}
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Cell label="Cadence" value={`${cadenceStatusLabel(s.cadenceStatus)} · ${s.totalCommits} commits · ${s.activeWeeks} active weeks`} />
        <Cell label="Who" value={`${s.distinctHuman} human · ${plain(s.concentration)}${s.leadDeparted ? " · lead stopped" : ""}`} tone={s.leadDeparted ? "avoid" : undefined} />
        <Cell label="Authorship · origin" value={`${plain(s.authorship)} · ${plain(s.origin)}`} />
        <Cell label="Reaching production" value={plain(s.live)} tone={s.live === "live" ? "good" : s.live === "deploys-without-code" ? "caution" : undefined} />
        <Cell label="Used by outsiders" value={s.adoption} tone={s.adoption === "used" ? "good" : s.adoption === "unused" ? "caution" : undefined} />
        <Cell label="Stars" value={s.stars} tone={s.stars === "suspect" ? "avoid" : undefined} />
        <Cell label="Repo health" value={s.health} tone={s.health === "poor" ? "avoid" : s.health === "sound" ? "good" : undefined} />
        <Cell label="Chart vs commits" value={plain(s.market)} tone={s.market === "price-without-shipping" ? "avoid" : s.market === "shipping-into-weakness" ? "good" : undefined} />
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-ink-faint">
        Read {s.reposRead} repos and {s.commitsRead} commits over {s.windowDays} days{s.releasesInWindow ? `, ${s.releasesInWindow} release${s.releasesInWindow === 1 ? "" : "s"}` : ""}. The full roster, the yearly chart, claims against the commit log and the sector comparison are in the shipping panel below.
      </p>
    </section>
  );
}
