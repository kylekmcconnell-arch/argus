import type { ShippingSummaryWeek } from "../../../threat/shipping";
import type { CodeCommitterView } from "../codeView";

/* The Code chapter's pictures.

   Each one draws a figure that is already in the frozen read: the weekly
   commit series with release and deploy markers, how the commits divide
   between the people who wrote them, and how much of the star count arrived
   in its largest burst. Nothing is smoothed, extrapolated or invented, and a
   series the read never took is not drawn at all. */

const CHART_W = 720;
const CHART_H = 150;
const PAD_B = 22;

function utcWeek(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** Weekly commits as bars, the token's price as a line, releases and deploys as markers. */
export function ActivityChart({ weeks, windowDays, source }: { weeks: ShippingSummaryWeek[]; windowDays: number; source?: string }) {
  if (weeks.length < 2) return null;
  const maxCommits = Math.max(1, ...weeks.map((week) => week.commits));
  const prices = weeks.map((week) => week.price).filter((price): price is number => price != null && Number.isFinite(price));
  const hasPrice = prices.length >= 2;
  const minPrice = hasPrice ? Math.min(...prices) : 0;
  const maxPrice = hasPrice ? Math.max(...prices) : 1;
  const slot = CHART_W / weeks.length;
  const barW = Math.max(2, slot - 2);
  const plotH = CHART_H - PAD_B;
  const x = (index: number) => index * slot;
  const priceY = (price: number) => plotH - ((price - minPrice) / Math.max(1e-12, maxPrice - minPrice)) * (plotH - 12) - 4;
  const linePoints = weeks
    .map((week, index) => (week.price != null ? `${(x(index) + barW / 2).toFixed(1)},${priceY(week.price).toFixed(1)}` : null))
    .filter((point): point is string => point != null)
    .join(" ");
  // The window the verdict was read over, shaded at the right-hand end.
  const windowWeeks = Math.min(weeks.length, Math.max(1, Math.round(windowDays / 7)));
  const totalCommits = weeks.reduce((sum, week) => sum + week.commits, 0);
  const releases = weeks.reduce((sum, week) => sum + week.releases, 0);
  const deploys = weeks.reduce((sum, week) => sum + week.deploys, 0);
  return (
    <figure className="code-chart">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`Weekly commits from ${utcWeek(weeks[0].weekStart)} to ${utcWeek(weeks[weeks.length - 1].weekStart)}: ${totalCommits} commits in total, busiest week ${maxCommits}, ${releases} releases and ${deploys} on-chain deployments marked.${hasPrice ? " The line is the token's weekly price." : ""}`}
      >
        <rect x={x(weeks.length - windowWeeks)} y={0} width={CHART_W - x(weeks.length - windowWeeks)} height={plotH} className="chart-window" />
        <line x1={0} y1={plotH} x2={CHART_W} y2={plotH} className="chart-axis" />
        {weeks.map((week, index) => {
          const height = (week.commits / maxCommits) * (plotH - 10);
          return (
            <rect
              key={week.weekStart}
              x={x(index)}
              y={plotH - height}
              width={barW}
              height={Math.max(week.commits > 0 ? 1.5 : 0, height)}
              className="chart-bar"
            >
              <title>{`${utcWeek(week.weekStart)}: ${week.commits} commits${week.releases ? `, ${week.releases} release${week.releases === 1 ? "" : "s"}` : ""}${week.deploys ? `, ${week.deploys} deployment${week.deploys === 1 ? "" : "s"}` : ""}`}</title>
            </rect>
          );
        })}
        {hasPrice && <polyline points={linePoints} className="chart-price" />}
        {weeks.map((week, index) => (
          <g key={`marks-${week.weekStart}`}>
            {week.releases > 0 && <circle cx={x(index) + barW / 2} cy={plotH + 7} r={2.6} className="chart-release"><title>{`${utcWeek(week.weekStart)}: ${week.releases} release${week.releases === 1 ? "" : "s"}`}</title></circle>}
            {week.deploys > 0 && <rect x={x(index) + barW / 2 - 2.4} y={plotH + 12} width={4.8} height={4.8} className="chart-deploy"><title>{`${utcWeek(week.weekStart)}: ${week.deploys} on-chain deployment${week.deploys === 1 ? "" : "s"}`}</title></rect>}
          </g>
        ))}
      </svg>
      <div className="legend-row">
        <span>{utcWeek(weeks[0].weekStart)}</span>
        <span>{utcWeek(weeks[weeks.length - 1].weekStart)}</span>
      </div>
      <figcaption className="chart-legend">
        <span className="key key-bar">Commits a week</span>
        {hasPrice && <span className="key key-price">Token price</span>}
        {releases > 0 && <span className="key key-release">Release</span>}
        {deploys > 0 && <span className="key key-deploy">On-chain deployment</span>}
        <span className="key key-window">The {windowDays}-day window this verdict reads</span>
      </figcaption>
      {source === "window-commits" && (
        <p className="subtle-note">Weekly counts are taken from the commits read in the window, so weeks before it are not drawn.</p>
      )}
    </figure>
  );
}

