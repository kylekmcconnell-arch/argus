import { ArgusMark } from "./ArgusMark";

type Status = "live" | "partial" | "planned";
const PHASES: { n: number; title: string; steps: [string, Status][] }[] = [
  { n: 1, title: "Token and market data", steps: [
    ["Check price, market size, liquidity, trading history, and large holders", "live"],
    ["Compare the token with CoinGecko and major exchange listings", "live"],
    ["Check supply schedule and tokens with the same ticker", "partial"],
  ] },
  { n: 2, title: "Website and public claims", steps: [
    ["Read the project website and connect it to the right token", "partial"],
    ["Check claims against archived pages, public profiles, and other sources", "partial"],
    ["Look for X account name changes and mentions of older names", "live"],
  ] },
  { n: 3, title: "Code, founders, and funding", steps: [
    ["Find the correct GitHub accounts and review their history", "partial"],
    ["Check founder backgrounds, public affiliations, and notable followers", "live"],
    ["Trace where the contract deployer's funds came from", "live"],
    ["Look for important connections to known people, wallets, and projects", "live"],
  ] },
  { n: 4, title: "Conflicting claims", steps: [
    ["Compare claims across every source and flag disagreements", "live"],
  ] },
  { n: 5, title: "Special checks", steps: [
    ["Check the token contract for common scam risks", "live"],
    ["Check competition, legal risk, hiring, and signs of real users", "planned"],
    ["Check source quality, app security, and AI-related risks", "planned"],
  ] },
  { n: 6, title: "Result and follow-up", steps: [
    ["Calculate the score and apply safety limits", "live"],
    ["Show a pass, caution, or fail result", "live"],
    ["Let the subject respond", "planned"],
    ["Export a formatted report", "planned"],
  ] },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[13.5px] font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{children}</div>
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-4">
      <div className="text-[13.5px] font-medium text-ink">{title}</div>
      <div className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{body}</div>
    </div>
  );
}

export function AboutPage({ onStart }: { onStart: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-5">
        <ArgusMark size={36} />
      </div>
      <h1 className="display-sm text-[24px] text-ink">How ARGUS works</h1>
      <p className="mt-1.5 max-w-2xl text-[13.5px] leading-relaxed text-ink-dim">
        ARGUS checks the <span className="text-ink">people</span> behind a project and the
        <span className="text-ink"> token</span> itself. It shows what looks credible, what looks risky,
        and what still needs checking.
      </p>

      <Section title="A serious risk can limit the score">
        A strong score elsewhere cannot hide a major problem. A confirmed scam, a fake endorsement,
        a token that cannot be sold, or an owner who can create unlimited new tokens can lower the final result.
      </Section>

      <Section title="Auditing people">
        ARGUS checks each role a person holds, such as founder, investor, advisor, or promoter. The final result
        reflects the riskiest role instead of averaging serious problems away.
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Card title="Endorsements" body="An endorsement only counts when the named person actually confirms it. A denial is a serious warning." />
          <Card title="Repeat investors" body="It is a strong sign when an investor from a founder's earlier success backs the new project too." />
          <Card title="Aliases are not automatically risky" body="Using an alias is not a problem by itself. Pretending to be someone else is." />
          <Card title="Sources" body="Important claims include a source and date. Strong claims should be confirmed by more than one independent source." />
        </div>
      </Section>

      <Section title="Auditing tokens">
        Token checks use live market and contract data to test trading, liquidity, large holders, and owner controls.
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Card title="Contract controls" body="ARGUS checks whether the owner can create more tokens, stop transfers, change key settings, or prevent selling." />
          <Card title="Trading funds" body="ARGUS checks how much money supports trading and whether that money can be removed." />
          <Card title="Large holders" body="ARGUS looks for a small group of new or connected wallets controlling too much of the supply." />
          <Card title="People behind the token" body="ARGUS connects the token to its team, the wallet that created it, and its largest holders." />
        </div>
      </Section>

      <Section title="Saved facts, consistent results">
        The same saved facts produce the same result. When the scoring rules change, ARGUS tests them against known
        examples. Radar checks popular tokens, and Watchlist can flag changes such as trading funds being removed.
      </Section>

      <Section title="Every check ARGUS can run">
        The list below shows what works today, what works in part, and what is planned.
        <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-faint">
          {([["live", "bg-pass"], ["partial", "bg-caution"], ["planned", "bg-line-2"]] as const).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${c}`} />{l}</span>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {PHASES.map((p) => (
            <div key={p.n} className="panel p-3.5">
              <div className="mb-2 text-[12.5px] font-semibold text-ink">Phase {p.n} · {p.title}</div>
              <div className="space-y-1">
                {p.steps.map(([label, status], i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px] text-ink-dim">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "live" ? "bg-pass" : status === "partial" ? "bg-caution" : "bg-line-2"}`} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-8 flex items-center gap-3">
        <button onClick={onStart} className="btn-primary px-5 py-2.5 text-[13.5px] font-medium">Start an audit</button>
        <span className="text-[12.5px] text-ink-faint">Current sources · saved reports · repeatable scoring</span>
      </div>
    </div>
  );
}
