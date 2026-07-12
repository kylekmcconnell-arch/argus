import { useRef, useState } from "react";
import { HeroBackdrop } from "./ArgusMark";
import { ScoreTicker } from "./ScoreTicker";
import type { ReportKind } from "../lib/reports";
import { recentScored } from "../lib/recentScored";
import { PrivateToggle } from "./PrivateToggle";

// The front door: the investigation question in the display voice, one
// chat-style input, live samples. The old static announcement-bar copy lives
// here now ("paste an X handle or a token contract") where it belongs.
export function Landing({ onAudit, onAbout, onOpenRecent }: { onAudit: (handle: string, priv?: boolean) => void | Promise<void>; onAbout: () => void; onOpenRecent?: (ref: string, kind?: ReportKind) => void }) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);
  const hasScores = onOpenRecent && recentScored(1).length > 0;

  const launchFreshAudit = async (subject: string) => {
    if (!subject || launchingRef.current) return;
    launchingRef.current = true;
    setLaunching(true);
    try {
      await onAudit(subject, priv);
    } catch {
      // The app owns the explicit failure state; Home only releases its lock.
    } finally {
      // A successful launch normally unmounts Home. If navigation is declined
      // or the launch rejects before that happens, let the analyst retry.
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  return (
    <div className="relative flex min-h-full flex-col">
      <HeroBackdrop className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[440px] w-full opacity-50" />

      {onOpenRecent && <ScoreTicker onOpen={onOpenRecent} />}

      <div className={`relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 ${hasScores ? "pt-[7vh]" : "pt-[13vh]"}`}>
        <div className="eyebrow rise-in">Forensic due-diligence</div>
        <h1 className="display rise-in mt-3 text-center text-[44px] leading-[1.04] text-ink max-md:text-[32px]">
          Who is actually behind the&nbsp;handle?
        </h1>

        <p className="rise-in mt-4 max-w-lg text-center text-[13.5px] leading-relaxed text-ink-dim">
          Paste an X handle, a token contract, or a project website. ARGUS audits the people on their
          evidence and the tokens on-chain, then shows the assessment, supporting evidence, and unresolved gaps before capital is at risk.
        </p>

        {/* chat-style input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void launchFreshAudit(value.trim());
          }}
          aria-busy={launching}
          className="mt-7 w-full rounded-xl border border-line bg-panel p-2.5 soft-shadow transition focus-within:border-signal/60"
        >
          <div className="flex items-center gap-2">
            <span className="mono pl-2 text-[15px] text-ink-faint select-none">@</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/^@/, ""))}
              placeholder="@handle, a token contract, or a project site (e.g. neuro-mesh.io)"
              className="mono min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] text-ink placeholder:text-ink-faint focus:outline-none"
              autoFocus
            />
          </div>
          <div className="mt-2 flex items-center gap-2 px-1">
            <PrivateToggle on={priv} onToggle={setPriv} />
            <button
              type="submit"
              disabled={launching}
              aria-describedby="fresh-audit-note"
              className="btn-primary ml-auto flex items-center gap-1.5 px-3.5 py-1.5 text-[13.5px] font-medium disabled:cursor-wait disabled:opacity-70"
            >
              {launching ? "Starting fresh audit…" : "Run audit"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>
        <p id="fresh-audit-note" className="mt-2.5 text-center text-[11px] leading-relaxed text-ink-faint">
          Starts a fresh provider run and may use paid API quota. Open previous snapshots from Recent audits.
        </p>

        {/* live token samples */}
        <div className="mt-8 w-full">
          <div className="eyebrow mb-2.5 text-center">Or audit a token, live on-chain</div>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { sym: "$PEPE", addr: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
              { sym: "$SHIB", addr: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce" },
              { sym: "$UNI", addr: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" },
            ].map((t) => (
              <button
                key={t.sym}
                onClick={() => { void launchFreshAudit(t.addr); }}
                disabled={launching}
                className="mono rounded-full border border-line bg-panel px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-signal/50 hover:text-ink disabled:cursor-wait disabled:opacity-60"
              >
                {t.sym}
              </button>
            ))}
          </div>
        </div>

        <div className="py-10 text-center text-[11px] text-ink-faint">
          Hard caps over scores · pseudonymity is neutral · evidence-disciplined
          <button onClick={onAbout} className="ml-2 text-signal-dim underline-offset-2 hover:underline">How it works →</button>
        </div>
      </div>
    </div>
  );
}
