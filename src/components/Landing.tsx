import { useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  CurrencyEthIcon,
  DatabaseIcon,
  FingerprintSimpleIcon,
  MagnifyingGlassIcon,
  QuestionIcon,
  ShieldCheckIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { HeroBackdrop } from "./ArgusMark";
import { PrivateToggle } from "./PrivateToggle";

const INVESTIGATION_OUTPUTS = [
  { icon: CheckCircleIcon, label: "Verified facts", detail: "Claims tied directly to supporting sources." },
  { icon: QuestionIcon, label: "Open questions", detail: "Unknowns ranked by their impact on the decision." },
  { icon: DatabaseIcon, label: "Source quality", detail: "Coverage, provenance, and contradictions made visible." },
  { icon: ClockCounterClockwiseIcon, label: "Decision freshness", detail: "A frozen case you can rescan and compare over time." },
] as const;

const INVESTIGATION_LENSES = [
  { icon: FingerprintSimpleIcon, title: "Identity & authority", detail: "Who is involved, what they control, and what can actually be corroborated." },
  { icon: CurrencyEthIcon, title: "Capital & contract risk", detail: "Wallet exposure, token powers, concentration, sanctions, and linked entities." },
  { icon: ShieldCheckIcon, title: "Decision gaps", detail: "What keeps confidence below exceptional and what you should verify next." },
] as const;

// The front door is a decision-oriented investigation canvas. Previous cases
// remain in the persistent rail instead of competing with the primary task.
export function Landing({ onAudit, onAbout }: { onAudit: (handle: string, priv?: boolean) => void | Promise<void>; onAbout: () => void }) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);

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
    <div className="relative min-h-full overflow-hidden">
      <HeroBackdrop className="pointer-events-none absolute bottom-[-70px] left-[24%] z-0 h-[310px] w-[86%] opacity-55 max-md:bottom-[-15px] max-md:left-[5%] max-md:h-[260px] max-md:w-[120%] max-md:opacity-30" />

      <div className="relative z-10 mx-auto w-full max-w-5xl px-5 py-10 sm:px-7 lg:py-16">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
          <section aria-labelledby="landing-title" className="rise-in">
            <div className="eyebrow">Start a new investigation</div>
            <h1 id="landing-title" className="display mt-3 max-w-3xl text-[44px] leading-[1.04] text-ink max-md:text-[32px]">
              Know what you’re backing before capital moves.
            </h1>

            <p className="mt-4 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
              Enter an X handle, token contract, or project website. ARGUS resolves identity and control,
              tests the on-chain story, and separates verified facts from the gaps you still need to close.
            </p>

            {/* primary investigation input */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void launchFreshAudit(value.trim());
              }}
              aria-busy={launching}
              className="panel soft-shadow mt-8 w-full p-4 sm:p-5"
            >
              <label htmlFor="investigation-subject" className="eyebrow">Subject</label>
              <div className="investigation-control relative mt-2.5">
                <MagnifyingGlassIcon size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  id="investigation-subject"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="@handle, contract, or project"
                  className="field mono min-h-12 w-full py-3 pl-10 pr-4 text-[13.5px] sm:pr-20"
                  aria-describedby="subject-help fresh-audit-note"
                  autoComplete="off"
                  autoCapitalize="none"
                  enterKeyHint="go"
                  spellCheck={false}
                  required
                  autoFocus
                />
                <span className="investigation-trace pointer-events-none absolute right-3 top-1/2 hidden items-center sm:flex" aria-hidden="true">
                  <WaveformIcon size={42} weight="thin" />
                </span>
              </div>
              <p id="subject-help" className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                ARGUS detects the subject type and builds the appropriate person, token, site, or combined project case.
              </p>

              <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line/70 pt-4">
                <PrivateToggle on={priv} onToggle={setPriv} />
                <button
                  type="submit"
                  disabled={launching || !value.trim()}
                  aria-describedby="fresh-audit-note"
                  className="btn-primary landing-cta-signal ml-auto flex min-h-10 items-center gap-2 px-4 py-2 text-[13.5px] font-medium disabled:cursor-wait"
                >
                  {launching ? "Starting fresh audit…" : "Start investigation"}
                  <ArrowRightIcon size={16} weight="bold" aria-hidden />
                </button>
              </div>
            </form>
            <p id="fresh-audit-note" className="mt-2.5 text-[11px] leading-relaxed text-ink-faint">
              Starts a fresh provider run and may use paid API quota. Open previous snapshots from Recent cases.
            </p>

          </section>

          <aside aria-labelledby="investigation-output-title" className="panel rise-in overflow-hidden">
            <div className="border-b border-line px-4 py-3.5">
              <div id="investigation-output-title" className="eyebrow">Every investigation returns</div>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">A decision canvas, not just a score.</p>
            </div>
            <div className="divide-y divide-line/70">
              {INVESTIGATION_OUTPUTS.map(({ icon: Icon, label, detail }) => (
                <div key={label} className="flex gap-3 px-4 py-3.5">
                  <Icon size={18} className="mt-0.5 shrink-0 text-ink-faint" aria-hidden />
                  <div>
                    <div className="text-[13.5px] font-medium text-ink">{label}</div>
                    <div className="mt-1 text-[11px] leading-relaxed text-ink-faint">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="panel-inset mx-4 mb-4 px-3 py-2.5 text-[11px] leading-relaxed text-ink-dim">
              Verified, inferred, and unresolved evidence stays visibly distinct.
            </div>
          </aside>
        </div>

        <section aria-labelledby="investigation-lenses-title" className="mt-12 border-t border-line/70 pt-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">Decision coverage</div>
              <h2 id="investigation-lenses-title" className="display-sm mt-2 text-[18px] text-ink">One subject. Three diligence lenses.</h2>
            </div>
            <button type="button" onClick={onAbout} className="btn-ghost flex min-h-9 items-center gap-1.5 text-[12.5px] text-signal-lift">
              See how ARGUS works <ArrowRightIcon size={14} aria-hidden />
            </button>
          </div>
          <div className="mt-5 grid divide-y divide-line/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {INVESTIGATION_LENSES.map(({ icon: Icon, title, detail }) => (
              <div key={title} className="py-4 sm:px-5 sm:first:pl-0 sm:last:pr-0">
                <Icon size={20} className="text-ink-faint" aria-hidden />
                <h3 className="mt-3 text-[15px] font-medium text-ink">{title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="pt-10 text-[11px] text-ink-faint">
          Hard caps over scores · pseudonymity is neutral · evidence-disciplined
        </div>
      </div>
    </div>
  );
}
