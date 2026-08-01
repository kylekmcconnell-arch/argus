import { usdCompact } from "../lib/format";

/**
 * OPERATOR TRACK RECORD: the strongest thing ARGUS knows about a launchpad
 * token, rendered as the dossier it already is instead of one grey sentence.
 *
 * Nobody else joins an X following edge to a bio claim to a launch-announcement
 * post to a launchpad creator index. The server does that work in
 * server/adapters/operatorLaunches.ts; this panel keeps the STRUCTURE the
 * flattening threw away: which prior launch resolved to a live market, how it
 * was tied to the operator, what it is worth now, and, held apart in a quieter
 * group, the projects the operator only CLAIMS.
 *
 * The line ARGUS does not cross: a claimed project with no live market today is
 * reported as the operator's own dated claim, in their own words, with a link to
 * the post. It is never reported as an outcome, and never as abandonment.
 *
 * The prop type mirrors OperatorLaunchHistory field for field. It is restated
 * here rather than imported because pulling server/adapters/operatorLaunches
 * into the app tsconfig drags server/config + server/cost (node globals) in with
 * it and breaks `npm run typecheck`.
 */

export type OperatorLaunchLink = "same_creator_wallet" | "operator_bio_project" | "operator_announcement";

export interface OperatorPriorLaunch {
  symbol: string;
  name?: string;
  mint: string;
  chain: string;
  /** Current fully diluted value: what the launch is worth now, not at its peak. */
  fdvUsd: number | null;
  liquidityUsd: number | null;
  xHandle?: string;
  createdAt?: string;
  /** Launchpad mint date. One clock, so two launches can be measured against each other. */
  mintedAt?: string;
  /** The highest value this launch is known to have reached, when one survived vetting. */
  athUsd?: number;
  /** When that peak printed, when the accepted peak carried a date. */
  athAt?: string;
  /** The operator's own post claiming this launch: the receipt a reader can open. */
  permalink?: string;
  url: string;
  /** How this launch was tied to the operator; never an inference. */
  link: OperatorLaunchLink;
  announcement?: { text: string; at?: string; url?: string };
}

export interface OperatorClaimedProject {
  label: string;
  at?: string;
  quote: string;
  /** Permalink to the post the claim came from, when the source carried one. */
  url?: string;
}

export interface OperatorLaunchHistoryView {
  creatorWallet?: string;
  launches: OperatorPriorLaunch[];
  /** When the launchpad minted the token under audit, on the same clock as mintedAt. */
  subjectMintedAt?: string;
  totalLaunches: number;
  claimedProjects: OperatorClaimedProject[];
}

/** How the tie was established, said in the source's own terms. */
const LINK_LABEL: Record<OperatorLaunchLink, string> = {
  same_creator_wallet: "same creator wallet",
  operator_bio_project: "named in the operator's bio",
  operator_announcement: "the operator's own launch post",
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function monthYear(at?: string): string | null {
  const parsed = at ? new Date(at) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed.toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
    : null;
}

/** Plain distance between two launch dates. Neutral units, no adjectives. */
function launchInterval(earlier: number, later: number): string | null {
  const days = Math.round(Math.abs(later - earlier) / 86_400_000);
  if (!Number.isFinite(days)) return null;
  if (days < 1) return "under a day apart";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} apart`;
  if (days < 120) return `${Math.round(days / 7)} weeks apart`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} apart`;
}

/** Below this a move off the peak is market noise, not a track record. */
const MATERIAL_DECLINE_PCT = 10;

/**
 * Decline from the vetted peak. Only stated when both numbers are real and the
 * peak is genuinely above today's value, so a token trading at or near its high
 * never picks up a decline it does not have. Matches the server's own floor and
 * precision (server/adapters/operatorLaunches.ts describeDecline) so the panel
 * and the finding can never print two different numbers.
 */
function declineFromPeak(now?: number | null, peak?: number | null): { pct: number; peakUsd: number } | null {
  if (!finite(now) || !finite(peak) || peak <= 0 || !(now > 0) || now >= peak) return null;
  const pct = ((peak - now) / peak) * 100;
  return pct >= MATERIAL_DECLINE_PCT ? { pct, peakUsd: peak } : null;
}

const shortWallet = (wallet: string): string =>
  wallet.length > 12 ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : wallet;

const bareHandle = (handle: string): string => handle.trim().replace(/^@+/, "");

