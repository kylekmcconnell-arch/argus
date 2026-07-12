import { lazy, Suspense, useState, useCallback, useEffect, useRef } from "react";
import { AppShell } from "./components/AppShell";
import { Landing } from "./components/Landing";
import { logAudit, hydrateSharedLog } from "./lib/auditlog";
import {
  syncReport,
  fetchReport,
  fetchReportVersion,
  fetchReportState,
  storedInvestigation,
  storedPersonDossier,
  storedSiteRecon,
  storedTokenDossier,
  resolveStoredCases,
  type ReportKind,
  type StoredReport,
  type StoredCaseSubject,
  type StoredCaseResolution,
} from "./lib/reports";
import { recordContribution, tokenContribution, personContribution, investigationContribution, hydrateCommunityGraph } from "./graph/store";
import type { Investigation } from "./lib/investigation";
import type { Recon } from "./collect/recon";
import { type Dossier } from "./data/dossier";
import { probeBackend } from "./lib/live";
import { startPersonAudit, setOnComplete, getRun } from "./lib/runner";
import { startTokenScan, startInvestigationScan, setScanOnComplete, getScanRun, type ScanRun } from "./lib/scanrunner";
import { isRunnableTokenInput, resolveInput, type RunnableTokenInput } from "./lib/resolveInput";
import type { TokenDossier } from "./token/audit";
import { resolveTokenSubject, type TokenCandidate } from "./token/resolveSubject";
import type { NavTarget } from "./components/Sidebar";
import { personChecks, tokenChecks } from "./lib/scanChecklist";
import { deriveDecisionReadiness } from "./lib/decisionReadiness";
import { normalizeSubjectRef } from "./lib/subjectRef";
import { useArgusAuth } from "./auth-context";
import type { CaseBriefTarget } from "./lib/caseBrief";
import type { ReportPersistenceContext, ReportVersionContext } from "./lib/reportVersion";
import { fetchReconWebTeam } from "./lib/reconSupplements";

// Product areas load on demand. The home/search shell stays immediate while
// heavyweight reports, graph views, recon, and admin tooling become cached
// route chunks after the investigator first opens them.
const AboutPage = lazy(() => import("./components/AboutPage").then((module) => ({ default: module.AboutPage })));
const AdminPage = lazy(() => import("./components/AdminPage").then((module) => ({ default: module.AdminPage })));
const AlertsPage = lazy(() => import("./components/AlertsPage").then((module) => ({ default: module.AlertsPage })));
const ApiPage = lazy(() => import("./components/ApiPage").then((module) => ({ default: module.ApiPage })));
const ChangelogPage = lazy(() => import("./components/ChangelogPage").then((module) => ({ default: module.ChangelogPage })));
const CaseBriefPanel = lazy(() => import("./components/CaseBriefPanel").then((module) => ({ default: module.CaseBriefPanel })));
const DossiersPage = lazy(() => import("./components/DossiersPage").then((module) => ({ default: module.DossiersPage })));
const FindWallet = lazy(() => import("./components/FindWallet").then((module) => ({ default: module.FindWallet })));
const FoundersPage = lazy(() => import("./components/FoundersPage").then((module) => ({ default: module.FoundersPage })));
const GraphPage = lazy(() => import("./components/GraphPage").then((module) => ({ default: module.GraphPage })));
const InvestigationReport = lazy(() => import("./components/InvestigationReport").then((module) => ({ default: module.InvestigationReport })));
const InvestigationRun = lazy(() => import("./components/InvestigationRun").then((module) => ({ default: module.InvestigationRun })));
const KolsPage = lazy(() => import("./components/KolsPage").then((module) => ({ default: module.KolsPage })));
const LiveRun = lazy(() => import("./components/LiveRun").then((module) => ({ default: module.LiveRun })));
const ProjectView = lazy(() => import("./components/ProjectView").then((module) => ({ default: module.ProjectView })));
const ProjectsPage = lazy(() => import("./components/ProjectsPage").then((module) => ({ default: module.ProjectsPage })));
const ProvidersPage = lazy(() => import("./components/ProvidersPage").then((module) => ({ default: module.ProvidersPage })));
const RadarPage = lazy(() => import("./components/RadarPage").then((module) => ({ default: module.RadarPage })));
const ReconPage = lazy(() => import("./components/ReconPage").then((module) => ({ default: module.ReconPage })));
const Report = lazy(() => import("./components/Report").then((module) => ({ default: module.Report })));
const TokenReport = lazy(() => import("./components/TokenReport").then((module) => ({ default: module.TokenReport })));
const TokenRun = lazy(() => import("./components/TokenRun").then((module) => ({ default: module.TokenRun })));
const TrendingPage = lazy(() => import("./components/TrendingPage").then((module) => ({ default: module.TrendingPage })));
const VcsPage = lazy(() => import("./components/VcsPage").then((module) => ({ default: module.VcsPage })));
const WatchlistPage = lazy(() => import("./components/WatchlistPage").then((module) => ({ default: module.WatchlistPage })));

function RouteLoading() {
  return (
    <div className="flex min-h-[55vh] items-center justify-center" role="status" aria-live="polite">
      <span className="flex items-center gap-2 text-[12.5px] text-ink-faint">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
        Loading investigation workspace…
      </span>
    </div>
  );
}

function CaseBriefLoadingDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.focus();
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      aria-label="Opening case brief"
      className="fixed inset-0 z-[100] m-0 ml-auto h-[100dvh] max-h-none w-full max-w-[760px] border-0 border-l border-line bg-void p-0 text-ink shadow-2xl backdrop:bg-black/75"
    >
      <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
        <span className="flex items-center gap-2 text-[12.5px] text-ink-dim">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
          Opening case brief…
        </span>
      </div>
    </dialog>
  );
}

type Phase =
  | "idle" | "radar" | "trending" | "recon" | "find" | "dossiers" | "graph" | "kols" | "founders" | "projects" | "vcs" | "watchlist" | "alerts" | "track" | "admin" | "about" | "api" | "providers" | "changelog"
  | "running" | "live" | "report"
  | "token-run" | "token-report"
  | "investigation" | "investigation-report"
  | "resolving"
  | "token-choice"
  | "project"
  | "notfound";

type TokenLaunchMode = "token" | "investigation";

type Cached =
  | { kind: "person"; dossier: Dossier }
  | { kind: "token"; dossier: TokenDossier }
  | { kind: "investigation"; inv: Investigation }
  | { kind: "site"; recon: Recon; briefTarget?: CaseBriefTarget; versionContext?: ReportVersionContext };

type CachedKind = Cached["kind"];

const cacheKey = (ref: string, kind?: CachedKind) => `${kind ?? "latest"}:${normalizeSubjectRef(ref)}`;
const cacheResult = (cache: Map<string, Cached>, ref: string, result: Cached, updateLatest = true) => {
  cache.set(cacheKey(ref, result.kind), result);
  if (updateLatest) cache.set(cacheKey(ref), result);
};
const cachedPersistence = (result: Cached | undefined): ReportPersistenceContext | undefined => {
  if (result?.kind === "person" || result?.kind === "token") return result.dossier.persistence;
  if (result?.kind === "investigation") return result.inv.persistence;
  return undefined;
};
const settleCachedScan = (
  cache: Map<string, Cached>,
  ref: string,
  scanId: string,
  result: Cached,
): boolean => {
  const typedKey = cacheKey(ref, result.kind);
  const current = cache.get(typedKey);
  const latestKey = cacheKey(ref);
  const latest = cache.get(latestKey);
  const typedMatches = current?.kind === result.kind && cachedPersistence(current)?.scanId === scanId;
  const latestMatches = latest?.kind === result.kind && cachedPersistence(latest)?.scanId === scanId;
  if (typedMatches) cache.set(typedKey, result);
  if (latestMatches) cache.set(latestKey, result);
  return typedMatches || latestMatches;
};
const clearCachedRef = (cache: Map<string, Cached>, ref: string) => {
  const suffix = `:${normalizeSubjectRef(ref)}`;
  for (const key of cache.keys()) if (key.endsWith(suffix)) cache.delete(key);
};

function clearUrlQuery(): void {
  if (typeof window !== "undefined" && window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }
}

const siteCaseRef = (value: string): string => {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname
      .replace(/^www\./i, "")
      .toLowerCase();
  } catch {
    return normalizeSubjectRef(value).replace(/\/.*$/, "").replace(/^www\./, "");
  }
};

