import { useState, useCallback, useEffect, useRef } from "react";
import { AppShell } from "./components/AppShell";
import { Landing } from "./components/Landing";
import { LiveRun } from "./components/LiveRun";
import { Report } from "./components/Report";
import { DossiersPage } from "./components/DossiersPage";
import { GraphPage } from "./components/GraphPage";
import { KolsPage } from "./components/KolsPage";
import { FoundersPage } from "./components/FoundersPage";
import { VcsPage } from "./components/VcsPage";
import { ProjectsPage } from "./components/ProjectsPage";
import { AlertsPage } from "./components/AlertsPage";
import { WatchlistPage } from "./components/WatchlistPage";
import { RadarPage } from "./components/RadarPage";
import { TrendingPage } from "./components/TrendingPage";
import { AboutPage } from "./components/AboutPage";
import { ApiPage } from "./components/ApiPage";
import { ProvidersPage } from "./components/ProvidersPage";
import { ChangelogPage } from "./components/ChangelogPage";
import { ReconPage } from "./components/ReconPage";
import { FindWallet } from "./components/FindWallet";
import { AdminPage } from "./components/AdminPage";
import { logAudit, hydrateSharedLog } from "./lib/auditlog";
import { syncReport, fetchReport } from "./lib/reports";
import { recordContribution, tokenContribution, personContribution, investigationContribution, hydrateCommunityGraph } from "./graph/store";
import { TokenRun } from "./components/TokenRun";
import { TokenReport } from "./components/TokenReport";
import { InvestigationRun } from "./components/InvestigationRun";
import { InvestigationReport } from "./components/InvestigationReport";
import { ProjectView } from "./components/ProjectView";
import type { Investigation } from "./lib/investigation";
import { type Dossier } from "./data/dossier";
import { probeBackend } from "./lib/live";
import { startPersonAudit, setOnComplete, getRun } from "./lib/runner";
import { startTokenScan, startInvestigationScan, setScanOnComplete, getScanRun, type ScanRun } from "./lib/scanrunner";
import { resolveInput, type ResolvedInput } from "./lib/resolveInput";
import type { TokenDossier } from "./token/audit";
import type { NavTarget } from "./components/Sidebar";

type Phase =
  | "idle" | "radar" | "trending" | "recon" | "find" | "dossiers" | "graph" | "kols" | "founders" | "projects" | "vcs" | "watchlist" | "alerts" | "track" | "admin" | "about" | "api" | "providers" | "changelog"
  | "running" | "live" | "report"
  | "token-run" | "token-report"
  | "investigation" | "investigation-report"
  | "project"
  | "notfound";

// Deep links:
//   ?s=<handle>    -> open the stored report for that subject (share links)
//   ?live=<handle> -> straight into a live collector run
function initialFromUrl(): { phase: Phase; dossier: Dossier | null; query: string; openRef?: string } {
  if (typeof window === "undefined") return { phase: "idle", dossier: null, query: "" };
  const params = new URLSearchParams(window.location.search);
  const s = params.get("s");
  // Resolved after mount via onOpenRecent (session cache -> stored report -> rescan).
  if (s) return { phase: "idle", dossier: null, query: "", openRef: s };
  const live = params.get("live");
  if (live) return { phase: "live", dossier: null, query: live };
  const token = params.get("t");
  if (token) return { phase: "token-run", dossier: null, query: token };
  const site = params.get("site");
  if (site) return { phase: "recon", dossier: null, query: site };
  const inv = params.get("inv");
  if (inv) return { phase: "investigation", dossier: null, query: inv };
  if (params.has("find")) return { phase: "find", dossier: null, query: "" };
  return { phase: "idle", dossier: null, query: "" };
}

