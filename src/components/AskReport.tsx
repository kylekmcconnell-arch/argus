import { useEffect, useRef, useState } from "react";
import { CaretDown, Terminal } from "@phosphor-icons/react";
import { CHALLENGE_EVENT, type ChallengeDetail } from "../lib/challenge";

export interface AskReportProps {
  subject: string;
  reportVersionId?: string;
  /** Legacy callers may still provide display context; it is never sent. */
  context?: string;
}

function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/* Quick openers for a challenge. "Attach a document" prefers the analyst
   add-info flow when it is on the page (evidence is verified before publish);
   the others seed the prompt. */
const CHALLENGE_CHIPS: { label: string; seed: string }[] = [
  { label: "Point at a source", seed: "Check this source: " },
  { label: "Dispute the score", seed: "I dispute this score because " },
  { label: "What am I missing?", seed: "What evidence would change this score?" },
];

// Ask-the-report is deliberately bound to an immutable report version. The
// API loads the organization-scoped frozen packet server-side; the browser
// sends no evidence claims that could be forged or confused with stored data.
// It is also the landing surface for "Challenge this": the CHALLENGE_EVENT
// opens the console with the disputed context attached to the next question.
export function AskReport({
  subject,
  reportVersionId,
}: AskReportProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [challengeCtx, setChallengeCtx] = useState<string | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<string[]>([]);
  const [asked, setAsked] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const frozenReady = Boolean(reportVersionId);

  useEffect(() => {
    const onChallenge = (event: Event) => {
      const detail = (event as CustomEvent<ChallengeDetail>).detail;
      if (!detail?.context) return;
      setOpen(true);
      setChallengeCtx(detail.context);
      // Focus after the expanded body has rendered (a timeout, not rAF —
      // rAF never fires while the tab is hidden).
      setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 0);
    };
    window.addEventListener(CHALLENGE_EVENT, onChallenge);
    return () => window.removeEventListener(CHALLENGE_EVENT, onChallenge);
  }, []);

  const ask = async () => {
    const question = q.trim();
    if (!question || loading || !reportVersionId) return;
    setLoading(true);
    setAnswer(null);
    setAnswerSources([]);
    setAsked(question);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          subject,
          question: challengeCtx ? `[Challenging: ${challengeCtx}] ${question}` : question,
          reportVersionId,
        }),
      });
      const body = await response.json().catch(() => ({})) as {
        answer?: unknown;
        note?: unknown;
        citations?: unknown;
      };
      setAnswer(
        typeof body.answer === "string" && body.answer.trim()
          ? body.answer
          : typeof body.note === "string" && body.note.trim()
            ? body.note
            : "No grounded answer returned.",
      );
      setAnswerSources(
        Array.isArray(body.citations)
          ? [...new Set(body.citations.map(safeSourceUrl).filter((url): url is string => Boolean(url)))].slice(0, 6)
          : [],
      );
    } catch {
      setAnswer("Network error. No report-grounded answer was produced.");
    } finally {
      setLoading(false);
    }
  };

  const attachChip = () => {
    const addInfo = document.getElementById("add-info");
    if (addInfo) {
      addInfo.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
    } else {
      setQ("I have a document that bears on this: ");
      inputRef.current?.focus();
    }
  };

  return (
    <div className="panel overflow-hidden">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <Terminal aria-hidden="true" size={16} weight="duotone" className="text-signal-lift" />
        <span className="eyebrow">Ask about this report{challengeCtx ? " · challenging" : ""}</span>
        <CaretDown aria-hidden="true" size={14} weight="bold" className={`ml-auto text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="console-sheet border-t border-console-line p-4">
          {challengeCtx && (
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="mono text-[11px] text-console-ink-dim">
                · challenging <span className="font-medium text-console-accent">{challengeCtx}</span>
              </span>
              <button
                type="button"
                onClick={() => setChallengeCtx(null)}
                aria-label="Clear challenge context"
                className="mono cursor-pointer text-[10px] uppercase tracking-wide text-console-ink-dim transition hover:text-console-ink"
              >
                clear ✕
              </button>
            </div>
          )}
          {challengeCtx && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              <button type="button" className="console-chip" onClick={attachChip}>Attach a document</button>
              {CHALLENGE_CHIPS.map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  className="console-chip"
                  onClick={() => { setQ(chip.seed); inputRef.current?.focus(); }}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <div className="console-input flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5">
              <span aria-hidden="true" className="mono text-[13px] text-console-accent">❯</span>
              <input
                ref={inputRef}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void ask(); }}
                disabled={!frozenReady}
                aria-label="Question about this report"
                placeholder={frozenReady
                  ? challengeCtx
                    ? "tell ARGUS where the file is wrong, or paste a link…"
                    : "What supports this score?"
                  : "Open or save a report first"}
                className="min-w-0 flex-1 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <button type="button" onClick={() => void ask()} disabled={loading || !q.trim() || !frozenReady} className="btn-primary shrink-0 px-3 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Checking…" : "Ask"}</button>
          </div>
          {(loading || answer) && (
            <div className="mt-3" aria-live="polite">
              {asked && (
                <p className="mono text-[12px] text-console-ink">
                  <span aria-hidden="true" className="text-console-accent">❯ </span>{asked}
                </p>
              )}
              {loading ? (
                <p className="mono mt-1.5 text-[12px] text-console-ink-dim">Checking the report…</p>
              ) : (
                <>
                  <p className="mt-1.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-console-ink">
                    <span aria-hidden="true" className="mono mr-2 text-[10px] font-medium uppercase tracking-wider text-console-accent">ARGUS</span>
                    {answer}
                  </p>
                  {answerSources.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Frozen report sources used in this answer">
                      {answerSources.map((url, index) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="mono text-[11px] text-console-accent underline-offset-2 hover:underline">
                            Source {index + 1}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}
          {!answer && !loading && (
            <p className="mt-2.5 text-[11px] leading-snug text-console-ink-dim">
              {frozenReady
                ? challengeCtx
                  ? "Answers come only from this report's saved sources. To change the score, add evidence: it is verified before it can move anything."
                  : "Answers use only the sources saved with this report. If the report does not know, ARGUS will say so."
                : "Save or open a report before asking a question."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
