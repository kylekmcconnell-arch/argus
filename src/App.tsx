import { useState, useCallback } from "react";
import { AppShell } from "./components/AppShell";
import { Landing } from "./components/Landing";
import { RunConsole } from "./components/RunConsole";
import { LiveRun } from "./components/LiveRun";
import { Report } from "./components/Report";
import { DossiersPage } from "./components/DossiersPage";
import { GraphPage } from "./components/GraphPage";
import { WatchlistPage } from "./components/WatchlistPage";
import { RadarPage } from "./components/RadarPage";
import { AboutPage } from "./components/AboutPage";
import { ApiPage } from "./components/ApiPage";
import { TrackRecordPage } from "./components/TrackRecordPage";
import { ReconPage } from "./components/ReconPage";
import { AdminPage } from "./components/AdminPage";
import { logAudit } from "./lib/auditlog";
import { recordContribution, tokenContribution, personContribution, investigationContribution } from "./graph/store";
import { TokenRun } from "./components/TokenRun";
import { TokenReport } from "./components/TokenReport";
import { InvestigationRun } from "./components/InvestigationRun";
import { InvestigationReport } from "./components/InvestigationReport";
import type { Investigation } from "./lib/investigation";
import { findSubject, buildReport, type SubjectFixture } from "./data/subjects";
import { type Dossier } from "./data/dossier";
import { probeBackend } from "./lib/live";
import { resolveInput, type ResolvedInput } from "./lib/resolveInput";
import type { TokenDossier } from "./token/audit";
import type { NavTarget } from "./components/Sidebar";

type Phase =
  | "idle" | "radar" | "recon" | "dossiers" | "graph" | "watchlist" | "track" | "admin" | "about" | "api"
  | "running" | "live" | "report"
  | "token-run" | "token-report"
  | "investigation" | "investigation-report"
  | "notfound";

// Deep links:
//   ?s=<handle>    -> straight to the curated report (shareable dossiers)
//   ?live=<handle> -> straight into a live collector run
function initialFromUrl(): { phase: Phase; dossier: Dossier | null; query: string } {
  if (typeof window === "undefined") return { phase: "idle", dossier: null, query: "" };
  const params = new URLSearchParams(window.location.search);
  const s = params.get("s");
  if (s) {
    const f = findSubject(s);
    if (f) return { phase: "report", dossier: buildReport(f), query: s };
  }
  const live = params.get("live");
  if (live) return { phase: "live", dossier: null, query: live };
  const token = params.get("t");
  if (token) return { phase: "token-run", dossier: null, query: token };
  const site = params.get("site");
  if (site) return { phase: "recon", dossier: null, query: site };
  const inv = params.get("inv");
  if (inv) return { phase: "investigation", dossier: null, query: inv };
  return { phase: "idle", dossier: null, query: "" };
}

