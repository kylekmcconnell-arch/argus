import { useMemo, useState } from "react";
import { fetchPanelJson, panelRequestFailure, requiredPanelHeaders, type PanelRequestFailure } from "../lib/panelCostHeaders";
import { fetchOhlcv } from "../lib/priceHistory";
import {
  assessShipping,
  cadenceStatusLabel,
  shippingGradeLabel,
  type ShippingAssessment,
  type ShippingClaim,
  type ShippingCohort,
  type ShippingDeploy,
  type ShippingInput,
  type ShippingPricePoint,
  type ShippingSummary,
} from "../threat/shipping";
import { detectPeerSector } from "../threat/shippingPeers";
import { PanelRequestNotice } from "./PanelRequestNotice";

// Shipping assessment (/api/github-shipping): is the team building, who is
// doing it and are they still here, how substantial is the work, is it theirs,
// is it reaching the chain, is anyone outside using it, are the stars real,
// and how does the cadence compare with the leaders of the sector and with
// tokens at the same stage. The server fetches and normalises; the judgement
// is a pure function (src/threat/shipping) so it re-runs here with the price
// series, the deployer history, the project's own posts, the docs text, the
// previous saved summary and the stage cohort, which the server never sees.
// On-click and metered like the other deep tools.
type ShippingData = {
  available?: boolean;
  note?: string;
  input?: ShippingInput;
  assessment?: ShippingAssessment;
};

const TONE: Record<ShippingAssessment["grade"], string> = {
  "shipping-team": "tint-good",
  "shipping-solo": "tint-signal",
  thin: "tint-caution",
  stalled: "tint-avoid",
  unknown: "",
};

const plain = (s: string) => s.replace(/-/g, " ");

function Row({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "caution" | "avoid" }) {
  const color = tone === "good" ? "text-good" : tone === "caution" ? "text-caution" : tone === "avoid" ? "text-avoid" : "text-ink";
  return (
    <div className="flex flex-col">
      <span className="eyebrow">{label}</span>
      <span className={`text-[13px] ${color}`}>{value}</span>
      {sub && <span className="text-[11.5px] leading-snug text-ink-faint">{sub}</span>}
    </div>
  );
}

/**
 * The one picture: commits per week over the life of the repositories, the
 * token's price on top, releases and deploys as ticks. Bars are commits, the
 * line is price (scaled to its own range), diamonds are releases, triangles
 * are on-chain deploys.
 */
