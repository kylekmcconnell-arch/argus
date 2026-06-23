import { useState } from "react";
import { verdictMeta } from "../lib/verdict";
import type { Investigation } from "../lib/investigation";

const MAX_FOUNDER_AUDITS = 5;

function money(n?: number): string {
  if (n == null) return "—";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + Math.round(n);
}
const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 5)}…${a.slice(-4)}` : a);

function VerdictPill({ verdict, score }: { verdict: string; score: number | null }) {
  const m = verdictMeta(verdict);
  return (
    <span className="mono rounded-full px-2 py-0.5 text-[11px] font-semibold tracking-wider" style={{ color: m.color, background: m.glow, border: `1px solid ${m.color}55` }}>
      {m.label}{typeof score === "number" ? ` ${score}` : ""}
    </span>
  );
}

function Card({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) {
  return (
    <div className="rounded-xl border bg-white p-4" style={{ borderColor: accent ? accent + "55" : "var(--color-line)" }}>
      <div className="mb-2 text-[11px] uppercase tracking-wider text-ink-faint">{title}</div>
      {children}
    </div>
  );
}

export function InvestigationReport({
  inv,
  onAudit,
  onReset,
  onOpenToken,
}: {
  inv: Investigation;
  onAudit: (q: string) => void;
  onReset: () => void;
  onOpenToken: () => void;
}) {
  const [spent, setSpent] = useState(0);
  const { token, projectX, recon, projectAccount, founders } = inv;
  const tm = verdictMeta(token.verdict);
  const auditFounder = (handle: string) => { if (spent < MAX_FOUNDER_AUDITS) { setSpent((n) => n + 1); onAudit(handle); } };

  return (
    <div className="relative min-h-full pb-24">
      <div className="grid-bg absolute inset-0 top-0 -z-10 h-60" />
      <header className="sticky top-0 z-20 border-b border-line bg-void/85 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-5 py-3">
          <button onClick={onReset} className="flex items-center gap-1.5 text-[13px] text-ink-dim transition hover:text-ink">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Home
          </button>
          <span className="mono text-[11px] text-ink-faint">/ investigation</span>
          <span className="mono ml-auto rounded border px-1.5 py-0.5 text-[10px] tracking-wider" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>● LIVE</span>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-5">
        {/* headline */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[24px] font-medium tracking-[-0.02em] text-ink">{`Investigation · $${token.symbol}`}</h1>
            <VerdictPill verdict={token.verdict} score={token.score} />
            {projectAccount && <span className="mono text-[12px] text-ink-faint">project account <VerdictPill verdict={projectAccount.report.composite_verdict} score={projectAccount.report.governing_score} /></span>}
          </div>
          <p className="mt-2 max-w-3xl text-[14px] font-medium leading-relaxed text-ink">{inv.founderNote}</p>
          <p className="mono mt-1 break-all text-[11px] text-ink-faint">{inv.rootRef}</p>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {/* on-chain */}
          <Card title="On-chain" accent={tm.color}>
            <div className="flex items-center justify-between">
              <span className="mono text-[14px] text-ink">{`$${token.symbol}`}</span>
              <VerdictPill verdict={token.verdict} score={token.score} />
            </div>
            <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{token.headline}</p>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11.5px] text-ink-faint">
              <span>liq <span className="mono text-ink-dim">{money(token.liquidityUsd)}</span></span>
              <span>mc <span className="mono text-ink-dim">{money(token.mcap)}</span></span>
              <span>chain <span className="mono text-ink-dim capitalize">{token.chain}</span></span>
            </div>
            <button onClick={onOpenToken} className="mono mt-3 rounded-lg border border-line px-2.5 py-1 text-[12px] text-ink-dim transition hover:border-line-2 hover:text-ink">full on-chain report →</button>
          </Card>

          {/* the people behind it */}
          <Card title="The people behind it">
            <p className="text-[12.5px] leading-relaxed text-ink-dim">{recon ? recon.identityLine : inv.founderNote}</p>

            {founders.length > 0 && (
              <div className="mt-2.5 space-y-1.5 border-t border-line/60 pt-2.5">
                {founders.map((f) => (
                  <div key={f.name} className="flex items-center justify-between gap-2">
                    <span className="mono text-[12.5px] text-ink">{f.name}</span>
                    {f.handle ? (
                      <button
                        onClick={() => auditFounder(f.handle!)}
                        disabled={spent >= MAX_FOUNDER_AUDITS}
                        className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40"
                        style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
                      >
                        {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "background →"}
                      </button>
                    ) : (
                      <span className="mono shrink-0 text-[10.5px] text-ink-faint">named on site · no verified handle</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* project account — explicitly NOT a founder */}
            <div className="mt-2.5 border-t border-line/60 pt-2.5">
              <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Project account (not a founder)</div>
              {projectX ? (
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="mono text-[12.5px] text-ink">{projectX}</span>
                  {projectAccount ? (
                    <VerdictPill verdict={projectAccount.report.composite_verdict} score={projectAccount.report.governing_score} />
                  ) : (
                    <button onClick={() => auditFounder(projectX)} disabled={spent >= MAX_FOUNDER_AUDITS} className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40" style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}>
                      {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "audit →"}
                    </button>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[12px] text-ink-faint">No X account linked to this token.</p>
              )}
            </div>

            {token.deployer && (
              <div className="mt-2.5 border-t border-line/60 pt-2.5 text-[11.5px] text-ink-faint">
                Deployed by <span className="mono text-ink-dim">{shortAddr(token.deployer)}</span> · deployer wallet, no identity verification available.
              </div>
            )}
          </Card>
        </div>

        {/* project account dossier detail */}
        {projectAccount && (
          <div className="mt-3">
            <Card title={`Project account · ${projectAccount.handle}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-ink">{projectAccount.display_name || projectAccount.handle}</span>
                <VerdictPill verdict={projectAccount.report.composite_verdict} score={projectAccount.report.governing_score} />
                <span className="ml-auto text-[11px] text-ink-faint">{projectAccount.followers} followers · joined {projectAccount.joined}</span>
              </div>
              {projectAccount.bio && <p className="mt-1.5 text-[12.5px] leading-snug text-ink-dim">{projectAccount.bio}</p>}
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink">{projectAccount.headline}</p>
              {projectAccount.evidence.ventures.length > 0 && (
                <div className="mt-2 border-t border-line/60 pt-2">
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Claimed ventures (unverified — Crunchbase/PDL off)</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {projectAccount.evidence.ventures.slice(0, 6).map((v, i) => (
                      <span key={i} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim">{v.project_name}</span>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>
        )}

        <div className="mt-4 rounded-xl border border-line bg-panel/40 p-4 text-[12px] leading-relaxed text-ink-faint">
          <span className="text-ink-dim">How to read this:</span> the token and site recon run keyless and free; the project account is backgrounded automatically (one live people-audit). Per-founder deep-dives are one-click and capped at {MAX_FOUNDER_AUDITS} per investigation to bound cost. ARGUS never invents a founder: names without a verified handle are shown but not audited, and a project account is never treated as a person behind the project.
        </div>
      </div>
    </div>
  );
}