function briefTargetForPerson(dossier: Dossier): CaseBriefTarget | null {
  if (dossier.versionContext?.caseId) {
    return {
      caseId: dossier.versionContext.caseId,
      expectedReportVersionId: dossier.versionContext.reportVersionId,
    };
  }
  if (dossier.persistence?.state === "persisted" && dossier.persistence.reportVersionId) {
    return {
      kind: "person",
      ref: normalizeSubjectRef(dossier.handle),
      expectedReportVersionId: dossier.persistence.reportVersionId,
    };
  }
  return null;
}

function cachedFromStoredReport(report: StoredReport): Cached | null {
  if (report.kind === "site") {
    const recon = storedSiteRecon(report);
    if (!recon) return null;
    return {
      kind: "site",
      recon,
      versionContext: report.versionContext,
      briefTarget: report.versionContext?.caseId
        ? {
            caseId: report.versionContext.caseId,
            expectedReportVersionId: report.versionContext.reportVersionId,
          }
        : undefined,
    };
  }
  if (report.kind === "investigation") return { kind: "investigation", inv: storedInvestigation(report) };
  if (report.kind === "token") return { kind: "token", dossier: storedTokenDossier(report) };
  if (report.kind === "person") return { kind: "person", dossier: storedPersonDossier(report) };
  return null;
}

function preferredStoredCase(
  subjects: StoredCaseSubject[],
  preferred: ReportKind = "investigation",
): StoredCaseSubject | null {
  if (!subjects.length) return null;
  if (new Set(subjects.map((subject) => subject.ref)).size > 1) return null;
  return subjects.find((subject) => subject.kind === preferred)
    ?? subjects.find((subject) => subject.kind === "investigation")
    ?? subjects.find((subject) => subject.kind === "token")
    ?? subjects[0];
}

// Deep links:
//   ?s=<handle>    -> open the stored report for that subject (share links)
//   ?live=<handle> -> resolve the person case before re-attaching or launching
function initialFromUrl(): { phase: Phase; dossier: Dossier | null; query: string; openRef?: string; openKind?: ReportKind; openVersionId?: string } {
  if (typeof window === "undefined") return { phase: "idle", dossier: null, query: "" };
  const params = new URLSearchParams(window.location.search);
  const version = params.get("version");
  if (version) return { phase: "idle", dossier: null, query: "", openVersionId: version };
  const s = params.get("s");
  // Resolved after mount via onOpenRecent (session cache -> stored report -> rescan).
  if (s) return { phase: "idle", dossier: null, query: "", openRef: s };
  const live = params.get("live");
  if (live) return { phase: "idle", dossier: null, query: "", openRef: live, openKind: "person" };
  const token = params.get("t");
  if (token) return { phase: "idle", dossier: null, query: "", openRef: token, openKind: "token" };
  const site = params.get("site");
  if (site) return { phase: "idle", dossier: null, query: "", openRef: site, openKind: "site" };
  const inv = params.get("inv");
  if (inv) return { phase: "idle", dossier: null, query: "", openRef: inv, openKind: "investigation" };
  if (params.has("find")) return { phase: "find", dossier: null, query: "" };
  return { phase: "idle", dossier: null, query: "" };
}

