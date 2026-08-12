import { useState } from "react";
import { CaretDown, ChatCircleText } from "@phosphor-icons/react";

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

// Ask-the-report is deliberately bound to an immutable report version. The
// API loads the organization-scoped frozen packet server-side; the browser
// sends no evidence claims that could be forged or confused with stored data.
export function AskReport({
  subject,
  reportVersionId,
}: AskReportProps) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [answerSources, setAnswerSources] = useState<string[]>([]);
  const [asked, setAsked] = useState("");
  const [loading, setLoading] = useState(false);
  const frozenReady = Boolean(reportVersionId);

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
          question,
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

  return (
    <div className="panel">
      <button type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChatCircleText aria-hidden="true" size={16} weight="duotone" className="text-signal-lift" />
        <span className="eyebrow">Ask about this report</span>
        <CaretDown aria-hidden="true" size={14} weight="bold" className={`ml-auto text-ink-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-line/60 p-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void ask(); }}
              disabled={!frozenReady}
              aria-label="Question about this report"
              placeholder={frozenReady ? "What supports this score?" : "Open or save a report first"}
              className="field min-w-0 flex-1 px-2.5 py-1.5 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-60"
            />
            <button type="button" onClick={() => void ask()} disabled={loading || !q.trim() || !frozenReady} className="btn-primary shrink-0 px-3 py-1.5 text-[12.5px] font-medium disabled:cursor-not-allowed disabled:opacity-60">{loading ? "Checking…" : "Ask"}</button>
          </div>
          {(loading || answer) && (
            <div className="mt-2.5" aria-live="polite">
              {asked && <p className="text-[11px] text-ink-faint">Q: {asked}</p>}
              {loading ? (
                <p className="mt-1 text-[12.5px] text-ink-faint">Checking the report…</p>
              ) : (
                <>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-dim">{answer}</p>
                  {answerSources.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-2" aria-label="Frozen report sources used in this answer">
                      {answerSources.map((url, index) => (
                        <li key={url}>
                          <a href={url} target="_blank" rel="noopener noreferrer" className="mono link-ext text-[11px]">
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
            <p className="mt-2 text-[11px] leading-snug text-ink-faint">
              {frozenReady
                ? "Answers use only the sources saved with this report. If the report does not know, ARGUS will say so."
                : "Save or open a report before asking a question."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
