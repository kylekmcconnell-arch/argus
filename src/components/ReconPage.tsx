import { useState, useCallback, useEffect, useRef } from "react";
import { runRecon, type Recon } from "../collect/recon";
import type { RetrievalStage } from "../collect/retrieve";
import { logAudit } from "../lib/auditlog";
import { ScoreTicker } from "./ScoreTicker";
import type { ReportKind } from "../lib/reports";
import { PrivateToggle } from "./PrivateToggle";
import { beginScan, endScan } from "../lib/activescans";
import { syncReport } from "../lib/reports";
import { verdictMeta } from "../lib/verdict";
import { recordContribution } from "../graph/store";
import type { WebPerson } from "../lib/investigation";
import { ProjectResearch } from "./ProjectResearch";
import { resolveProjectToken, type ResolvedProjectToken } from "../lib/resolveProjectToken";
import { AddInfo } from "./AddInfo";
import { LinkEntity } from "./LinkEntity";
import { SiteHistory } from "./SiteHistory";
import { SiteInfra } from "./SiteInfra";
import { ProjectXAccount } from "./ProjectXAccount";
import type { ReportPersistenceContext, ReportVersionContext } from "../lib/reportVersion";
import { reconResultPolicy } from "../lib/reconResultPolicy";
import { reconReportText } from "../lib/reconReportText";
import { fetchReconWebTeam } from "../lib/reconSupplements";
import { LiveSupplementalNotice, SnapshotEvidenceControl } from "./SnapshotEvidenceControl";

// Turn a finished recon into a graph contribution: the project, its X account,
// and (if found) its on-chain token + that token's own subgraph.
function reconContribution(r: Recon) {
  if (r.retrieval.status === "gap") return null;
  let host: string;
  try { host = new URL(r.retrieval.url).hostname.replace(/^www\./, ""); } catch { return null; }
  const nodes: { type: string; key: string; [k: string]: unknown }[] = [
    { type: "Company", key: host, subject: true, verdict: r.verdict?.verdict, was_rug: r.verdict?.verdict === "FAIL" },
  ];
  const edges: { src: string; dst: string; type: string; [k: string]: unknown }[] = [];
  const x = r.socials.find((s) => /x\.com|twitter\.com/i.test(s.url));
  if (x) {
    const seg = x.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1];
    if (seg && !/status|home|i|share/i.test(seg)) { const h = "@" + seg.toLowerCase(); nodes.push({ type: "Person", key: h }); edges.push({ src: host, dst: h, type: "RUNS_X" }); }
  }
  const f = r.pivot?.found;
  if (f) {
    for (const n of f.graph.nodes) nodes.push(n.subject ? { ...n, verdict: f.verdict } : n);
    for (const e of f.graph.edges) edges.push(e);
    edges.push({ src: host, dst: "$" + f.symbol, type: "TOKEN" });
  }
  return { handle: host, verdict: r.verdict?.verdict, nodes, edges };
}

function Ring({ score, color }: { score: number | null; color: string }) {
  const size = 60, r = size / 2 - 5, c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.7s ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="mono text-[15px] font-semibold tabular" style={{ color }}>{score ?? "N/A"}</span>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  good: "var(--color-pass)",
  warn: "var(--color-caution)",
  bad: "var(--color-avoid)",
  gap: "var(--color-unverifiable)",
};
const GLYPH: Record<string, string> = { good: "✓", warn: "▲", bad: "✗", gap: "◌" };

const OUTCOME_TONE: Record<string, string> = {
  ok: "var(--color-pass)", "spa-stub": "var(--color-caution)",
  blocked: "var(--color-caution)", unreachable: "var(--color-avoid)",
};

const COVERAGE: Record<string, { label: string; color: string; blurb: string }> = {
  rendered: { label: "FULL COVERAGE", color: "var(--color-pass)", blurb: "Page retrieved directly." },
  recovered: { label: "RECOVERED", color: "var(--color-caution)", blurb: "Direct fetch failed; content recovered by rendering the JS app." },
  gap: { label: "COVERAGE GAP", color: "var(--color-unverifiable)", blurb: "Site could not be retrieved or rendered. No content claims are made." },
};

const EXAMPLES = ["neuro-mesh.io", "stripe.com"];