export default function App() {
  const boot = initialFromUrl();
  const [phase, setPhase] = useState<Phase>(boot.phase);
  const [fixture, setFixture] = useState<SubjectFixture | null>(boot.query ? findSubject(boot.query) ?? null : null);
  const [dossier, setDossier] = useState<Dossier | null>(boot.dossier);
  const [query, setQuery] = useState(boot.query);
  const [tokenInput, setTokenInput] = useState<ResolvedInput | null>(
    boot.phase === "token-run" && boot.query ? resolveInput(boot.query) : null,
  );
  const [tokenDossier, setTokenDossier] = useState<TokenDossier | null>(null);
  const [reconUrl, setReconUrl] = useState<string | null>(boot.phase === "recon" ? boot.query : null);
  const [investigationInput, setInvestigationInput] = useState<string | null>(boot.phase === "investigation" ? boot.query : null);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);

  const onAudit = useCallback(async (raw: string) => {
    setQuery(raw);
    const resolved = resolveInput(raw);
    if (resolved.kind === "token") {
      setTokenInput(resolved);
      setPhase("token-run");
      return;
    }
    if (resolved.kind === "site") {
      setReconUrl(resolved.ref);
      setPhase("recon");
      return;
    }
    const f = findSubject(raw);
    setFixture(f ?? null);
    const providers = await probeBackend();
    if (providers) {
      setPhase("live");
      return;
    }
    if (f) setPhase("running");
    else setPhase("notfound");
  }, []);

  // The main search bar runs the full autonomous investigation for a contract;
  // handles and sites fall through to the normal routing. Internal clicks
  // (Radar, recon, watchlist, founder buttons) keep using onAudit for a quick
  // single-surface audit and don't auto-spend.
  const onInvestigate = useCallback((raw: string) => {
    if (resolveInput(raw).kind === "token") {
      setQuery(raw);
      setInvestigationInput(raw);
      setPhase("investigation");
      return;
    }
    onAudit(raw);
  }, [onAudit]);

  const onInvestigationError = useCallback(() => setPhase("notfound"), []);

  const onInvestigationDone = useCallback((inv: Investigation) => {
    setInvestigation(inv);
    setPhase("investigation-report");
    logAudit({
      kind: "token", query: `$${inv.token.symbol}`, ref: inv.token.address, verdict: inv.token.verdict, score: inv.token.score,
      summary: inv.founderNote,
      flags: ["investigation", inv.recon?.team.state === "named" ? "team-named" : "", inv.projectAccount ? "project-audited" : ""].filter(Boolean),
    });
    // compound the graph with the token, its deployer, and (if anonymous) the
    // funder — so a funder bankrolling multiple launches bridges across audits
    const c = investigationContribution(inv);
    if (c) recordContribution(c);
  }, []);

  const onTokenDone = useCallback((d: TokenDossier) => {
    setTokenDossier(d);
    setPhase("token-report");
    logAudit({
      kind: "token", query: `$${d.symbol}`, ref: d.address, verdict: d.verdict, score: d.score,
      summary: d.headline,
      flags: [d.capApplied ? `cap:${d.capApplied}` : "", d.bundleRisk !== "low" ? `bundle:${d.bundleRisk}` : ""].filter(Boolean),
    });
    // compound the trust graph: this token, its deployer, project X and holders
    recordContribution(tokenContribution(d.symbol, d.verdict, d.graph.nodes, d.graph.edges));
  }, []);

  const logPerson = (d: Dossier) => {
    logAudit({
      kind: "person", query: d.handle, ref: d.handle, verdict: d.report.composite_verdict, score: d.report.governing_score,
      summary: d.headline,
      flags: [d.report.cap_applied ? `cap:${d.report.cap_applied}` : "", `role:${d.report.governing_role}`].filter(Boolean),
    });
    // compound the trust graph with this person and their affiliations, so the
    // network bridges them to any token/company/person later tied to the same node
    recordContribution(personContribution(d));
  };

  const onRunDone = useCallback(() => {
    setFixture((f) => {
      if (f) {
        const d = buildReport(f);
        setDossier(d);
        logPerson(d);
        setPhase("report");
      }
      return f;
    });
  }, []);

  const onLiveDone = useCallback((d: Dossier) => {
    setDossier(d);
    logPerson(d);
    setPhase("report");
  }, []);

  const onLiveError = useCallback(() => {
    setFixture((f) => {
      if (f) {
        setDossier(buildReport(f));
        setPhase("report");
      } else {
        setPhase("notfound");
      }
      return f;
    });
  }, []);

  // open a dossier straight to its report (no run), for gallery/graph cards
  const onOpen = useCallback((handle: string) => {
    const f = findSubject(handle);
    if (!f) return;
    setQuery(handle);
    setFixture(f);
    setDossier(buildReport(f));
    setPhase("report");
  }, []);

  const clearUrl = () => {
    if (typeof window !== "undefined" && window.location.search) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  };

  const reset = useCallback(() => {
    clearUrl();
    setPhase("idle");
    setFixture(null);
    setDossier(null);
    setTokenInput(null);
    setTokenDossier(null);
    setInvestigationInput(null);
    setInvestigation(null);
    setQuery("");
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
      setFixture(null);
      setDossier(null);
      setQuery("");
    }
    // opening Site recon from the rail is a fresh, manual page
    if (t === "recon") setReconUrl(null);
    setPhase(t);
  }, []);

  const personAudit = phase === "running" || phase === "live" || phase === "report";
  const inAudit = personAudit || phase === "token-run" || phase === "token-report" || phase === "investigation" || phase === "investigation-report";
  const activeHandle = personAudit ? dossier?.handle ?? (query ? "@" + query.replace(/^@/, "") : null) : null;
  const view: NavTarget | "audit" = inAudit
    ? "audit"
    : phase === "radar" || phase === "recon" || phase === "dossiers" || phase === "graph" || phase === "watchlist" || phase === "track" || phase === "admin" || phase === "about" || phase === "api"
      ? phase
      : "idle";

  return (
    <AppShell onNav={onNav} onAudit={onAudit} activeHandle={activeHandle} view={view}>
      {phase === "idle" && <Landing onAudit={onInvestigate} onAbout={() => setPhase("about")} />}

      {phase === "about" && <AboutPage onStart={reset} />}

      {phase === "api" && <ApiPage />}

      {phase === "dossiers" && <DossiersPage onOpen={onOpen} />}

      {phase === "graph" && <GraphPage onOpen={onOpen} />}

      {phase === "radar" && <RadarPage onAudit={onAudit} />}

      {phase === "watchlist" && <WatchlistPage onAudit={onAudit} />}

      {phase === "track" && <TrackRecordPage onAudit={onAudit} />}

      {phase === "recon" && <ReconPage key={reconUrl ?? "manual"} initialUrl={reconUrl ?? undefined} onAudit={onAudit} />}

      {phase === "admin" && <AdminPage onAudit={onAudit} />}

      {phase === "running" && fixture && <RunConsole fixture={fixture} onDone={onRunDone} />}

      {phase === "live" && <LiveRun handle={query} onDone={onLiveDone} onError={onLiveError} />}

      {phase === "report" && dossier && <Report dossier={dossier} onReset={reset} />}

      {phase === "token-run" && tokenInput && (
        <TokenRun input={tokenInput} onDone={onTokenDone} onError={() => setPhase("notfound")} />
      )}

      {phase === "token-report" && tokenDossier && <TokenReport dossier={tokenDossier} onReset={reset} onAudit={onAudit} />}

      {phase === "investigation" && investigationInput && (
        <InvestigationRun input={investigationInput} onDone={onInvestigationDone} onError={onInvestigationError} />
      )}

      {phase === "investigation-report" && investigation && (
        <InvestigationReport inv={investigation} onAudit={onAudit} onReset={reset} onOpenToken={onOpenToken} onOpenProjectAccount={onOpenProjectAccount} />
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
          ) : (
            <>
              <div className="mono text-[13px] text-signal">@{query.replace(/^@/, "")}</div>
              <h2 className="mt-3 text-2xl font-medium tracking-tight text-ink">No live dossier yet</h2>
              <p className="mt-2 max-w-md text-[14px] leading-relaxed text-ink-dim">
                This demo ships with curated worked audits. With provider keys configured, ARGUS resolves any
                handle on demand. Pick a dossier from the rail, or paste a token contract for a live audit.
              </p>
            </>
          )}
          <button onClick={reset} className="btn-primary mt-6 px-5 py-2.5 text-[13px] font-medium">
            Back to home
          </button>
        </div>
      )}
    </AppShell>
  );
}
