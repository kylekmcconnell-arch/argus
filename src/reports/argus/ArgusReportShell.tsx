import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "./argus-report.css";
import { ArgusReportProvider, type ArgusReportRuntime } from "./context";
import { DisclosureButton, DisclosureProvider, InlinePanel, useDisclosures } from "./disclosure";
import { CHAPTERS, type ChapterId, type ReportIssue } from "./model";
import { Badge, ChallengeButton, ChallengePanel } from "./primitives";
import { panelTargetForContext } from "./challengeText";
import { ChallengeForm, SignupGate } from "./challenge";
import { CHALLENGE_EVENT, type ChallengeDetail } from "../../lib/challenge";

/* The report frame from the approved design: sticky toolbar (breadcrumb,
   compact saved scores, Watch · Export brief · Share), sticky horizontal
   chapter navigation, saved-version meta line, one chapter at a time, and a
   footer. The application sidebar stays outside this component. */

export interface ShareConfig {
  /** Existing capability-link service: POST /api/share for this exact version. */
  create?: () => Promise<string>;
  /** Why a link cannot be created from this view, when it cannot. */
  unavailableReason?: string;
  subjectLabel: string;
  versionLabel: string;
}

export interface MoreAction {
  label: string;
  detail?: string;
  onClick: () => void;
}

export interface ArgusReportShellProps {
  runtime: Omit<ArgusReportRuntime, "readOnly" | "goTo" | "toast">;
  shareView: boolean;
  breadcrumbName: string;
  versionLabel?: string | null;
  topScores: Array<{ label: string; value: string }>;
  savedLine: string;
  /** The exact immutable version behind a live result, when one was saved. */
  savedHref?: string | null;
  issues: ReportIssue[];
  watch?: { watched: boolean; toggle: () => void } | null;
  exportBrief: () => Promise<void>;
  share?: ShareConfig | null;
  more?: MoreAction[];
  chapters: Record<ChapterId, (props: { readOnly: boolean; active: boolean }) => ReactNode>;
  footerNote: string;
  scope: ReactNode;
  initialChapter?: ChapterId;
}

function Toast({ text }: { text: string | null }) {
  return <div className="toast" role="status" aria-live="polite" hidden={!text}>{text}</div>;
}

/** Each audit row is challengeable on its own, like every other claim. */
function auditChallenge(issue: ReportIssue) {
  return {
    id: `audit-${issue.id}`,
    title: issue.title,
    claim: `Report quality audit, ${issue.severity} in ${issue.area}: ${issue.title}. ${issue.observed} How this report handles it: ${issue.handling}`,
  };
}

export function AuditList({ issues, critical }: { issues: ReportIssue[]; critical: boolean }) {
  const shown = issues.filter((issue) => !critical || issue.severity === "Critical");
  return (
    <>
      <div className="eyebrow">{critical ? `${shown.length} critical conflict${shown.length === 1 ? "" : "s"}` : "Structural and mathematical review"}</div>
      <h2 className="dialog-title">{critical ? "Resolve these before relying on the scores." : "The report quality audit"}</h2>
      <p className="dialog-body">
        These checks compare the saved report with itself: score representations, evidence eligibility and data scopes. They do not change the saved scores and are not findings about the subject.
      </p>
      {shown.map((issue, index) => (
        <article className="issue" key={issue.id}>
          <div className="issue-label">
            <Badge tone={issue.severity === "Critical" ? "red" : "amber"}>{issue.severity}</Badge>
            <span>{String(index + 1).padStart(2, "0")} · {issue.area}</span>
          </div>
          <h3>{issue.title}</h3>
          <p>{issue.observed}</p>
          <p className="fix"><strong>How this report handles it:</strong> {issue.handling}</p>
          <ChallengeButton target={auditChallenge(issue)} />
          <ChallengePanel target={auditChallenge(issue)} />
        </article>
      ))}
    </>
  );
}

