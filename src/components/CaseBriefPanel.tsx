import { useEffect, useRef, useState } from "react";
import {
  appendCaseBriefNote,
  CaseBriefAnchorConflictError,
  CaseBriefConflictError,
  fetchCaseBrief,
  fetchOlderCaseBriefNotes,
  fetchOlderCaseBriefRevisions,
  saveCaseBrief,
  type CaseBrief,
  type CaseBriefContent,
  type CaseBriefRecommendation,
  type CaseBriefRevision,
  type CaseBriefTarget,
  type CaseBriefViewer,
} from "../lib/caseBrief";

interface CaseBriefPanelProps {
  target: CaseBriefTarget;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean, busy?: boolean) => void;
}

interface BriefDraft {
  recommendation: CaseBriefRecommendation;
  assigneeUserId: string;
  dueDate: string;
  anchorReportVersionId: string;
  reanchor: boolean;
  summary: string;
  strongestEvidence: string;
  highestRisks: string;
  unresolvedQuestions: string;
  changeConditions: string;
  nextActions: string;
}

const RECOMMENDATIONS: Array<{ value: CaseBriefRecommendation; label: string; tone: string }> = [
  { value: "undecided", label: "Undecided", tone: "var(--color-ink-dim)" },
  { value: "advance", label: "Advance", tone: "var(--color-pass)" },
  { value: "monitor", label: "Monitor", tone: "var(--color-caution)" },
  { value: "decline", label: "Decline", tone: "var(--color-avoid)" },
];

const LIST_FIELDS = [
  ["strongestEvidence", "Strongest evidence", "One verified support point per line."],
  ["highestRisks", "Highest risks", "One material risk or contradiction per line."],
  ["unresolvedQuestions", "Unresolved questions", "What still blocks a confident decision?"],
  ["changeConditions", "What would change the decision", "Evidence or events that would change the recommendation."],
  ["nextActions", "Next actions", "Concrete follow-ups, one per line."],
] as const satisfies ReadonlyArray<readonly [keyof Pick<BriefDraft, "strongestEvidence" | "highestRisks" | "unresolvedQuestions" | "changeConditions" | "nextActions">, string, string]>;

const fieldClass = "mt-1.5 w-full rounded-lg border border-line-2 bg-void/70 px-3 py-2 text-[13px] leading-relaxed text-ink outline-none transition placeholder:text-ink-dim focus:border-signal disabled:cursor-not-allowed disabled:opacity-65";

function dateInputValue(value: string | null): string {
  if (!value) return "";
  const date = value.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return date ?? "";
}

