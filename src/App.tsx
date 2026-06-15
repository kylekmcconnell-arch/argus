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
import { TokenRun } from "./components/TokenRun";
import { TokenReport } from "./components/TokenReport";
import { findSubject, buildReport, type SubjectFixture } from "./data/subjects";
import { type Dossier } from "./data/dossier";
import { probeBackend } from "./lib/live";
import { resolveInput, type ResolvedInput } from "./lib/resolveInput";
import type { TokenDossier } from "./token/audit";
import type { NavTarget } from "./components/Sidebar";

type Phase =
  | "idle" | "radar" | "dossiers" | "graph" | "watchlist" | "about"
  | "running" | "live" | "report"
  | "token-run" | "token-report"
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

  const onAudit = useCallback(async (raw: string) => {
    setQuery(raw);
    const resolved = resolveInput(raw);
    if (resolved.kind === "token") {
      setTokenInput(resolved);
      setPhase("token-run");
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

  const onTokenDone = useCallback((d: TokenDossier) => {
    setTokenDossier(d);
    setPhase("token-report");
  }, []);

  const onRunDone = useCallback(() => {
    setFixture((f) => {
      if (f) {
        setDossier(buildReport(f));
        setPhase("report");
      }
      return f;
    });
  }, []);

  const onLiveDone = useCallback((d: Dossier) => {
    setDossier(d);
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
    setQuery("");
  }, []);

  const onNav = useCallback((t: NavTarget) => {
    clearUrl();
    if (t === "idle") {
      setFixture(null);
      setDossier(null);
      setQuery("");
    }
    setPhase(t);
  }, []);

  const personAudit = phase === "running" || phase === "live" || phase === "report";
  const inAudit = personAudit || phase === "token-run" || phase === "token-report";
  const activeHandle = personAudit ? dossier?.handle ?? (query ? "@" + query.replace(/^@/, "") : null) : null;
  const view: NavTarget | "audit" = inAudit
    ? "audit"
    : phase === "radar" || phase === "dossiers" || phase === "graph" || phase === "watchlist" || phase === "about"
      ? phase
      : "idle";

  return (
    <AppShell onNav={onNav} onAudit={onAudit} activeHandle={activeHandle} view={view}>
      {phase === "idle" && <Landing onAudit={onAudit} onAbout={() => setPhase("about")} />}

      {phase === "about" && <AboutPage onStart={reset} />}

      {phase === "dossiers" && <DossiersPage onOpen={onOpen} />}

      {phase === "graph" && <GraphPage onOpen={onOpen} />}

      {phase === "radar" && <RadarPage onAudit={onAudit} />}

      {phase === "watchlist" && <WatchlistPage onAudit={onAudit} />}

      {phase === "running" && fixture && <RunConsole fixture={fixture} onDone={onRunDone} />}

      {phase === "live" && <LiveRun handle={query} onDone={onLiveDone} onError={onLiveError} />}

      {phase === "report" && dossier && <Report dossier={dossier} onReset={reset} />}

      {phase === "token-run" && tokenInput && (
        <TokenRun input={tokenInput} onDone={onTokenDone} onError={() => setPhase("notfound")} />
      )}

      {phase === "token-report" && tokenDossier && <TokenReport dossier={tokenDossier} onReset={reset} onAudit={onAudit} />}

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
