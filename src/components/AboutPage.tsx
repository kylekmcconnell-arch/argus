import { ArgusMark } from "./ArgusMark";

type Status = "live" | "partial" | "planned";
const PHASES: { n: number; title: string; steps: [string, Status][] }[] = [
  { n: 1, title: "Token data", steps: [
    ["DexScreener: liquidity, MC vs FDV, pair age, holders", "live"],
    ["Corroborate: CoinGecko cross-check, CEX markets", "live"],
    ["CoinMarketCap, emission schedule, ticker collision", "partial"],
  ] },
  { n: 2, title: "Surface intelligence", steps: [
    ["Full website crawl, every page and link", "planned"],
    ["Verify claims and partnerships independently", "planned"],
  ] },
  { n: 3, title: "Code and founder forensics", steps: [
    ["GitHub repo audit, code-quality / LLM-gen detection", "planned"],
    ["Founder background and cofounder-network risk", "partial"],
    ["Funding archaeology", "planned"],
    ["Panoptes trust graph", "live"],
  ] },
  { n: 4, title: "Contradiction detection", steps: [
    ["Internal contradiction scan across materials", "planned"],
  ] },
  { n: 5, title: "Specialist analysis modules", steps: [
    ["Smart-contract scan / rug-pull vectors", "live"],
    ["Moat, legal & IP, job-posting intel, user validation", "planned"],
    ["Data provenance, app security, AI attack vectors", "planned"],
  ] },
  { n: 6, title: "Scoring, right-of-reply, verdict", steps: [
    ["Scoring engine + hard caps", "live"],
    ["PASS / CAUTION / FAIL verdict", "live"],
    ["Right-of-reply channel", "planned"],
    ["Formatted report export", "planned"],
  ] },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
      <div className="mt-2 text-[13.5px] leading-relaxed text-ink-dim">{children}</div>
    </section>
  );
}

function Card({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-line bg-panel p-4">
      <div className="text-[13px] font-medium text-ink">{title}</div>
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
      <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">How ARGUS works</h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
        ARGUS is the hundred-eyed giant of crypto due-diligence. It audits two things forensically: the
        <span className="text-ink"> people</span> in a deal and the <span className="text-ink">tokens</span> on-chain.
        A strong story never papers over a disqualifying fact.
      </p>

      <Section title="The core rule: hard caps over scores">
        Every subject is scored to 100 on its own axes, but disqualifying findings act as <span className="text-ink">hard caps</span> that
        override the weighted total rather than averaging into it. A single confirmed rug, a contradicted
        endorsement, a honeypot, or a live mint authority cannot be diluted by strong scores elsewhere.
      </Section>

      <Section title="Auditing people">
        A subject is routed into every role they hold (founder, fund, KOL, advisor, agency, member) and each role
        is scored on its own evidence. The composite verdict is governed by the most severe role, never averaged.
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Card title="Testimonial corroboration" body="Endorsements only count if the named person actually acknowledges the subject. A wall of marquee names nobody confirms scores near zero; a denial caps the score." />
          <Card title="Repeat-backing signal" body="The strongest positive in venture: a backer from a prior successful exit returning for the new one. Its absence after a claimed exit is a quiet negative." />
          <Card title="Pseudonymity is neutral" body="Risk lives in behaviour, not identity. Disclosure earns a bonus; only impersonation blocks a verdict." />
          <Card title="Evidence discipline" body="Every published claim carries a source, a date, and an independent-source count. Only corroborated material is publishable." />
        </div>
      </Section>

      <Section title="Auditing tokens">
        Token audits run live in your browser with no keys, from DexScreener (market, liquidity, trading),
        GoPlus (contract safety, holders, EVM and Solana), and a honeypot.is buy/sell simulation.
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          <Card title="Contract safety" body="Honeypot (simulated), mintable supply, ownership renounced / reclaimable, hidden owner, freeze authority (Solana), taxes. Any of these can hard-cap the verdict to AVOID." />
          <Card title="Liquidity & lock" body="Pool depth and whether liquidity is locked or burned. Thin or unlocked liquidity is exit risk." />
          <Card title="Bundle / snipe detection" body="Flags concentrated supply held by fresh non-contract wallets, the signature of a bundled launch or coordinated snipe." />
          <Card title="Token to people" body="One click from a token to audit the team's X account, the deployer, and top holders, unified in the Panoptes graph." />
        </div>
      </Section>

      <Section title="Reproducible by design">
        The scoring model lives in two declarative files and is pinned by a golden-set calibration suite, so the same
        evidence always yields the same verdict, and tuning the model surfaces exactly which verdicts move. Radar
        scans trending tokens live; Watchlist re-checks saved audits and flags drift like liquidity pulls.
      </Section>

      <Section title="The full investigation protocol">
        ARGUS implements a six-phase, twenty-step forensic protocol. Status reflects what runs today,
        live and keyless, versus what is on the roadmap (web crawl, code forensics, and agent steps
        unlock with provider keys).
        <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-faint">
          {([["live", "var(--color-pass)"], ["partial", "var(--color-caution)"], ["planned", "var(--color-line-2)"]] as const).map(([l, c]) => (
            <span key={l} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{l}</span>
          ))}
        </div>
        <div className="mt-3 space-y-2">
          {PHASES.map((p) => (
            <div key={p.n} className="rounded-xl border border-line bg-panel p-3.5">
              <div className="mb-2 text-[12px] font-semibold text-ink">Phase {p.n} · {p.title}</div>
              <div className="space-y-1">
                {p.steps.map(([label, status], i) => (
                  <div key={i} className="flex items-center gap-2 text-[12.5px] text-ink-dim">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: status === "live" ? "var(--color-pass)" : status === "partial" ? "var(--color-caution)" : "var(--color-line-2)" }} />
                    {label}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <div className="mt-8 flex items-center gap-3">
        <button onClick={onStart} className="btn-primary px-5 py-2.5 text-[13px] font-medium">Start an audit</button>
        <span className="text-[12.5px] text-ink-faint">API-only acquisition · evidence-disciplined · reproducible</span>
      </div>
    </div>
  );
}