function dueAtValue(value: string): string | null {
  return value ? `${value}T12:00:00.000Z` : null;
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function shortId(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 16 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function readableDate(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function draftFrom(viewer: CaseBriefViewer): BriefDraft {
  const brief = viewer.brief;
  const content = brief?.content;
  const assigneeIsActive = Boolean(
    brief?.assigneeUserId
    && viewer.assignees.some((assignee) => assignee.userId === brief.assigneeUserId),
  );
  return {
    recommendation: brief?.recommendation ?? "undecided",
    assigneeUserId: assigneeIsActive ? brief?.assigneeUserId ?? "" : "",
    dueDate: dateInputValue(brief?.dueAt ?? null),
    anchorReportVersionId: brief?.anchorReportVersionId ?? viewer.currentVersion?.reportVersionId ?? "",
    reanchor: false,
    summary: content?.summary ?? "",
    strongestEvidence: (content?.strongestEvidence ?? []).join("\n"),
    highestRisks: (content?.highestRisks ?? []).join("\n"),
    unresolvedQuestions: (content?.unresolvedQuestions ?? []).join("\n"),
    changeConditions: (content?.changeConditions ?? []).join("\n"),
    nextActions: (content?.nextActions ?? []).join("\n"),
  };
}

function draftFingerprint(draft: BriefDraft | null): string {
  return draft ? JSON.stringify(draft) : "";
}

function contentFrom(draft: BriefDraft): CaseBriefContent {
  return {
    summary: draft.summary.trim(),
    strongestEvidence: lines(draft.strongestEvidence),
    highestRisks: lines(draft.highestRisks),
    unresolvedQuestions: lines(draft.unresolvedQuestions),
    changeConditions: lines(draft.changeConditions),
    nextActions: lines(draft.nextActions),
  };
}

function validateContent(content: CaseBriefContent): string | null {
  if (content.summary.length > 4_000) return "The executive summary must be 4,000 characters or fewer.";
  const lists = [
    ["Strongest evidence", content.strongestEvidence],
    ["Highest risks", content.highestRisks],
    ["Unresolved questions", content.unresolvedQuestions],
    ["Decision-change conditions", content.changeConditions],
    ["Next actions", content.nextActions],
  ] as const;
  for (const [label, items] of lists) {
    if (items.length > 20) return `${label} can contain at most 20 nonblank items.`;
    if (items.some((item) => item.length > 2_000)) return `Each ${label.toLowerCase()} item must be 2,000 characters or fewer.`;
  }
  if (new TextEncoder().encode(JSON.stringify(content)).byteLength > 65_536) {
    return "The case brief is too large. Shorten the evidence synthesis before saving.";
  }
  return null;
}

function newClientId(): string {
  if (typeof crypto === "undefined") throw new Error("Secure note identifiers are unavailable in this browser.");
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  if (typeof crypto.getRandomValues !== "function") throw new Error("Secure note identifiers are unavailable in this browser.");
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function recommendationLabel(value: CaseBriefRecommendation): string {
  return RECOMMENDATIONS.find((item) => item.value === value)?.label ?? "Undecided";
}

function revisionFromBrief(brief: CaseBrief): CaseBriefRevision {
  return {
    id: `head-${brief.revision}-${brief.updatedAt}`,
    caseId: brief.caseId,
    revision: brief.revision,
    anchorReportVersionId: brief.anchorReportVersionId,
    recommendation: brief.recommendation,
    assigneeUserId: brief.assigneeUserId,
    assigneeDisplayName: brief.assigneeDisplayName,
    dueAt: brief.dueAt,
    content: brief.content,
    createdByUserId: brief.updatedByUserId,
    authorDisplayName: brief.updatedByDisplayName,
    createdAt: brief.updatedAt,
  };
}

function BriefReadout({ content }: { content: CaseBriefContent }) {
  const fields = [
    ["Strongest evidence", content.strongestEvidence],
    ["Highest risks", content.highestRisks],
    ["Unresolved questions", content.unresolvedQuestions],
    ["Decision-change conditions", content.changeConditions],
    ["Next actions", content.nextActions],
  ] as const;
  return (
    <div className="mt-3 space-y-3 text-[12px] text-ink-dim">
      {content.summary && <p className="whitespace-pre-wrap leading-relaxed">{content.summary}</p>}
      {fields.map(([label, items]) => items.length > 0 && (
        <div key={label}>
          <div className="text-[9.5px] uppercase tracking-wider text-ink-dim">{label}</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {items.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function CaseBriefPanel({ target, onClose, onDirtyChange }: CaseBriefPanelProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const noteAttemptRef = useRef<{ clientId: string; body: string } | null>(null);
  const [viewer, setViewer] = useState<CaseBriefViewer | null>(null);
  const [draft, setDraft] = useState<BriefDraft | null>(null);
  const [baseline, setBaseline] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [noteSaving, setNoteSaving] = useState(false);
  const [historyLoading, setHistoryLoading] = useState<"revisions" | "notes" | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflictBrief, setConflictBrief] = useState<CaseBrief | null | undefined>(undefined);
  const briefDirty = draft !== null && draftFingerprint(draft) !== baseline;
  const hasUnsavedWork = briefDirty || Boolean(noteBody.trim());
  const busy = saving || noteSaving;
  const navigationProtected = hasUnsavedWork || busy;

  const load = async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const next = await fetchCaseBrief(target, { settleRetries: 3, signal });
      if (!next) {
        setViewer(null);
        setDraft(null);
        setError("The report is still being secured. Wait a moment, then retry the case brief.");
        return;
      }
      const nextDraft = draftFrom(next);
      setViewer(next);
      setDraft(nextDraft);
      setBaseline(draftFingerprint(nextDraft));
      setConflictBrief(undefined);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "The case brief could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  };

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
    // target is stable for the mounted drawer; App keys the component by target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!navigationProtected) return;
    const protect = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [navigationProtected]);

  useEffect(() => {
    onDirtyChange?.(hasUnsavedWork, busy);
  }, [busy, hasUnsavedWork, onDirtyChange]);

  useEffect(() => () => onDirtyChange?.(false, false), [onDirtyChange]);

  useEffect(() => {
    if (!error || !alertRef.current) return;
    alertRef.current.focus({ preventScroll: false });
    alertRef.current.scrollIntoView?.({ block: "nearest" });
  }, [error]);

  const requestClose = () => {
    if (busy) {
      setError("Wait for the in-flight save to finish before closing this case brief.");
      return;
    }
    if (hasUnsavedWork && !window.confirm("Discard your unsaved case brief changes and note draft?")) return;
    onClose();
  };

  const updateDraft = <K extends keyof BriefDraft>(key: K, value: BriefDraft[K]) => {
    if (busy) return;
    setDraft((current) => current ? { ...current, [key]: value } : current);
    setNotice("");
  };

  const runSave = async (expectedRevision?: number) => {
    if (!viewer || !draft || busy || !viewer.canEdit || viewer.case.status === "archived") return;
    if (!draft.anchorReportVersionId) {
      setError("This case does not have a report version to anchor the brief to.");
      return;
    }
    const content = contentFrom(draft);
    const validationError = validateContent(content);
    if (validationError) {
      setError(validationError);
      return;
    }
    const priorRevision = expectedRevision ?? viewer.brief?.revision ?? 0;
    const anchorReportVersionId = draft.anchorReportVersionId;
    const storedDueAt = viewer.brief?.dueAt ?? null;
    const dueAt = dateInputValue(storedDueAt) === draft.dueDate
      ? storedDueAt
      : dueAtValue(draft.dueDate);
    const conflictHead = conflictBrief;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await saveCaseBrief({
        caseId: viewer.case.caseId,
        expectedRevision: priorRevision,
        anchorReportVersionId,
        reanchor: draft.reanchor,
        recommendation: draft.recommendation,
        assigneeUserId: draft.assigneeUserId || null,
        dueAt,
        content,
      });
      const savedDraft: BriefDraft = { ...draft, anchorReportVersionId: saved.anchorReportVersionId, reanchor: false };
      setDraft(savedDraft);
      setBaseline(draftFingerprint(savedDraft));
      let authoritative: CaseBriefViewer | null = null;
      let freshnessVerified = false;
      try {
        authoritative = await fetchCaseBrief({ caseId: saved.caseId }, { settleRetries: 0 });
        freshnessVerified = Boolean(
          authoritative?.brief
          && authoritative.brief.revision >= saved.revision,
        );
      } catch {
        // The save already committed. The fallback keeps known revisions, but
        // explicitly warns that evidence freshness could not be verified.
      }
      const newerHead = freshnessVerified
        && authoritative?.brief
        && authoritative.brief.revision > saved.revision
        ? authoritative.brief
        : null;
      if (freshnessVerified && authoritative) {
        const revisions = new Map(authoritative.revisions.map((revision) => [revision.revision, revision]));
        for (const head of [conflictHead, saved]) {
          if (head && !revisions.has(head.revision)) revisions.set(head.revision, revisionFromBrief(head));
        }
        setViewer({
          ...authoritative,
          revisions: [...revisions.values()].sort((left, right) => right.revision - left.revision),
        });
        setConflictBrief(newerHead ?? undefined);
      } else {
        setViewer((current) => {
          if (!current) return current;
          const revisions = new Map(current.revisions.map((revision) => [revision.revision, revision]));
          for (const head of [conflictHead, saved]) {
            if (head && !revisions.has(head.revision)) revisions.set(head.revision, revisionFromBrief(head));
          }
          return {
            ...current,
            brief: saved,
            hasNewEvidence: current.case.currentReportVersionId !== saved.anchorReportVersionId,
            revisions: [...revisions.values()].sort((left, right) => right.revision - left.revision),
          };
        });
        setConflictBrief(undefined);
      }
      if (!freshnessVerified) {
        setError(`Revision ${saved.revision} was saved, but ARGUS could not verify whether newer evidence is active. Reopen the brief before relying on its freshness state.`);
      } else if (newerHead) {
        setError(`Revision ${saved.revision} was saved, then revision ${newerHead.revision} became current. Your saved reasoning remains in the immutable timeline.`);
      }
      setNotice(newerHead
        ? `Revision ${saved.revision} saved; revision ${newerHead.revision} is now current.`
        : saved.revision === priorRevision
          ? `No material change was detected. Revision ${saved.revision} remains current.`
          : `Revision ${saved.revision} saved. The prior revision remains immutable.`);
    } catch (saveError) {
      if (saveError instanceof CaseBriefConflictError) {
        setConflictBrief(saveError.currentBrief);
        setViewer((current) => current ? { ...current, brief: saveError.currentBrief } : current);
        setError("Another analyst saved this brief first. Your draft is intact. Review the conflict, then retry against the latest revision.");
      } else if (saveError instanceof CaseBriefAnchorConflictError) {
        try {
          const latest = await fetchCaseBrief({ caseId: viewer.case.caseId }, { settleRetries: 0 });
          if (!latest) throw new Error("The latest evidence snapshot is temporarily unavailable.", { cause: saveError });
          setViewer(latest);
          setDraft((current) => current ? {
            ...current,
            anchorReportVersionId: latest.brief?.anchorReportVersionId
              ?? latest.currentVersion?.reportVersionId
              ?? current.anchorReportVersionId,
            reanchor: false,
          } : current);
          setError("A newer report version was published first. Your analysis is intact; review the latest evidence and explicitly choose whether to re-anchor again.");
        } catch (refreshError) {
          setError(refreshError instanceof Error ? refreshError.message : saveError.message);
        }
      } else {
        setError(saveError instanceof Error ? saveError.message : "The case brief could not be saved.");
      }
    } finally {
      setSaving(false);
    }
  };

  const saveNote = async () => {
    if (!viewer || busy || !viewer.canEdit || viewer.case.status === "archived" || !noteBody.trim()) return;
    setNoteSaving(true);
    setError("");
    try {
      const body = noteBody.trim();
      const attempt = noteAttemptRef.current?.body === body
        ? noteAttemptRef.current
        : { clientId: newClientId(), body };
      noteAttemptRef.current = attempt;
      const note = await appendCaseBriefNote({ caseId: viewer.case.caseId, body, clientId: attempt.clientId });
      setViewer((current) => current ? { ...current, notes: [note, ...current.notes] } : current);
      setNoteBody("");
      noteAttemptRef.current = null;
      setNotice("Note appended to the case history.");
    } catch (noteError) {
      setError(noteError instanceof Error ? noteError.message : "The case note could not be appended.");
    } finally {
      setNoteSaving(false);
    }
  };

  const loadOlderRevisions = async () => {
    if (!viewer?.hasOlderRevisions || historyLoading) return;
    const oldest = [...viewer.revisions].sort((a, b) => a.revision - b.revision)[0];
    if (!oldest) return;
    setHistoryLoading("revisions");
    setError("");
    try {
      const page = await fetchOlderCaseBriefRevisions(viewer.case.caseId, oldest.revision);
      setViewer((current) => {
        if (!current) return current;
        const revisions = new Map(current.revisions.map((revision) => [revision.revision, revision]));
        for (const revision of page.revisions) revisions.set(revision.revision, revision);
        const anchorVersions = new Map(current.anchorVersions.map((version) => [version.reportVersionId, version]));
        for (const version of page.anchorVersions) anchorVersions.set(version.reportVersionId, version);
        return {
          ...current,
          revisions: [...revisions.values()].sort((left, right) => right.revision - left.revision),
          anchorVersions: [...anchorVersions.values()].sort((left, right) => right.version - left.version),
          hasOlderRevisions: page.hasOlderRevisions,
        };
      });
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Older revisions could not be loaded.");
    } finally {
      setHistoryLoading(null);
    }
  };

  const loadOlderNotes = async () => {
    if (!viewer?.hasOlderNotes || historyLoading) return;
    const oldest = [...viewer.notes].sort((left, right) =>
      Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.id.localeCompare(right.id))[0];
    if (!oldest) return;
    setHistoryLoading("notes");
    setError("");
    try {
      const page = await fetchOlderCaseBriefNotes(viewer.case.caseId, {
        createdAt: oldest.createdAt,
        id: oldest.id,
      });
      setViewer((current) => {
        if (!current) return current;
        const notes = new Map(current.notes.map((note) => [note.id, note]));
        for (const note of page.notes) notes.set(note.id, note);
        return {
          ...current,
          notes: [...notes.values()].sort((left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt)
            || right.id.localeCompare(left.id)),
          hasOlderNotes: page.hasOlderNotes,
        };
      });
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : "Older notes could not be loaded.");
    } finally {
      setHistoryLoading(null);
    }
  };

  const refreshConflict = async () => {
    if (!viewer || busy) return;
    setSaving(true);
    setError("");
    try {
      const latest = await fetchCaseBrief({ caseId: viewer.case.caseId }, { settleRetries: 0 });
      if (!latest) throw new Error("The latest server revision is temporarily unavailable.");
      setViewer(latest);
      setConflictBrief(latest.brief);
      setNotice("Server state refreshed. Your local fields were not replaced.");
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : "The latest server revision could not be loaded.");
    } finally {
      setSaving(false);
    }
  };

  const editable = Boolean(viewer?.canEdit && viewer.case.status === "open");
  const currentVersion = viewer?.currentVersion;
  const savedBriefHasNewEvidence = Boolean(
    viewer?.brief
    && currentVersion
    && viewer.brief.anchorReportVersionId !== currentVersion.reportVersionId,
  );
  const anchorVersion = viewer && draft
    ? viewer.anchorVersions.find((version) => version.reportVersionId === draft.anchorReportVersionId)
      ?? (currentVersion?.reportVersionId === draft.anchorReportVersionId ? currentVersion : null)
    : null;
  const currentRecommendation = RECOMMENDATIONS.find((item) => item.value === draft?.recommendation) ?? RECOMMENDATIONS[0];
  const basisIsProposed = Boolean(
    draft
    && (!viewer?.brief || draft.anchorReportVersionId !== viewer.brief.anchorReportVersionId),
  );
  const conflictBasisNeedsChoice = Boolean(
    conflictBrief
    && draft
    && !draft.reanchor
    && draft.anchorReportVersionId !== conflictBrief.anchorReportVersionId,
  );
  const orderedRevisions = viewer ? [...viewer.revisions].sort((a, b) => b.revision - a.revision) : [];
  const orderedNotes = viewer ? [...viewer.notes].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)) : [];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="case-brief-title"
      aria-describedby="case-brief-description"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      className="fixed inset-0 z-[100] m-0 ml-auto h-[100dvh] max-h-none w-full max-w-[760px] overflow-hidden border-0 border-l border-line bg-void p-0 text-ink shadow-2xl backdrop:bg-black/75"
    >
      <div className="flex h-full flex-col">
        <header className="shrink-0 border-b border-line bg-panel/95 px-5 py-4 backdrop-blur">
          <div className="flex items-start gap-4">
            <div className="min-w-0 flex-1">
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-signal">Analyst workspace</div>
              <h2 id="case-brief-title" className="mt-1 truncate text-[21px] font-medium tracking-tight text-ink">
                Case brief{viewer ? ` · ${viewer.case.query || viewer.case.ref}` : ""}
              </h2>
              <p id="case-brief-description" className="mt-1 text-[12px] leading-relaxed text-ink-dim">
                A human decision record anchored to immutable ARGUS evidence. It never changes the model verdict.
              </p>
            </div>
            <button
              type="button"
              onClick={requestClose}
              disabled={busy}
              aria-label="Close case brief"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line text-xl leading-none text-ink-dim transition hover:border-line-2 hover:text-ink"
            >
              ×
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading && (
            <div className="flex min-h-[45vh] items-center justify-center" role="status" aria-live="polite">
              <span className="flex items-center gap-2 text-[12px] text-ink-dim">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
                Loading exact case history…
              </span>
            </div>
          )}

          {!loading && !viewer && (
            <div className="rounded-xl border border-avoid/35 bg-avoid/5 p-4">
              <div ref={alertRef} tabIndex={-1} role="alert" className="text-[13px] leading-relaxed text-avoid">{error || "This case brief is unavailable."}</div>
              <button
                type="button"
                onClick={() => void load()}
                className="mt-3 rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink transition hover:border-signal hover:text-signal"
              >
                Retry
              </button>
            </div>
          )}

          {!loading && viewer && draft && (
            <div className="space-y-5">
              <section aria-label="Case identity and evidence anchor" className="rounded-xl border border-line bg-panel p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono rounded border border-line px-1.5 py-0.5 text-[9.5px] uppercase text-ink-dim">{viewer.case.kind}</span>
                      <span className="mono break-all text-[12px] text-ink">{viewer.case.ref}</span>
                      {viewer.case.status === "archived" && <span className="mono rounded border border-caution/40 bg-caution/5 px-1.5 py-0.5 text-[9.5px] uppercase text-caution">Archived · read only</span>}
                    </div>
                    <div className="mono mt-2 text-[10px] text-ink-dim">Case {shortId(viewer.case.caseId)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9.5px] uppercase tracking-wider text-ink-dim">
                      {basisIsProposed ? "Proposed decision basis · unsaved" : "Saved analyst decision basis"}
                    </div>
                    <div className="mono mt-1 text-[14px] font-semibold text-ink">
                      {anchorVersion
                        ? `v${anchorVersion.version} · ${anchorVersion.verdict ?? "No verdict"}${anchorVersion.score != null ? ` · ${anchorVersion.score}` : ""}`
                        : shortId(draft.anchorReportVersionId)}
                    </div>
                    <div className="mt-0.5 text-[10px] text-ink-dim">
                      {anchorVersion ? `Immutable evidence captured ${readableDate(anchorVersion.createdAt)}` : "Exact immutable anchor"}
                    </div>
                  </div>
                </div>
                <dl className="mt-4 grid grid-cols-1 gap-3 border-t border-line/70 pt-3 text-[11px] sm:grid-cols-2">
                  <div>
                    <dt className="uppercase tracking-wider text-ink-dim">{basisIsProposed ? "Proposed brief anchor" : "Saved brief anchor"}</dt>
                    <dd className="mono mt-1 text-ink-dim" title={draft.anchorReportVersionId}>
                      {anchorVersion ? `v${anchorVersion.version} · ${shortId(draft.anchorReportVersionId)}` : shortId(draft.anchorReportVersionId)}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-ink-dim">Current model evidence</dt>
                    <dd className="mono mt-1 text-ink-dim">
                      {currentVersion
                        ? `v${currentVersion.version} · ${currentVersion.verdict ?? "No verdict"}${currentVersion.score != null ? ` · ${currentVersion.score}` : ""}`
                        : "No report version"}
                    </dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-ink-dim">Evidence captured</dt>
                    <dd className="mt-1 text-ink-dim">{readableDate(currentVersion?.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="uppercase tracking-wider text-ink-dim">Coverage</dt>
                    <dd className="mono mt-1 text-ink-dim">{currentVersion ? `${currentVersion.completenessState} · ${currentVersion.attestationState.replaceAll("_", " ")}` : "—"}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2 border-t border-line/70 pt-3">
                  {anchorVersion && (
                    <a
                      href={`?version=${encodeURIComponent(anchorVersion.reportVersionId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center rounded-lg border border-line-2 px-3 py-1.5 text-[11px] text-ink-dim transition hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                    >
                      Review {basisIsProposed ? "proposed" : "saved"} basis v{anchorVersion.version} in new tab ↗
                    </a>
                  )}
                  {currentVersion && currentVersion.reportVersionId !== anchorVersion?.reportVersionId && (
                    <a
                      href={`?version=${encodeURIComponent(currentVersion.reportVersionId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-8 items-center rounded-lg border border-caution/50 px-3 py-1.5 text-[11px] text-caution transition hover:bg-caution/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-caution"
                    >
                      Review current evidence v{currentVersion.version} in new tab ↗
                    </a>
                  )}
                </div>
                <details className="mt-3 border-t border-line/70 pt-3">
                  <summary className="cursor-pointer text-[10px] text-ink-dim">Exact immutable IDs</summary>
                  <dl className="mono mt-2 space-y-2 text-[9.5px] leading-relaxed text-ink-dim">
                    <div>
                      <dt className="uppercase tracking-wider">Case ID</dt>
                      <dd className="mt-0.5 break-all text-ink-dim">{viewer.case.caseId}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider">Brief anchor report version</dt>
                      <dd className="mt-0.5 break-all text-ink-dim">{draft.anchorReportVersionId || "—"}</dd>
                    </div>
                    <div>
                      <dt className="uppercase tracking-wider">Current report version</dt>
                      <dd className="mt-0.5 break-all text-ink-dim">{currentVersion?.reportVersionId ?? "—"}</dd>
                    </div>
                  </dl>
                </details>
              </section>

              {savedBriefHasNewEvidence && currentVersion && (
                <section role="alert" className="rounded-xl border border-caution/40 bg-caution/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-[500px]">
                      <div className="text-[12.5px] font-medium text-caution">New evidence is available</div>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                        This brief remains anchored to its older immutable snapshot. Review report v{currentVersion.version}, then explicitly re-anchor before saving conclusions based on it.
                      </p>
                    </div>
                    {editable && (
                      <button
                        type="button"
                        onClick={() => setDraft((current) => current ? current.reanchor
                          ? {
                              ...current,
                              anchorReportVersionId: viewer.brief?.anchorReportVersionId ?? current.anchorReportVersionId,
                              reanchor: false,
                            }
                          : {
                              ...current,
                              anchorReportVersionId: currentVersion.reportVersionId,
                              reanchor: true,
                            } : current)}
                        aria-pressed={draft.reanchor}
                        disabled={busy}
                        className="shrink-0 rounded-lg border border-caution/50 px-3 py-1.5 text-[11px] font-medium text-caution transition hover:bg-caution/10"
                      >
                        {draft.reanchor ? "Keep existing anchor" : `Re-anchor to v${currentVersion.version}`}
                      </button>
                    )}
                  </div>
                </section>
              )}

              {!editable && viewer.case.status !== "archived" && (
                <div className="rounded-xl border border-line bg-panel/60 px-4 py-3 text-[12px] text-ink-dim">
                  Your viewer role can read this brief, its revisions, and notes. Owners and analysts can edit it.
                </div>
              )}

              {error && <div ref={alertRef} tabIndex={-1} role="alert" className="rounded-lg border border-avoid/35 bg-avoid/5 px-3 py-2 text-[12px] leading-relaxed text-avoid">{error}</div>}
              {notice && <div role="status" aria-live="polite" className="rounded-lg border border-pass/35 bg-pass/5 px-3 py-2 text-[12px] text-pass">{notice}</div>}
              {conflictBrief !== undefined && (
                <div className="rounded-xl border border-caution/40 bg-caution/5 p-4">
                  <div className="text-[12px] font-medium text-caution">Revision conflict · local draft preserved</div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink-dim">
                    The server is now at revision {conflictBrief?.revision ?? 0}. Nothing you typed was replaced. Retry only when you are ready to write your draft as the next immutable revision.
                  </p>
                  {conflictBrief && (
                    <details className="mt-3 rounded-lg border border-line/70 bg-void/40 px-3 py-2.5">
                      <summary className="cursor-pointer text-[11px] text-ink-dim">Compare with current server revision {conflictBrief.revision}</summary>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-[9.5px] text-ink-dim">
                        <span className="mono">Server anchor {shortId(conflictBrief.anchorReportVersionId)}</span>
                        <a
                          href={`?version=${encodeURIComponent(conflictBrief.anchorReportVersionId)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-6 items-center rounded border border-line-2 px-1.5 py-1 text-signal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                        >
                          Review exact server evidence ↗
                        </a>
                      </div>
                      <dl className="mt-2 grid grid-cols-1 gap-2 text-[10.5px] text-ink-dim sm:grid-cols-2">
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Server recommendation</dt>
                          <dd className="mt-0.5 text-ink">{recommendationLabel(conflictBrief.recommendation)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Your draft recommendation</dt>
                          <dd className="mt-0.5 text-ink">{recommendationLabel(draft.recommendation)}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Server assignee</dt>
                          <dd className="mt-0.5 text-ink">{conflictBrief.assigneeDisplayName ?? "Unassigned"}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Your draft assignee</dt>
                          <dd className="mt-0.5 text-ink">
                            {draft.assigneeUserId
                              ? viewer.assignees.find((assignee) => assignee.userId === draft.assigneeUserId)?.displayName ?? "Former analyst"
                              : "Unassigned"}
                          </dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Server due</dt>
                          <dd className="mt-0.5 text-ink">{conflictBrief.dueAt ? dateInputValue(conflictBrief.dueAt) : "No due date"}</dd>
                        </div>
                        <div>
                          <dt className="uppercase tracking-wider text-ink-dim">Your draft due</dt>
                          <dd className="mt-0.5 text-ink">{draft.dueDate || "No due date"}</dd>
                        </div>
                      </dl>
                      <BriefReadout content={conflictBrief.content} />
                    </details>
                  )}
                  {conflictBasisNeedsChoice && conflictBrief && (
                    <div role="alert" className="mt-3 rounded-lg border border-caution/40 bg-void/40 px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">
                      The other revision changed the evidence basis. ARGUS will not attach your analysis to that anchor silently.
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setDraft((current) => current ? {
                            ...current,
                            anchorReportVersionId: conflictBrief.anchorReportVersionId,
                            reanchor: false,
                          } : current);
                          setNotice("The current server basis is now selected explicitly. Review that immutable report before retrying.");
                        }}
                        className="ml-2 rounded-md border border-caution/50 px-2 py-1 font-medium text-caution transition hover:bg-caution/10 disabled:opacity-60"
                      >
                        Use server basis
                      </button>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void refreshConflict()}
                      className="rounded-lg border border-line px-3 py-1.5 text-[11px] text-ink-dim transition hover:border-line-2 hover:text-ink disabled:opacity-60"
                    >
                      Refresh server state
                    </button>
                    <button
                      type="button"
                      disabled={busy || conflictBasisNeedsChoice}
                      onClick={() => void runSave(conflictBrief?.revision ?? 0)}
                      className="rounded-lg border border-caution/50 px-3 py-1.5 text-[11px] font-medium text-caution transition hover:bg-caution/10 disabled:opacity-60"
                    >
                      {saving ? "Saving…" : draft.reanchor ? "Keep my draft and re-anchor" : "Save my draft as next revision"}
                    </button>
                  </div>
                </div>
              )}

              <section aria-labelledby="analyst-decision-heading" className="rounded-xl border border-signal/30 bg-signal/5 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 id="analyst-decision-heading" className="text-[14px] font-medium text-ink">Analyst recommendation</h3>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">A human judgment recorded separately from the current ARGUS model verdict.</p>
                  </div>
                  <span className="mono rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: `${currentRecommendation.tone}66`, color: currentRecommendation.tone }}>
                    {currentRecommendation.label}
                  </span>
                </div>
                <label className="mt-4 block text-[11px] font-medium text-ink-dim">
                  Recommendation
                  <select
                    value={draft.recommendation}
                    onChange={(event) => updateDraft("recommendation", event.target.value as CaseBriefRecommendation)}
                    disabled={!editable || busy}
                    className={fieldClass}
                  >
                    {RECOMMENDATIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="mt-4 block text-[11px] font-medium text-ink-dim">
                  Executive summary
                  <textarea
                    value={draft.summary}
                    onChange={(event) => updateDraft("summary", event.target.value)}
                    readOnly={!editable || busy}
                    rows={5}
                    maxLength={4000}
                    placeholder="State the recommendation, why it is justified, and the biggest uncertainty."
                    className={fieldClass}
                  />
                  <span className="mt-1 block text-right text-[9.5px] text-ink-dim">{draft.summary.length.toLocaleString()} / 4,000</span>
                </label>
              </section>

              <section aria-label="Case brief evidence synthesis" className="space-y-4 rounded-xl border border-line bg-panel p-4">
                {LIST_FIELDS.map(([key, label, hint]) => (
                  <label key={key} className="block text-[11px] font-medium text-ink-dim">
                    {label}
                    <span className="ml-2 font-normal text-ink-dim">{hint}</span>
                    <textarea
                      value={draft[key]}
                      onChange={(event) => updateDraft(key, event.target.value)}
                      readOnly={!editable || busy}
                      rows={4}
                      placeholder="One item per line"
                      className={fieldClass}
                    />
                    <span className="mt-1 block text-right text-[9.5px] text-ink-dim">{lines(draft[key]).length} / 20 items</span>
                  </label>
                ))}
              </section>

              <section aria-label="Case ownership" className="rounded-xl border border-line bg-panel p-4">
                <h3 className="text-[13px] font-medium text-ink">Ownership and timing</h3>
                <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <label className="text-[11px] font-medium text-ink-dim">
                    Assignee
                    <select
                      value={draft.assigneeUserId}
                      onChange={(event) => updateDraft("assigneeUserId", event.target.value)}
                      disabled={!editable || busy}
                      className={fieldClass}
                    >
                      <option value="">Unassigned</option>
                      {viewer.assignees.map((assignee) => (
                        <option key={assignee.userId} value={assignee.userId}>{assignee.displayName} · {assignee.role}</option>
                      ))}
                    </select>
                    {viewer.brief?.assigneeDisplayName
                      && (!viewer.brief.assigneeUserId
                        || !viewer.assignees.some((assignee) => assignee.userId === viewer.brief?.assigneeUserId)) && (
                      <span className="mt-1.5 block text-[9.5px] text-ink-dim">
                        Historical assignee: {viewer.brief.assigneeDisplayName}. The account is no longer assignable.
                      </span>
                    )}
                  </label>
                  <label className="text-[11px] font-medium text-ink-dim">
                    Review due
                    <input
                      type="date"
                      value={draft.dueDate}
                      onChange={(event) => updateDraft("dueDate", event.target.value)}
                      disabled={!editable || busy}
                      className={fieldClass}
                    />
                  </label>
                </div>
              </section>

              {editable && (
                <section aria-label="Save case brief revision" className="flex flex-wrap items-center gap-3 rounded-xl border border-signal/35 bg-signal/5 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-medium text-ink">Secure this decision record</div>
                    <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-dim">
                      {conflictBrief !== undefined
                        ? "Resolve the concurrent revision and evidence basis before saving."
                        : briefDirty
                          ? "A material save creates the next immutable revision."
                          : "No unsaved brief fields."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runSave()}
                    disabled={busy || !briefDirty || conflictBrief !== undefined}
                    className="btn-primary px-4 py-2 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? "Saving revision…" : viewer.brief ? "Save new revision" : "Create case brief"}
                  </button>
                </section>
              )}

              <section aria-labelledby="case-notes-heading" className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 id="case-notes-heading" className="text-[13px] font-medium text-ink">Append-only case notes</h3>
                    <p className="mt-0.5 text-[10.5px] text-ink-dim">Notes can be added, never edited or deleted.</p>
                  </div>
                  <span className="mono text-[10px] text-ink-dim">
                    {viewer.hasOlderNotes ? `Latest ${orderedNotes.length} notes` : `${orderedNotes.length} notes`}
                  </span>
                </div>
                {editable && (
                  <div className="mt-3">
                    <label htmlFor="case-brief-note" className="sr-only">New case note</label>
                    <textarea
                      id="case-brief-note"
                      value={noteBody}
                      onChange={(event) => setNoteBody(event.target.value)}
                      disabled={busy}
                      rows={3}
                      maxLength={10_000}
                      placeholder="Add an observation, handoff, or follow-up result…"
                      className={fieldClass}
                    />
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="text-[9.5px] text-ink-dim">{noteBody.length.toLocaleString()} / 10,000</span>
                      <button
                        type="button"
                        onClick={() => void saveNote()}
                        disabled={busy || !noteBody.trim()}
                        className="rounded-lg border border-line px-3 py-1.5 text-[11px] font-medium text-ink transition hover:border-signal hover:text-signal disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {noteSaving ? "Appending…" : "Append note"}
                      </button>
                    </div>
                  </div>
                )}
                {orderedNotes.length > 0 ? (
                  <ol className="mt-4 space-y-2 border-t border-line/70 pt-3">
                    {orderedNotes.map((note) => (
                      <li key={note.id} className="rounded-lg border border-line/70 bg-void/50 px-3 py-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-ink-dim">
                          <span className="font-medium text-ink-dim">{note.authorDisplayName}</span>
                          <time dateTime={note.createdAt}>{readableDate(note.createdAt)}</time>
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap text-[12px] leading-relaxed text-ink-dim">{note.body}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 border-t border-line/70 pt-3 text-[11.5px] text-ink-dim">No analyst notes yet.</p>
                )}
                {viewer.hasOlderNotes && (
                  <button
                    type="button"
                    disabled={historyLoading !== null}
                    onClick={() => void loadOlderNotes()}
                    className="mt-3 min-h-8 rounded-lg border border-line-2 px-3 py-1.5 text-[11px] text-ink-dim transition hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-60"
                  >
                    {historyLoading === "notes" ? "Loading older notes…" : "Load older append-only notes"}
                  </button>
                )}
              </section>

              <section aria-labelledby="revision-history-heading" className="rounded-xl border border-line bg-panel p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 id="revision-history-heading" className="text-[13px] font-medium text-ink">Immutable revision timeline</h3>
                    <p className="mt-0.5 text-[10.5px] text-ink-dim">Every material save creates a new snapshot. Loaded revisions remain inspectable below.</p>
                  </div>
                  <span className="mono text-[10px] text-ink-dim">
                    {viewer.hasOlderRevisions ? `Latest ${orderedRevisions.length} revisions` : `${orderedRevisions.length} revisions`}
                  </span>
                </div>
                {orderedRevisions.length > 0 ? (
                  <ol className="mt-4 space-y-2 border-t border-line/70 pt-3">
                    {orderedRevisions.map((revision) => (
                      <li key={revision.id}>
                        <details className="rounded-lg border border-line/70 bg-void/50 px-3 py-2.5">
                          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="mono text-[11px] font-semibold text-ink">Revision {revision.revision}</span>
                              <span className="mono rounded border border-line px-1.5 py-0.5 text-[9px] uppercase text-ink-dim">{recommendationLabel(revision.recommendation)}</span>
                              <span className="ml-auto text-[10px] text-ink-dim">{revision.authorDisplayName} · {readableDate(revision.createdAt)}</span>
                            </span>
                          </summary>
                          <div className="mt-2 border-t border-line/60 pt-2">
                            {(() => {
                              const basis = viewer.anchorVersions.find((version) => version.reportVersionId === revision.anchorReportVersionId);
                              return (
                                <div className="flex flex-wrap items-center gap-2 text-[9.5px] text-ink-dim" title={revision.anchorReportVersionId}>
                                  <span className="mono">
                                    {basis
                                      ? `Decision basis v${basis.version} · ${basis.verdict ?? "No verdict"}${basis.score != null ? ` · ${basis.score}` : ""} · captured ${readableDate(basis.createdAt)}`
                                      : `Anchor ${shortId(revision.anchorReportVersionId)}`}
                                  </span>
                                  {basis && (
                                    <a
                                      href={`?version=${encodeURIComponent(basis.reportVersionId)}`}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="rounded border border-line-2 px-1.5 py-1 text-signal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                                    >
                                      Review exact evidence ↗
                                    </a>
                                  )}
                                </div>
                              );
                            })()}
                            <div className="mt-1 text-[9.5px] text-ink-dim">
                              Assignee {revision.assigneeDisplayName
                                ?? (revision.assigneeUserId
                                  ? viewer.assignees.find((assignee) => assignee.userId === revision.assigneeUserId)?.displayName ?? "Former analyst"
                                  : "Unassigned")}
                              {revision.dueAt ? ` · due ${dateInputValue(revision.dueAt)}` : ""}
                            </div>
                            <BriefReadout content={revision.content} />
                          </div>
                        </details>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="mt-4 border-t border-line/70 pt-3 text-[11.5px] text-ink-dim">No saved revisions yet. The first save creates revision 1.</p>
                )}
                {viewer.hasOlderRevisions && (
                  <button
                    type="button"
                    disabled={historyLoading !== null}
                    onClick={() => void loadOlderRevisions()}
                    className="mt-3 min-h-8 rounded-lg border border-line-2 px-3 py-1.5 text-[11px] text-ink-dim transition hover:border-signal hover:text-signal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal disabled:opacity-60"
                  >
                    {historyLoading === "revisions" ? "Loading older revisions…" : "Load older immutable revisions"}
                  </button>
                )}
              </section>
            </div>
          )}
        </div>

        {!loading && viewer && draft && (
          <footer className="shrink-0 border-t border-line bg-panel/95 px-5 py-3 backdrop-blur">
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-0 flex-1 text-[10.5px] text-ink-dim">
                {busy
                  ? noteSaving ? "Appending note… navigation is protected" : "Saving revision… navigation is protected"
                  : editable
                    ? hasUnsavedWork ? "Unsaved analyst work" : viewer.brief ? `Saved revision ${viewer.brief.revision}` : "No brief saved yet"
                  : viewer.case.status === "archived" ? "Archived case · read-only history" : "Read-only access"}
              </div>
              <button
                type="button"
                onClick={requestClose}
                disabled={busy}
                className="rounded-lg border border-line px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-line-2 hover:text-ink"
              >
                Close
              </button>
              {editable && (
                <button
                  type="button"
                  onClick={() => void runSave()}
                  disabled={busy || !briefDirty || conflictBrief !== undefined}
                  className="btn-primary px-4 py-1.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving revision…" : viewer.brief ? "Save new revision" : "Create case brief"}
                </button>
              )}
            </div>
          </footer>
        )}
      </div>
    </dialog>
  );
}