export function OperatorTrackRecord({
  history,
  operatorHandle,
  creatorWallet,
}: {
  history: OperatorLaunchHistoryView;
  operatorHandle: string;
  creatorWallet?: string;
}) {
  const launches = history?.launches ?? [];
  const claimed = history?.claimedProjects ?? [];
  // One launch and nothing claimed is not a track record. Render nothing rather
  // than an empty shell that implies a finding.
  if (!launches.length && !claimed.length) return null;

  const handle = bareHandle(operatorHandle ?? "");
  const wallet = creatorWallet ?? history?.creatorWallet;
  const total = Math.max(history?.totalLaunches ?? 0, launches.length + 1);

  // Spacing is measured on the launchpad clock only (mintedAt plus the subject's
  // own mint), never on a pool-creation date from whichever source resolved the
  // launch. Two launches are one interval and one interval is not a rate, so
  // three or more dates report no spacing here at all.
  const dates = [...launches.map((launch) => launch.mintedAt), history?.subjectMintedAt]
    .map((at) => (at ? Date.parse(at) : Number.NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b);
  const interval = dates.length === 2 ? launchInterval(dates[0], dates[1]) : null;

  const showsPeak = launches.some((launch) => declineFromPeak(launch.fdvUsd, launch.athUsd) !== null);

  const sources = new Set<string>();
  if (wallet) sources.add("the pump.fun creator index");
  for (const launch of launches) {
    sources.add(launch.link === "same_creator_wallet" ? "the pump.fun creator index" : "dexscreener markets");
    if (launch.announcement) sources.add("the operator's own posts");
  }
  if (claimed.length) sources.add("the operator's own posts");

  return (
    <section className="panel scroll-mt-28 px-4 py-4 sm:px-5" aria-labelledby="operator-track-record-title">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="operator-track-record-title" className="text-[13.5px] font-semibold tracking-tight text-ink">
          Operator track record
          {handle && (
            <>
              {" "}
              <a
                href={`https://x.com/${encodeURIComponent(handle)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="link-ext mono text-[11px] font-normal"
              >
                @{handle}
              </a>
            </>
          )}
        </h2>
        {wallet && (
          <a
            href={`https://pump.fun/profile/${encodeURIComponent(wallet)}`}
            target="_blank"
            rel="noopener noreferrer"
            title={wallet}
            className="link-ext mono text-[11px] text-ink-faint"
          >
            creator wallet {shortWallet(wallet)}
          </a>
        )}
      </div>

      {launches.length > 0 && (
        <p className="mt-2 text-[12.5px] leading-relaxed text-ink">
          Launch {total} of {total} traced to this operator.
          {interval ? ` The two dated launches are ${interval}.` : ""}
        </p>
      )}

      {launches.length > 0 && (
        <ol className="mt-3 divide-y divide-line/60 border-t border-line/60">
          {launches.map((launch) => {
            const minted = monthYear(launch.mintedAt ?? launch.createdAt);
            const drop = declineFromPeak(launch.fdvUsd, launch.athUsd);
            const peaked = monthYear(launch.athAt);
            const receipt = launch.permalink ?? launch.announcement?.url;
            const provenance = [launch.name, LINK_LABEL[launch.link]].filter(Boolean).join(" · ");
            return (
              <li key={launch.mint} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
                <div className="min-w-0">
                  <a
                    href={launch.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-ext mono text-[13.5px] font-medium text-ink"
                  >
                    {launch.symbol || launch.mint.slice(0, 6)}
                  </a>
                  {minted && <span className="mono ml-2 text-[11px] text-ink-faint">minted {minted}</span>}
                  {receipt && (
                    <a
                      href={receipt}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="link-ext mono ml-2 text-[11px] text-ink-faint"
                    >
                      the post
                    </a>
                  )}
                  {provenance && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{provenance}</p>}
                </div>
                <div className="shrink-0 text-right">
                  <div className="stat-label">value now</div>
                  <div className="stat-value">
                    {finite(launch.fdvUsd) && launch.fdvUsd > 0 ? usdCompact(launch.fdvUsd) : "not reported"}
                  </div>
                  {drop && (
                    <div className="mono text-[11px] text-caution">
                      down {drop.pct.toFixed(1)}% from its {usdCompact(drop.peakUsd)} peak{peaked ? ` in ${peaked}` : ""}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {claimed.length > 0 && (
        <div className={`border-t border-line/60 pt-3 ${launches.length ? "mt-4" : "mt-3"}`}>
          <div id="operator-claimed-projects-title" className="text-[12.5px] font-medium text-ink-dim">
            The operator's own claims
          </div>
          {/*
            What the evidence is: a post of the operator's that announces a
            launch and names a project. That is NOT the same as the operator
            saying they launched that project, and the difference is real. In
            the recorded $LINKR audit one claim is "@pmpr_bot", pulled from
            "Creator rewards config is now live ... Just tag @pmpr_bot", a post
            which claims no authorship of anything. The panel says what the
            posts do, quotes them, and lets the reader read them.
          */}
          <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
            This account's own launch posts name {claimed.length} other project
            {claimed.length === 1 ? "" : "s"}. No traded market resolved to{" "}
            {claimed.length === 1 ? "it" : "them"} in this scan, so what stands is the claim, its date, and the
            operator's own words.
          </p>
          <ul className="mt-2 space-y-1.5" aria-labelledby="operator-claimed-projects-title">
            {claimed.map((project) => {
              const at = monthYear(project.at);
              return (
                <li key={`${project.label}-${project.at ?? ""}`} className="panel-inset px-3 py-2">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="mono text-[11px] text-ink-dim">{project.label}</span>
                    {at && <span className="mono text-[11px] text-ink-faint">{at}</span>}
                    {project.url && (
                      <a
                        href={project.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="link-ext mono ml-auto text-[11px] text-ink-faint"
                      >
                        the post
                      </a>
                    )}
                  </div>
                  {project.quote && (
                    <blockquote className="mt-1 text-[11px] leading-relaxed text-ink-faint">"{project.quote}"</blockquote>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {sources.size > 0 && (
        <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
          {/*
            "Every value is what the market says today" stopped being true the
            moment a row could also show a dated peak, so the peak clause
            appears only on a panel that actually shows one. A panel with no
            vetted peak must not so much as mention the word.
          */}
          Traced from {[...sources].join(", ")}. Each launch's value now is what the market says today
          {showsPeak ? "; a peak is the highest value these sources agree on" : ""}.
        </p>
      )}
    </section>
  );
}