// apex of a host without a public-suffix list — enough to match jup.ag against
// www.jup.ag / station.jup.ag.
const apexOf = (host: string) => { const p = host.toLowerCase().replace(/^www\./, "").split("."); return p.length <= 2 ? p.join(".") : p.slice(-2).join("."); };
const hostFromUrl = (u: string) => { try { return new URL(/^https?:\/\//.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ""); } catch { return u; } };
// Verdict/finding text asserting an absent team — suppressed when a team IS known.
const TEAM_ABSENCE = /\bno team\b|team not (?:established|found)|no (?:leadership|team) section|anonymous team/i;

export function ReconPage({ initialUrl, initialRecon, initialVersionContext, initialPrivate, onAudit, onInvestigate, onOpenRecent, onOpenBrief, onStartFresh }: { initialUrl?: string; initialRecon?: Recon; initialVersionContext?: ReportVersionContext; initialPrivate?: boolean; onAudit?: (q: string, priv?: boolean) => void; onInvestigate?: (q: string, priv?: boolean) => void; onOpenRecent?: (ref: string, kind?: ReportKind) => void; onOpenBrief?: (ref: string) => void; onStartFresh?: () => void }) {
  const [url, setUrl] = useState(initialUrl ?? initialRecon?.retrieval.url ?? "");
  const [priv, setPriv] = useState(!!initialPrivate);
  const privRef = useRef(!!initialPrivate);
  const togglePriv = (v: boolean) => { setPriv(v); privRef.current = v; };
  const [stages, setStages] = useState<RetrievalStage[]>([]);
  const [pivotNotes, setPivotNotes] = useState<string[]>([]);
  const [recon, setRecon] = useState<Recon | null>(initialRecon ?? null);
  const [resultPrivate, setResultPrivate] = useState<boolean | null>(initialRecon ? !!initialPrivate : null);
  const [resultPersistence, setResultPersistence] = useState<ReportPersistenceContext | null>(null);
  const [snapshotContext, setSnapshotContext] = useState<ReportVersionContext | null>(initialVersionContext ?? null);
  const [currentIntelligenceEnabled, setCurrentIntelligenceEnabled] = useState(false);
  const resultPolicy = reconResultPolicy({
    hasRecon: Boolean(recon),
    resultPrivate,
    nextRunPrivate: priv,
    snapshot: Boolean(snapshotContext),
    persistence: resultPersistence,
  });
  const showCurrentIntelligence = (!snapshotContext || currentIntelligenceEnabled)
    && !resultPolicy.displayedPrivate;
  // A Case Brief is valid only for the exact stored snapshot supplied at mount.
  // Any new run clears that binding until the result is reopened from storage.
  const [briefBound, setBriefBound] = useState(Boolean(initialRecon && onOpenBrief));
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [webTeam, setWebTeam] = useState<WebPerson[]>([]);
  const [teamSearching, setTeamSearching] = useState(false);
  const [teamSearched, setTeamSearched] = useState(false);
  const [projToken, setProjToken] = useState<ResolvedProjectToken | null>(null);
  const [redirecting, setRedirecting] = useState<ResolvedProjectToken | null>(null);
  const ran = useRef(!!initialRecon);
  const mounted = useRef(true);
  const runningRef = useRef(false);
  const runSequence = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async (raw: string) => {
    if (runningRef.current) return;
    const target = raw.trim();
    if (!target) return;
    const runPrivate = privRef.current;
    onStartFresh?.();
    setSnapshotContext(null);
    setCurrentIntelligenceEnabled(false);
    runningRef.current = true;
    const runId = ++runSequence.current;
    const isCurrent = () => mounted.current && runId === runSequence.current;
    setUrl(target);
    setRunning(true);
    setRecon(null);
    setResultPrivate(null);
    setResultPersistence({ state: runPrivate ? "private" : "pending" });
    setBriefBound(false);
    setStages([]);
    setPivotNotes([]);
    setWebTeam([]);
    setTeamSearched(false);
    setProjToken(null);
    setRedirecting(null);
    let scanHost = target;
    try { scanHost = new URL(/^https?:\/\//.test(target) ? target : `https://${target}`).hostname.replace(/^www\./, ""); } catch { /* keep */ }
    const scanId = `site:${scanHost}:${Date.now()}`;
    beginScan({ id: scanId, label: scanHost, kind: "site", ref: scanHost, pct: 10 });
    let r: Recon;
    try {
      r = await runRecon(
        target,
        (s) => { if (isCurrent()) setStages((prev) => [...prev, s]); },
        (note) => { if (isCurrent()) setPivotNotes((prev) => [...prev, note]); },
      );
    } catch {
      endScan(scanId);
      if (isCurrent()) setRunning(false);
      runningRef.current = false;
      return;
    }
    if (isCurrent()) {
      setRecon(r);
      setResultPrivate(runPrivate);
    }
    endScan(scanId);

    // Bridge to the token. A JS-app site (jup.ag) can render too thin to surface
    // token signals, so the recon never reaches the token where the real diligence
    // lives. Resolve the project's canonical token by name; if the token's OFFICIAL
    // homepage matches the site we recon'd, this IS that token's project — skip
    // straight to the full investigation. Otherwise (weaker, name-only match) just
    // offer a one-click bridge card.
    if (isCurrent() && r.retrieval.status !== "gap" && !r.isFund && !r.pivot?.found) {
      const t = await resolveProjectToken(r.title || scanHost).catch(() => null);
      if (t && isCurrent()) {
        const officialHost = t.homepage ? hostFromUrl(t.homepage) : null;
        if (onInvestigate && officialHost && apexOf(officialHost) === apexOf(scanHost)) {
          // Provable match — run the full report instead of the thin site recon.
          setRedirecting(t);
          if (isCurrent()) setRunning(false);
          runningRef.current = false;
          onInvestigate(t.contract, runPrivate);
          return;
        }
        setProjToken(t);
      }
    }

    // Private recon: show the keyless result but leave no trace and do not launch
    // paid supplements. The decision is captured at run start, so changing the
    // next-run toggle while collection is in flight cannot make this run public.
    if (runPrivate) {
      if (isCurrent()) setRunning(false);
      runningRef.current = false;
      return;
    }

    // Persist under the bare host (enigma-fund.com), NOT the full URL — the
    // report library and Dossiers lifecycle actions both key on this host.
    let logHost = r.retrieval.url;
    try { logHost = new URL(r.retrieval.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }

    // Persist before launching paid supplements. /api/report returns a signed,
    // short-lived capability for this exact immutable site version; without it,
    // deep team and X discovery fail closed instead of creating unbound spend.
    let persistence: ReportPersistenceContext = { state: "failed" };
    if (r.retrieval.status !== "gap") {
      let host = r.retrieval.url;
      try { host = new URL(r.retrieval.url).hostname.replace(/^www\./, ""); } catch { /* keep */ }
      persistence = await syncReport("site", host, host, { recon: r }, r.verdict?.verdict, r.verdict?.score);
    }
    if (isCurrent()) setResultPersistence(persistence);

    // Coverage gaps remain useful activity-log evidence. Successful recon
    // results compound the shared graph only after their immutable save exists.
    if (r.retrieval.status === "gap" || persistence.state === "persisted") {
      logAudit({
        kind: "site",
        query: logHost,
        ref: logHost,
        verdict: r.verdict?.verdict ?? r.retrieval.status,
        score: r.verdict?.score ?? null,
        coverage: r.retrieval.status,
        summary: r.identityLine,
        flags: [
          r.retrieval.status === "gap" ? "coverage-gap" : "",
          r.team.state === "unnamed-section" ? "team-unnamed" : "",
          r.team.state === "named" ? "team-named" : "",
          r.tokenSignals.length >= 2 ? "token-project" : "",
          r.pivot?.reconcile.tone === "bad" ? "token-claim-unverified" : "",
          r.pivot?.found ? "token-found-onchain" : "",
        ].filter(Boolean),
      });
    }
    if (persistence.state === "persisted") {
      const contribution = reconContribution(r);
      if (contribution) recordContribution(contribution);
    }

    const panelCostToken = persistence.state === "persisted"
      ? persistence.panelCostToken ?? undefined
      : undefined;
    if (isCurrent() && r.retrieval.status !== "gap" && panelCostToken) {
      setTeamSearching(true);
      void fetchReconWebTeam(r.retrieval.url, r.title ?? "", r, panelCostToken)
        .then((people) => { if (isCurrent()) setWebTeam(people); })
        .finally(() => { if (isCurrent()) { setTeamSearching(false); setTeamSearched(true); } });
    }
    if (isCurrent()) setRunning(false);
    runningRef.current = false;
  }, [onInvestigate, onStartFresh]);

  // Auto-run when opened with a URL from the main search bar.
  useEffect(() => {
    if (ran.current || !initialUrl) return;
    ran.current = true;
    run(initialUrl);
  }, [initialUrl, run]);

  // The project's GitHub org (from its site's links), for commit forensics.
  const ghOrg = (recon?.socials ?? [])
    .map((s) => s.url.match(/github\.com\/([A-Za-z0-9_.-]{1,39})/i)?.[1])
    .find((g) => g && !/^(orgs|sponsors|topics|features|about|marketplace|explore|pricing)$/i.test(g)) ?? null;
  // The recon'd host, for deleted-content archaeology.
  let reconHost = "";
  try { reconHost = recon ? new URL(recon.retrieval.url).hostname.replace(/^www\./, "") : ""; } catch { /* keep empty */ }
  // Don't assert "no team" when we DID identify one (via the web/LinkedIn dig or
  // the rendered page) — the thin render missing a team section isn't its absence.
  const teamKnown = (recon?.team.names.length ?? 0) > 0 || webTeam.length > 0;

  const openRecent = onOpenRecent
    ? (ref: string, kind?: ReportKind) => onOpenRecent(ref, kind)
    : onAudit
      ? (ref: string) => onAudit(ref)
      : undefined;
  return (
    <>
      {openRecent && <ScoreTicker onOpen={openRecent} label="Recent site recons · click to open the report" filter={(e) => e.kind === "site"} />}
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="display-sm text-[24px] text-ink">Site recon</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        Point ARGUS at a project's website. It fetches, and when a site is a JavaScript app that returns only a
        shell, it escalates to a rendering crawler instead of guessing. Crucially, when it cannot see something it
        says so: a failed fetch becomes a coverage gap, never a confident "anonymous team."
      </p>

      {snapshotContext && (
        <div className="mt-4">
          <SnapshotEvidenceControl
            snapshotVersion={snapshotContext.version}
            capturedAt={snapshotContext.createdAt}
            currentIntelligenceEnabled={currentIntelligenceEnabled}
            onLoadCurrentIntelligence={() => setCurrentIntelligenceEnabled(true)}
          />
        </div>
      )}
      {!snapshotContext && recon && (
        <div className="mt-4">
          <LiveSupplementalNotice private={resultPolicy.displayedPrivate} persisted={resultPersistence?.state === "persisted"} />
        </div>
      )}

      {/* input */}
      <div className="mt-5 flex items-center gap-2">
        <div className="field flex flex-1 items-center px-3">
          <span className="mono text-[12.5px] text-ink-faint">https://</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(url); }}
            placeholder="project-site.io"
            className="mono w-full bg-transparent px-1.5 py-2.5 text-[13.5px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <PrivateToggle on={priv} onToggle={togglePriv} className="shrink-0 py-2.5" />
        <button
          onClick={() => run(url)}
          disabled={running}
          className="btn-primary shrink-0 px-4 py-2.5 text-[13.5px] font-medium disabled:opacity-50"
        >
          {running ? "running…" : "Run recon"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-faint">
        <span>try</span>
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => run(e)} disabled={running} className="chip normal-case tracking-normal transition hover:text-ink disabled:opacity-50">{e}</button>
        ))}
      </div>

      {/* retrieval trace — the fail -> escalate routing, shown */}
      {stages.length > 0 && (
        <div className="panel mt-6 overflow-hidden">
          <div className="eyebrow border-b border-line px-4 py-2">Retrieval</div>
          {stages.map((s, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="mono mt-0.5 shrink-0 text-[11px] text-ink-faint">{i + 1}</span>
              <span className="mono shrink-0 text-[12.5px] text-ink">{s.method}</span>
              <span className="chip tint-var shrink-0" style={{ "--tint": OUTCOME_TONE[s.outcome] ?? "var(--color-ink-faint)" } as React.CSSProperties}>
                {s.outcome}
              </span>
              <span className="flex-1 text-[12.5px] leading-snug text-ink-dim">{s.note}</span>
              {s.chars > 0 && <span className="mono shrink-0 text-[11px] text-ink-faint">{s.chars.toLocaleString()} ch</span>}
            </div>
          ))}
        </div>
      )}

      {/* auto-routing: this site IS a token's official homepage → full report */}
      {redirecting ? (
        <div className="panel tint-signal mt-6 p-5">
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-signal-lift">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
            This is {redirecting.name}'s site. Opening the full ${redirecting.symbol} report…
          </div>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">A site recon only reads the website; ${redirecting.symbol} is a live token ({redirecting.chain}) whose official homepage is this domain, so ARGUS is running the full on-chain investigation instead.</p>
        </div>
      ) : recon && (
        <>
          {/* verdict hero */}
          {recon.verdict && (() => {
            const v = recon.verdict!;
            const m = verdictMeta(v.verdict);
            return (
              <div className="mt-4 rounded-xl border bg-panel p-5" style={{ borderColor: m.color + "66", background: m.glow }}>
                <div className="flex items-center gap-4">
                  <Ring score={v.score} color={m.color} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="display text-[24px] uppercase leading-none" style={{ color: m.color }}>{m.label}</span>
                      <span className="chip tint-var" style={{ "--tint": COVERAGE[recon.retrieval.status].color } as React.CSSProperties}>
                        {COVERAGE[recon.retrieval.status].label}
                      </span>
                      {v.capApplied && <span className="chip tint-avoid">cap · {v.capApplied.replace(/_/g, " ")}</span>}
                      {briefBound && resultPolicy.canMutate && onOpenBrief && reconHost && (
                        <button
                          type="button"
                          onClick={() => onOpenBrief(reconHost)}
                          title="Open the analyst decision brief anchored to this exact site case"
                          className="btn-chip ml-auto"
                        >
                          case brief
                        </button>
                      )}
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(reconReportText(recon, {
                            reportVersionId: snapshotContext?.reportVersionId
                              ?? (resultPersistence?.state === "persisted" ? resultPersistence.reportVersionId ?? undefined : undefined),
                            version: snapshotContext?.version,
                            privateSession: resultPolicy.displayedPrivate,
                          }, window.location.origin));
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className={`btn-chip ${briefBound && resultPolicy.canMutate && onOpenBrief && reconHost ? "" : "ml-auto"}`}
                      >
                        {copied ? "copied ✓" : "copy report"}
                      </button>
                    </div>
                    {recon.title && <div className="mt-1 truncate text-[13.5px] text-ink-dim">{recon.title}</div>}
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-dim">{teamKnown && TEAM_ABSENCE.test(recon.identityLine) ? "Team identified off the rendered page. See the Team section below." : recon.identityLine}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                  {v.reasons.filter((r) => !(teamKnown && TEAM_ABSENCE.test(r.text))).map((r, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="mono mt-0.5 shrink-0 text-[12.5px]" style={{ color: TONE[r.tone] }}>{GLYPH[r.tone]}</span>
                      <span className="text-[13.5px] leading-snug text-ink-dim">{r.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* token bridge — a site recon only reads the website; if the project has
              a real token, one click opens the full on-chain report where the depth is */}
          {projToken && (
            <button
              onClick={() => onAudit?.(projToken.contract, resultPolicy.displayedPrivate)}
              className="panel tint-signal mt-3 w-full p-4 text-left transition hover:brightness-110"
            >
              <div className="flex flex-wrap items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12h4l3 8 4-16 3 8h4" /></svg>
                <span className="text-[12.5px] font-medium text-signal-lift">This project has a live token: ${projToken.symbol}{projToken.rank ? ` · CoinGecko #${projToken.rank}` : ""} · {projToken.chain}</span>
                <span className="mono ml-auto text-[11px] text-signal-lift">open full on-chain report →</span>
              </div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">
                The site recon only reads the website. Open the ${projToken.symbol} report for market intelligence, holder distribution, wallet clustering, deployer &amp; bytecode forensics, and the sanctions screen.
              </p>
            </button>
          )}

          {/* the project's official X account — searched, resolved, broken down */}
          {showCurrentIntelligence && reconHost && (recon.title || reconHost) && (
            <div className="mt-3">
              <ProjectXAccount
                name={recon.title || reconHost.replace(/\.[a-z]+$/, "")}
                domain={reconHost}
                seedHandle={(() => {
                  const x = recon.socials.find((s) => /x\.com|twitter\.com/i.test(s.url));
                  const seg = x?.url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{2,30})/i)?.[1] ?? (x?.label.startsWith("@") ? x.label.slice(1) : undefined);
                  return seg && !/status|home|intent|share|i$/i.test(seg) ? seg : undefined;
                })()}
                panelCostToken={resultPolicy.panelCostToken}
                onAudit={onAudit ? (handle) => onAudit(handle, resultPolicy.displayedPrivate) : undefined}
              />
            </div>
          )}

          {/* findings ledger */}
          <div className="mt-3 panel p-4">
            <div className="eyebrow">Findings</div>
            <div className="mt-2 space-y-2">
              {recon.findings.filter((f) => !(teamKnown && TEAM_ABSENCE.test(f.claim))).map((f, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mono mt-0.5 shrink-0 text-[12.5px]" style={{ color: TONE[f.tone] }}>{GLYPH[f.tone]}</span>
                  <span className="text-[13.5px] leading-snug text-ink-dim">{f.claim}</span>
                </div>
              ))}
            </div>
          </div>

          {/* on-chain reality check */}
          {recon.pivot && (
            <div className="panel tint-var mt-3 p-4" style={{ "--tint": TONE[recon.pivot.reconcile.tone] } as React.CSSProperties}>
              <div className="flex items-center gap-2">
                <span className="eyebrow">On-chain reality check</span>
                <span className="mono shrink-0 text-[12.5px]" style={{ color: TONE[recon.pivot.reconcile.tone] }}>{GLYPH[recon.pivot.reconcile.tone]}</span>
                {recon.pivot.method === "name-search" && recon.pivot.found && (
                  <span className="chip">ticker match · unconfirmed</span>
                )}
              </div>

              {/* the claim it is checking */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recon.pivot.claim.ticker && <Chip k="ticker" v={recon.pivot.claim.ticker} />}
                {recon.pivot.claim.fdv && <Chip k="claims" v={recon.pivot.claim.fdv} />}
                {recon.pivot.claim.raise && <Chip k="raise" v={recon.pivot.claim.raise} />}
                {recon.pivot.claim.live && <Chip k="" v="token live" />}
              </div>

              {pivotNotes.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {pivotNotes.map((n, i) => <div key={i} className="mono text-[11px] text-ink-faint">→ {n}</div>)}
                </div>
              )}

              <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-ink">{recon.pivot.reconcile.line}</p>

              {/* found token -> click through to the full token audit. Wording
                  makes clear a name-search token is being judged on its OWN,
                  not asserted to be this project's. */}
              {recon.pivot.found && onAudit && (
                <button
                  onClick={() => onAudit(recon.pivot!.found!.address, resultPolicy.displayedPrivate)}
                  className="btn-chip tint-signal mt-3"
                >
                  {recon.pivot.method === "name-search" ? `audit ${recon.pivot.found.symbol} independently →` : `open full token audit for ${recon.pivot.found.symbol} →`}
                </button>
              )}

              {/* name-search candidates, when nothing confidently matched */}
              {!recon.pivot.found && recon.pivot.candidates.length > 0 && (
                <div className="mt-2.5">
                  <div className="eyebrow">Closest by name (not a confirmed match)</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recon.pivot.candidates.map((c) => (
                      <button key={c.address} onClick={() => onAudit?.(c.address, resultPolicy.displayedPrivate)} className="chip normal-case tracking-normal transition hover:text-ink">
                        {c.symbol} · {c.chain} · ${Math.round(c.liqUsd).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* extracted entities */}
          {(recon.socials.length > 0 || recon.funding.length > 0 || (recon.tokenSignals.length > 0 && !recon.isFund)) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {recon.socials.length > 0 && (
                <Card title="Socials">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.socials.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="chip normal-case tracking-normal transition hover:text-ink">{s.label}</a>
                    ))}
                  </div>
                </Card>
              )}
              {recon.funding.length > 0 && (
                <Card title="Funding claims (unverified)">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.funding.map((f) => <span key={f} className="chip normal-case tracking-normal">{f}</span>)}
                  </div>
                </Card>
              )}
              {recon.tokenSignals.length > 0 && !recon.isFund && (
                <Card title="Token signals">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.tokenSignals.map((t) => <span key={t} className="chip normal-case tracking-normal">{t}</span>)}
                  </div>
                </Card>
              )}
            </div>
          )}

          {/* TEAM — the headline. Merge the names on the rendered page with the
              deeper web/LinkedIn dig so every person shows, each enriched with a
              handle/LinkedIn where the search found one. */}
          {(recon.team.names.length > 0 || teamSearching || teamSearched) && (() => {
            const merged = new Map<string, { name: string; handle?: string; role?: string; linkedin?: string; source: string }>();
            const key = (n: string) => n.trim().toLowerCase();
            for (const n of recon.team.names) merged.set(key(n), { name: n, source: "site" });
            for (const p of webTeam) {
              const ex = [...merged.values()].find((m) => key(m.name) === key(p.name));
              if (ex) { ex.handle = ex.handle ?? p.handle; ex.role = ex.role ?? p.role; ex.linkedin = ex.linkedin ?? p.linkedin; ex.source = "site + web"; }
              else merged.set(key(p.name), { name: p.name, handle: p.handle, role: p.role, linkedin: p.linkedin, source: "web/LinkedIn" });
            }
            const people = [...merged.values()];
            return (
              <div className="mt-3 panel p-4">
                <div className="flex items-center gap-2">
                  <span className="eyebrow">Team · {people.length} {people.length === 1 ? "person" : "people"}</span>
                  {teamSearching && <span className="text-[11px] text-ink-faint">digging Google / LinkedIn / Crunchbase / X…</span>}
                </div>
                {people.length > 0 ? (
                  <div className="mt-2 space-y-1.5">
                    {people.map((p) => (
                      <div key={p.handle ?? p.name} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="text-[12.5px] text-ink">{p.name}</span>
                          {p.handle && <span className="mono text-[11px] text-ink-faint">{p.handle}</span>}
                          {p.role && <span className="text-[11px] text-ink-faint">{p.role}</span>}
                          {p.linkedin && (
                            <a href={`https://${p.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="link-ext text-[11px]">LinkedIn</a>
                          )}
                          <span className="text-[11px] text-ink-faint">({p.source})</span>
                        </span>
                        {p.handle && onAudit ? (
                          <button onClick={() => onAudit(p.handle!, resultPolicy.displayedPrivate)} className="btn-chip tint-signal shrink-0">audit →</button>
                        ) : (
                          <span className="mono shrink-0 text-[11px] text-ink-faint">named only</span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  !teamSearching && <p className="mt-1.5 text-[12.5px] text-ink-faint">No team members named on the site or dug up via web / LinkedIn / X search.</p>
                )}
              </div>
            );
          })()}

          {/* unified project research: news & press, documents & resources, domain
              intelligence, and GitHub forensics — the same cluster every report uses */}
          {showCurrentIntelligence && reconHost && <ProjectResearch name={(recon.title || reconHost).split(/[:|–\u2014·]/)[0].trim() || reconHost} domain={reconHost} githubOrg={ghOrg} subjectKey={reconHost || ghOrg || undefined} record={resultPolicy.canRecord} panelCostToken={resultPolicy.panelCostToken} />}

          {/* off-chain operator linking: shared analytics IDs / co-registered domains / hosting */}
          {showCurrentIntelligence && reconHost && <SiteInfra key={`${reconHost}:${resultPolicy.canRecord ? "record" : "read-only"}`} domain={reconHost} record={resultPolicy.canRecord} onAudit={onAudit ? (ref) => onAudit(ref, resultPolicy.displayedPrivate) : undefined} />}

          {/* deleted-content archaeology: what the site removed over time */}
          {showCurrentIntelligence && reconHost && <SiteHistory domain={reconHost} />}

          {/* analyst augmentation — add a piece the recon missed (verified before publish) */}
          {showCurrentIntelligence && resultPolicy.canMutate && reconHost && <AddInfo subject={reconHost} subjectKind="site" canonicalRef={reconHost} subjectGraphKey={reconHost} />}

          {/* hard link — manually bridge this site to another entity in the graph */}
          {showCurrentIntelligence && resultPolicy.canMutate && reconHost && <LinkEntity subject={reconHost} subjectKind="site" canonicalRef={reconHost} graphSubjectKey={reconHost} />}
        </>
      )}
    </div>
    </>
  );
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="chip normal-case tracking-normal">
      {k && <span className="text-ink-faint">{k} </span>}{v}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="eyebrow mb-2">{title}</div>
      {children}
    </div>
  );
}