export default function App() {
  const boot = initialFromUrl();
  const [phase, setPhase] = useState<Phase>(boot.phase);
  const [dossier, setDossier] = useState<Dossier | null>(boot.dossier);
  const [query, setQuery] = useState(boot.query);
  const [tokenInput, setTokenInput] = useState<ResolvedInput | null>(
    boot.phase === "token-run" && boot.query ? resolveInput(boot.query) : null,
  );
  const [tokenDossier, setTokenDossier] = useState<TokenDossier | null>(null);
  const [reconUrl, setReconUrl] = useState<string | null>(boot.phase === "recon" ? boot.query : null);
  const [investigationInput, setInvestigationInput] = useState<string | null>(boot.phase === "investigation" ? boot.query : null);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [viewedProject, setViewedProject] = useState<{ name: string; domain?: string } | null>(null);
  // When a LIVE audit genuinely fails (vs. simply having no curated fixture), we
  // carry the real reason so the failure page tells the truth and offers a retry,
  // instead of the "no live dossier / demo" copy that implies nothing ever ran.
  const [liveError, setLiveError] = useState<string | null>(null);

  // Session cache of completed audits, so clicking a recent audit SHOWS the
  // result it already produced (with a Rescan button) instead of re-running it.
  type Cached =
    | { kind: "person"; dossier: Dossier }
    | { kind: "token"; dossier: TokenDossier }
    | { kind: "investigation"; inv: Investigation };
  const resultCache = useRef(new Map<string, Cached>());
  const cacheKey = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^[@$]/, "").replace(/\/$/, "");
  // Private/incognito toggle for the current NON-person flow (token / investigation
  // / site). Person audits carry their own private flag on the background run.
  // A private audit runs and shows the result but is never persisted, logged,
  // graphed, or shown in the sidebar/tickers.
  const privRef = useRef(false);

  // Pull the shared community graph + audit log once on load, so this session
  // sees everyone's work (no-op when no backend is configured).
  // Warm the serverless backend on load (functions scale to zero after idle) so
  // the first audit click of the day doesn't eat a cold start on the live path.
  useEffect(() => { void hydrateCommunityGraph(); void hydrateSharedLog(); void probeBackend(); }, []);

  const onAudit = useCallback(async (raw: string, priv = false) => {
    privRef.current = priv;
    const resolved = resolveInput(raw);
    if (resolved.kind === "token") {
      setQuery(raw);
      setTokenInput(resolved);
      startTokenScan(resolved, priv); // background: survives navigation
      setPhase("token-run");
      return;
    }
    if (resolved.kind === "site") {
      setQuery(raw);
      setReconUrl(resolved.ref);
      setPhase("recon");
      return;
    }
    // handle: use the RESOLVED username (e.g. extracted from an x.com URL), not raw.
    const handle = resolved.ref;
    setQuery(handle);
    setLiveError(null);
    const providers = await probeBackend();
    if (providers) {
      // Start the background run NOW (before the view mounts) so it survives an
      // immediate navigation away — the runner owns the stream, not the view.
      startPersonAudit(handle, priv);
      setPhase("live");
    } else {
      setPhase("notfound");
    }
  }, []);

  // The main search bar runs the full autonomous investigation for a contract;
  // handles and sites fall through to the normal routing. Internal clicks
  // (Radar, recon, watchlist, founder buttons) keep using onAudit for a quick
  // single-surface audit and don't auto-spend.
  const onInvestigate = useCallback((raw: string, priv = false) => {
    privRef.current = priv;
    if (resolveInput(raw).kind === "token") {
      setQuery(raw);
      setInvestigationInput(raw);
      startInvestigationScan(raw, priv); // background: survives navigation
      setPhase("investigation");
      return;
    }
    onAudit(raw, priv);
  }, [onAudit]);

  const onInvestigationError = useCallback(() => setPhase("notfound"), []);

  // Open a project-centric view: dig who worked on it, all auditable.
  const onOpenProject = useCallback((name: string, domain?: string) => {
    setViewedProject({ name, domain });
    setPhase("project");
  }, []);

  // DATA-side completion (runs for every finished scan, backgrounded or not, so it
  // lands in the library even if navigated away). Never touches the view.
  const investigationData = useCallback((inv: Investigation, priv: boolean) => {
    resultCache.current.set(cacheKey(inv.token.address), { kind: "investigation", inv });
    if (priv) return;
    void syncReport("investigation", inv.token.address, `$${inv.token.symbol}`, inv, inv.token.verdict, inv.token.score);
    logAudit({
      kind: "token", query: `$${inv.token.symbol}`, ref: inv.token.address, image: inv.token.imageUrl, verdict: inv.token.verdict, score: inv.token.score,
      summary: inv.founderNote,
      flags: ["investigation", inv.recon?.team.state === "named" ? "team-named" : "", inv.projectAccount ? "project-audited" : ""].filter(Boolean),
    });
    const c = investigationContribution(inv);
    if (c) recordContribution(c);
  }, []);
  const tokenData = useCallback((d: TokenDossier, priv: boolean) => {
    resultCache.current.set(cacheKey(d.address), { kind: "token", dossier: d });
    if (priv) return;
    void syncReport("token", d.address, `$${d.symbol}`, d, d.verdict, d.score);
    logAudit({
      kind: "token", query: `$${d.symbol}`, ref: d.address, image: d.imageUrl, verdict: d.verdict, score: d.score,
      summary: d.headline,
      flags: [d.capApplied ? `cap:${d.capApplied}` : "", d.bundleRisk !== "low" ? `bundle:${d.bundleRisk}` : ""].filter(Boolean),
    });
    recordContribution(tokenContribution(d.symbol, d.verdict, d.graph.nodes, d.graph.edges));
  }, []);
  // The runner calls this for every finished token / investigation scan.
  useEffect(() => {
    setScanOnComplete((run: ScanRun) => {
      if (run.kind === "token" && run.result) tokenData(run.result as TokenDossier, !!run.priv);
      else if (run.kind === "investigation" && run.result) investigationData(run.result as Investigation, !!run.priv);
    });
  }, [tokenData, investigationData]);

  // VIEW-side completion (only when this view is mounted on the finished run) —
  // the runner already logged/persisted, so these just move the current view.
  const onInvestigationDone = useCallback((inv: Investigation) => { setInvestigation(inv); setPhase("investigation-report"); }, []);
  const onTokenDone = useCallback((d: TokenDossier) => { setTokenDossier(d); setPhase("token-report"); }, []);

  // Data-side completion for a person audit: cache + persist + log + graph. This
  // is view-independent — it's what makes a BACKGROUNDED audit still land in
  // Recent audits and Dossiers — so the runner calls it for every finished run,
  // whether or not the user is looking at it. It never touches the view.
  const logPerson = useCallback((d: Dossier, priv = false) => {
    resultCache.current.set(cacheKey(d.handle), { kind: "person", dossier: d });
    if (priv) return; // private: cached for this session's view only — nothing leaves
    void syncReport("person", d.handle, d.handle, d, d.report.composite_verdict, d.report.governing_score);
    logAudit({
      kind: "person", query: d.handle, ref: d.handle, verdict: d.report.composite_verdict, score: d.report.governing_score,
      image: d.avatar_url, // real X photo (falls back to unavatar in auditImage when absent)
      summary: d.headline,
      // Log EVERY held role (not just the governing one) so a founder-who-is-also-
      // a-KOL (e.g. blknoiz06) appears in all matching directories.
      flags: [
        d.report.cap_applied ? `cap:${d.report.cap_applied}` : "",
        ...Array.from(new Set([d.report.governing_role, ...(d.report.roles ?? [])])).filter(Boolean).map((r) => `role:${r}`),
      ].filter(Boolean),
    });
    // compound the trust graph with this person and their affiliations, so the
    // network bridges them to any token/company/person later tied to the same node
    recordContribution(personContribution(d));
  }, []);

  // Register the completion handler once — every finished background run logs +
  // persists through here, so it appears in the library even if navigated away.
  useEffect(() => { setOnComplete(logPerson); }, [logPerson]);

  // Owner-view transition only: the runner already logged/persisted via onComplete,
  // so this just moves the CURRENT view to the finished report (no re-logging).
  const showCached = useCallback((ref: string, c: Cached) => {
    setQuery(ref);
    if (c.kind === "person") { setDossier(c.dossier); setPhase("report"); }
    else if (c.kind === "token") { setTokenDossier(c.dossier); setPhase("token-report"); }
    else { setInvestigation(c.inv); setPhase("investigation-report"); }
  }, []);

  const onLiveDone = useCallback((d: Dossier) => {
    setDossier(d);
    setPhase("report");
  }, []);

  // A live audit failing usually means our long SSE stream dropped (proxy / tab
  // throttle) — but the server persists finished audits, so recover the report
  // before dead-ending. Poll a few times: the server upsert may land just after
  // our stream died. Only show "not found" when nothing was produced.
  const onLiveError = useCallback(async () => {
    const ref = query;
    const cached = resultCache.current.get(cacheKey(ref));
    if (cached) { showCached(ref, cached); return; }
    for (let attempt = 0; attempt < 4; attempt++) {
      const rep = await fetchReport(ref);
      if (rep?.payload && (rep.kind === "person" || rep.kind === "token" || rep.kind === "investigation")) {
        const c = rep.kind === "investigation"
          ? { kind: "investigation" as const, inv: rep.payload as Investigation }
          : rep.kind === "token"
            ? { kind: "token" as const, dossier: rep.payload as TokenDossier }
            : { kind: "person" as const, dossier: rep.payload as Dossier };
        resultCache.current.set(cacheKey(ref), c);
        showCached(ref, c);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    // Nothing was persisted — this is a real live failure. Surface WHY (timeout,
    // stream drop, backend error) so the user can retry instead of being told the
    // engine "ships with curated audits" as if it never tried.
    setLiveError(getRun(ref)?.error ?? "The live audit didn't finish.");
    setPhase("notfound");
  }, [query, showCached]);


  // Clicking a recent audit SHOWS the report already produced (with a Rescan
  // button), from: this session's cache → the persisted report on the backend
  // (survives reload, and pulls up another analyst's actual report) → and only
  // re-runs if we have neither.
  const onOpenRecent = useCallback(async (ref: string) => {
    // A background PERSON run — re-attach: reopen the live console or show it done.
    const run = getRun(ref);
    if (run) {
      setQuery(run.handle);
      if (run.status === "running") { setPhase("live"); return; }
      if (run.status === "done" && run.dossier) { setDossier(run.dossier); setPhase("report"); return; }
    }
    // A background token / investigation scan still running — reopen its console.
    const invRun = getScanRun("investigation", ref);
    if (invRun && invRun.status === "running") { setInvestigationInput(invRun.input); setQuery(invRun.input); setPhase("investigation"); return; }
    const tokRun = getScanRun("token", ref);
    if (tokRun && tokRun.status === "running") { setTokenInput(resolveInput(tokRun.input)); setQuery(tokRun.input); setPhase("token-run"); return; }
    const c = resultCache.current.get(cacheKey(ref));
    if (c) { showCached(ref, c); return; }
    const rep = await fetchReport(ref);
    if (rep?.payload && (rep.kind === "person" || rep.kind === "token" || rep.kind === "investigation")) {
      const cached = rep.kind === "investigation"
        ? { kind: "investigation" as const, inv: rep.payload as Investigation }
        : rep.kind === "token"
          ? { kind: "token" as const, dossier: rep.payload as TokenDossier }
          : { kind: "person" as const, dossier: rep.payload as Dossier };
      resultCache.current.set(cacheKey(ref), cached);
      showCached(ref, cached);
      return;
    }
    onAudit(ref);
  }, [onAudit, showCached]);

  // open a library/graph card: same path as a recent click (stored report first)
  const onOpen = onOpenRecent;

  // Share links (?s=<handle>) resolve through the same stored-report path.
  useEffect(() => {
    if (boot.openRef) void onOpenRecent(boot.openRef);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearUrl = () => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  };

  const reset = useCallback(() => {
    clearUrl();
    setPhase("idle");
    setDossier(null);
    setTokenInput(null);
    setTokenDossier(null);
    setInvestigationInput(null);
    setInvestigation(null);
    setQuery("");
    setLiveError(null);
  }, []);

  // from the investigation report: open the full on-chain token report
  const onOpenToken = useCallback(() => {
    setInvestigation((inv) => {
      if (inv) { setTokenDossier(inv.token); setPhase("token-report"); }
      return inv;
    });
  }, []);

  // from the investigation report: open the full people report for the project
  // account (already collected — no re-spend), which shows the axis/cap reasoning.
  const onOpenProjectAccount = useCallback(() => {
    setInvestigation((inv) => {
      if (inv?.projectAccount) { setDossier(inv.projectAccount); setQuery(inv.projectAccount.handle); setPhase("report"); }
      return inv;
    });
  }, []);

  const onNav = useCallback((t: NavTarget) => {
    clearUrl();
    if (t === "idle") {
      setDossier(null);
      setQuery("");
    }
    // opening Site recon from the rail is a fresh, manual page (private off by default)
    if (t === "recon") { setReconUrl(null); privRef.current = false; }
    setPhase(t);
  }, []);

  const personAudit = phase === "running" || phase === "live" || phase === "report";
  const inAudit = personAudit || phase === "token-run" || phase === "token-report" || phase === "investigation" || phase === "investigation-report";
  const activeHandle = personAudit ? dossier?.handle ?? (query ? "@" + query.replace(/^@/, "") : null) : null;
  const view: NavTarget | "audit" = inAudit
    ? "audit"
    : phase === "radar" || phase === "trending" || phase === "recon" || phase === "find" || phase === "dossiers" || phase === "graph" || phase === "kols" || phase === "founders" || phase === "projects" || phase === "vcs" || phase === "watchlist" || phase === "alerts" || phase === "track" || phase === "admin" || phase === "about" || phase === "api" || phase === "providers" || phase === "changelog"
      ? phase
      : "idle";

  return (
    <AppShell onNav={onNav} onAudit={onAudit} onOpenRecent={onOpenRecent} activeHandle={activeHandle} view={view}>
      {phase === "idle" && <Landing onAudit={onInvestigate} onAbout={() => setPhase("about")} onOpenRecent={onOpenRecent} />}

      {phase === "about" && <AboutPage onStart={reset} />}

      {phase === "api" && <ApiPage />}

      {phase === "providers" && <ProvidersPage />}

      {phase === "changelog" && <ChangelogPage />}

      {phase === "dossiers" && <DossiersPage onOpen={onOpen} />}

      {phase === "graph" && <GraphPage onOpen={onOpen} />}

      {phase === "kols" && <KolsPage onAudit={onAudit} onOpenRecent={onOpenRecent} />}

      {phase === "founders" && <FoundersPage onAudit={onAudit} onOpenRecent={onOpenRecent} />}

      {phase === "vcs" && <VcsPage onAudit={onAudit} onOpenRecent={onOpenRecent} />}

      {phase === "projects" && <ProjectsPage onAudit={onAudit} onOpenRecent={onOpenRecent} />}

      {phase === "radar" && <RadarPage onAudit={onAudit} />}

      {phase === "trending" && <TrendingPage onOpen={onOpenRecent} />}

      {phase === "watchlist" && <WatchlistPage onAudit={onAudit} />}

      {phase === "alerts" && <AlertsPage onOpen={onOpenRecent} />}

      {phase === "recon" && <ReconPage key={reconUrl ?? "manual"} initialUrl={reconUrl ?? undefined} initialPrivate={privRef.current} onAudit={onAudit} onInvestigate={onInvestigate} onOpenRecent={onOpenRecent} />}

      {phase === "find" && <FindWallet onAudit={onAudit} onReset={reset} onOpenRecent={onOpenRecent} />}

      {phase === "admin" && <AdminPage onAudit={onAudit} />}

      {phase === "live" && <LiveRun handle={query} onDone={onLiveDone} onError={onLiveError} />}

      {phase === "report" && dossier && <Report dossier={dossier} onReset={reset} onAudit={onAudit} onOpenProject={onOpenProject} />}
      {phase === "project" && viewedProject && <ProjectView project={viewedProject} onAudit={onAudit} onReset={reset} />}

      {phase === "token-run" && tokenInput && (
        <TokenRun input={tokenInput} onDone={onTokenDone} onError={() => setPhase("notfound")} />
      )}

      {phase === "token-report" && tokenDossier && <TokenReport dossier={tokenDossier} onReset={reset} onAudit={onAudit} />}

      {phase === "investigation" && investigationInput && (
        <InvestigationRun input={investigationInput} onDone={onInvestigationDone} onError={onInvestigationError} />
      )}

      {phase === "investigation-report" && investigation && (
        <InvestigationReport
          inv={investigation}
          onAudit={onAudit}
          onReset={reset}
          onOpenToken={onOpenToken}
          onOpenProjectAccount={onOpenProjectAccount}
          onReAudit={() => { const a = investigation.token.address; setInvestigationInput(a); setInvestigation(null); startInvestigationScan(a, privRef.current); setPhase("investigation"); }}
        />
      )}

      {phase === "notfound" && (
        <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-24 text-center">
          <div className="grid-bg absolute inset-0 -z-10" />
          {resolveInput(query).kind === "token" ? (
            <>
              <div className="mono max-w-md break-all text-[13px] text-signal">{query}</div>
              <h2 className="mt-3 text-2xl font-medium tracking-tight text-ink">Couldn't resolve that token</h2>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
                No DEX pair was found for this contract. It may be brand-new, unlisted, illiquid, or on a chain
                ARGUS doesn't index yet. Double-check the address, or try one of the live samples on the home screen.
              </p>
            </>
          ) : liveError ? (
            <>
              <div className="mono text-[13px] text-signal">@{query.replace(/^@/, "")}</div>
              <h2 className="mt-3 text-2xl font-medium tracking-tight text-ink">The live audit didn't finish</h2>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
                ARGUS collected against this handle but the run ended before a report was assembled — usually a
                timeout on a very large account, or a dropped connection. Nothing was saved. Retrying often
                clears it, since slow providers are cached on the second pass.
              </p>
              <div className="mono mt-3 max-w-md break-words rounded-lg border border-line/60 bg-panel/50 px-3 py-2 text-[11px] text-ink-faint">
                {liveError}
              </div>
              <div className="mt-6 flex items-center gap-3">
                <button onClick={() => onAudit(query, privRef.current)} className="btn-primary px-5 py-2.5 text-[13px] font-medium">
                  Retry audit
                </button>
                <button onClick={reset} className="text-[13px] text-ink-dim hover:text-ink">
                  Back to home
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mono text-[13px] text-signal">@{query.replace(/^@/, "")}</div>
              <h2 className="mt-3 text-2xl font-medium tracking-tight text-ink">No live dossier yet</h2>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
                This demo ships with curated worked audits. With provider keys configured, ARGUS resolves any
                handle on demand. Pick a dossier from the rail, or paste a token contract for a live audit.
              </p>
              <button onClick={reset} className="btn-primary mt-6 px-5 py-2.5 text-[13px] font-medium">
                Back to home
              </button>
            </>
          )}
          {resolveInput(query).kind === "token" && (
            <button onClick={reset} className="btn-primary mt-6 px-5 py-2.5 text-[13px] font-medium">
              Back to home
            </button>
          )}
        </div>
      )}
    </AppShell>
  );
}
