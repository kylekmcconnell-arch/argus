// Development-only prototype of the interactive-dossier report experience
// (docs/REPORT-EXPERIENCE-BRIEF-2026-08-17.md, steps 4-6). ?design-preview=dossier
//
// Everything on this page is derived by buildDossier() from the fixture, which is
// the real @dynexcoin report (version 7c51822f, captured 2026-08-16) trimmed to
// the fields the model reads, values verbatim.
//
// Each beat gets its own visual form rather than one repeated list: the subject
// is a portrait and a timeline, the team is a set of cards split by whether the
// subject itself named them, the perimeter is a host comparison, coverage is a
// census of every check, and the verdict is the six scored axes as ranges. A
// score band is drawn as a range because that is what the engine records — a
// single number would be a claim the evidence does not make.
import { useEffect, useRef, useState } from "react";
import { ProvenanceTag } from "../components/ProvenanceTag";
import { buildDossier, type DossierFigure, type StrengthBand, type KeyMeasure } from "../lib/dossierModel";
import fixture from "./dynexReportFixture.json";

const TINT: Record<string, string> = {
  sourced: "text-sourced", derived: "text-derived", unestablished: "text-unverifiable",
};
const TIER_TINT: Record<string, string> = {
  exceptional: "var(--color-sourced)", solid: "var(--color-signal)",
  emerging: "var(--color-derived)", weak: "var(--color-unverifiable)",
};

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(q.matches); on(); q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return r;
}