/** How the window's commits divide between the people who wrote them. */
export function ShareBar({ committers }: { committers: CodeCommitterView[] }) {
  const shown = committers.filter((person) => person.sharePct > 0).slice(0, 6);
  if (shown.length === 0) return null;
  const tone = (person: CodeCommitterView) => (person.kind !== "human" ? "muted" : person.match.tone === "green" ? "named" : "unnamed");
  const accounted = shown.reduce((sum, person) => sum + person.sharePct, 0);
  return (
    <div className="share-figure">
      <div className="share-bar" role="img" aria-label={`Share of commits: ${shown.map((person) => `${person.name} ${Math.round(person.sharePct)}%`).join(", ")}`}>
        {shown.map((person) => (
          <span key={person.key} className={`share-seg share-${tone(person)}`} style={{ width: `${Math.max(1, person.sharePct)}%` }} title={`${person.name}: ${Math.round(person.sharePct)}%`} />
        ))}
        {accounted < 99 && <span className="share-seg share-rest" style={{ width: `${Math.max(1, 100 - accounted)}%` }} title="Everyone else" />}
      </div>
      <div className="chart-legend">
        <span className="key key-named">Named in this report</span>
        <span className="key key-unnamed">Not named</span>
        <span className="key key-muted">Automation or mirror</span>
      </div>
    </div>
  );
}

/** How much of the star count arrived in its largest three-day burst. */
export function BurstMeter({ burstSharePct, total, launchBurst }: { burstSharePct: number; total?: number | null; launchBurst?: boolean }) {
  const share = Math.max(0, Math.min(100, burstSharePct));
  return (
    <div className="burst-figure">
      <div className="burst-bar" role="img" aria-label={`${Math.round(share)}% of stars arrived in the largest three-day burst${total != null ? ` of ${total} in total` : ""}.`}>
        <span className={`burst-fill${share >= 50 && !launchBurst ? " is-suspect" : ""}`} style={{ width: `${share}%` }} />
      </div>
      <div className="legend-row">
        <span><strong>{Math.round(share)}%</strong> in the largest three-day burst</span>
        <span>{total != null ? `${total.toLocaleString("en-US")} stars in total` : "Total not recorded"}</span>
      </div>
    </div>
  );
}

/** Contributions from inside the project against contributions from outside it. */
export function OutsideUseBar({ externalPrs, externalIssues, activeForks, downloads }: { externalPrs?: number | null; externalIssues?: number | null; activeForks?: number | null; downloads?: number | null }) {
  const rows = [
    { label: "Pull requests from outside", value: externalPrs },
    { label: "Issues from outside", value: externalIssues },
    { label: "Forks pushed to in the window", value: activeForks },
    { label: "Package downloads last month", value: downloads },
  ].filter((row): row is { label: string; value: number } => row.value != null && Number.isFinite(row.value));
  if (rows.length === 0) return null;
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="use-figure">
      {rows.map((row) => (
        <div className="use-row" key={row.label}>
          <span>{row.label}</span>
          <div className="mini-bar"><i style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <strong>{row.value.toLocaleString("en-US")}</strong>
        </div>
      ))}
    </div>
  );
}