function SharePanel({ share, onPreview }: { share: ShareConfig; onPreview: () => void }) {
  const [state, setState] = useState<"idle" | "creating" | "created" | "error">("idle");
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  // Sharing is a primary action: bring the panel into view as soon as it opens.
  // The panel grows from zero height and scroll anchoring shifts the page
  // while it does, so snap again once the open animation has finished.
  useEffect(() => {
    const target = panelRef.current?.closest(".inline-detail") ?? panelRef.current;
    const snap = () => target?.scrollIntoView?.({ behavior: "auto", block: "start" });
    snap();
    const settled = window.setTimeout(snap, 300);
    return () => window.clearTimeout(settled);
  }, []);
  const create = async () => {
    if (!share.create || state === "creating") return;
    setState("creating");
    setStatus("Creating your link…");
    try {
      const href = await share.create();
      const parsed = new URL(href, window.location.origin);
      if (parsed.protocol !== "https:" && parsed.hostname !== window.location.hostname) {
        throw new Error("The sharing service did not return a usable link.");
      }
      setUrl(parsed.toString());
      setState("created");
      setStatus("Share link created. Anyone with this link can view the report.");
    } catch (error) {
      setState("error");
      setStatus(error instanceof Error && error.message ? error.message : "Link creation failed. Please try again.");
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setStatus("Select the link and copy it.");
    }
  };
  return (
    <div className="share-panel" ref={panelRef}>
      <div className="eyebrow">Share interactive report</div>
      <h2 className="dialog-title">Let others explore the evidence.</h2>
      <p className="dialog-body">Create a read-only link to this version of the report, including its scores, evidence and review warnings.</p>
      <div className="status-box">
        <strong>Anyone with the link can view the shared report.</strong>
        <p>Recipients can explore the report without an account. They must sign up or sign in before starting a challenge. Your watchlist, checklist and unsubmitted challenges are excluded. Links expire after 30 days and can be revoked.</p>
      </div>
      <div className="share-summary"><span>{share.subjectLabel}</span><span>{share.versionLabel} · Read only</span></div>
      {!share.create && share.unavailableReason && <p className="subtle-note">{share.unavailableReason}</p>}
      <button type="button" className="btn primary" disabled={!share.create || state === "creating" || state === "created"} onClick={() => void create()}>
        {state === "created" ? "Link created" : "Create share link"}
      </button>
      <button type="button" className="btn" style={{ marginLeft: 8 }} onClick={onPreview}>Preview shared view</button>
      <p className="share-status" role="status">{status}</p>
      {state === "created" && (
        <div className="share-result">
          <label htmlFor="rd-share-url">Shareable link</label>
          <input id="rd-share-url" readOnly type="url" value={url} onFocus={(event) => event.currentTarget.select()} />
          <button type="button" className="btn" onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
        </div>
      )}
    </div>
  );
}

