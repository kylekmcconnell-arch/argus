import { useState } from "react";
import { ArgusMark, HeroBackdrop } from "./ArgusMark";
import { SUBJECTS } from "../data/subjects";
import { ROLE_META } from "../lib/verdict";

// Origami-style hero: centered heading + chat-style input + quick-start dossiers,
// over a faint line-art backdrop. Calm and static, matching origami.chat.
export function Landing({ onAudit }: { onAudit: (handle: string) => void }) {
  const [value, setValue] = useState("");

  return (
    <div className="relative flex min-h-full flex-col">
      <HeroBackdrop className="pointer-events-none absolute inset-x-0 bottom-0 z-0 h-[440px] w-full opacity-50" />

      <div className="relative z-10 mx-auto flex w-full max-w-2xl flex-1 flex-col items-center px-6 pt-[11vh]">
        <div className="mb-5">
          <ArgusMark size={40} />
        </div>

        <h1 className="text-center text-[34px] font-medium leading-[1.1] tracking-[-0.02em] text-ink">
          Who is actually behind the handle?
        </h1>

        <p className="mt-3 max-w-lg text-center text-[14px] leading-relaxed text-ink-dim">
          Paste an X handle or a token contract. ARGUS audits the people on their evidence and the
          tokens on-chain, and returns a verdict you can stake money on.
        </p>

        {/* chat-style input */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (value.trim()) onAudit(value.trim());
          }}
          className="mt-7 w-full rounded-xl border border-line bg-white p-2.5 soft-shadow transition focus-within:border-line-2"
        >
          <div className="flex items-center gap-2">
            <span className="mono pl-2 text-[15px] text-ink-faint select-none">@</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value.replace(/^@/, ""))}
              placeholder="@handle, x.com/ url, or a token contract address"
              className="mono min-w-0 flex-1 bg-transparent py-1.5 text-[14px] text-ink placeholder:text-ink-faint focus:outline-none"
              autoFocus
            />
          </div>
          <div className="mt-2 flex items-center gap-2 px-1">
            <span className="rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-dim">Multi-class</span>
            <span className="rounded-md border border-line px-2 py-1 text-[11.5px] text-ink-dim">API-only</span>
            <button type="submit" className="btn-primary ml-auto flex items-center gap-1.5 px-3.5 py-1.5 text-[13px] font-medium">
              Run audit
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </form>

        {/* quick start */}
        <div className="mt-8 w-full">
          <div className="mb-2.5 text-center text-[11px] uppercase tracking-[0.18em] text-ink-faint">Or try a live dossier</div>
          <div className="grid grid-cols-2 gap-2.5">
            {SUBJECTS.map((s) => (
              <button
                key={s.handle}
                onClick={() => onAudit(s.handle)}
                className="group flex items-center gap-3 rounded-lg border border-line bg-white px-3 py-2.5 text-left transition hover:border-line-2 hover:shadow-sm"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel-2 text-[14px] text-signal">
                  {s.avatar}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="mono block truncate text-[13px] text-ink">{s.handle}</span>
                  <span className="block truncate text-[11px] text-ink-faint">
                    {s.roles.map((r) => ROLE_META[r].label).join(" · ")}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* live token samples */}
        <div className="mt-5 w-full">
          <div className="mb-2.5 text-center text-[11px] uppercase tracking-[0.18em] text-ink-faint">Or audit a token, live on-chain</div>
          <div className="flex flex-wrap justify-center gap-2">
            {[
              { sym: "$PEPE", addr: "0x6982508145454ce325ddbe47a25d4ec3d2311933" },
              { sym: "$SHIB", addr: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce" },
              { sym: "$UNI", addr: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984" },
            ].map((t) => (
              <button
                key={t.sym}
                onClick={() => onAudit(t.addr)}
                className="mono rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] text-ink-dim transition hover:border-line-2 hover:text-ink"
              >
                {t.sym}
              </button>
            ))}
          </div>
        </div>

        <div className="py-10 text-center text-[11px] text-ink-faint">
          Hard caps over scores · pseudonymity is neutral · evidence-disciplined
        </div>
      </div>
    </div>
  );
}