/* ── the six scored axes, drawn as the ranges the engine actually records ── */
function BandChart({ bands, only }: { bands: StrengthBand[]; only?: string }) {
  const shown = only ? bands.filter((b) => b.axis === only) : bands;
  const ceiling = Math.max(...bands.map((b) => b.maxScore), 1);
  return (
    <div className="space-y-2">
      {shown.map((b) => (
        <div key={b.axis}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] text-ink-dim">{b.label}</span>
            <span className="mono text-[10px] text-ink-faint">{b.minScore}–{b.maxScore}</span>
          </div>
          <div className="mt-1 h-[7px] w-full rounded-full bg-line/60">
            <div
              className="h-full rounded-full"
              style={{
                marginLeft: `${(b.minScore / ceiling) * 100}%`,
                width: `${((b.maxScore - b.minScore) / ceiling) * 100 || 2}%`,
                background: TIER_TINT[b.tier] ?? "var(--color-ink-faint)",
                minWidth: 6,
              }}
            />
          </div>
          {only && b.reasons.length > 0 && (
            <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">{b.reasons.join(" · ")}</p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ── every check in the scan, one mark each ── */
const STATE_TINT: Record<string, string> = {
  confirmed: "var(--color-sourced)", "checked-empty": "var(--color-unverifiable)",
  unknown: "var(--color-unverifiable)", unavailable: "var(--color-unverifiable)",
  "not-applicable": "var(--color-line)",
};
function CoverageGrid({ checks }: { checks: Array<{ state: string; count: number }> }) {
  const dots = checks.flatMap((c) => Array.from({ length: c.count }, () => c.state));
  return (
    <div>
      <div className="flex flex-wrap gap-[3px]">
        {dots.map((state, i) => (
          <span key={i} title={state} className="h-[9px] w-[9px] rounded-[2px]"
            style={{ background: STATE_TINT[state] ?? "var(--color-ink-faint)" }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {checks.map((c) => (
          <span key={c.state} className="mono flex items-center gap-1 text-[10px] text-ink-faint">
            <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: STATE_TINT[c.state] ?? "var(--color-ink-faint)" }} />
            {c.count} {c.state}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Who is reading. The report scores one evidence set but answers four questions. */
function LensPicker({ lenses }: { lenses: Array<{ id: string; label: string; question: string; findings: string[] }> }) {
  const [active, setActive] = useState(lenses[0]?.id ?? "");
  if (!lenses.length) return null;
  const lens = lenses.find((l) => l.id === active) ?? lenses[0];
  return (
    <div className="mt-6 max-w-[54ch]">
      <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Read this as</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {lenses.map((l) => (
          <button key={l.id} type="button" onClick={() => setActive(l.id)}
            className={`chip normal-case tracking-normal ${l.id === lens.id ? "tint-signal text-signal-lift" : "tint-neutral text-ink-faint"}`}>
            {l.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[13px] italic leading-relaxed text-ink-dim">{lens.question}</p>
      <ul className="mt-2.5 space-y-1.5 border-l-2 border-signal/40 pl-3.5">
        {lens.findings.slice(0, 4).map((f, i) => (
          <li key={i} className="text-[12px] leading-relaxed text-ink-dim">{f}</li>
        ))}
      </ul>
      <p className="mono mt-2 text-[10px] text-ink-faint">
        {lens.findings.length} finding{lens.findings.length === 1 ? "" : "s"} carry into this lens
      </p>
    </div>
  );
}

/** The frozen measurement ledger, every row, grouped by domain. */
function MeasureLedger({ measures }: { measures: KeyMeasure[] }) {
  const [open, setOpen] = useState(false);
  if (!measures.length) return null;
  const byDomain = measures.reduce<Record<string, KeyMeasure[]>>((acc, m) => {
    (acc[m.domain] ??= []).push(m); return acc;
  }, {});
  return (
    <div className="mt-6 max-w-[54ch]">
      <button type="button" onClick={() => setOpen(!open)}
        className="chip tint-neutral text-ink-dim normal-case tracking-normal">
        {open ? "Close the ledger" : `Every measurement · ${measures.length}`}
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {Object.entries(byDomain).map(([domain, rows]) => (
            <div key={domain}>
              <p className="mono text-[10px] uppercase tracking-[0.1em] text-signal-lift">{domain}</p>
              <div className="mt-1 space-y-0.5">
                {rows.map((m, i) => (
                  <div key={i} className="flex items-baseline justify-between gap-3 border-b-hairline border-line/60 py-1">
                    <span className="min-w-0 text-[11.5px] leading-snug text-ink-dim">{m.label}</span>
                    <span className="mono shrink-0 text-[11px] text-ink">
                      {m.value}{m.unit && m.unit !== "text" && m.unit !== "date" ? ` ${m.unit}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** "Go deeper" — the questions this beat left open, in the report's own words. */
function RabbitHole({ questions }: { questions: string[] }) {
  const [open, setOpen] = useState(false);
  if (!questions.length) return null;
  return (
    <div className="mt-6 max-w-[54ch]">
      <button type="button" onClick={() => setOpen(!open)}
        className="chip tint-signal text-signal-lift normal-case tracking-normal">
        {open ? "Close" : `Go down this rabbit hole · ${questions.length}`}
      </button>
      {open && (
        <ul className="mt-3 space-y-2 border-l-2 border-signal/40 pl-3.5">
          {questions.map((q, i) => (
            <li key={i} className="text-[12.5px] leading-relaxed text-ink-dim">{q}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Figure({ figure }: { figure: DossierFigure }) {
  const [open, setOpen] = useState(false);
  const r = figure.receipt;
  return (
    <div className="relative">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono shrink-0 text-[10px] uppercase tracking-[0.1em] text-ink-faint">{figure.label}</span>
        <button type="button" onClick={() => r && setOpen(!open)} aria-expanded={r ? open : undefined}
          className={`mono min-w-0 truncate text-right text-[12px] ${TINT[figure.provenance.tier]} ${r ? "cursor-pointer underline decoration-dotted underline-offset-4" : "cursor-default"}`}>
          {figure.value}
        </button>
      </div>
      {figure.unboundNote && <p className="mt-0.5 text-right text-[10.5px] leading-snug text-unverifiable">{figure.unboundNote}</p>}
      {open && r && (
        <div className="panel absolute right-0 bottom-full z-30 mb-2 w-[330px] px-3.5 py-3 text-left shadow-lg">
          <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Provenance</p>
          <p className="mt-2 text-[12px] italic leading-relaxed text-ink-dim">“{r.passage}”</p>
          <p className="mono mt-2 break-all text-[10.5px] text-ink-faint">{r.sourceLabel}</p>
          <div className="mt-2.5 border-t border-line pt-2">
            {r.chain.map(([what, when]) => (
              <div key={what} className="mt-1 flex items-baseline justify-between gap-3">
                <span className={`text-[11.5px] ${when === "never" ? "text-unverifiable" : "text-ink-dim"}`}>{what}</span>
                <span className={`mono text-[10.5px] ${when === "never" ? "text-unverifiable" : "text-ink-faint"}`}>{when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DossierPreview() {
  const d = buildDossier(fixture as unknown as Record<string, unknown>);
  const beats = d.beats;
  const [cur, setCur] = useState(beats[0]?.id ?? "");
  const reduced = useReducedMotion();
  const refs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const pick = () => {
      const c = window.innerHeight / 2;
      let best: string | null = null, bd = Infinity;
      for (const [id, el] of Object.entries(refs.current)) {
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const dist = Math.abs(r.top + r.height / 2 - c);
        if (dist < bd) { bd = dist; best = id }
      }
      if (best) setCur(best);
    };
    pick();
    window.addEventListener("scroll", pick, { passive: true });
    window.addEventListener("resize", pick, { passive: true });
    return () => { window.removeEventListener("scroll", pick); window.removeEventListener("resize", pick) };
  }, []);

  const upto = beats.findIndex((b) => b.id === cur);
  const on = (i: number) => reduced || i <= upto;
  const perimeter = beats.find((b) => b.id === "perimeter");

  return (
    <div className={`dossier-preview min-h-screen bg-void text-ink ${reduced ? "reduced" : ""}`}>
      <header className="flex items-center justify-between border-b border-line px-6 py-2.5">
        <p className="mono text-[10px] uppercase tracking-[0.14em] text-ink-faint">
          Design preview · derived from report 7c51822f
        </p>
        {d.cost && (
          <p className="mono text-[10px] text-ink-faint">
            scan cost ${d.cost.usd?.toFixed(2)}{d.cost.estimated ? " est." : ""}
          </p>
        )}
      </header>

      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-12 px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]">
        <div>
          {beats.map((b) => (
            <section key={b.id} data-beat={b.id} data-screen-label={b.label}
              ref={(el) => { refs.current[b.id] = el }}
              className="flex min-h-[82vh] flex-col justify-center py-10">
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-signal-lift">{b.kicker}</p>
              <h2 className="display mt-3 max-w-[20ch] text-[32px] leading-[1.14] text-ink">{b.heading}</h2>

              {b.id === "subject" && (
                <div className="mt-6 flex max-w-[54ch] items-start gap-5">
                  {d.subject.avatarUrl && (
                    <img src={d.subject.avatarUrl} alt="" width={72} height={72}
                      className="h-[72px] w-[72px] shrink-0 rounded-xl border border-line object-cover" />
                  )}
                  <div className="min-w-0">
                    {d.subject.bio && <p className="text-[13.5px] leading-relaxed text-ink-dim">{d.subject.bio}</p>}
                    {d.subject.avatarNote && (
                      <p className="mt-2 text-[11px] leading-snug text-ink-faint">{d.subject.avatarNote.split(".")[0]}.</p>
                    )}
                  </div>
                </div>
              )}

              {b.id === "subject" && d.links.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-2">
                  {d.links.map((l) => (
                    <a key={l.url} href={l.url} target="_blank" rel="noreferrer"
                      className="chip tint-sourced text-sourced normal-case tracking-normal">
                      {l.label}
                    </a>
                  ))}
                </div>
              )}

              {b.id === "activity" && d.pressClaims.length > 0 && (
                <div className="mt-6 max-w-[54ch]">
                  <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Claimed coverage</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {d.pressClaims.map((c) => (
                      <span key={c.outlet} className={`chip normal-case tracking-normal ${c.verified ? "tint-sourced text-sourced" : "tint-unverifiable text-unverifiable"}`}>
                        {c.outlet}{c.verified ? "" : " · unverified"}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] leading-snug text-ink-faint">
                    Named in the file as coverage of this subject. No artifact was fetched for any of them,
                    so the mastheads lend nothing to the score.
                  </p>
                </div>
              )}

              {b.id === "subject" && d.timeline.length > 0 && (
                <div className="mt-7 max-w-[54ch]">
                  <div className="flex items-stretch gap-0">
                    {d.timeline.map((t, i) => (
                      <div key={t.label} className={`flex-1 border-l-2 pl-3 ${i === d.timeline.length - 1 ? "border-signal" : "border-line"}`}>
                        <p className="mono text-[10px] uppercase tracking-[0.1em] text-ink-faint">{t.label}</p>
                        <p className="mono mt-1 text-[13px] text-ink">{t.when}</p>
                        {t.detail && <p className="mt-0.5 text-[10.5px] leading-snug text-ink-faint">{t.detail}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.id === "team" && d.team.length > 0 && (
                <div className="mt-6 max-w-[56ch]">
                  <p className="mono mb-2 text-[10px] uppercase tracking-[0.12em] text-ink-faint">
                    {d.team.filter((m) => m.firstParty).length} named by the subject · {d.team.filter((m) => !m.firstParty).length} found only by search
                  </p>
                <div className="grid grid-cols-2 gap-2.5">
                  {d.team.map((m) => (
                    <div key={m.name} className={`panel-inset flex items-start gap-2.5 px-3 py-2.5 ${m.firstParty ? "border-l-2 border-sourced" : "border-l-2 border-unverifiable/50"}`}>
                      {m.avatarUrl ? (
                        <img src={m.avatarUrl} alt="" width={32} height={32}
                          className="h-8 w-8 shrink-0 rounded-full border border-line object-cover" />
                      ) : (
                        <span aria-hidden="true"
                          className={`mono flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] ${m.firstParty ? "border-sourced/40 text-sourced" : "border-unverifiable/40 text-unverifiable"}`}>
                          {m.name.replace(/^@/, "").charAt(0).toUpperCase()}
                        </span>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-medium text-ink">{m.name}</p>
                        <p className="mt-0.5 text-[11.5px] leading-snug text-ink-dim">{m.role}</p>
                        <p className={`mono mt-1.5 text-[10px] ${m.firstParty ? "text-sourced" : "text-unverifiable"}`}>
                          {m.firstParty ? "named by the account itself" : "web search only"}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                </div>
              )}

              {b.id === "perimeter" && (
                <div className="mt-6 max-w-[54ch] space-y-2.5">
                  <div className="panel-inset border-l-2 border-sourced px-3.5 py-3">
                    <p className="mono text-[10px] uppercase tracking-[0.1em] text-sourced">Sources that name this subject</p>
                    <p className="mono mt-1.5 text-[12px] text-ink-dim">dynexcoin.org · x.com/dynexcoin · github.com/dynexcoin</p>
                  </div>
                  <div className="panel-inset border-l-2 border-unverifiable px-3.5 py-3">
                    <p className="mono text-[10px] uppercase tracking-[0.1em] text-unverifiable">Sources behind the legal entity</p>
                    <p className="mono mt-1.5 text-[12px] text-ink-dim">sec.gov · EDGAR CIK 826675 · a Virginia corporation</p>
                    <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">
                      Four filings, none mentioning DNX, dynexcoin.org, or neuromorphic computing.
                    </p>
                  </div>
                </div>
              )}

              {b.id === "coverage" && (
                <div className="mt-6 max-w-[54ch] space-y-4">
                  <CoverageGrid checks={d.coverage.checks} />
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <Stat n={`${d.coverage.questionsAnswered}/${d.coverage.questionsTotal}`} k="questions answered" />
                    <Stat n={String(d.coverage.leads)} k="leads never confirmed" />
                    <Stat n={String(d.coverage.failedProviders.length)} k={`providers silent · ${d.coverage.failedProviders.join(", ")}`} />
                  </div>
                </div>
              )}

              {b.id === "coverage" && <RabbitHole questions={d.openQuestions} />}
              {b.id === "coverage" && <MeasureLedger measures={d.measures} />}
              {b.id === "verdict" && <LensPicker lenses={d.lenses} />}

              {b.id === "verdict" && (
                <div className="mt-6 max-w-[54ch]">
                  {d.verdict.headline && <p className="text-[13.5px] leading-relaxed text-ink-dim">{d.verdict.headline}</p>}
                  <div className="mt-6"><BandChart bands={d.strengthBands} /></div>
                  {d.nextActions.length > 0 && (
                    <div className="mt-7">
                      <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">What would move this</p>
                      <ol className="mt-2 space-y-2">
                        {d.nextActions.slice(0, 3).map((a) => (
                          <li key={a.rank} className="flex gap-2.5">
                            <span className="mono shrink-0 text-[11px] text-signal-lift">{a.rank}</span>
                            <span className="min-w-0">
                              <span className="block text-[12.5px] leading-snug text-ink-dim">{a.action}</span>
                              {a.whyNow && <span className="mt-0.5 block text-[10.5px] text-ink-faint">{a.whyNow}</span>}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}
            </section>
          ))}
          <div className="h-[28vh]" />
        </div>

        {/* the pinned file */}
        <div className="hidden lg:block">
          <div className="sticky top-8 h-[calc(100vh-4rem)] py-8">
            <div className="panel flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">The file</span>
                <span className="mono text-[10px] text-ink-faint">{upto + 1} / {beats.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div data-cs="mast" data-settled="true" className="dossier-block flex items-center gap-3">
                  {d.subject.avatarUrl && (
                    <img src={d.subject.avatarUrl} alt="" width={40} height={40}
                      className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
                  )}
                  <div className="min-w-0">
                    <h3 className="display truncate text-[20px] text-ink">{d.subject.name}</h3>
                    <p className="mono truncate text-[10.5px] text-ink-faint">
                      {d.subject.handle}{d.subject.followers ? ` · ${d.subject.followers}` : ""}
                    </p>
                  </div>
                </div>

                {beats.filter((b) => b.id !== "verdict").map((b, i) => (
                  <div key={b.id} data-cs={b.id} data-settled={on(i) ? "true" : "false"} className="dossier-block">
                    <div className="mt-4 border-t border-line pt-3.5">
                      <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{b.label}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{b.heading}</p>
                      {b.figures.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {b.figures.slice(0, 4).map((f, n) => <Figure key={`${f.label}-${n}`} figure={f} />)}
                        </div>
                      )}
                      {b.id === "coverage" && <div className="mt-3"><CoverageGrid checks={d.coverage.checks} /></div>}
                    </div>
                  </div>
                ))}

                <div data-cs="verdict" data-settled={on(beats.length - 1) ? "true" : "false"} className="dossier-block">
                  <div className="mt-4 border-t border-line pt-3.5">
                    <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Verdict</p>
                    <div className="mt-2 flex items-baseline gap-2.5">
                      <span className="display text-[30px] text-caution">{d.verdict.call}</span>
                      {d.verdict.score !== null && <span className="mono text-[15px] text-ink-dim">{d.verdict.score}/100</span>}
                    </div>
                    <div className="mt-3"><BandChart bands={d.strengthBands} /></div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
                  <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Origin</span>
                  <ProvenanceTag state={{ tier: "sourced" }} />
                  <ProvenanceTag state={{ tier: "derived" }} />
                  <ProvenanceTag state={{ tier: "unestablished" }} />
                </div>
              </div>

              <div className="border-t border-line px-4 py-2">
                <p className="mono text-[10px] text-ink-faint">
                  {beats[upto]?.label ?? beats[0]?.label}
                  {perimeter?.figures.some((f) => f.unboundNote) ? " · one record names someone else" : " · dotted values open their receipt"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ n, k }: { n: string; k: string }) {
  return (
    <div>
      <p className="mono text-[22px] leading-none text-ink">{n}</p>
      <p className="mt-1 text-[10.5px] leading-snug text-ink-faint">{k}</p>
    </div>
  );
}
