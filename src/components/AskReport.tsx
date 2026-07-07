import { useState } from "react";

// Ask-the-report: a scoped chat over a finished report. The analyst types a
// question ("why didn't you connect this to @foo?", "what's the biggest red flag?")
// and ARGUS answers from the report's own evidence via /api/ask. The report passes
// a compact context string so the answer is grounded, not invented.
export function AskReport({ subject, context }: { subject: string; context?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asked, setAsked] = useState("");
  const [loading, setLoading] = useState(false);

  const ask = async () => {
    const question = q.trim();
    if (!question || loading) return;
    setLoading(true); setAnswer(null); setAsked(question);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subject, question, context }) });
      const d = await r.json();
      setAnswer(d?.answer || d?.note || "No answer returned.");
    } catch { setAnswer("Network error."); }
    setLoading(false);
  };

  return (
    <div className="rounded-xl border border-line bg-panel">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-signal)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
        <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">Ask this report</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-ink-faint)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ml-auto transition-transform" style={{ transform: open ? "rotate(180deg)" : "none" }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="border-t border-line/60 p-4">
          <div className="flex gap-2">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
              placeholder="why didn't you connect this to @foo?"
              className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2/40 px-2.5 py-1.5 text-[12.5px] text-ink outline-none placeholder:text-ink-faint focus:border-line-2"
            />
            <button onClick={ask} disabled={loading || !q.trim()} className="btn-primary shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium disabled:opacity-40">{loading ? "thinking…" : "Ask"}</button>
          </div>
          {(loading || answer) && (
            <div className="mt-2.5">
              {asked && <p className="text-[11px] text-ink-faint">Q: {asked}</p>}
              {loading ? (
                <p className="mt-1 text-[12px] text-ink-faint">reading the report…</p>
              ) : (
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-dim">{answer}</p>
              )}
            </div>
          )}
          {!answer && !loading && (
            <p className="mt-2 text-[10.5px] leading-snug text-ink-faint">Ask why something wasn't found or connected. ARGUS answers from this report's evidence; if two things should be linked, it'll tell you to add a hard link above.</p>
          )}
        </div>
      )}
    </div>
  );
}