export default function App() {
  const { role } = useArgusAuth();
  const [boot] = useState(initialFromUrl);
  const [evidenceReviewVersionId, setEvidenceReviewVersionId] = useState<string | null>(boot.openVersionId ?? null);
  const [phase, setPhase] = useState<Phase>(boot.phase);
  const [dossier, setDossier] = useState<Dossier | null>(boot.dossier);
  const [personBriefTarget, setPersonBriefTarget] = useState<CaseBriefTarget | null>(null);
  const [query, setQuery] = useState(boot.query);
  const [tokenInput, setTokenInput] = useState<RunnableTokenInput | null>(null);
  const [tokenDossier, setTokenDossier] = useState<TokenDossier | null>(null);
  const [tokenBriefTarget, setTokenBriefTarget] = useState<CaseBriefTarget | null>(null);
  const [reconUrl, setReconUrl] = useState<string | null>(boot.phase === "recon" ? boot.query : null);
  const [storedRecon, setStoredRecon] = useState<Recon | null>(null);
  const [storedReconBriefTarget, setStoredReconBriefTarget] = useState<CaseBriefTarget | null>(null);
  const [storedReconVersionContext, setStoredReconVersionContext] = useState<ReportVersionContext | null>(null);
  const [investigationInput, setInvestigationInput] = useState<RunnableTokenInput | null>(null);
  const [investigation, setInvestigation] = useState<Investigation | null>(null);
  const [viewedProject, setViewedProject] = useState<{ name: string; domain?: string; privateMode: boolean; panelCostToken?: string } | null>(null);
  // When a LIVE audit genuinely fails (vs. simply having no curated fixture), we
  // carry the real reason so the failure page tells the truth and offers a retry,
  // instead of the "no live dossier / demo" copy that implies nothing ever ran.
  const [liveError, setLiveError] = useState<string | null>(null);
  const [caseNotice, setCaseNotice] = useState<{
    reason: "archived" | "missing" | "unavailable" | "search-unavailable" | "launch-failed" | "token-unresolved" | "case-ambiguous" | "privacy-conflict";
    ref: string;
    kind?: ReportKind;
    mode?: TokenLaunchMode;
    reuseStored?: boolean;
  } | null>(null);
  const [tokenChoices, setTokenChoices] = useState<TokenCandidate[]>([]);
  const [tokenChoicePrivate, setTokenChoicePrivate] = useState(false);
  const [tokenChoiceMode, setTokenChoiceMode] = useState<TokenLaunchMode>("investigation");
  const [tokenChoiceReuseStored, setTokenChoiceReuseStored] = useState(true);
  const [resolutionUsesStoredCases, setResolutionUsesStoredCases] = useState(true);
  const [caseBriefTarget, setCaseBriefTarget] = useState<CaseBriefTarget | null>(null);
  const caseBriefDirtyRef = useRef(false);
  const caseBriefBusyRef = useRef(false);
  const closeCaseBriefForNavigation = useCallback((): boolean => {
    if (caseBriefBusyRef.current) return false;
    if (caseBriefDirtyRef.current && !window.confirm("Discard your unsaved case brief changes and note draft?")) return false;
    caseBriefDirtyRef.current = false;
    caseBriefBusyRef.current = false;
    setCaseBriefTarget(null);
    return true;
  }, []);
  const dismissCaseBrief = useCallback(() => {
    caseBriefDirtyRef.current = false;
    caseBriefBusyRef.current = false;
    setCaseBriefTarget(null);
  }, []);
  const trackCaseBriefDirty = useCallback((dirty: boolean, busy = false) => {
    caseBriefDirtyRef.current = dirty;
    caseBriefBusyRef.current = busy;
  }, []);

  // Session cache of completed audits, so clicking a recent audit SHOWS the
  // result it already produced (with a Rescan button) instead of re-running it.
  const resultCache = useRef(new Map<string, Cached>());
  const reportPersistenceQueues = useRef(new Map<string, Promise<void>>());
  const enqueueReportPersistence = useCallback((
    kind: "token" | "investigation",
    ref: string,
    work: () => Promise<void>,
  ) => {
    const key = `${kind}:${normalizeSubjectRef(ref)}`;
    const previous = reportPersistenceQueues.current.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    reportPersistenceQueues.current.set(key, next);
    const clear = () => {
      if (reportPersistenceQueues.current.get(key) === next) {
        reportPersistenceQueues.current.delete(key);
      }
    };
    void next.then(clear, clear);
  }, []);
  const safeAuditRequestRef = useRef(0);
  // Private/incognito toggle for the current NON-person flow (token / investigation
  // / site). Person audits carry their own private flag on the background run.
  // A private audit runs and shows the result but is never persisted, logged,
  // graphed, or shown in the sidebar/tickers.
  const privRef = useRef(false);
  const [privateMode, setPrivateMode] = useState(false);

  const leaveEvidenceReview = useCallback(() => {
    if (!evidenceReviewVersionId) return;
    setEvidenceReviewVersionId(null);
    clearUrlQuery();
  }, [evidenceReviewVersionId]);

  // Pull the shared community graph + audit log once on load, so this session
  // sees everyone's work (no-op when no backend is configured).
  // Warm the serverless backend on load (functions scale to zero after idle) so
  // the first audit click of the day doesn't eat a cold start on the live path.
  useEffect(() => { void hydrateCommunityGraph(); void hydrateSharedLog(); void probeBackend(); }, []);

  const showPrivacyConflict = useCallback((ref: string) => {
    setQuery(ref);
    setCaseNotice({ reason: "privacy-conflict", ref });
    setLiveError(null);
    setPhase("notfound");
  }, []);

  const onAudit = useCallback(async (raw: string, priv = false, force = false) => {
    if (!closeCaseBriefForNavigation()) return;
    leaveEvidenceReview();
    const requestId = ++safeAuditRequestRef.current;
    setPersonBriefTarget(null);
    setTokenBriefTarget(null);
    setCaseNotice(null);
    privRef.current = priv;
    setPrivateMode(priv);
    const resolved = resolveInput(raw);
    if (resolved.kind === "token") {
      if (!isRunnableTokenInput(resolved)) {
        setQuery(raw);
        setLiveError(null);
        setCaseNotice({ reason: "token-unresolved", ref: raw });
        setPhase("notfound");
        return;
      }
      setQuery(raw);
      setTokenInput(resolved);
      const run = startTokenScan(resolved, priv, { force }); // background: survives navigation
      if (run.priv !== priv) { showPrivacyConflict(raw); return; }
      setPhase("token-run");
      return;
    }
    if (resolved.kind === "site") {
      setQuery(raw);
      setReconUrl(resolved.ref);
      setStoredRecon(null);
      setStoredReconBriefTarget(null);
      setStoredReconVersionContext(null);
      setPhase("recon");
      return;
    }
    // handle: use the RESOLVED username (e.g. extracted from an x.com URL), not raw.
    const handle = resolved.ref;
    setQuery(handle);
    setLiveError(null);
    const providers = await probeBackend();
    if (requestId !== safeAuditRequestRef.current) return;
    if (providers) {
      // Start the background run NOW (before the view mounts) so it survives an
      // immediate navigation away — the runner owns the stream, not the view.
      const run = startPersonAudit(handle, priv);
      if (!!run.priv !== priv) { showPrivacyConflict(handle); return; }
      setPhase("live");
    } else {
      setPhase("notfound");
    }
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, setLiveError, setPhase, setPrivateMode, setQuery, setReconUrl, setTokenInput, showPrivacyConflict]);

  // The main search bar runs the full autonomous investigation for a contract;
  // handles and sites fall through to the normal routing. Internal clicks
  // (Radar, recon, watchlist, founder buttons) keep using onAudit for a quick
  // single-surface audit and don't auto-spend.
  const onInvestigate = useCallback((raw: string, priv = false, force = false) => {
    if (!closeCaseBriefForNavigation()) return;
    leaveEvidenceReview();
    safeAuditRequestRef.current += 1;
    setPersonBriefTarget(null);
    setTokenBriefTarget(null);
    setCaseNotice(null);
    privRef.current = priv;
    setPrivateMode(priv);
    const resolved = resolveInput(raw);
    if (isRunnableTokenInput(resolved)) {
      setQuery(raw);
      setInvestigationInput(resolved);
      const run = startInvestigationScan(resolved, priv, { force }); // background: survives navigation
      if (run.priv !== priv) { showPrivacyConflict(raw); return; }
      setPhase("investigation");
      return;
    }
    onAudit(raw, priv, force);
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, onAudit, setInvestigationInput, setPhase, setPrivateMode, setQuery, showPrivacyConflict]);

  const onInvestigationError = useCallback(() => setPhase("notfound"), [setPhase]);

  // Open a project-centric view: dig who worked on it, all auditable.
  const onOpenProject = useCallback((name: string, domain?: string, priv = false, panelCostToken?: string) => {
    if (!closeCaseBriefForNavigation()) return;
    leaveEvidenceReview();
    privRef.current = priv;
    setPrivateMode(priv);
    setViewedProject({ name, domain, privateMode: priv, ...(!priv && panelCostToken ? { panelCostToken } : {}) });
    setPhase("project");
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, setPhase, setPrivateMode, setViewedProject]);

  const onOpenPrivateProject = useCallback((name: string, domain?: string) => {
    onOpenProject(name, domain, true);
  }, [onOpenProject]);

  // DATA-side completion (runs for every finished scan, backgrounded or not, so it
  // lands in the library even if navigated away). Never touches the view.
  const investigationData = useCallback((inv: Investigation, priv: boolean, scanId: string) => {
    if (priv) return;
    const pending: Investigation = { ...inv, persistence: { state: "pending", scanId } };
    cacheResult(resultCache.current, inv.token.address, { kind: "investigation", inv: pending });
    enqueueReportPersistence("investigation", inv.token.address, async () => {
      const persisted = await syncReport("investigation", inv.token.address, `$${inv.token.symbol}`, inv, inv.token.verdict, inv.token.score);
      const settled: Investigation = { ...inv, persistence: { ...persisted, scanId } };
      if (!settleCachedScan(
        resultCache.current,
        inv.token.address,
        scanId,
        { kind: "investigation", inv: settled },
      )) return;
      setInvestigation((current) => (
        current
        && !current.versionContext
        && current.persistence?.scanId === scanId
        && normalizeSubjectRef(current.token.address) === normalizeSubjectRef(inv.token.address)
          ? settled
          : current
      ));
      setTokenDossier((current) => (
        current
        && current.viewPersistence?.scanId === scanId
        && normalizeSubjectRef(current.address) === normalizeSubjectRef(inv.token.address)
          ? { ...current, viewPersistence: settled.persistence }
          : current
      ));
      setDossier((current) => (
        current?.viewPersistence?.scanId === scanId
          ? { ...current, viewPersistence: settled.persistence }
          : current
      ));
      if (
        persisted.state === "persisted"
        && persisted.panelCostToken
        && inv.siteUrl
        && inv.recon
      ) {
        void fetchReconWebTeam(inv.siteUrl, inv.token.name, inv.recon, persisted.panelCostToken)
          .then((webTeam) => {
            if (!webTeam.length) return;
            const supplemented: Investigation = { ...settled, webTeam };
            if (!settleCachedScan(
              resultCache.current,
              inv.token.address,
              scanId,
              { kind: "investigation", inv: supplemented },
            )) return;
            setInvestigation((current) => (
              current
              && !current.versionContext
              && current.persistence?.scanId === scanId
              && normalizeSubjectRef(current.token.address) === normalizeSubjectRef(inv.token.address)
                ? supplemented
                : current
            ));
            const contribution = investigationContribution(supplemented);
            if (contribution) recordContribution(contribution);
          });
      }
    });
    logAudit({
      kind: "token", query: `$${inv.token.symbol}`, ref: inv.token.address, image: inv.token.imageUrl, verdict: inv.token.verdict, score: inv.token.score,
      summary: inv.founderNote,
      coverage: deriveDecisionReadiness(tokenChecks(inv.token)).status,
      flags: ["investigation", inv.recon?.team.state === "named" ? "team-named" : "", inv.projectAccount ? "project-audited" : ""].filter(Boolean),
    });
    const c = investigationContribution(inv);
    if (c) recordContribution(c);
  }, [enqueueReportPersistence, setDossier, setInvestigation, setTokenDossier]);
  const tokenData = useCallback((d: TokenDossier, priv: boolean, scanId: string) => {
    if (priv) return;
    const pending: TokenDossier = { ...d, persistence: { state: "pending", scanId } };
    cacheResult(resultCache.current, d.address, { kind: "token", dossier: pending });
    enqueueReportPersistence("token", d.address, async () => {
      const persisted = await syncReport("token", d.address, `$${d.symbol}`, d, d.verdict, d.score);
      const settled: TokenDossier = { ...d, persistence: { ...persisted, scanId } };
      if (!settleCachedScan(
        resultCache.current,
        d.address,
        scanId,
        { kind: "token", dossier: settled },
      )) return;
      setTokenDossier((current) => (
        current
        && !current.versionContext
        && !current.viewVersionContext
        && current.persistence?.scanId === scanId
        && normalizeSubjectRef(current.address) === normalizeSubjectRef(d.address)
          ? settled
          : current
      ));
    });
    logAudit({
      kind: "token", query: `$${d.symbol}`, ref: d.address, image: d.imageUrl, verdict: d.verdict, score: d.score,
      summary: d.headline,
      coverage: deriveDecisionReadiness(tokenChecks(d)).status,
      flags: [d.capApplied ? `cap:${d.capApplied}` : "", d.bundleRisk !== "low" ? `bundle:${d.bundleRisk}` : ""].filter(Boolean),
    });
    recordContribution(tokenContribution(d.symbol, d.verdict, d.graph.nodes, d.graph.edges));
  }, [enqueueReportPersistence, setTokenDossier]);
  // The runner calls this for every finished token / investigation scan.
  useEffect(() => {
    setScanOnComplete((run: ScanRun) => {
      if (run.kind === "token" && run.result) tokenData(run.result as TokenDossier, !!run.priv, run.id);
      else if (run.kind === "investigation" && run.result) investigationData(run.result as Investigation, !!run.priv, run.id);
    });
  }, [tokenData, investigationData]);

  // VIEW-side completion (only when this view is mounted on the finished run) —
  // the runner already logged/persisted, so these just move the current view.
  const onInvestigationDone = useCallback((inv: Investigation, priv: boolean, scanId: string) => {
    const cached = priv ? null : resultCache.current.get(cacheKey(inv.token.address, "investigation"));
    setInvestigation(cached?.kind === "investigation" && cached.inv.persistence?.scanId === scanId
      ? cached.inv
      : { ...inv, persistence: { state: priv ? "private" : "pending", scanId } });
    setPhase("investigation-report");
  }, [setInvestigation, setPhase]);
  const onTokenDone = useCallback((d: TokenDossier, priv: boolean, scanId: string) => {
    const cached = priv ? null : resultCache.current.get(cacheKey(d.address, "token"));
    setTokenDossier(cached?.kind === "token" && cached.dossier.persistence?.scanId === scanId
      ? cached.dossier
      : { ...d, persistence: { state: priv ? "private" : "pending", scanId } });
    // Token scans render before their asynchronous persistence finishes. Expose
    // a brief only after reopening the exact immutable stored version.
    setTokenBriefTarget(null);
    setPhase("token-report");
  }, [setPhase, setTokenDossier]);

  // Data-side completion for a person audit: always keep the finished report in
  // this session, then publish it to audit and graph surfaces only when the
  // server returned an exact immutable version binding. This is view-independent
  // and never pulls the user away from their current screen.
  const logPerson = useCallback((d: Dossier, priv = false) => {
    if (priv) return; // private: current view only — nothing is cached or leaves
    cacheResult(resultCache.current, d.handle, { kind: "person", dossier: d });
    const persistedVersionId = d.persistence?.state === "persisted"
      && typeof d.persistence.reportVersionId === "string"
      && d.persistence.reportVersionId
      ? d.persistence.reportVersionId
      : null;
    // A failed server save remains available in this session and the report UI
    // explains how to rescan it, but it must not look like a durable audit or
    // enter the shared graph without an exact immutable version binding.
    if (!persistedVersionId) return;
    void syncReport("person", d.handle, d.handle, d, d.report.composite_verdict, d.report.governing_score);
    logAudit({
      kind: "person", query: d.handle, ref: d.handle, verdict: d.report.composite_verdict, score: d.report.governing_score,
      image: d.avatar_url, // real X photo (falls back to unavatar in auditImage when absent)
      summary: d.headline,
      coverage: deriveDecisionReadiness(d.checkRuns?.length ? d.checkRuns : personChecks({
        identityConfidence: d.report.identity_confidence ?? undefined,
        realName: (d.display_name ?? "").trim().split(/\s+/).filter(Boolean).length >= 2,
        roles: d.report.roles ?? [],
        hasAssociates: (d.evidence.associates ?? []).length > 0,
      })).status,
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
    if (c.kind === "person") {
      setDossier(c.dossier);
      setPersonBriefTarget(briefTargetForPerson(c.dossier));
      setPhase("report");
    }
    else if (c.kind === "token") {
      setTokenDossier(c.dossier);
      setTokenBriefTarget(c.dossier.versionContext?.caseId
        ? {
            caseId: c.dossier.versionContext.caseId,
            expectedReportVersionId: c.dossier.versionContext.reportVersionId,
          }
        : null);
      setPhase("token-report");
    }
    else if (c.kind === "investigation") { setInvestigation(c.inv); setPhase("investigation-report"); }
    else {
      setReconUrl(null);
      setStoredRecon(c.recon);
      setStoredReconBriefTarget(c.briefTarget ?? null);
      setStoredReconVersionContext(c.versionContext ?? null);
      setPhase("recon");
    }
  }, [setDossier, setInvestigation, setPhase, setQuery, setStoredRecon, setTokenDossier]);

  const onLiveDone = useCallback((d: Dossier) => {
    const completed = privRef.current
      ? { ...d, persistence: { state: "private" as const } }
      : d;
    setDossier(completed);
    setPersonBriefTarget(briefTargetForPerson(completed));
    setPhase("report");
  }, [setDossier, setPhase]);

  // A live audit failing usually means our long SSE stream dropped (proxy / tab
  // throttle) — but the server persists finished audits, so recover the report
  // before dead-ending. Poll a few times: the server upsert may land just after
  // our stream died. Only show "not found" when nothing was produced.
  const onLiveError = useCallback(async () => {
    const requestId = ++safeAuditRequestRef.current;
    const ref = query;
    if (privRef.current) {
      setLiveError(getRun(ref)?.error ?? "The private live audit didn't finish.");
      setPhase("notfound");
      return;
    }
    const cached = resultCache.current.get(cacheKey(ref, "person"));
    if (requestId !== safeAuditRequestRef.current) return;
    if (cached) { showCached(ref, cached); return; }
    for (let attempt = 0; attempt < 4; attempt++) {
      const rep = await fetchReport(ref, "person");
      if (requestId !== safeAuditRequestRef.current) return;
      if (rep?.payload && rep.kind === "person") {
        const c = { kind: "person" as const, dossier: storedPersonDossier(rep) };
        cacheResult(resultCache.current, ref, c);
        showCached(ref, c);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      if (requestId !== safeAuditRequestRef.current) return;
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
  const onOpenRecent = useCallback(async (
    ref: string,
    requestedKind?: ReportKind,
    allowLaunch = true,
  ) => {
    if (!closeCaseBriefForNavigation()) return;
    leaveEvidenceReview();
    const requestId = ++safeAuditRequestRef.current;
    privRef.current = false;
    setPrivateMode(false);
    setCaseNotice(null);
    const cachedKind = requestedKind === "person" || requestedKind === "token" || requestedKind === "investigation" || requestedKind === "site"
      ? requestedKind
      : undefined;

    // Case status is authoritative over background runs and in-memory caches.
    // Archived history remains discoverable, but no entry point may re-attach
    // or reopen it without an explicit analyst action.
    const lookup = await fetchReportState(ref, requestedKind);
    if (requestId !== safeAuditRequestRef.current) return;
    if (lookup.status === "archived") {
      clearCachedRef(resultCache.current, ref);
      setQuery(ref);
      setCaseNotice({ reason: "archived", ref, kind: requestedKind });
      setLiveError(null);
      setPhase("notfound");
      return;
    }
    if (lookup.status === "unavailable") {
      setQuery(ref);
      setCaseNotice({ reason: "unavailable", ref, kind: requestedKind });
      setLiveError(null);
      setPhase("notfound");
      return;
    }
    // The durable lookup is asynchronous. Read the session cache only after it
    // returns so a scan that completed while that request was in flight wins
    // over the older durable projection the request may have captured.
    const sessionCached = cachedKind
      ? resultCache.current.get(cacheKey(ref, cachedKind))
      : resultCache.current.get(cacheKey(ref));
    const sessionPersistence = cachedPersistence(sessionCached);
    if (lookup.status === "open" && !lookup.report) {
      if (sessionCached && (sessionPersistence?.state === "pending" || sessionPersistence?.state === "failed")) {
        showCached(ref, sessionCached);
        return;
      }
      clearCachedRef(resultCache.current, ref);
      setQuery(ref);
      setCaseNotice(null);
      setLiveError("The case is open, but its immutable projection is temporarily unavailable. No new scan was started.");
      setPhase("notfound");
      return;
    }

    // A background PERSON run — re-attach: reopen the live console or show it done.
    const run = getRun(ref);
    if (run && !run.priv && (!requestedKind || requestedKind === "person")) {
      setQuery(run.handle);
      if (run.status === "running") { setPhase("live"); return; }
    }
    // A background token / investigation scan still running — reopen its console.
    const invRun = getScanRun("investigation", ref);
    const invInput = invRun ? resolveInput(invRun.input) : null;
    if (invRun && !invRun.priv && invRun.status === "running" && invInput && isRunnableTokenInput(invInput) && (!requestedKind || requestedKind === "investigation")) { setInvestigationInput(invInput); setQuery(invRun.input); setPhase("investigation"); return; }
    const tokRun = getScanRun("token", ref);
    const tokInput = tokRun ? resolveInput(tokRun.input) : null;
    if (tokRun && !tokRun.priv && tokRun.status === "running" && tokInput && isRunnableTokenInput(tokInput) && (!requestedKind || requestedKind === "token")) { setTokenInput(tokInput); setQuery(tokRun.input); setPhase("token-run"); return; }

    // A completed scan enters the session cache before its immutable version is
    // activated. Keep that newer pending/failed result visible instead of
    // silently replacing it with the previous durable version for the case.
    if (sessionCached && (sessionPersistence?.state === "pending" || sessionPersistence?.state === "failed")) {
      showCached(ref, sessionCached);
      return;
    }

    // Once no collector is actively running, durable storage is authoritative.
    // Prefer its exact immutable version over a same-session cache that another
    // analyst or a newer completed scan may already have superseded.
    const rep = lookup.report;
    if (rep?.payload && (rep.kind === "person" || rep.kind === "token" || rep.kind === "investigation" || rep.kind === "site")) {
      if (rep.kind === "site") {
        const recon = storedSiteRecon(rep);
        if (!recon) {
          setQuery(ref);
          setLiveError("The stored site report is invalid. No new recon was started.");
          setPhase("notfound");
          return;
        }
        const cached = {
          kind: "site" as const,
          recon,
          versionContext: rep.versionContext,
          briefTarget: rep.versionContext?.caseId
            ? {
                caseId: rep.versionContext.caseId,
                expectedReportVersionId: rep.versionContext.reportVersionId,
              }
            : undefined,
        };
        cacheResult(resultCache.current, ref, cached, !requestedKind);
        showCached(ref, cached);
        return;
      }
      const cached = rep.kind === "investigation"
        ? { kind: "investigation" as const, inv: storedInvestigation(rep) }
        : rep.kind === "token"
          ? { kind: "token" as const, dossier: storedTokenDossier(rep) }
          : { kind: "person" as const, dossier: storedPersonDossier(rep) };
      cacheResult(resultCache.current, ref, cached, !requestedKind);
      showCached(ref, cached);
      return;
    }

    if (run?.status === "done" && !run.priv && run.dossier && (!requestedKind || requestedKind === "person")) {
      setDossier(run.dossier);
      setPersonBriefTarget(briefTargetForPerson(run.dossier));
      setPhase("report");
      return;
    }
    const c = sessionCached;
    if (c) { showCached(ref, c); return; }
    if (!allowLaunch) {
      setQuery(ref);
      setCaseNotice({ reason: "missing", ref, kind: requestedKind });
      setLiveError(null);
      setPhase("notfound");
      return;
    }
    if (requestedKind === "investigation") onInvestigate(ref);
    else onAudit(ref);
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, onAudit, onInvestigate, showCached]);

  const showAuditLaunchFailure = useCallback((
    ref: string,
    mode: TokenLaunchMode,
    reuseStored: boolean,
    error: unknown,
  ) => {
    const detail = error instanceof Error ? error.message : String(error);
    setQuery(ref);
    setCaseNotice({ reason: "launch-failed", ref, mode, reuseStored });
    setLiveError(detail.trim().slice(0, 500) || "Unexpected audit launch failure.");
    setPhase("notfound");
  }, []);

  const openOrLaunchTokenCandidate = useCallback(async (
    candidate: TokenCandidate,
    priv = false,
    mode: TokenLaunchMode = "investigation",
    requestId?: number,
    allowLaunch = true,
    reuseStored = true,
  ) => {
    const activeRequestId = requestId ?? ++safeAuditRequestRef.current;
    try {
      privRef.current = priv;
      setPrivateMode(priv);
      setPhase("resolving");
      if (!priv && reuseStored) {
        const storedLookup = await resolveStoredCases(candidate.canonicalRef);
        if (activeRequestId !== safeAuditRequestRef.current) return;
        if (storedLookup.status === "unavailable") {
          setQuery(candidate.canonicalRef);
          setCaseNotice({ reason: "search-unavailable", ref: candidate.canonicalRef, mode, reuseStored });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
        const preferredKind: ReportKind = mode === "token" ? "token" : "investigation";
        const stored = preferredStoredCase(storedLookup.subjects, preferredKind);
        if (stored) {
          await onOpenRecent(stored.ref, stored.kind);
          return;
        }
        if (storedLookup.subjects.length) {
          setQuery(candidate.canonicalRef);
          setCaseNotice({ reason: "case-ambiguous", ref: candidate.canonicalRef });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
        if (!allowLaunch) {
          setQuery(candidate.canonicalRef);
          setCaseNotice({ reason: "missing", ref: candidate.canonicalRef, kind: preferredKind });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
      }

      setTokenChoices([]);
      setCaseNotice(null);
      setQuery(candidate.input.ref);
      privRef.current = priv;
      setPrivateMode(priv);
      if (mode === "token") {
        setTokenInput(candidate.input);
        const run = reuseStored
          ? startTokenScan(candidate.input, priv)
          : startTokenScan(candidate.input, priv, { force: true });
        if (run.priv !== priv) { showPrivacyConflict(candidate.canonicalRef); return; }
        setPhase("token-run");
      } else {
        setInvestigationInput(candidate.input);
        const run = reuseStored
          ? startInvestigationScan(candidate.input, priv)
          : startInvestigationScan(candidate.input, priv, { force: true });
        if (run.priv !== priv) { showPrivacyConflict(candidate.canonicalRef); return; }
        setPhase("investigation");
      }
    } catch (error) {
      if (activeRequestId !== safeAuditRequestRef.current) return;
      showAuditLaunchFailure(candidate.canonicalRef, mode, reuseStored, error);
    }
  }, [onOpenRecent, showAuditLaunchFailure, showPrivacyConflict]);

  // Search and pivot entry points are storage-first; the Home CTA explicitly
  // opts out so "Run audit" always means a fresh provider run. Both paths still
  // canonicalize token candidates with free DexScreener data before spending.
  const onSafeAuditMode = useCallback(async (
    raw: string,
    priv = false,
    mode: TokenLaunchMode,
    allowLaunch = true,
    reuseStored = true,
  ) => {
    if (!closeCaseBriefForNavigation()) return;
    leaveEvidenceReview();
    const requestId = ++safeAuditRequestRef.current;
    try {
      setCaseNotice(null);
      setTokenChoices([]);
      privRef.current = priv;
      setPrivateMode(priv);
      setQuery(raw);
      setLiveError(null);
      setResolutionUsesStoredCases(reuseStored);
      setPhase("resolving");

      const parsed = resolveInput(raw);
      const lookupInput = parsed.kind === "handle"
        ? parsed.ref
        : parsed.kind === "site"
          ? siteCaseRef(parsed.ref)
          : raw;
      const storedLookup: StoredCaseResolution = priv || !reuseStored
        ? { status: "ok", subjects: [] }
        : await resolveStoredCases(lookupInput);
      if (requestId !== safeAuditRequestRef.current) return;
      if (storedLookup.status === "unavailable") {
        setQuery(raw);
        setCaseNotice({ reason: "search-unavailable", ref: raw, mode, reuseStored });
        setLiveError(null);
        setPhase("notfound");
        return;
      }

      if (parsed.kind !== "token") {
        const stored = preferredStoredCase(storedLookup.subjects);
        if (stored) {
          await onOpenRecent(stored.ref, stored.kind);
          return;
        }
        if (storedLookup.subjects.length) {
          setQuery(raw);
          setCaseNotice({ reason: "case-ambiguous", ref: raw });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
        if (!allowLaunch) {
          setQuery(raw);
          setCaseNotice({ reason: "missing", ref: raw, kind: parsed.kind === "site" ? "site" : "person" });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
        await onAudit(raw, priv);
        return;
      }

      // Exact private token inputs are already canonical enough to launch. Do not
      // consult durable storage (which would reopen a public report) or spend a
      // resolver call merely to recover the same contract.
      if (priv && isRunnableTokenInput(parsed)) {
        setTokenChoices([]);
        setCaseNotice(null);
        setQuery(parsed.ref);
        if (mode === "token") {
          setTokenInput(parsed);
          const run = reuseStored
            ? startTokenScan(parsed, true)
            : startTokenScan(parsed, true, { force: true });
          if (!run.priv) { showPrivacyConflict(parsed.ref); return; }
          setPhase("token-run");
        } else {
          setInvestigationInput(parsed);
          const run = reuseStored
            ? startInvestigationScan(parsed, true)
            : startInvestigationScan(parsed, true, { force: true });
          if (!run.priv) { showPrivacyConflict(parsed.ref); return; }
          setPhase("investigation");
        }
        return;
      }

      // Exact contracts and historical exact aliases can open immediately. A
      // ticker must still resolve against the live contract set even if only one
      // stored case currently uses that display label.
      if (reuseStored && parsed.via !== "ticker" && parsed.via !== "dexscreener") {
        const preferredKind: ReportKind = mode === "token" ? "token" : "investigation";
        const stored = preferredStoredCase(storedLookup.subjects, preferredKind);
        if (stored) {
          await onOpenRecent(stored.ref, stored.kind);
          return;
        }
        if (storedLookup.subjects.length) {
          setQuery(raw);
          setCaseNotice({ reason: "case-ambiguous", ref: raw });
          setLiveError(null);
          setPhase("notfound");
          return;
        }
      }

      const resolution = await resolveTokenSubject(parsed);
      if (requestId !== safeAuditRequestRef.current) return;
      if (resolution.state === "unavailable") {
        setQuery(raw);
        setCaseNotice({ reason: "search-unavailable", ref: raw, mode, reuseStored });
        setLiveError(null);
        setPhase("notfound");
        return;
      }
      if (resolution.state === "not_found") {
        setQuery(raw);
        setCaseNotice({ reason: "token-unresolved", ref: raw });
        setLiveError(null);
        setPhase("notfound");
        return;
      }
      if (resolution.state === "ambiguous") {
        setQuery(raw);
        setTokenChoices(resolution.candidates);
        setTokenChoicePrivate(priv);
        setTokenChoiceMode(mode);
        setTokenChoiceReuseStored(reuseStored);
        setLiveError(null);
        setPhase("token-choice");
        return;
      }
      await openOrLaunchTokenCandidate(resolution.candidate, priv, mode, requestId, allowLaunch, reuseStored);
    } catch (error) {
      if (requestId !== safeAuditRequestRef.current) return;
      showAuditLaunchFailure(raw, mode, reuseStored, error);
    }
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, onAudit, onOpenRecent, openOrLaunchTokenCandidate, showAuditLaunchFailure, showPrivacyConflict]);

  const onHomeAudit = useCallback(
    (raw: string, priv = false) => onSafeAuditMode(raw, priv, "investigation", true, false),
    [onSafeAuditMode],
  );

  const onSafeInvestigationAudit = useCallback(
    (raw: string, priv = false) => onSafeAuditMode(raw, priv, "investigation"),
    [onSafeAuditMode],
  );

  const onSafeAudit = useCallback(
    (raw: string, priv = false) => onSafeAuditMode(raw, priv, "token"),
    [onSafeAuditMode],
  );

  // Incognito pivots still need canonical ticker/address resolution, but must
  // skip durable public-case reuse all the way through that resolver.
  const onPrivateAudit = useCallback((raw: string) => {
    void onSafeAuditMode(raw, true, "token");
  }, [onSafeAuditMode]);

  // open a library/graph card: same path as a recent click (stored report first)
  const onOpen = onOpenRecent;

  // Share links resolve through the stored-report path. `?version=` is an
  // immutable evidence-review route used by Case Briefs and never launches a scan.
  useEffect(() => {
    if (evidenceReviewVersionId) {
      let cancelled = false;
      const timer = window.setTimeout(() => {
        void (async () => {
          const report = await fetchReportVersion(evidenceReviewVersionId);
          if (cancelled) return;
          const cached = report ? cachedFromStoredReport(report) : null;
          const ref = report?.ref ?? "";
          if (!cached || !ref) {
            setQuery(evidenceReviewVersionId);
            setLiveError("That immutable evidence version is unavailable or you no longer have access to it.");
            setPhase("notfound");
            return;
          }
          privRef.current = false;
          setPrivateMode(false);
          cacheResult(resultCache.current, ref, cached, false);
          showCached(ref, cached);
        })();
      }, 0);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    if (!boot.openRef) return;
    const timer = window.setTimeout(() => {
      const ref = boot.openRef as string;
      if (boot.openKind === "token") void onSafeAuditMode(ref, false, "token", false);
      else if (boot.openKind === "investigation") void onSafeAuditMode(ref, false, "investigation", false);
      else if (boot.openKind === "site") void onSafeAuditMode(ref, false, "token", false);
      else void onOpenRecent(ref, boot.openKind, false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [boot.openKind, boot.openRef, evidenceReviewVersionId, onOpenRecent, onSafeAuditMode, showCached]);

  const reset = useCallback(() => {
    if (!closeCaseBriefForNavigation()) return;
    safeAuditRequestRef.current += 1;
    leaveEvidenceReview();
    setPhase("idle");
    setDossier(null);
    setPersonBriefTarget(null);
    setTokenInput(null);
    setTokenDossier(null);
    setTokenBriefTarget(null);
    setInvestigationInput(null);
    setInvestigation(null);
    setStoredRecon(null);
    setStoredReconBriefTarget(null);
    setStoredReconVersionContext(null);
    setQuery("");
    setLiveError(null);
    setCaseNotice(null);
    setTokenChoices([]);
    setTokenChoicePrivate(false);
    setTokenChoiceMode("investigation");
    privRef.current = false;
    setPrivateMode(false);
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, setDossier, setInvestigation, setInvestigationInput, setLiveError, setPhase, setPrivateMode, setQuery, setTokenDossier, setTokenInput]);

  // from the investigation report: open the full on-chain token report
  const onOpenToken = useCallback(() => {
    if (!closeCaseBriefForNavigation()) return;
    // The token dossier embedded in an investigation inherits investigation
    // evidence context. It is not the independently persisted token case, so
    // fail closed instead of attaching either facet's Case Brief to this view.
    setTokenBriefTarget(null);
    setInvestigation((inv) => {
      if (inv) {
        setTokenDossier(inv.versionContext
          ? { ...inv.token, viewVersionContext: inv.versionContext }
          : inv.persistence
            ? { ...inv.token, viewPersistence: inv.persistence }
            : inv.token);
        setPhase("token-report");
      }
      return inv;
    });
  }, [closeCaseBriefForNavigation, setInvestigation, setPhase, setTokenDossier]);

  // from the investigation report: open the full people report for the project
  // account (already collected — no re-spend), which shows the axis/cap reasoning.
  const onOpenProjectAccount = useCallback(() => {
    if (!closeCaseBriefForNavigation()) return;
    // Nested project-account audits are collected privately inside the owning
    // investigation and are not durable person cases.
    setPersonBriefTarget(null);
    setInvestigation((inv) => {
      if (inv?.projectAccount) {
        setDossier(inv.versionContext
          ? { ...inv.projectAccount, viewVersionContext: inv.versionContext }
          : inv.persistence
            ? { ...inv.projectAccount, viewPersistence: inv.persistence }
            : inv.projectAccount);
        setQuery(inv.projectAccount.handle);
        setPhase("report");
      }
      return inv;
    });
  }, [closeCaseBriefForNavigation, setDossier, setInvestigation, setPhase, setQuery]);

  const onNav = useCallback((t: NavTarget) => {
    if (!closeCaseBriefForNavigation()) return;
    safeAuditRequestRef.current += 1;
    setPersonBriefTarget(null);
    setTokenBriefTarget(null);
    leaveEvidenceReview();
    if (t === "idle") {
      setDossier(null);
      setQuery("");
    }
    // opening Site recon from the rail is a fresh, manual page (private off by default)
    if (t === "recon") {
      setReconUrl(null);
      setStoredRecon(null);
      setStoredReconBriefTarget(null);
      setStoredReconVersionContext(null);
      privRef.current = false;
      setPrivateMode(false);
    }
    setPhase(t);
  }, [closeCaseBriefForNavigation, leaveEvidenceReview, setDossier, setPhase, setPrivateMode, setQuery, setReconUrl]);

  const personAudit = phase === "running" || phase === "live" || phase === "report";
  const inAudit = personAudit || phase === "token-run" || phase === "token-report" || phase === "investigation" || phase === "investigation-report" || phase === "resolving" || phase === "token-choice";
  const activeHandle = personAudit ? dossier?.handle ?? (query ? "@" + query.replace(/^@/, "") : null) : null;
  const view: NavTarget | "audit" = inAudit
    ? "audit"
    : phase === "radar" || phase === "trending" || phase === "recon" || phase === "find" || phase === "dossiers" || phase === "graph" || phase === "kols" || phase === "founders" || phase === "projects" || phase === "vcs" || phase === "watchlist" || phase === "alerts" || phase === "track" || phase === "admin" || phase === "about" || phase === "api" || phase === "providers" || phase === "changelog"
      ? phase
      : "idle";
  const personReportPrivate = (dossier?.viewPersistence ?? dossier?.persistence)?.state === "private";
  const tokenReportPrivate = (tokenDossier?.viewPersistence ?? tokenDossier?.persistence)?.state === "private";
  const investigationReportPrivate = investigation?.persistence?.state === "private";

  return (
    <AppShell onNav={onNav} onAudit={onSafeAudit} onOpenRecent={onOpenRecent} activeHandle={activeHandle} view={view}>
      <Suspense fallback={<RouteLoading />}>
      {evidenceReviewVersionId && phase !== "idle" && phase !== "notfound" && (
        <div className="tint-signal mx-auto mt-4 flex max-w-5xl flex-wrap items-center gap-2 rounded-xl border px-4 py-3 text-[12.5px]">
          <span className="font-medium text-signal">Immutable evidence review</span>
          <span className="mono break-all">version {evidenceReviewVersionId}</span>
          <span>Opened in a separate tab so the Case Brief draft remains intact.</span>
        </div>
      )}
      {phase === "idle" && <Landing onAudit={onHomeAudit} onAbout={() => setPhase("about")} onOpenRecent={onOpenRecent} />}

      {phase === "about" && <AboutPage onStart={reset} />}

      {phase === "api" && <ApiPage />}

      {phase === "providers" && <ProvidersPage />}

      {phase === "changelog" && <ChangelogPage />}

      {phase === "dossiers" && <DossiersPage onOpen={onOpen} onOpenBrief={setCaseBriefTarget} />}

      {phase === "graph" && <GraphPage onOpen={onOpen} />}

      {phase === "kols" && <KolsPage onAudit={onSafeAudit} onOpenRecent={onOpenRecent} />}

      {phase === "founders" && <FoundersPage onAudit={onSafeAudit} onOpenRecent={onOpenRecent} />}

      {phase === "vcs" && <VcsPage onAudit={onSafeAudit} onOpenRecent={onOpenRecent} />}

      {phase === "projects" && <ProjectsPage onAudit={onSafeAudit} onOpenRecent={onOpenRecent} />}

      {phase === "radar" && <RadarPage onAudit={onSafeAudit} />}

      {phase === "trending" && <TrendingPage onOpen={onOpenRecent} />}

      {phase === "watchlist" && <WatchlistPage onAudit={onSafeAudit} />}

      {phase === "alerts" && <AlertsPage onOpen={onOpenRecent} />}

      {phase === "recon" && <ReconPage key={storedRecon ? `stored:${storedRecon.retrieval.url}:${storedReconVersionContext?.reportVersionId ?? "legacy"}` : reconUrl ?? "manual"} initialUrl={reconUrl ?? undefined} initialRecon={storedRecon ?? undefined} initialVersionContext={storedReconVersionContext ?? undefined} initialPrivate={privateMode} onAudit={onSafeAudit} onInvestigate={onSafeInvestigationAudit} onOpenRecent={onOpenRecent} onOpenBrief={!evidenceReviewVersionId && !privateMode && storedReconBriefTarget ? () => setCaseBriefTarget(storedReconBriefTarget) : undefined} onStartFresh={leaveEvidenceReview} />}

      {phase === "find" && <FindWallet onAudit={onSafeAudit} onReset={reset} onOpenRecent={onOpenRecent} />}

      {phase === "admin" && <AdminPage onAudit={onSafeAudit} />}

      {phase === "live" && <LiveRun handle={query} onDone={onLiveDone} onError={onLiveError} />}

      {phase === "report" && dossier && <Report key={`person:${dossier.versionContext?.reportVersionId ?? dossier.viewVersionContext?.reportVersionId ?? dossier.persistence?.scanId ?? dossier.viewPersistence?.scanId ?? dossier.report.audit_id}`} dossier={dossier} onReset={reset} onAudit={personReportPrivate ? onPrivateAudit : onSafeAudit} onRescan={() => onAudit(dossier.handle, personReportPrivate)} onOpenProject={personReportPrivate ? onOpenPrivateProject : (name, domain, panelCostToken) => onOpenProject(name, domain, false, panelCostToken)} onOpenBrief={!evidenceReviewVersionId && !privateMode && personBriefTarget ? () => setCaseBriefTarget(personBriefTarget) : undefined} />}
      {phase === "project" && viewedProject && <ProjectView project={viewedProject} onAudit={viewedProject.privateMode ? onPrivateAudit : onSafeAudit} onReset={reset} record={!viewedProject.privateMode} panelCostToken={viewedProject.panelCostToken} />}

      {phase === "token-run" && tokenInput && (
        <TokenRun input={tokenInput} onDone={onTokenDone} onError={() => setPhase("notfound")} />
      )}

      {phase === "token-report" && tokenDossier && <TokenReport key={`token:${tokenDossier.versionContext?.reportVersionId ?? tokenDossier.viewVersionContext?.reportVersionId ?? tokenDossier.persistence?.scanId ?? tokenDossier.viewPersistence?.scanId ?? tokenDossier.address}`} dossier={tokenDossier} onReset={reset} onAudit={tokenReportPrivate ? onPrivateAudit : onSafeAudit} onRescan={() => onAudit(tokenDossier.address, tokenReportPrivate, true)} onOpenBrief={!evidenceReviewVersionId && !privateMode && tokenBriefTarget ? () => setCaseBriefTarget(tokenBriefTarget) : undefined} />}

      {phase === "investigation" && investigationInput && (
        <InvestigationRun input={investigationInput} onDone={onInvestigationDone} onError={onInvestigationError} />
      )}

      {phase === "investigation-report" && investigation && (
        <InvestigationReport
          key={`investigation:${investigation.versionContext?.reportVersionId ?? investigation.persistence?.scanId ?? investigation.token.address}`}
          inv={investigation}
          onAudit={investigationReportPrivate ? onPrivateAudit : onSafeAudit}
          onReset={reset}
          onOpenToken={onOpenToken}
          onOpenProjectAccount={onOpenProjectAccount}
          onOpenBrief={!evidenceReviewVersionId && !privateMode && investigation.versionContext?.caseId
            ? () => setCaseBriefTarget({
                caseId: investigation.versionContext!.caseId,
                expectedReportVersionId: investigation.versionContext!.reportVersionId,
              })
            : undefined}
          onReAudit={() => {
            const input = resolveInput(investigation.token.address);
            if (!isRunnableTokenInput(input)) return;
            leaveEvidenceReview();
            privRef.current = investigationReportPrivate;
            setPrivateMode(investigationReportPrivate);
            setInvestigationInput(input);
            setInvestigation(null);
            const run = startInvestigationScan(input, investigationReportPrivate, { force: true });
            if (run.priv !== investigationReportPrivate) { showPrivacyConflict(input.ref); return; }
            setPhase("investigation");
          }}
        />
      )}

      {phase === "resolving" && (
        <div className="relative flex min-h-[60vh] flex-col items-center justify-center px-6 text-center" role="status" aria-live="polite">
          <div className="grid-bg absolute inset-0 -z-10" />
          <span className="h-2 w-2 animate-pulse rounded-full bg-signal" />
          <h2 className="mt-4 display-sm text-[18px] text-ink">Resolving the exact subject</h2>
          <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-dim">
            {resolutionUsesStoredCases
              ? "Checking durable cases and canonical contract identity before any collector or paid investigation can start."
              : "Resolving canonical identity before starting a fresh provider run. Existing snapshots will remain unchanged and paid API quota may be used."}
          </p>
        </div>
      )}

      {phase === "token-choice" && (
        <div className="relative mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 py-16">
          <div className="grid-bg absolute inset-0 -z-10" />
          <div className="eyebrow text-signal">Exact contract required</div>
          <h2 className="mt-2 display-sm text-[24px] text-ink">Choose the token you meant</h2>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
            More than one contract uses this ticker. ARGUS will never guess based on liquidity or popularity. Select the exact chain and address before any investigation starts.
          </p>
          {!tokenChoiceReuseStored && (
            <p className="mt-3 max-w-2xl text-[12.5px] leading-relaxed text-ink-faint">
              This is still a fresh-audit request. Choosing a contract starts a new provider run and may use paid API quota; previous snapshots remain in Recent audits.
            </p>
          )}
          <div className="mt-6 grid gap-3">
            {tokenChoices.map((candidate) => (
              <button
                key={`${candidate.chain}:${candidate.canonicalRef}`}
                onClick={() => { void openOrLaunchTokenCandidate(candidate, tokenChoicePrivate, tokenChoiceMode, undefined, true, tokenChoiceReuseStored); }}
                className="panel p-4 text-left transition hover:border-line-2"
                aria-label={`${tokenChoiceReuseStored ? "Investigate" : "Start fresh audit of"} ${candidate.symbol || candidate.name || "token"} on ${candidate.chain} at ${candidate.canonicalRef}`}
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[15px] font-medium text-ink">
                    {candidate.symbol ? `$${candidate.symbol}` : candidate.name || "Unnamed token"}
                    {candidate.name && candidate.name.toLowerCase() !== candidate.symbol.toLowerCase() && (
                      <span className="ml-2 text-[12.5px] font-normal text-ink-dim">{candidate.name}</span>
                    )}
                  </span>
                  <span className="chip">{candidate.chain}</span>
                </span>
                <span className="mono mt-2 block break-all text-[11px] text-ink-dim">{candidate.canonicalRef}</span>
                <span className="mt-2 block text-[11px] text-ink-faint">
                  {candidate.liquidityUsd > 0
                    ? `${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(candidate.liquidityUsd)} liquidity on the strongest matching pair`
                    : "Liquidity unavailable"}
                </span>
              </button>
            ))}
          </div>
          <button onClick={reset} className="mt-6 self-start text-[13.5px] text-ink-dim hover:text-ink">Back to home</button>
        </div>
      )}

      {phase === "notfound" && (
        <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-24 text-center">
          <div className="grid-bg absolute inset-0 -z-10" />
          {caseNotice ? (
            <>
              <div className="mono max-w-md break-all text-[13.5px] text-signal">{caseNotice.ref}</div>
              <h2 className="mt-3 display-sm text-[24px] text-ink">
                {caseNotice.reason === "archived"
                  ? "This case is archived"
                  : caseNotice.reason === "missing"
                    ? "No stored case exists yet"
                    : caseNotice.reason === "launch-failed"
                      ? "Couldn't start the audit"
                      : caseNotice.reason === "privacy-conflict"
                        ? "A scan is already running in another privacy mode"
                        : caseNotice.reason === "token-unresolved"
                          ? "Couldn't resolve that token"
                          : caseNotice.reason === "case-ambiguous"
                            ? "More than one stored case matches"
                            : "Stored case status is unavailable"}
              </h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-dim">
                {caseNotice.reason === "archived"
                  ? "Its immutable reports, evidence, audit history, and trust-graph intelligence are preserved. ARGUS did not start a new scan."
                  : caseNotice.reason === "missing"
                    ? "This link does not point to an existing immutable report. ARGUS did not automatically start a collector or spend investigation quota."
                    : caseNotice.reason === "launch-failed"
                      ? "ARGUS hit an unexpected resolver or orchestration error and exited the launch flow instead of leaving it stuck. Retry once; any same-subject run already in flight will be reused rather than duplicated."
                      : caseNotice.reason === "privacy-conflict"
                        ? "ARGUS will not attach a private view to a public run, or suppress persistence for a public request by reusing a private run. Let the current scan finish, then retry."
                        : caseNotice.reason === "token-unresolved"
                          ? "No exact DexScreener contract matched that token input. ARGUS did not reinterpret it as a person or spend any investigation quota. Paste the contract address, a DexScreener URL, or an exact $TICKER."
                          : caseNotice.reason === "case-ambiguous"
                            ? "Several durable cases share that label. Open the report library and choose the exact case facet; ARGUS will not guess or start a scan."
                            : "ARGUS could not safely verify whether this case is active or archived. No cached report was opened and no paid scan was started."}
              </p>
              {caseNotice.reason === "launch-failed" && liveError && (
                <div role="alert" className="mono panel-inset mt-3 max-w-md break-words px-3 py-2 text-left text-[12.5px] text-ink-dim">
                  {liveError}
                </div>
              )}
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <button
                  onClick={() => {
                    if (caseNotice.reason === "archived") setPhase("dossiers");
                    else if (caseNotice.reason === "missing") reset();
                    else if (caseNotice.reason === "unavailable") void onOpenRecent(caseNotice.ref, caseNotice.kind);
                    else if (caseNotice.reason === "search-unavailable" || caseNotice.reason === "launch-failed") void onSafeAuditMode(
                      caseNotice.ref,
                      privRef.current,
                      caseNotice.mode ?? "investigation",
                      true,
                      caseNotice.reuseStored ?? true,
                    );
                    else if (caseNotice.reason === "case-ambiguous") setPhase("dossiers");
                    else reset();
                  }}
                  className="btn-primary px-5 py-2.5 text-[13.5px] font-medium"
                >
                  {caseNotice.reason === "archived"
                    ? "Go to report library"
                    : caseNotice.reason === "missing"
                      ? "Back to home"
                    : caseNotice.reason === "privacy-conflict"
                      ? "Back to home"
                      : caseNotice.reason === "launch-failed"
                        ? "Retry audit"
                        : caseNotice.reason === "unavailable" || caseNotice.reason === "search-unavailable"
                          ? "Retry safely"
                          : caseNotice.reason === "case-ambiguous"
                            ? "Go to report library"
                            : "Try another token"}
                </button>
                {(caseNotice.reason === "archived" || caseNotice.reason === "missing") && role !== "viewer" && (
                  <button
                    onClick={() => {
                      const archived = caseNotice;
                      setCaseNotice(null);
                      if (archived.kind === "investigation") onInvestigate(archived.ref, privRef.current, true);
                      else onAudit(archived.ref, privRef.current, true);
                    }}
                    className="rounded-lg border border-line px-5 py-2.5 text-[13.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
                  >
                    {caseNotice.reason === "archived" ? "Start fresh scan and reopen" : "Start a new scan"}
                  </button>
                )}
              </div>
            </>
          ) : resolveInput(query).kind === "token" ? (
            <>
              <div className="mono max-w-md break-all text-[13.5px] text-signal">{query}</div>
              <h2 className="mt-3 display-sm text-[24px] text-ink">Couldn't resolve that token</h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-dim">
                No DEX pair was found for this contract. It may be brand-new, unlisted, illiquid, or on a chain
                ARGUS doesn't index yet. Double-check the address, or try one of the live samples on the home screen.
              </p>
            </>
          ) : liveError ? (
            <>
              <div className="mono text-[13.5px] text-signal">@{query.replace(/^@/, "")}</div>
              <h2 className="mt-3 display-sm text-[24px] text-ink">The live audit didn't finish</h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-dim">
                ARGUS collected against this handle but the run ended before a report was assembled — usually a
                timeout on a very large account, or a dropped connection. Nothing was saved. Retrying often
                clears it, since slow providers are cached on the second pass.
              </p>
              <div className="mono panel-inset mt-3 max-w-md break-words px-3 py-2 text-[12.5px] text-ink-dim">
                {liveError}
              </div>
              <div className="mt-6 flex items-center gap-3">
                <button onClick={() => onAudit(query, privRef.current)} className="btn-primary px-5 py-2.5 text-[13.5px] font-medium">
                  Retry audit
                </button>
                <button onClick={reset} className="text-[13.5px] text-ink-dim hover:text-ink">
                  Back to home
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="mono text-[13.5px] text-signal">@{query.replace(/^@/, "")}</div>
              <h2 className="mt-3 display-sm text-[24px] text-ink">No live dossier yet</h2>
              <p className="mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-dim">
                This demo ships with curated worked audits. With provider keys configured, ARGUS resolves any
                handle on demand. Pick a dossier from the rail, or paste a token contract for a live audit.
              </p>
              <button onClick={reset} className="btn-primary mt-6 px-5 py-2.5 text-[13.5px] font-medium">
                Back to home
              </button>
            </>
          )}
          {!caseNotice && resolveInput(query).kind === "token" && (
            <button onClick={reset} className="btn-primary mt-6 px-5 py-2.5 text-[13.5px] font-medium">
              Back to home
            </button>
          )}
        </div>
      )}
      </Suspense>
      {caseBriefTarget && (
        <Suspense fallback={<CaseBriefLoadingDialog />}>
          <CaseBriefPanel
            key={JSON.stringify(caseBriefTarget)}
            target={caseBriefTarget}
            onClose={dismissCaseBrief}
            onDirtyChange={trackCaseBriefDirty}
          />
        </Suspense>
      )}
    </AppShell>
  );
}
