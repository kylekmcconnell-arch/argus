import { useState, type FormEvent } from "react";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { ArgusMark, HeroBackdrop } from "./ArgusMark";

export function PublicAccessHome({
  onLogin,
  onCode,
}: {
  onLogin: () => void;
  onCode: (code: string) => void;
}) {
  const [code, setCode] = useState("");
  const normalizedCode = code.trim().toUpperCase();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (normalizedCode) onCode(normalizedCode);
  };

  return (
    <div className="public-access-home relative min-h-screen overflow-hidden bg-void text-ink">
      <HeroBackdrop className="public-access-backdrop pointer-events-none absolute z-0" />

      <header className="relative z-10 flex items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <a href="/" className="flex items-center gap-2.5" aria-label="ARGUS home">
          <ArgusMark size={30} tone="brand" />
          <span className="text-[18px] font-semibold tracking-tight">ARGUS</span>
        </a>
        <button type="button" onClick={onLogin} className="btn-ghost min-h-10 px-3 text-[13px] font-medium text-ink-dim hover:text-ink">
          Log in
        </button>
      </header>

      <main className="public-access-main relative z-10 mx-auto grid w-full max-w-[1440px] items-center px-5 pb-12 pt-10 sm:px-8 lg:px-12">
        <section aria-labelledby="public-access-title" className="rise-in max-w-[850px]">
          <div className="eyebrow text-signal-lift">Private early access</div>
          <h1 id="public-access-title" className="public-access-title display mt-4 text-ink">
            Start with the decision.<br />ARGUS builds the evidence.
          </h1>
          <p className="mt-6 max-w-[610px] text-[15px] leading-relaxed text-ink-dim">
            Forensic due diligence for people, projects, tokens, and websites, built into one clear report.
          </p>

          <form onSubmit={submit} className="mt-10 max-w-[600px]">
            <label htmlFor="early-access-code" className="mb-2 block text-[11px] font-medium uppercase tracking-[0.12em] text-ink-faint">
              Early access code
            </label>
            <div className="public-access-codebar">
              <input
                id="early-access-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="Enter your code"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="mono min-w-0 bg-transparent px-4 py-3.5 text-[14px] tracking-[0.06em] text-ink outline-none placeholder:tracking-normal placeholder:text-ink-faint"
              />
              <button
                type="submit"
                disabled={!normalizedCode}
                className="btn-primary flex min-h-[54px] items-center justify-center gap-2 rounded-none px-6 text-[13px] font-medium disabled:opacity-35"
              >
                Continue
                <ArrowRightIcon size={15} weight="bold" aria-hidden />
              </button>
            </div>
            <p className="mt-3 text-[11.5px] text-ink-faint">
              Need a code? <a href="/?view=join" className="text-ink-dim underline decoration-line-2 underline-offset-4 hover:text-ink">Request access</a>
            </p>
          </form>
        </section>

        <aside className="public-access-eye rise-in" aria-label="ARGUS intelligence">
          <ArgusMark size={210} live motion="focused" tone="brand" />
          <p className="mt-7 max-w-[250px] text-center text-[12px] leading-relaxed text-ink-faint">
            Evidence, risks, and unanswered questions, clearly separated.
          </p>
        </aside>
      </main>

      <footer className="relative z-10 mx-auto flex w-full max-w-[1440px] items-center justify-between gap-4 px-5 pb-6 text-[10px] uppercase tracking-[0.1em] text-ink-faint sm:px-8 lg:px-12">
        <span>Research intelligence</span>
        <span>Private beta</span>
      </footer>
    </div>
  );
}
