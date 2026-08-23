import { useRef, useState } from "react";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CurrencyDollarIcon,
  FingerprintSimpleIcon,
  HandshakeIcon,
  MagnifyingGlassIcon,
  QuestionIcon,
  ShieldCheckIcon,
  TrendUpIcon,
  UsersThreeIcon,
  WaveformIcon,
} from "@phosphor-icons/react";
import { ArgusMark, HeroBackdrop } from "./ArgusMark";
import { PrivateToggle } from "./PrivateToggle";
import type { ResearchIntent } from "../lib/researchDirector";

const INVESTIGATION_OUTPUTS = [
  { icon: CheckCircleIcon, label: "Confirmed evidence", detail: "Facts we could confirm, with links to the sources." },
  { icon: ShieldCheckIcon, label: "Decision-changing risks", detail: "Risks, conflicts, and important facts we could not confirm." },
  { icon: QuestionIcon, label: "Open questions", detail: "The questions that matter most before you make a decision." },
] as const;

const INVESTIGATION_LENSES = [
  { icon: UsersThreeIcon, title: "Who is behind it", detail: "The people involved, their roles, and what they control." },
  { icon: CurrencyDollarIcon, title: "Where the money and control sit", detail: "Contract powers, large holders, liquidity, sanctions, and connected wallets." },
  { icon: QuestionIcon, title: "What remains unknown", detail: "Missing facts and the most important questions to answer next." },
] as const;

const INVESTIGATION_INTENTS: ReadonlyArray<{
  value: ResearchIntent;
  icon: typeof CurrencyDollarIcon;
  title: string;
  detail: string;
}> = [
  { value: "investment_due_diligence", icon: CurrencyDollarIcon, title: "Invest or allocate capital", detail: "Should I invest or allocate capital?" },
  { value: "alpha_discovery", icon: TrendUpIcon, title: "Find differentiated upside", detail: "Where might strong signals be overlooked?" },
  { value: "counterparty_risk", icon: HandshakeIcon, title: "Assess a counterparty", detail: "Is this counterparty safe to work with?" },
  { value: "identity_and_control", icon: FingerprintSimpleIcon, title: "Reveal identity and control", detail: "Who is behind it, and what do they control?" },
];

