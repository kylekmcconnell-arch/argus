import { useRef, useState } from "react";
import { ChatCenteredTextIcon, XIcon } from "@phosphor-icons/react";

export function FeedbackButton() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState("normal");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const close = () => {
    dialogRef.current?.close();
    if (state === "sent") {
      setBody("");
      setPriority("normal");
      setState("idle");
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (body.trim().length < 8 || state === "sending") return;
    setState("sending");
    try {
      const params = new URLSearchParams(window.location.search);
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          priority,
          route: `${window.location.pathname}${window.location.search}`,
          reportVersionId: params.get("version") || undefined,
          context: {
            title: document.title,
            viewport: { width: window.innerWidth, height: window.innerHeight },
          },
        }),
      });
      if (!response.ok) throw new Error("Feedback could not be saved.");
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="feedback-launcher floating-brand-launcher group fixed z-50 flex h-11 w-11 items-center justify-center rounded-full border transition hover:w-[124px] hover:justify-start hover:gap-2 hover:px-3 focus-visible:w-[124px] focus-visible:justify-start focus-visible:gap-2 focus-visible:px-3"
        data-testid="feedback-launcher"
        aria-label="Give feedback to the ARGUS team"
      >
        <ChatCenteredTextIcon size={19} aria-hidden />
        <span className="hidden whitespace-nowrap text-[12px] font-medium group-hover:inline group-focus-visible:inline">Give feedback</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="feedback-title"
        className="m-auto w-[min(520px,calc(100%-2rem))] rounded-xl border border-line bg-void p-0 text-ink shadow-2xl backdrop:bg-black/70"
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between border-b border-line px-5 py-4">
            <div>
              <div className="eyebrow">Claude queue</div>
              <h2 id="feedback-title" className="display-sm mt-1 text-[21px] text-ink">What should we improve?</h2>
            </div>
            <button type="button" onClick={close} aria-label="Close feedback" className="rounded-md p-2 text-ink-dim hover:bg-panel hover:text-ink">
              <XIcon size={18} aria-hidden />
            </button>
          </div>
          <div className="p-5">
            {state === "sent" ? (
              <div role="status" className="rounded-lg border border-signal/30 bg-signal/5 px-4 py-5 text-[13px] leading-relaxed text-signal-lift">
                Saved to Claude’s to-do queue. An owner can prioritize it, move it into progress, and check it off.
              </div>
            ) : (
              <>
                <label htmlFor="feedback-body" className="block text-[12px] font-medium text-ink-dim">Feedback</label>
                <textarea
                  id="feedback-body"
                  autoFocus
                  required
                  minLength={8}
                  maxLength={4000}
                  rows={6}
                  value={body}
                  onChange={(event) => { setBody(event.target.value); setState("idle"); }}
                  placeholder="Tell us what happened, what you expected, and which report or screen you were using."
                  className="field mt-1.5 w-full resize-y px-3 py-2.5 text-[13px] leading-relaxed"
                />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <label className="text-[12px] text-ink-dim">
                    Priority
                    <select value={priority} onChange={(event) => setPriority(event.target.value)} className="field mono ml-2 px-2 py-1.5 text-[11.5px]">
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <span className="mono text-[10.5px] text-ink-faint">{body.length}/4000</span>
                </div>
                {state === "error" && <div role="alert" className="mt-3 text-[12px] text-avoid">Feedback could not be saved. Please try again.</div>}
              </>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
            <button type="button" onClick={close} className="btn-chip">Close</button>
            {state !== "sent" && (
              <button type="submit" disabled={state === "sending" || body.trim().length < 8} className="btn-primary px-4 py-2 text-[12px] disabled:opacity-40">
                {state === "sending" ? "Saving…" : "Send to Claude"}
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