export function TrendChart({ weeks, windowDays }: { weeks: ShippingAssessment["trend"]["weeks"]; windowDays: number }) {
  if (!weeks.length) return null;
  const W = 640;
  const H = 120;
  const padL = 6;
  const padR = 6;
  const padT = 14;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const slot = innerW / weeks.length;
  const maxCommits = Math.max(1, ...weeks.map((w) => w.commits));
  const prices = weeks.map((w) => w.price).filter((p): p is number => p != null && Number.isFinite(p));
  const pMin = prices.length ? Math.min(...prices) : 0;
  const pMax = prices.length ? Math.max(...prices) : 1;
  const priceY = (p: number) => padT + innerH - ((p - pMin) / Math.max(1e-9, pMax - pMin)) * innerH;
  const windowWeeks = Math.ceil(windowDays / 7);
  const windowX = padL + Math.max(0, weeks.length - windowWeeks) * slot;
  const path = weeks
    .map((w, i) => (w.price != null ? `${i === 0 || weeks[i - 1].price == null ? "M" : "L"}${(padL + i * slot + slot / 2).toFixed(1)},${priceY(w.price).toFixed(1)}` : ""))
    .filter(Boolean)
    .join(" ");
  const label = `${weeks.reduce((n, w) => n + w.commits, 0)} commits over ${weeks.length} weeks${prices.length ? ", with price" : ""}; ${weeks.reduce((n, w) => n + w.releases, 0)} releases and ${weeks.reduce((n, w) => n + w.deploys, 0)} deploys marked`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full" role="img" aria-label={label} preserveAspectRatio="none">
      <rect x={windowX} y={padT} width={W - padR - windowX} height={innerH} className="fill-line" opacity={0.25} />
      {weeks.map((w, i) => {
        const h = (w.commits / maxCommits) * innerH;
        const x = padL + i * slot;
        return (
          <g key={w.weekStart}>
            <title>{`${w.weekStart}: ${w.commits} commit${w.commits === 1 ? "" : "s"}${w.price != null ? `, price ${w.price.toPrecision(3)}` : ""}${w.releases ? `, ${w.releases} release${w.releases === 1 ? "" : "s"}` : ""}${w.deploys ? `, ${w.deploys} deploy${w.deploys === 1 ? "" : "s"}` : ""}`}</title>
            <rect x={x + 1} y={padT + innerH - h} width={Math.max(1, slot - 2)} height={h} className={w.commits ? "fill-ink-dim" : "fill-line"} />
            {w.releases > 0 && <polygon points={`${x + slot / 2},${padT - 8} ${x + slot / 2 + 4},${padT - 4} ${x + slot / 2},${padT} ${x + slot / 2 - 4},${padT - 4}`} className="fill-good" />}
            {w.deploys > 0 && <polygon points={`${x + slot / 2 - 4},${H - padB + 12} ${x + slot / 2 + 4},${H - padB + 12} ${x + slot / 2},${H - padB + 4}`} className="fill-signal-lift" />}
          </g>
        );
      })}
      {path && <path d={path} fill="none" className="stroke-avoid" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      <text x={padL} y={H - 4} className="fill-ink-faint" fontSize={9}>{weeks[0].weekStart}</text>
      <text x={W - padR} y={H - 4} textAnchor="end" className="fill-ink-faint" fontSize={9}>{weeks[weeks.length - 1].weekStart}</text>
    </svg>
  );
}

