import { useRef, useState } from "react";
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
    <div className="rounded-xl border bg-panel p-4" style={{ borderColor: accent ? accent + "55" : "var(--color-line)" }}>
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
  onOpenProjectAccount,
}: {
  inv: Investigation;
  onAudit: (q: string) => void;
  onReset: () => void;
  onOpenToken: () => void;
  onOpenProjectAccount: () => void;
}) {
  const [spent, setSpent] = useState(0);
  const spentRef = useRef(0); // synchronous guard so a rapid double-click can't overshoot the cap
  const { token, projectX, recon, projectAccount, founders, deployerTrail } = inv;
  const tm = verdictMeta(token.verdict);
  // Unified team: members named in the project's X content (associates) merged
  // with people dug up via the web/LinkedIn search, deduped by handle so a
  // pseudonymous handle gets enriched with its real name + LinkedIn.
  const teamUnified: { name: string; handle?: string; role: string; linkedin?: string }[] = (() => {
    const map = new Map<string, { name: string; handle?: string; role: string; linkedin?: string }>();
    for (const a of projectAccount?.evidence.associates ?? []) {
      if (!/^team:/i.test(a.relation ?? "")) continue;
      map.set(a.associate_key.toLowerCase(), { name: a.associate_key, handle: a.associate_key, role: (a.relation ?? "team").replace(/^team:\s*/i, "") });
    }
    for (const p of inv.webTeam ?? []) {
      const ex = p.handle ? map.get(p.handle.toLowerCase()) : undefined;
      if (ex) { ex.name = p.name || ex.name; ex.linkedin = ex.linkedin ?? p.linkedin; if (!ex.role || ex.role === "team") ex.role = p.role; }
      else map.set((p.handle ?? p.name).toLowerCase(), { name: p.name, handle: p.handle, role: p.role, linkedin: p.linkedin });
    }
    return [...map.values()];
  })();
  const advisors = (projectAccount?.evidence.testimonials ?? []).filter((t) => t.claimed_relationship === "advisor");
  const advisorChip = (v?: string): { label: string; color: string } => {
    const s = (v ?? "").toLowerCase();
    if (s.includes("corrobor")) return { label: "corroborated", color: "var(--color-pass)" };
    if (s.includes("contradict")) return { label: "contradicted", color: "var(--color-avoid)" };
    return { label: "unconfirmed", color: "var(--color-ink-faint)" };
  };
  const auditFounder = (handle: string) => {
    if (spentRef.current >= MAX_FOUNDER_AUDITS) return;
    spentRef.current += 1;
    setSpent(spentRef.current);
    onAudit(handle);
  };

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
                <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">People & accounts surfaced</div>
                {founders.map((f) => (
                  <div key={f.name} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">
                      <span className="mono text-[12.5px] text-ink">{f.name}</span>
                      <span className="ml-2 text-[10.5px] text-ink-faint">{f.source === "project" ? "from project account" : f.handle ? "linked on site" : "named on site"}</span>
                    </span>
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
                      <span className="mono shrink-0 text-[10.5px] text-ink-faint">no verified handle</span>
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
                <div>
                  Deployed by <span className="mono text-ink-dim">{shortAddr(token.deployer)}</span>
                  {deployerTrail?.walletAgeDays != null && <> · wallet <span className="text-ink-dim">{deployerTrail.walletAgeDays}d</span> old</>}
                  {deployerTrail?.tokensCreated != null && <> · <span className="text-ink-dim">{deployerTrail.tokensCreated}</span> tokens minted</>}
                </div>
                {deployerTrail?.chain && deployerTrail.chain.length > 0 ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-ink-faint">money trail</span>
                    <span className="mono rounded bg-panel-2 px-1 py-0.5 text-ink-dim">{shortAddr(token.deployer)}</span>
                    {deployerTrail.chain.map((h, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <span className="text-ink-faint">←</span>
                        {h.label ? (
                          <span className="mono rounded px-1.5 py-0.5" style={{ background: "rgba(22,163,74,0.12)", color: "var(--color-pass)" }}>{h.label}</span>
                        ) : (
                          <span className="mono rounded bg-panel-2 px-1 py-0.5 text-ink-dim">{shortAddr(h.to)}</span>
                        )}
                      </span>
                    ))}
                    {!deployerTrail.terminatesAtCex && <span className="text-ink-faint">· trail cold</span>}
                  </div>
                ) : deployerTrail?.funder ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span>funded by</span>
                    {deployerTrail.funder.label ? (
                      <span className="mono rounded px-1.5 py-0.5" style={{ background: "rgba(22,163,74,0.10)", color: "var(--color-pass)" }}>{deployerTrail.funder.label}</span>
                    ) : (
                      <span className="mono text-ink-dim">{shortAddr(deployerTrail.funder.address)}</span>
                    )}
                  </div>
                ) : null}
                {deployerTrail?.serialDeployer && (
                  <span className="mono mt-1 inline-block rounded px-1.5 py-0.5" style={{ background: "rgba(220,38,38,0.12)", color: "var(--color-avoid)" }}>serial deployer · {deployerTrail.tokensCreated}+ tokens</span>
                )}
                {deployerTrail && <div className="mt-1 leading-snug">{deployerTrail.note}</div>}
                {!deployerTrail && <div className="mt-0.5">deployer wallet, no identity verification available.</div>}
              </div>
            )}
          </Card>
        </div>

        {/* team + advisors: X content merged with the web/LinkedIn deep search */}
        {(teamUnified.length > 0 || advisors.length > 0) && (
          <div className="mt-3">
            <Card title="Team & advisors · X content + web/LinkedIn search">
              {teamUnified.length > 0 && (
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Team ({teamUnified.length})</div>
                  <div className="mt-1.5 space-y-1.5">
                    {teamUnified.map((m) => (
                      <div key={m.handle ?? m.name} className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                          <span className="mono text-[12.5px] text-ink">{m.name}</span>
                          {m.handle && m.handle !== m.name && <span className="mono text-[11px] text-ink-faint">{m.handle}</span>}
                          <span className="text-[10.5px] text-ink-faint">{m.role}</span>
                          {m.linkedin && (
                            <a href={`https://${m.linkedin.replace(/^https?:\/\//, "")}`} target="_blank" rel="noreferrer" className="text-[10.5px] text-signal-dim underline-offset-2 hover:underline">LinkedIn ↗</a>
                          )}
                        </span>
                        {m.handle ? (
                          <button
                            onClick={() => auditFounder(m.handle!)}
                            disabled={spent >= MAX_FOUNDER_AUDITS}
                            className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40"
                            style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
                          >
                            {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "background →"}
                          </button>
                        ) : (
                          <span className="mono shrink-0 text-[10.5px] text-ink-faint">no handle</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {advisors.length > 0 && (
                <div className={teamMembers.length > 0 ? "mt-3 border-t border-line/60 pt-3" : ""}>
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Advisors / backers ({advisors.length}) · claimed, corroborated</div>
                  <div className="mt-1.5 space-y-1.5">
                    {advisors.map((a) => {
                      const c = advisorChip(a.corroboration_verdict);
                      return (
                        <div key={a.claimed_endorser_handle} className="flex items-center justify-between gap-2">
                          <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <span className="mono text-[12.5px] text-ink">{a.claimed_endorser_handle}</span>
                            <span className="mono rounded px-1.5 py-0.5 text-[10px]" style={{ background: `${c.color}1a`, color: c.color }}>{c.label}</span>
                            {a.follows_subject === false && <span className="text-[10px] text-ink-faint">does not follow project</span>}
                          </span>
                          {a.claimed_endorser_handle && (
                            <button
                              onClick={() => auditFounder(a.claimed_endorser_handle!)}
                              disabled={spent >= MAX_FOUNDER_AUDITS}
                              className="mono shrink-0 rounded-md border px-2 py-0.5 text-[11px] transition disabled:opacity-40"
                              style={{ borderColor: "var(--color-signal)", color: "var(--color-signal)" }}
                            >
                              {spent >= MAX_FOUNDER_AUDITS ? "cap reached" : "background →"}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-ink-faint">A claimed advisor who does not follow or has never acknowledged the project is a classic fake-name-drop signal.</p>
                </div>
              )}
            </Card>
          </div>
        )}

        {/* project account dossier detail */}
        {projectAccount && (
          <div className="mt-3">
            <Card title={`Project account · ${projectAccount.handle}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[13.5px] font-medium text-ink">{projectAccount.display_name || projectAccount.handle}</span>
                <VerdictPill verdict={projectAccount.report.composite_verdict} score={projectAccount.report.governing_score} />
                <span className="ml-auto text-[11px] text-ink-faint">{projectAccount.followers} followers · joined {projectAccount.joined}</span>
              </div>
              {/* why the score landed where it did */}
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-faint">
                <span>governed by <span className="text-ink-dim">{String(projectAccount.report.governing_role).toLowerCase()}</span></span>
                {projectAccount.report.cap_applied && <span className="mono rounded px-1.5 py-0.5" style={{ background: "var(--color-avoid)18", color: "var(--color-avoid)" }}>cap · {String(projectAccount.report.cap_applied).replace(/_/g, " ")}</span>}
                <button onClick={onOpenProjectAccount} className="mono ml-auto rounded-md border border-line px-2 py-0.5 text-[11px] text-ink-dim transition hover:border-line-2 hover:text-ink">why this score · full report →</button>
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
