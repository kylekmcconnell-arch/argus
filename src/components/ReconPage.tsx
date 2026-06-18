import { useState, useCallback, useEffect, useRef } from "react";
import { runRecon, type Recon } from "../collect/recon";
import type { RetrievalStage } from "../collect/retrieve";
import { logAudit } from "../lib/auditlog";
import { verdictMeta } from "../lib/verdict";

function Ring({ score, color }: { score: number | null; color: string }) {
  const size = 60, r = size / 2 - 5, c = 2 * Math.PI * r;
  const pct = score == null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth="4" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 0.7s ease-out" }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="mono text-[16px] font-semibold tabular" style={{ color }}>{score ?? "—"}</span>
      </div>
    </div>
  );
}

const TONE: Record<string, string> = {
  good: "var(--color-pass)",
  warn: "var(--color-caution)",
  bad: "var(--color-avoid)",
  gap: "var(--color-unverifiable)",
};
const GLYPH: Record<string, string> = { good: "✓", warn: "▲", bad: "✗", gap: "◌" };

const OUTCOME_TONE: Record<string, string> = {
  ok: "var(--color-pass)", "spa-stub": "var(--color-caution)",
  blocked: "var(--color-caution)", unreachable: "var(--color-avoid)",
};

const COVERAGE: Record<string, { label: string; color: string; blurb: string }> = {
  rendered: { label: "FULL COVERAGE", color: "var(--color-pass)", blurb: "Page retrieved directly." },
  recovered: { label: "RECOVERED", color: "var(--color-caution)", blurb: "Direct fetch failed; content recovered by rendering the JS app." },
  gap: { label: "COVERAGE GAP", color: "var(--color-unverifiable)", blurb: "Site could not be retrieved or rendered. No content claims are made." },
};

const EXAMPLES = ["neuro-mesh.io", "stripe.com"];