function MoreMenu({ actions }: { actions: MoreAction[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  if (!actions.length) return null;
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="btn quiet" aria-haspopup="menu" aria-expanded={open} aria-label="More report actions" onClick={() => setOpen((value) => !value)}>
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div className="more-menu" role="menu">
          {actions.map((action) => (
            <button key={action.label} type="button" role="menuitem" onClick={() => { setOpen(false); action.onClick(); }}>
              {action.label}
              {action.detail && <small>{action.detail}</small>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ShellBody(props: ArgusReportShellProps & {
  chapter: ChapterId;
  setChapter: (chapter: ChapterId) => void;
  readOnly: boolean;
  sharedPreview: boolean;
  setSharedPreview: (value: boolean) => void;
  toast: (text: string) => void;
}) {
  const { chapter, setChapter, issues, readOnly, sharedPreview } = props;
  const disclosures = useDisclosures();
  const [exporting, setExporting] = useState(false);
  // Existing panels raise the shared challenge event; it opens inline here,
  // below the report meta line, never as a modal.
  const [eventChallenge, setEventChallenge] = useState<string | null>(null);
  const { openPanel } = disclosures;
  useEffect(() => {
    const onChallenge = (event: Event) => {
      const context = (event as CustomEvent<ChallengeDetail>).detail?.context ?? "";
      setEventChallenge(context || "This report");
      openPanel("challenge:event");
      window.setTimeout(() => {
        const panel = document.getElementById("rd-panel-challenge-event");
        if (panel && typeof panel.scrollIntoView === "function") panel.scrollIntoView({ block: "start" });
      }, 40);
    };
    window.addEventListener(CHALLENGE_EVENT, onChallenge);
    return () => window.removeEventListener(CHALLENGE_EVENT, onChallenge);
  }, [openPanel]);

  const exportBrief = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await props.exportBrief();
      props.toast("PDF brief downloaded.");
    } catch (error) {
      console.error("[export] brief failed", error);
      props.toast("The PDF brief could not be generated. Try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="breadcrumb">
          <span>{props.shareView ? "Shared report" : "Cases"}</span>
          <span className="slash">/</span>
          <strong>{props.breadcrumbName}</strong>
          {props.versionLabel && <span className="version">{props.versionLabel}</span>}
        </div>
        <div className="top-scores">
          {props.topScores.map((score) => <span key={score.label}>{score.label} <b>{score.value}</b></span>)}
          {issues.some((issue) => issue.kind === "reconciliation" && issue.severity !== "Medium") && <span className="tiny-warning">Review needed</span>}
        </div>
        <div className="header-actions">
          {props.watch && !readOnly && (
            <button type="button" className="btn quiet" aria-pressed={props.watch.watched} onClick={() => {
              props.watch?.toggle();
              props.toast(props.watch?.watched ? "Removed from your watchlist." : "Added to your watchlist.");
            }}>
              <span aria-hidden="true">{props.watch.watched ? "★" : "☆"}</span>
              <span className="watch-label">{props.watch.watched ? "Watching" : "Watch"}</span>
            </button>
          )}
          <button type="button" className="btn" title="Download PDF brief" disabled={exporting} onClick={() => void exportBrief()}>
            <span aria-hidden="true">↓</span> {exporting ? "Preparing…" : "Export brief"}
          </button>
          {props.share && !props.shareView && (
            <DisclosureButton id="share" className="btn primary">Share</DisclosureButton>
          )}
          {!readOnly && props.more && <MoreMenu actions={props.more} />}
        </div>
      </header>
      <nav className="report-nav" aria-label="Report sections">
        {CHAPTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === chapter ? "selected" : undefined}
            aria-current={item.id === chapter ? "page" : undefined}
            onClick={() => setChapter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="rd-main" id="rd-main" tabIndex={-1}>
        <div className="report-meta">
          <span>
            <i className="saved-dot" aria-hidden="true" />{" "}
            {props.savedHref && (
              <><a href={props.savedHref} target="_blank" rel="noreferrer" title="Open the exact saved report. New checks shown later do not change its score.">SAVED REPORT</a>{" · "}</>
            )}
            {props.savedLine}
            <span data-report-header-identity="true"> · Report {props.runtime.auditId}{props.runtime.caseLabel ? ` · Case ${props.runtime.caseLabel}` : ""}</span>
          </span>
          {issues.length > 0 && (
            <DisclosureButton id="audit" className="textbtn">
              Report quality audit <span className="counter">{issues.length}</span> <span aria-hidden="true">↗</span>
            </DisclosureButton>
          )}
        </div>
        <InlinePanel id="audit" label="Report quality audit">{() => <AuditList issues={issues} critical={false} />}</InlinePanel>
        <InlinePanel id="challenge:event" label="Challenge">
          {() => (readOnly ? <SignupGate /> : <ChallengeForm key={eventChallenge ?? ""} target={panelTargetForContext(eventChallenge ?? "This report")} />)}
        </InlinePanel>
        {props.share && !props.shareView && (
          <InlinePanel id="share" label="Share" className="share-slot">
            {() => (
              <SharePanel
                share={props.share!}
                onPreview={() => {
                  disclosures.closeAll();
                  props.setSharedPreview(true);
                  props.toast("Shared view: reading is open; challenges require sign-up.");
                }}
              />
            )}
          </InlinePanel>
        )}
        {sharedPreview && (
          <div className="review-banner">
            <div>
              <strong>Shared report · read only</strong>
              <p>Explore freely. Sign up or sign in to start a challenge.</p>
            </div>
            <button type="button" className="btn" onClick={() => props.setSharedPreview(false)}>Exit preview</button>
          </div>
        )}
        {CHAPTERS.map((item) => (
          <div className="rd-chapter" key={item.id} data-chapter={item.id} hidden={item.id !== chapter}>
            {props.chapters[item.id]({ readOnly, active: item.id === chapter })}
          </div>
        ))}
        <footer className="rd-footer">
          <span>ARGUS · Evidence before conviction.</span>
          <span data-report-identity="true">{props.footerNote} · Presentation 2026-09-23.2</span>
          <DisclosureButton id="scope" className="textbtn">Scope &amp; limitations</DisclosureButton>
        </footer>
        <InlinePanel id="scope" label="Scope and limitations">{() => props.scope}</InlinePanel>
      </div>
    </>
  );
}

export function ArgusReportShell(props: ArgusReportShellProps) {
  const [chapter, setChapterState] = useState<ChapterId>(props.initialChapter ?? "decision");
  const [sharedPreview, setSharedPreview] = useState(false);
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingAnchor = useRef<string | null>(null);
  const [anchorTick, setAnchorTick] = useState(0);
  const readOnly = props.shareView || sharedPreview;

  const toast = useCallback((text: string) => {
    setToastText(text);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastText(null), 4000);
  }, []);
  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const setChapter = useCallback((next: ChapterId) => {
    setChapterState(next);
    const root = rootRef.current;
    if (root && typeof root.scrollIntoView === "function") root.scrollIntoView({ block: "start" });
  }, []);

  // In-report anchors (#basic-facts, #scan-methodology …) open the chapter that holds them.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as Element | null)?.closest?.("a[href^='#']");
      if (!anchor || !root.contains(anchor)) return;
      const id = decodeURIComponent((anchor.getAttribute("href") ?? "").slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target || !root.contains(target)) return;
      const holder = target.closest<HTMLElement>("[data-chapter]");
      const targetChapter = holder?.dataset.chapter as ChapterId | undefined;
      event.preventDefault();
      pendingAnchor.current = id;
      if (targetChapter && holder?.hidden) setChapterState(targetChapter);
      else setAnchorTick((tick) => tick + 1);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    const id = pendingAnchor.current;
    if (!id) return;
    pendingAnchor.current = null;
    const timer = window.setTimeout(() => {
      const element = document.getElementById(id);
      if (element) {
        if (element instanceof HTMLDetailsElement) element.open = true;
        element.scrollIntoView({ block: "start" });
      }
    }, 30);
    return () => window.clearTimeout(timer);
  }, [chapter, anchorTick]);

  const runtime = useMemo<ArgusReportRuntime>(() => ({
    ...props.runtime,
    readOnly,
    goTo: setChapter,
    toast,
  }), [props.runtime, readOnly, setChapter, toast]);

  return (
    <ArgusReportProvider value={runtime}>
      <DisclosureProvider resetKey={`${chapter}:${readOnly ? "read" : "owner"}`}>
        <div ref={rootRef} className="argus-rd" data-report-design="argus-2026-09">
          <ShellBody
            {...props}
            chapter={chapter}
            setChapter={setChapter}
            readOnly={readOnly}
            sharedPreview={sharedPreview}
            setSharedPreview={setSharedPreview}
            toast={toast}
          />
          <Toast text={toastText} />
        </div>
      </DisclosureProvider>
    </ArgusReportProvider>
  );
}