export function Landing({
  onAudit,
  onAbout,
}: {
  onAudit: (handle: string, priv?: boolean, intent?: ResearchIntent) => void | Promise<void>;
  onAbout: () => void;
}) {
  const [value, setValue] = useState("");
  const [priv, setPriv] = useState(false);
  const [intent, setIntent] = useState<ResearchIntent>("investment_due_diligence");
  const [launching, setLaunching] = useState(false);
  const launchingRef = useRef(false);

  const launchFreshAudit = async (subject: string) => {
    if (!subject || launchingRef.current) return;
    launchingRef.current = true;
    setLaunching(true);
    try {
      await onAudit(subject, priv, intent);
    } catch {
      // The app owns the explicit failure state; Home only releases its lock.
    } finally {
      launchingRef.current = false;
      setLaunching(false);
    }
  };

  return (
    <div className="landing-decision-page relative min-h-full overflow-hidden">
      <HeroBackdrop className="landing-decision-backdrop pointer-events-none absolute z-0" />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-5 py-10 sm:px-8 lg:px-12 lg:py-14 xl:px-16">
        <div className="landing-decision-grid">
          <section aria-labelledby="landing-title" className="rise-in min-w-0">
            <div className="eyebrow">Start a new investigation</div>
            <h1 id="landing-title" className="landing-decision-title display mt-4 text-ink">
              Start with the decision.<br />ARGUS builds the evidence.
            </h1>

            <p className="mt-5 max-w-2xl text-[15px] leading-relaxed text-ink-dim">
              Enter an X account, token address, contract, project, or website. ARGUS shows what looks
              credible, what looks risky, and what still needs checking.
            </p>

            <fieldset className="landing-intent-grid mt-9" aria-label="What are you trying to decide?">
              <legend className="sr-only">What are you trying to decide?</legend>
              {INVESTIGATION_INTENTS.map(({ value: option, icon: Icon, title, detail }) => {
                const selected = intent === option;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setIntent(option)}
                    className={`landing-intent-option ${selected ? "is-selected" : ""}`}
                  >
                    <span className="landing-intent-icon"><Icon size={24} weight={selected ? "bold" : "regular"} aria-hidden /></span>
                    <strong>{title}</strong>
                    <span>{detail}</span>
                  </button>
                );
              })}
            </fieldset>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void launchFreshAudit(value.trim());
              }}
              aria-busy={launching}
              className="mt-8 w-full"
            >
              <label htmlFor="investigation-subject" className="sr-only">Subject</label>
              <div className="landing-command-bar relative">
                <MagnifyingGlassIcon size={19} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input
                  id="investigation-subject"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder="@handle, contract, project, or website"
                  className="landing-command-input mono w-full py-3 pl-12 pr-4 text-[14px]"
                  aria-describedby="subject-help fresh-audit-note"
                  autoComplete="off"
                  autoCapitalize="none"
                  enterKeyHint="go"
                  spellCheck={false}
                  required
                />
                <span className="investigation-trace pointer-events-none absolute right-[205px] top-1/2 hidden -translate-y-1/2 items-center sm:flex" aria-hidden="true">
                  <WaveformIcon size={42} weight="thin" />
                </span>
                <button
                  type="submit"
                  disabled={launching || !value.trim()}
                  aria-describedby="fresh-audit-note"
                  className="btn-primary landing-command-submit flex items-center justify-center gap-2 text-[13.5px] font-medium disabled:cursor-wait"
                >
                  {launching ? "Starting…" : "Start investigation"}
                  <ArrowRightIcon size={16} weight="bold" aria-hidden />
                </button>
              </div>
              <p id="subject-help" className="sr-only">We’ll work out whether it is a person, token, website, or project.</p>

              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                <PrivateToggle on={priv} onToggle={setPriv} />
                <p className="text-[11px] leading-relaxed text-ink-faint">
                  ARGUS prioritizes specialists around your decision. Safety and identity gates are never waived.
                </p>
              </div>
            </form>

            <p id="fresh-audit-note" className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              A new scan checks current sources and may use paid data. Open a recent case to reuse saved results.
            </p>

          </section>

          <aside aria-labelledby="investigation-output-title" className="landing-method-rail rise-in">
            <div className="landing-method-eye"><ArgusMark size={150} live motion="focused" /></div>
            <div className="mt-8">
              <div id="investigation-output-title" className="eyebrow text-signal-lift">What the report resolves</div>
              <p className="mt-2 text-[13px] leading-relaxed text-ink-dim">
                A decision brief assembled from the file, not a list of disconnected checks.
              </p>
            </div>
            <div className="mt-5 divide-y divide-line/70 border-y border-line/70">
              {INVESTIGATION_OUTPUTS.map(({ icon: Icon, label, detail }) => (
                <div key={label} className="flex gap-3 py-5">
                  <Icon size={19} className="mt-0.5 shrink-0 text-signal-lift" aria-hidden />
                  <div>
                    <div className="text-[14px] font-medium text-ink">{label}</div>
                    <div className="mt-1 text-[12px] leading-relaxed text-ink-dim">{detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </div>

        <section aria-labelledby="investigation-lenses-title" className="mt-12 border-t border-line/70 pt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="eyebrow">How the report resolves the decision</div>
              <h2 id="investigation-lenses-title" className="display-sm mt-2 text-[21px] text-ink">One investigation. Three questions.</h2>
            </div>
            <button type="button" onClick={onAbout} className="btn-ghost flex min-h-9 items-center gap-1.5 text-[12.5px] text-signal-lift">
              See how ARGUS works <ArrowRightIcon size={14} aria-hidden />
            </button>
          </div>
          <div className="landing-lens-sequence mt-6 grid divide-y divide-line/70 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {INVESTIGATION_LENSES.map(({ icon: Icon, title, detail }, index) => (
              <div key={title} className="relative py-5 sm:px-8 sm:first:pl-0 sm:last:pr-0">
                <span className="landing-lens-number">{index + 1}</span>
                <Icon size={22} className="mt-4 text-ink-dim" aria-hidden />
                <h3 className="mt-3 text-[15px] font-medium text-ink">{title}</h3>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-dim">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="pt-10 text-[11px] text-ink-faint">Research only · not financial advice</div>
      </div>
    </div>
  );
}