export function ReconPage({ initialUrl, onAudit }: { initialUrl?: string; onAudit?: (q: string) => void }) {
  const [url, setUrl] = useState(initialUrl ?? "");
  const [stages, setStages] = useState<RetrievalStage[]>([]);
  const [pivotNotes, setPivotNotes] = useState<string[]>([]);
  const [recon, setRecon] = useState<Recon | null>(null);
  const [running, setRunning] = useState(false);
  const ran = useRef(false);

  const run = useCallback(async (raw: string) => {
    const target = raw.trim();
    if (!target) return;
    setUrl(target);
    setRunning(true);
    setRecon(null);
    setStages([]);
    setPivotNotes([]);
    const r = await runRecon(
      target,
      (s) => setStages((prev) => [...prev, s]),
      (note) => setPivotNotes((prev) => [...prev, note]),
    );
    setRecon(r);
    setRunning(false);
    logAudit({
      kind: "site",
      query: r.retrieval.url,
      verdict: r.verdict?.verdict ?? r.retrieval.status,
      score: r.verdict?.score ?? null,
      coverage: r.retrieval.status,
      summary: r.identityLine,
      flags: [
        r.retrieval.status === "gap" ? "coverage-gap" : "",
        r.team.state === "unnamed-section" ? "team-unnamed" : "",
        r.team.state === "named" ? "team-named" : "",
        r.tokenSignals.length >= 2 ? "token-project" : "",
        r.pivot?.reconcile.tone === "bad" ? "token-claim-unverified" : "",
        r.pivot?.found ? "token-found-onchain" : "",
      ].filter(Boolean),
    });
  }, []);

  // Auto-run when opened with a URL from the main search bar.
  useEffect(() => {
    if (ran.current || !initialUrl) return;
    ran.current = true;
    run(initialUrl);
  }, [initialUrl, run]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-[28px] font-medium tracking-[-0.02em] text-ink">Site recon</h1>
      <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-dim">
        Point ARGUS at a project's website. It fetches, and when a site is a JavaScript app that returns only a
        shell, it escalates to a rendering crawler instead of guessing. Crucially, when it cannot see something it
        says so: a failed fetch becomes a coverage gap, never a confident "anonymous team."
      </p>

      {/* input */}
      <div className="mt-5 flex items-center gap-2">
        <div className="flex flex-1 items-center rounded-lg border border-line bg-white px-3">
          <span className="mono text-[12px] text-ink-faint">https://</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") run(url); }}
            placeholder="project-site.io"
            className="mono w-full bg-transparent px-1.5 py-2.5 text-[13.5px] text-ink outline-none placeholder:text-ink-faint"
          />
        </div>
        <button
          onClick={() => run(url)}
          disabled={running}
          className="btn-primary shrink-0 px-4 py-2.5 text-[13px] font-medium disabled:opacity-50"
        >
          {running ? "running…" : "Run recon"}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-faint">
        <span>try</span>
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => run(e)} className="mono rounded border border-line bg-white px-1.5 py-0.5 text-ink-dim transition hover:text-ink">{e}</button>
        ))}
      </div>

      {/* retrieval trace — the fail -> escalate routing, shown */}
      {stages.length > 0 && (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-white">
          <div className="border-b border-line px-4 py-2 text-[10.5px] uppercase tracking-wider text-ink-faint">Retrieval</div>
          {stages.map((s, i) => (
            <div key={i} className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-0">
              <span className="mono mt-0.5 shrink-0 text-[10px] text-ink-faint">{i + 1}</span>
              <span className="mono shrink-0 text-[12px] text-ink">{s.method}</span>
              <span className="mono shrink-0 rounded px-1.5 text-[10.5px] font-semibold" style={{ color: OUTCOME_TONE[s.outcome] ?? "var(--color-ink-faint)", background: (OUTCOME_TONE[s.outcome] ?? "#888") + "14" }}>
                {s.outcome}
              </span>
              <span className="flex-1 text-[12px] leading-snug text-ink-dim">{s.note}</span>
              {s.chars > 0 && <span className="mono shrink-0 text-[10.5px] text-ink-faint">{s.chars.toLocaleString()} ch</span>}
            </div>
          ))}
        </div>
      )}

      {/* result */}
      {recon && (
        <>
          {/* verdict hero */}
          {recon.verdict && (() => {
            const v = recon.verdict!;
            const m = verdictMeta(v.verdict);
            return (
              <div className="mt-4 rounded-xl border bg-white p-5" style={{ borderColor: m.color + "66", background: m.glow }}>
                <div className="flex items-center gap-4">
                  <Ring score={v.score} color={m.color} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="mono text-[18px] font-semibold tracking-tight" style={{ color: m.color }}>{m.label}</span>
                      <span className="mono rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: COVERAGE[recon.retrieval.status].color, background: COVERAGE[recon.retrieval.status].color + "14" }}>
                        {COVERAGE[recon.retrieval.status].label}
                      </span>
                      {v.capApplied && <span className="mono rounded px-1.5 py-0.5 text-[10px] text-ink-faint" style={{ background: "var(--color-avoid)14", color: "var(--color-avoid)" }}>cap · {v.capApplied.replace(/_/g, " ")}</span>}
                    </div>
                    {recon.title && <div className="mt-1 truncate text-[13px] text-ink-dim">{recon.title}</div>}
                    <p className="mt-1.5 text-[13px] leading-relaxed text-ink-dim">{recon.identityLine}</p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5 border-t border-line/60 pt-3">
                  {v.reasons.map((r, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="mono mt-0.5 shrink-0 text-[12px]" style={{ color: TONE[r.tone] }}>{GLYPH[r.tone]}</span>
                      <span className="text-[13px] leading-snug text-ink-dim">{r.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* findings ledger */}
          <div className="mt-3 rounded-xl border border-line bg-white p-4">
            <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Findings</div>
            <div className="mt-2 space-y-2">
              {recon.findings.map((f, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="mono mt-0.5 shrink-0 text-[12px]" style={{ color: TONE[f.tone] }}>{GLYPH[f.tone]}</span>
                  <span className="text-[13px] leading-snug text-ink-dim">{f.claim}</span>
                </div>
              ))}
            </div>
          </div>

          {/* on-chain reality check */}
          {recon.pivot && (
            <div className="mt-3 rounded-xl border bg-white p-4" style={{ borderColor: TONE[recon.pivot.reconcile.tone] + "66" }}>
              <div className="flex items-center gap-2">
                <span className="text-[10.5px] uppercase tracking-wider text-ink-faint">On-chain reality check</span>
                <span className="mono shrink-0 text-[12px]" style={{ color: TONE[recon.pivot.reconcile.tone] }}>{GLYPH[recon.pivot.reconcile.tone]}</span>
              </div>

              {/* the claim it is checking */}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {recon.pivot.claim.ticker && <Chip k="ticker" v={recon.pivot.claim.ticker} />}
                {recon.pivot.claim.fdv && <Chip k="claims" v={recon.pivot.claim.fdv} />}
                {recon.pivot.claim.raise && <Chip k="raise" v={recon.pivot.claim.raise} />}
                {recon.pivot.claim.live && <Chip k="" v="token live" />}
              </div>

              {pivotNotes.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {pivotNotes.map((n, i) => <div key={i} className="mono text-[11.5px] text-ink-faint">→ {n}</div>)}
                </div>
              )}

              <p className="mt-2 text-[13.5px] font-medium leading-relaxed text-ink">{recon.pivot.reconcile.line}</p>

              {/* found token -> click through to the full token audit */}
              {recon.pivot.found && onAudit && (
                <button
                  onClick={() => onAudit(recon.pivot!.found!.address)}
                  className="mono mt-3 rounded-lg border border-line bg-panel-2/50 px-3 py-1.5 text-[12px] text-ink-dim transition hover:border-line-2 hover:text-ink"
                >
                  open full token audit for {recon.pivot.found.symbol} →
                </button>
              )}

              {/* name-search candidates, when nothing confidently matched */}
              {!recon.pivot.found && recon.pivot.candidates.length > 0 && (
                <div className="mt-2.5">
                  <div className="text-[10.5px] uppercase tracking-wider text-ink-faint">Closest by name (not a confirmed match)</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {recon.pivot.candidates.map((c) => (
                      <button key={c.address} onClick={() => onAudit?.(c.address)} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim transition hover:text-ink">
                        {c.symbol} · {c.chain} · ${Math.round(c.liqUsd).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* extracted entities */}
          {(recon.socials.length > 0 || recon.funding.length > 0 || recon.tokenSignals.length > 0) && (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {recon.socials.length > 0 && (
                <Card title="Socials">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.socials.map((s) => (
                      <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim transition hover:text-ink">{s.label}</a>
                    ))}
                  </div>
                </Card>
              )}
              {recon.funding.length > 0 && (
                <Card title="Funding claims (unverified)">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.funding.map((f) => <span key={f} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim">{f}</span>)}
                  </div>
                </Card>
              )}
              {recon.tokenSignals.length > 0 && (
                <Card title="Token signals">
                  <div className="flex flex-wrap gap-1.5">
                    {recon.tokenSignals.map((t) => <span key={t} className="mono rounded-md border border-line px-1.5 py-0.5 text-[11px] text-ink-dim">{t}</span>)}
                  </div>
                </Card>
              )}
            </div>
          )}
        </>
      )}

      <div className="mt-6 rounded-xl border border-line bg-panel/40 p-4 text-[12.5px] leading-relaxed text-ink-faint">
        <span className="text-ink-dim">Why this exists:</span> an earlier audit fetched only a site's JavaScript
        shell, never saw the team section, and reported "anonymous team." That was an overstatement — the honest
        line was "could not render the site." Retrieval now escalates on failure, and absence is only ever asserted
        from content actually rendered.
      </div>
    </div>
  );
}

function Chip({ k, v }: { k: string; v: string }) {
  return (
    <span className="mono rounded-md border border-line bg-panel-2/40 px-1.5 py-0.5 text-[11px] text-ink-dim">
      {k && <span className="text-ink-faint">{k} </span>}{v}
    </span>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-white p-4">
      <div className="mb-2 text-[10.5px] uppercase tracking-wider text-ink-faint">{title}</div>
      {children}
    </div>
  );
}