export function GithubShipping({
  org,
  login,
  repo,
  sectorText,
  priceSeries,
  claims,
  deploys,
  docsText,
  previous,
  cohort,
  token,
  projectHandle,
  panelCostToken,
  onAssessed,
}: {
  org?: string;
  login?: string;
  repo?: string;
  /** Free text the sector is detected from: description, bio, site copy. */
  sectorText?: string | null;
  priceSeries?: ShippingPricePoint[];
  claims?: ShippingClaim[];
  /** The project deployer's contract creations and upgrades, so commits can be matched to the chain. */
  deploys?: ShippingDeploy[];
  /** Roadmap or docs text with dated promises. */
  docsText?: string | null;
  /** The frozen summary from the previous saved report. */
  previous?: ShippingSummary | null;
  /** A stage cohort computed elsewhere. */
  cohort?: ShippingCohort | null;
  /** When no series is supplied, daily closes are pulled for this token on click (free, keyless); the deployer's creations and the stage cohort ride along when known. */
  token?: { address: string; chain: string; deployer?: string | null; mcap?: number; ageDays?: number };
  /** The project's X handle: its own recent posts are read on click and graded against the commit log. */
  projectHandle?: string | null;
  panelCostToken?: string;
  /** Called once the assessment is on screen, for callers that persist or record it. */
  onAssessed?: (assessment: ShippingAssessment) => void;
}) {
  const [data, setData] = useState<ShippingData | null>(null);
  const [fetchedSeries, setFetchedSeries] = useState<ShippingPricePoint[] | undefined>(undefined);
  const [fetchedClaims, setFetchedClaims] = useState<ShippingClaim[] | undefined>(undefined);
  const [fetchedDeploys, setFetchedDeploys] = useState<ShippingDeploy[] | undefined>(undefined);
  const [fetchedCohort, setFetchedCohort] = useState<ShippingCohort | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [showCoverage, setShowCoverage] = useState(false);
  const [failure, setFailure] = useState<{ key: string; failure: PanelRequestFailure } | null>(null);
  const sector = useMemo(() => detectPeerSector(sectorText), [sectorText]);
  const target = repo || org || login || "";
  const requestKey = [target, sector?.id ?? "", panelCostToken ?? ""].join(" ");
  const currentFailure = failure?.key === requestKey ? failure.failure : null;

  const run = async () => {
    if (loading || data || currentFailure || !panelCostToken || !target) return;
    setLoading(true);
    try {
      const qs = new URLSearchParams(repo ? { repo } : org ? { org } : { login: login ?? "" });
      if (sector) qs.set("sector", sector.id);
      // The chart is free and keyless, so it rides along with the paid read
      // rather than costing a second click; a missing series is just no read.
      const series = !priceSeries?.length && token?.address && token?.chain
        ? fetchOhlcv(token.address, token.chain, undefined, "day").then((w) => w?.candles.map((c) => ({ date: new Date(c.ts < 1e12 ? c.ts * 1000 : c.ts).toISOString(), close: c.close })), () => undefined)
        : Promise.resolve(undefined);
      const headers = requiredPanelHeaders(panelCostToken);
      const quiet = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);
      // The joins the server never sees: the project's own posts, the
      // deployer's contract creations, and the stage cohort from saved
      // reports. Each is best-effort; a missing join is a coverage note.
      const posts = !claims?.length && projectHandle
        ? quiet(fetchPanelJson<{ available?: boolean; posts?: ShippingClaim[] }>(`/api/x-posts?handle=${encodeURIComponent(projectHandle.replace(/^@/, ""))}`, { headers }).then((r) => (r?.available ? r.posts : undefined)))
        : Promise.resolve(undefined);
      const deployments = !deploys && token?.deployer && token.chain !== "solana"
        ? quiet(fetchPanelJson<{ available?: boolean; deploymentList?: { address: string; at: string }[] }>(`/api/evm-deployer?wallet=${encodeURIComponent(token.deployer)}&chain=${encodeURIComponent(token.chain)}`, { headers }).then((r) => (r?.available && r.deploymentList ? r.deploymentList.filter((x) => x.at).map((x) => ({ address: x.address, date: x.at, kind: "create" as const })) : undefined)))
        : Promise.resolve(undefined);
      const [d, fetched, ownPosts, deployed] = await Promise.all([
        fetchPanelJson<ShippingData>(`/api/github-shipping?${qs}`, { headers }),
        series,
        posts,
        deployments,
      ]);
      if (fetched?.length) setFetchedSeries(fetched);
      if (ownPosts?.length) setFetchedClaims(ownPosts);
      if (deployed?.length) setFetchedDeploys(deployed);
      if (!cohort && token?.chain && d?.assessment) {
        const cq = new URLSearchParams({ chain: token.chain, ref: token.address, commits: String(d.assessment.cadence.totalCommits), authors: String(d.assessment.committers.distinctHuman) });
        if (token.mcap != null) cq.set("mcap", String(token.mcap));
        if (token.ageDays != null) cq.set("ageDays", String(token.ageDays));
        const c = await quiet(fetchPanelJson<{ available?: boolean; cohort?: ShippingCohort }>(`/api/shipping-cohort?${cq}`, { headers }));
        if (c?.available && c.cohort) setFetchedCohort(c.cohort);
      }
      setData(d?.available === false || !d?.input ? { note: d?.note || "GitHub shipping assessment is unavailable right now." } : d);
    } catch (error) {
      setFailure({ key: requestKey, failure: panelRequestFailure(error) });
    } finally {
      setLoading(false);
    }
  };

  // Re-run the judgement locally with everything the server never sees.
  const assessment = useMemo(() => {
    if (!data?.input) return data?.assessment ?? null;
    const series = priceSeries?.length ? priceSeries : fetchedSeries;
    const joinedClaims = claims?.length ? claims : fetchedClaims;
    const joinedDeploys = deploys ?? fetchedDeploys;
    const joinedCohort = cohort ?? fetchedCohort;
    const extra: Partial<ShippingInput> = {
      ...(series?.length ? { priceSeries: series } : {}),
      ...(joinedClaims?.length ? { claims: joinedClaims } : {}),
      ...(joinedDeploys ? { deploys: joinedDeploys } : {}),
      ...(docsText ? { docsText } : {}),
      ...(previous ? { previous } : {}),
      ...(joinedCohort ? { cohort: joinedCohort } : {}),
    };
    if (!Object.keys(extra).length) return data.assessment ?? assessShipping(data.input);
    return assessShipping({ ...data.input, ...extra });
  }, [data, priceSeries, fetchedSeries, claims, fetchedClaims, deploys, fetchedDeploys, docsText, previous, cohort, fetchedCohort]);

  useMemo(() => { if (assessment && onAssessed) onAssessed(assessment); }, [assessment, onAssessed]);

  if (!target) return null;
  if (currentFailure) return <PanelRequestNotice failure={currentFailure} label="GitHub shipping assessment" className="mt-3" />;
  if (!data) {
    return (
      <div className="mt-3 panel p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="eyebrow">Shipping · github.com/{target}</span>
          <button onClick={run} disabled={loading || !panelCostToken} className="btn-chip tint-signal disabled:opacity-50">
            {loading ? "reading the repositories…" : panelCostToken ? "assess shipping →" : "saved report required"}
          </button>
        </div>
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-faint">
          Commit cadence over the repositories' life against the chart, who is committing and whether they are still there, how
          substantial the changes are, whether the code is original or mirrored and whether it reaches the chain, who outside the
          team uses it, whether the stars are proportionate, and how the pace compares with {sector ? sector.label : "the leading repositories in its sector"}.
        </p>
      </div>
    );
  }
  if (!assessment) {
    return (
      <div className="mt-3 panel p-4">
        <div className="eyebrow">Shipping · github.com/{target}</div>
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{data.note}</div>
      </div>
    );
  }

  const a = assessment;
  const topAuthors = a.committers.roster.filter((r) => r.kind !== "bot").slice(0, 8);
  const churn = a.committers.churn;
  return (
    <div className="mt-3 panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="eyebrow">Shipping · github.com/{target}</span>
        <span className={`btn-chip ${TONE[a.grade]}`}>{shippingGradeLabel(a.grade)}</span>
      </div>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink">{a.headline}</p>
      {a.delta && (
        <p className={`mt-1 text-[12.5px] leading-relaxed ${a.delta.stalled ? "text-avoid" : "text-ink-dim"}`}>{a.delta.detail}</p>
      )}

      <div className="mt-3">
        <div className="eyebrow">Commits per week{a.trend.source === "provider-weekly" ? " · last year" : ` · last ${a.windowDays} days`}{a.trend.weeks.some((w) => w.price != null) ? " · price on top" : ""}</div>
        <TrendChart weeks={a.trend.weeks} windowDays={a.windowDays} />
        <p className="text-[11.5px] leading-snug text-ink-faint">{a.trend.detail} Shaded: the {a.windowDays}-day window. Diamonds: releases. Triangles: on-chain deploys.</p>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Row label="Cadence" value={cadenceStatusLabel(a.cadence.status)} sub={`${a.cadence.totalCommits} commits · ${a.cadence.activeWeeks}/${a.cadence.weeks.length} active weeks${a.cadence.longestGapDays != null ? ` · longest gap ${a.cadence.longestGapDays}d` : ""}`} />
        <Row label="Committers" value={a.committers.concentration === "unattributed" ? "Mirror account only" : `${a.committers.distinctHuman} human · ${plain(a.committers.concentration)}`} sub={`top author ${a.committers.top1SharePct}% of commits${a.committers.botSharePct ? ` · ${a.committers.botSharePct}% bots` : ""}${a.committers.mirrorSharePct ? ` · ${a.committers.mirrorSharePct}% mirrored` : ""}`} />
        <Row label="Still there?" value={churn.departed ? "Lead has stopped" : churn.goneQuiet.length ? `${churn.goneQuiet.length} gone quiet` : churn.leadLogin ? "Lead still committing" : "Not enough history"} sub={churn.detail} tone={churn.departed ? "avoid" : churn.goneQuiet.length ? "caution" : undefined} />
        <Row label="Substance" value={a.substance.medianLinesChanged != null ? `${a.substance.medianLinesChanged} lines / commit (median)` : "Not measured"} sub={a.substance.trivialSharePct != null ? `${a.substance.trivialSharePct}% trivial · ${a.substance.bulkDropCount} bulk drops · ${a.cadence.releasesInWindow} releases` : undefined} />
        <Row label="Authorship" value={plain(a.authorship.verdict)} sub={a.authorship.evidence[0]} />
        <Row label="Origin" value={plain(a.origin.verdict)} sub={a.origin.forks.length ? `${a.origin.forks.length} fork${a.origin.forks.length === 1 ? "" : "s"}: ${a.origin.forks.slice(0, 2).map((f) => f.parent).join(", ")}` : a.origin.bulkImports.length ? `opens with a bulk import: ${a.origin.bulkImports[0]}` : "no forks, no bulk imports"} />
        <Row label="Reaching the chain?" value={plain(a.live.verdict)} sub={a.live.detail} tone={a.live.verdict === "live" ? "good" : a.live.verdict === "deploys-without-code" ? "caution" : undefined} />
        <Row label="Used by outsiders?" value={a.adoption.verdict} sub={a.adoption.detail} tone={a.adoption.verdict === "used" ? "good" : a.adoption.verdict === "unused" ? "caution" : undefined} />
        <Row label="Stars" value={a.stars.verdict === "none" ? "None" : `${a.stars.total.toLocaleString("en-US")} · ${a.stars.verdict}`} sub={a.stars.evidence[0]} tone={a.stars.verdict === "suspect" ? "avoid" : undefined} />
        <Row label="Repo health" value={a.health.verdict} sub={a.health.detail} tone={a.health.verdict === "poor" ? "avoid" : a.health.verdict === "sound" ? "good" : undefined} />
        <Row label="Chart vs commits" value={plain(a.market.read)} sub={a.market.detail} tone={a.market.read === "price-without-shipping" ? "avoid" : a.market.read === "shipping-into-weakness" ? "good" : undefined} />
        <Row label="Claims vs code" value={a.claims.graded.length ? `${a.claims.supported} backed · ${a.claims.unsupported} unbacked` : "No shipping claims read"} sub={a.claims.detail} tone={a.claims.unsupported > a.claims.supported ? "avoid" : undefined} />
        <Row label="Roadmap" value={a.roadmap.claims.length ? `${a.roadmap.met} met · ${a.roadmap.missed} missed · ${a.roadmap.pending} ahead` : "No dated promises read"} sub={a.roadmap.detail} tone={a.roadmap.missed > a.roadmap.met ? "avoid" : undefined} />
      </div>

      {topAuthors.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Who is committing</div>
          <div className="mt-1 space-y-1">
            {topAuthors.map((p) => (
              <div key={p.key} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-ink-dim">
                {p.login ? (
                  <a href={`https://github.com/${p.login}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11.5px]">@{p.login}</a>
                ) : (
                  <span className="mono text-[11.5px]">{p.name}</span>
                )}
                {p.name && p.login && p.name !== p.login && <span>{p.name}</span>}
                {p.twitter && <a href={`https://x.com/${p.twitter}`} target="_blank" rel="noreferrer" className="link-ext mono text-[11px]">x.com/{p.twitter}</a>}
                {p.company && <span className="text-ink-faint">{p.company}</span>}
                {p.orgs?.length ? <span className="text-ink-faint">orgs: {p.orgs.slice(0, 3).join(", ")}</span> : null}
                <span className="mono text-[11px] text-ink-faint">{p.sharePct}% · {p.last30} last 30d · {p.prior60} prior 60d</span>
                {p.kind === "mirror" && <span className="mono text-[11px] text-caution">mirror</span>}
                {p.freshAccount && <span className="mono text-[11px] text-caution">new account</span>}
                {p.prior60 >= 3 && p.last30 === 0 && <span className="mono text-[11px] text-avoid">gone quiet</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {a.cohort && (
        <div className="mt-3">
          <div className="eyebrow">At the same stage</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{a.cohort.detail}</p>
        </div>
      )}

      {a.peers && (
        <div className="mt-3">
          <div className="eyebrow">Against {a.peers.label} (the ceiling, not the yardstick)</div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{a.peers.detail}</p>
          <div className="mt-1 overflow-x-auto">
            <table className="mono text-[11px] text-ink-dim">
              <thead><tr><th className="pr-3 text-left font-normal text-ink-faint">repository</th><th className="pr-3 text-right font-normal text-ink-faint">commits/{a.windowDays}d</th><th className="pr-3 text-right font-normal text-ink-faint">authors</th><th className="text-right font-normal text-ink-faint">stars</th></tr></thead>
              <tbody>
                <tr className="text-ink"><td className="pr-3">{a.target}</td><td className="pr-3 text-right">{a.peers.subject.commitsInWindow}</td><td className="pr-3 text-right">{a.peers.subject.authorsInWindow}</td><td className="text-right">{a.peers.subject.stars}</td></tr>
                {a.peers.rows.map((r) => (
                  <tr key={r.nameWithOwner}><td className="pr-3">{r.nameWithOwner}</td><td className="pr-3 text-right">{r.commitsInWindow}</td><td className="pr-3 text-right">{r.authorsInWindow}</td><td className="text-right">{r.stars}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {a.claims.graded.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Shipping claims in the project's posts</div>
          <div className="mt-1 space-y-1">
            {a.claims.graded.slice(0, 6).map((c) => (
              <div key={`${c.date}-${c.text.slice(0, 20)}`} className="text-[12px] leading-snug text-ink-dim">
                <span className={`mono mr-1.5 ${c.grade === "supported" ? "text-good" : c.grade === "unsupported" ? "text-avoid" : "text-caution"}`}>{c.grade}</span>
                <span className="mono text-ink-faint">{c.date.slice(0, 10)}</span>{" "}
                {c.url ? <a href={c.url} target="_blank" rel="noreferrer" className="link-ext">{c.text.slice(0, 120)}</a> : c.text.slice(0, 120)}
                <span className="mono ml-1 text-ink-faint">{c.matchedRelease ? `release ${c.matchedRelease}` : `${c.matchedCommits} commits within a week`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {a.roadmap.claims.length > 0 && (
        <div className="mt-3">
          <div className="eyebrow">Dated promises in the docs</div>
          <div className="mt-1 space-y-1">
            {a.roadmap.claims.slice(0, 8).map((c) => (
              <div key={`${c.due}-${c.text.slice(0, 20)}`} className="text-[12px] leading-snug text-ink-dim">
                <span className={`mono mr-1.5 ${c.grade === "met" ? "text-good" : c.grade === "missed" ? "text-avoid" : c.grade === "pending" ? "text-ink-faint" : "text-caution"}`}>{c.grade}</span>
                <span className="mono text-ink-faint">{c.due.slice(0, 10)}</span> {c.text}
                <span className="mono ml-1 text-ink-faint">{c.evidence}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3">
        <div className="eyebrow">Evidence</div>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-ink-dim">
          {a.evidence.map((e) => <li key={e}>{e}</li>)}
        </ul>
        {a.caveats.length > 0 && (
          <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[12px] leading-snug text-ink-faint">
            {a.caveats.map((c) => <li key={c}>{c}</li>)}
          </ul>
        )}
      </div>

      <div className="mt-3">
        <button onClick={() => setShowCoverage((v) => !v)} className="eyebrow underline-offset-2 hover:underline">
          What this read saw {showCoverage ? "▾" : "▸"}
        </button>
        {showCoverage && (
          <div className="mt-1 text-[11.5px] leading-snug text-ink-faint">
            <div className="mono">
              {a.coverage.reposRead}{a.coverage.reposTotal != null ? ` of ${a.coverage.reposTotal}` : ""} repos · {a.coverage.commitsRead}{a.coverage.commitsCounted > a.coverage.commitsRead ? ` of ${a.coverage.commitsCounted}` : ""} commits in {a.coverage.windowDays}d · {a.coverage.historyRepos} repos mined · {a.coverage.starHistoryDays} star-history days · {a.coverage.weeklyStatsRead ? "yearly stats read" : "no yearly stats"} · {a.coverage.identitiesRead} committer accounts resolved
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {a.coverage.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
