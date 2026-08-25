// Production reading document for a live report.
// Visual language extracted from the DEV dossier preview (beats, portrait /
// timeline, first-party vs search team cards, coverage census, axis ranges,
// provenance colour). Headings and figures come from buildDossier(livePayload)
// — never from the dynex fixture. The fixture harness stays in src/dev/.
//
// Honesty (same contract as dossierModel):
// - Headings are counts and recorded states only.
// - Display name is not a bind key.
// - First-party named team is not independently corroborated.
// - Provenance colours are source-of-truth, not pass/fail.
import { useEffect, useRef, useState } from "react";
import { GithubLogo, LinkedinLogo, LinkSimple, XLogo } from "@phosphor-icons/react";
import { ProvenanceTag } from "./ProvenanceTag";
import { buildDossier, type Dossier, type DossierFigure, type DossierSourceRow, type StrengthBand, type KeyMeasure } from "../lib/dossierModel";

const TINT: Record<string, string> = {
  sourced: "text-sourced", derived: "text-derived", unestablished: "text-unverifiable",
};
const TIER_TINT: Record<string, string> = {
  exceptional: "var(--color-sourced)", solid: "var(--color-signal)",
  emerging: "var(--color-derived)", weak: "var(--color-unverifiable)",
};

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function useReducedMotion() {
  const [r, setR] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(q.matches);
    on();
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return r;
}

function figureTint(figure: DossierFigure): string {
  if (figure.locked) return "text-ink-faint";
  return TINT[figure.provenance.tier] ?? "text-ink";
}

function hostOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); }
  catch { return ""; }
}

const TEAM_PROFILE_ICONS = {
  x: XLogo,
  linkedin: LinkedinLogo,
  github: GithubLogo,
  huggingface: LinkSimple,
};

/* ── the six scored axes, drawn as the ranges the engine actually records ── */
export function BandChart({ bands, only }: { bands: StrengthBand[]; only?: string }) {
  if (!bands.length) return null;
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
            <p className="mt-1 text-[11px] leading-snug text-ink-faint">{b.reasons.join(" · ")}</p>
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
export function CoverageGrid({ checks }: { checks: Array<{ state: string; count: number }> }) {
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
function LensPicker({ lenses }: { lenses: Dossier["lenses"] }) {
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
      <p className="mt-3 text-[13.5px] italic leading-relaxed text-ink-dim">{lens.question}</p>
      <ul className="mt-2.5 space-y-1.5 border-l-2 border-signal/40 pl-3.5">
        {lens.findings.slice(0, 4).map((f, i) => (
          <li key={i} className="text-[12.5px] leading-relaxed text-ink-dim">{f}</li>
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
                    <span className="min-w-0 text-[11px] leading-snug text-ink-dim">{m.label}</span>
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

const SCORECARD_STATE_COPY: Record<string, string> = {
  established: "Evidence established",
  partial: "Partly established",
  open: "Still open",
  not_collected: "Not collected",
};

/** Role-specific evidence coverage. This is deliberately not a second score. */
function EntityScorecards({ dossier }: { dossier: Dossier }) {
  const [ledgerOpen, setLedgerOpen] = useState(false);
  if (!dossier.entityScorecards.length) return null;
  return (
    <div className="mt-7 max-w-[62ch] border-t border-line pt-6">
      {dossier.entityScorecards.map((scorecard) => (
        <section key={scorecard.id} aria-label={scorecard.label}>
          <p className="mono text-[10px] uppercase tracking-[0.12em] text-signal-lift">Role-specific review</p>
          <h3 className="mt-2 text-[17px] font-medium text-ink">{scorecard.label}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">
            Evidence coverage for this role. It does not create or alter the governing ARGUS score.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {scorecard.axes.map((axis) => (
              <div key={axis.id} className="panel-inset px-3 py-2.5">
                <p className="text-[12.5px] font-medium text-ink">{axis.label}</p>
                <p className="mono mt-1 text-[10px] uppercase tracking-[0.08em] text-ink-faint">
                  {SCORECARD_STATE_COPY[axis.state] ?? axis.state.replaceAll("_", " ")}
                  {axis.ledgerRowIds.length ? ` · ${axis.ledgerRowIds.length} record${axis.ledgerRowIds.length === 1 ? "" : "s"}` : ""}
                </p>
              </div>
            ))}
          </div>
        </section>
      ))}
      {dossier.entityLedger.length > 0 && (
        <div className="mt-4">
          <button type="button" onClick={() => setLedgerOpen(!ledgerOpen)} className="chip tint-neutral normal-case tracking-normal text-ink-dim">
            {ledgerOpen ? "Close role evidence" : `Open role evidence · ${dossier.entityLedger.length}`}
          </button>
          {ledgerOpen && (
            <div className="mt-3 divide-y divide-line border-y border-line">
              {dossier.entityLedger.map((row) => (
                <div key={row.id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12.5px] font-medium text-ink">{row.label}</span>
                    <span className="mono text-[10px] uppercase text-ink-faint">{row.kind.replaceAll("_", " ")} · {row.state.replaceAll("_", " ")}</span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-dim">{String(row.value)}</p>
                  {row.asOf && <p className="mono mt-1 text-[10px] text-ink-faint">As of {row.asOf}</p>}
                </div>
              ))}
            </div>
          )}
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
  const locked = figure.locked === true;
  return (
    <div className="relative">
      <div className="flex items-baseline justify-between gap-3">
        <span className="mono shrink-0 text-[10px] uppercase tracking-[0.1em] text-ink-faint">{figure.label}</span>
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          {locked ? (
            <span className="chip tint-neutral text-ink-faint normal-case tracking-normal">Not run</span>
          ) : (
            <ProvenanceTag state={figure.provenance} />
          )}
          <button type="button" onClick={() => r && !locked && setOpen(!open)} aria-expanded={r && !locked ? open : undefined}
            className={`mono min-w-0 truncate text-right text-[12.5px] ${figureTint(figure)} ${r && !locked ? "cursor-pointer underline decoration-dotted underline-offset-4" : "cursor-default"}`}>
            {figure.value}
          </button>
        </span>
      </div>
      {figure.unboundNote && <p className="mt-0.5 text-right text-[11px] leading-snug text-unverifiable">{figure.unboundNote}</p>}
      {open && r && (
        <div className="panel absolute right-0 bottom-full z-30 mb-2 w-[330px] px-3.5 py-3 text-left shadow-lg">
          <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Provenance</p>
          <p className="mt-2 text-[12.5px] italic leading-relaxed text-ink-dim">“{r.passage}”</p>
          {(r.sources.length > 0 ? r.sources : [{ url: r.url, sourceLabel: r.sourceLabel, passage: r.passage, capturedAt: null }]).map((s) => (
            <div key={s.url} className="mt-2">
              <a href={s.url} target="_blank" rel="noreferrer" className="link-ext mono break-all text-[11px]">
                {s.sourceLabel}
              </a>
              {s.passage && s.passage !== r.passage && (
                <p className="mt-1 text-[12.5px] italic leading-relaxed text-ink-dim">“{s.passage}”</p>
              )}
            </div>
          ))}
          <div className="mt-2.5 border-t border-line pt-2">
            {r.chain.map(([what, when]) => (
              <div key={what} className="mt-1 flex items-baseline justify-between gap-3">
                <span className={`text-[11px] ${when === "never" ? "text-unverifiable" : "text-ink-dim"}`}>{what}</span>
                <span className={`mono text-[11px] ${when === "never" ? "text-unverifiable" : "text-ink-faint"}`}>{when}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Keep the source receipts available without making a second, pinned copy of the report. */
function BeatReceipts({ figures }: { figures: DossierFigure[] }) {
  if (!figures.length) return null;
  return (
    <details className="mt-6 max-w-[54ch] border-t border-line pt-3">
      <summary className="cursor-pointer text-[12px] font-medium text-ink-dim">
        Sources behind this section · {figures.length}
      </summary>
      <div className="mt-3 space-y-2.5 rounded-xl border border-line/70 bg-surface-subtle px-3.5 py-3">
        {figures.map((figure, index) => (
          <Figure key={`${figure.label}-${index}`} figure={figure} />
        ))}
      </div>
    </details>
  );
}

function EvidenceOriginGuide() {
  return (
    <div className="mt-6 max-w-[54ch] border-t border-line pt-4">
      <p className="text-[12px] font-medium text-ink">How ARGUS knows</p>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Sourced facts come from a saved document or account. Derived facts are calculations. Unestablished items still need evidence.
      </p>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <ProvenanceTag state={{ tier: "sourced" }} />
        <ProvenanceTag state={{ tier: "derived" }} />
        <ProvenanceTag state={{ tier: "unestablished" }} />
      </div>
    </div>
  );
}

function Stat({ n, k }: { n: string; k: string }) {
  return (
    <div>
      <p className="mono text-[15px] leading-none text-derived">{n}</p>
      <p className="mt-1 text-[11px] leading-snug text-ink-faint">{k}</p>
    </div>
  );
}


/** Recorded documents, weighted by how many dossier figures cite them. */
function SourcesTable({ rows }: { rows: DossierSourceRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="mt-6 max-w-[54ch]">
      <div className="divide-y divide-line/60">
        {rows.map((row) => {
          const expanded = open === row.url;
          const ink = row.established ? "text-ink" : "text-unverifiable";
          const dim = row.established ? "text-ink-dim" : "text-unverifiable";
          return (
            <div key={row.url}>
              <button type="button" onClick={() => setOpen(expanded ? null : row.url)}
                aria-expanded={expanded}
                className="flex w-full items-baseline justify-between gap-3 py-2 text-left">
                <span className={`mono min-w-0 truncate text-[11px] ${ink}`}>{row.label}</span>
                <span className="flex shrink-0 items-baseline gap-3">
                  <span className={`mono text-[11px] ${dim}`}>
                    {row.factsCited} {row.factsCited === 1 ? "fact" : "facts"}
                  </span>
                  {row.lastCaptured && (
                    <span className="mono text-[11px] text-ink-faint">{row.lastCaptured}</span>
                  )}
                </span>
              </button>
              {expanded && (
                <div className="pb-2.5">
                  <ul className="space-y-1">
                    {row.citedLabels.map((label, i) => (
                      <li key={`${label}-${i}`} className={`text-[12.5px] leading-relaxed ${dim}`}>{label}</li>
                    ))}
                  </ul>
                  <a href={row.url} target="_blank" rel="noreferrer" className="link-ext mono mt-2 inline-block text-[11px]">
                    Open source
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Perimeter boxes from recorded figures and official links — never a fixture host list. */
function PerimeterFromRecord({ figures, links }: {
  figures: DossierFigure[];
  links: Dossier["links"];
}) {
  const bound = figures.filter((f) => !f.unboundNote);
  const unbound = figures.filter((f) => f.unboundNote);
  const boundHosts = [...new Set([
    ...bound.map((f) => hostOf(f.receipt?.url ?? "")).filter(Boolean),
    ...links.map((l) => hostOf(l.url)).filter(Boolean),
  ])];
  if (!bound.length && !unbound.length && !boundHosts.length) return null;
  return (
    <div className="mt-6 max-w-[54ch] space-y-2.5">
      {boundHosts.length > 0 && (
        <div className="panel-inset border-l-2 border-sourced px-3.5 py-3">
          <p className="mono text-[10px] uppercase tracking-[0.1em] text-sourced">Sources that name this subject</p>
          <p className="mono mt-1.5 text-[12.5px] text-ink-dim">{boundHosts.join(" · ")}</p>
        </div>
      )}
      {unbound.map((f, i) => {
        const hosts = [...new Set([hostOf(f.receipt?.url ?? "")].filter(Boolean))];
        return (
          <div key={`${f.label}-${i}`} className="panel-inset border-l-2 border-unverifiable px-3.5 py-3">
            <p className="mono text-[10px] uppercase tracking-[0.1em] text-unverifiable">Sources that do not name this subject</p>
            <p className="mono mt-1.5 text-[12.5px] text-ink-dim">
              {f.value}{hosts.length ? ` · ${hosts.join(" · ")}` : ""}
            </p>
            {f.unboundNote && (
              <p className="mt-1.5 text-[11px] leading-snug text-ink-faint">{f.unboundNote}.</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function DossierReport({
  payload,
  theatrical = false,
  id = "dossier",
}: {
  /** Live report payload. Must never be the dynex design fixture in production. */
  payload: Record<string, unknown>;
  /** Full-viewport beats + fixture chrome. DEV preview harness only. */
  theatrical?: boolean;
  id?: string;
}) {
  const d = buildDossier(payload);
  const beats = d.beats;
  const beatIds = beats.map((b) => b.id);
  const beatKey = beatIds.join("|");
  const reduced = useReducedMotion();
  const staticLayout = reduced || typeof IntersectionObserver !== "function";
  const refs = useRef<Record<string, HTMLElement | null>>({});
  const [settledIds, setSettledIds] = useState<string[]>(() => (
    prefersReducedMotion() ? beatIds : beatIds.slice(0, 1)
  ));
  const [cur, setCur] = useState(beats[0]?.id ?? "");

  useEffect(() => {
    const ids = beatKey.split("|").filter(Boolean);
    if (staticLayout) return;

    const settleUpTo = (id: string) => {
      const idx = ids.indexOf(id);
      if (idx < 0) return;
      setSettledIds((prev) => {
        const merged = new Set([...prev, ...ids.slice(0, idx + 1)]);
        return ids.filter((x) => merged.has(x));
      });
      setCur(id);
    };

    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const id = (entry.target as HTMLElement).dataset.beat;
        if (id) settleUpTo(id);
      }
    }, { threshold: 0.2, rootMargin: "0px 0px -8% 0px" });

    for (const id of ids) {
      const el = refs.current[id];
      if (el) io.observe(el);
    }

    const hash = window.location.hash.replace(/^#/, "");
    if (hash.startsWith("dossier-")) settleUpTo(hash.slice("dossier-".length));

    return () => io.disconnect();
  }, [beatKey, staticLayout]);

  const settled = (id: string) => staticLayout || settledIds.includes(id);
  const upto = staticLayout ? 0 : Math.max(0, beats.findIndex((b) => b.id === cur));
  const perimeter = beats.find((b) => b.id === "perimeter");
  const subjectHeading = beats.find((b) => b.id === "subject")?.heading ?? null;
  const beatMinH = theatrical ? "min-h-[82vh]" : "";

  return (
    <div
      id={id}
      data-dossier-root=""
      className={`${theatrical ? "dossier-preview min-h-screen bg-void text-ink" : "dossier-report"} ${reduced ? "reduced" : ""}`}
    >
      {theatrical && (
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
      )}

      <div
        data-dossier-layout={theatrical ? "split-story" : "full-width"}
        className={`grid w-full grid-cols-1 gap-12 ${theatrical
          ? "report-frame lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]"
          : "mt-7"}`}
      >
        <div>
          {beats.map((b) => (
            <section
              key={b.id}
              id={`dossier-${b.id}`}
              data-beat={b.id}
              data-screen-label={b.label}
              data-settled={settled(b.id) ? "true" : "false"}
              ref={(el) => { refs.current[b.id] = el; }}
              className={`dossier-block flex ${beatMinH} scroll-mt-28 flex-col justify-center ${theatrical ? "py-10" : "story-chapter report-section mt-7 py-6 first:mt-0"}`}
            >
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-signal-lift">{b.kicker}</p>
              <h2 className={theatrical
                ? "display mt-3 max-w-[20ch] text-[32px] leading-[1.14] text-ink"
                : "story-chapter-title mt-3 max-w-[28ch] text-ink"}>
                {b.heading}
              </h2>

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
                        <p className="mono mt-1 text-[13.5px] text-ink">{t.when}</p>
                        {t.detail && <p className="mt-0.5 text-[11px] leading-snug text-ink-faint">{t.detail}</p>}
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
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                          <p className="truncate text-[13.5px] font-medium text-ink">{m.name}</p>
                          <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">{m.role}</p>
                          <p className={`mono mt-1.5 text-[10px] ${m.firstParty ? "text-sourced" : "text-unverifiable"}`}>
                            {m.firstParty ? "named by the account itself" : "web search only"}
                          </p>
                          {m.profiles.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5" aria-label={`${m.name} profiles`}>
                              {m.profiles.map((profile) => {
                                const Icon = TEAM_PROFILE_ICONS[profile.provider];
                                return (
                                  <a
                                    key={`${profile.provider}:${profile.url}`}
                                    href={profile.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label={`Open ${m.name} on ${profile.label}`}
                                    title={`${m.name} on ${profile.label}`}
                                    className="inline-flex min-h-7 items-center gap-1 rounded-full border border-control-line px-2 text-[11px] font-medium text-ink-dim transition hover:border-signal hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
                                  >
                                    <Icon size={13} weight="regular" aria-hidden="true" />
                                    {profile.label}
                                  </a>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {b.id === "perimeter" && (
                <PerimeterFromRecord figures={b.figures} links={d.links} />
              )}

              {b.id === "coverage" && (
                <div className="mt-6 max-w-[54ch] space-y-4">
                  <CoverageGrid checks={d.coverage.checks} />
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <Stat n={`${d.coverage.questionsAnswered}/${d.coverage.questionsTotal}`} k="questions answered" />
                    <Stat n={String(d.coverage.leads)} k="leads never confirmed" />
                    <Stat n={String(d.coverage.failedProviders.length)} k={d.coverage.failedProviders.length
                      ? `${d.coverage.failedProviders.length} data source${d.coverage.failedProviders.length === 1 ? "" : "s"} did not respond`
                      : "data sources responded"} />
                  </div>
                </div>
              )}

              {b.id === "coverage" && <RabbitHole questions={d.openQuestions} />}
              {b.id === "coverage" && <MeasureLedger measures={d.measures} />}
              {b.id === "verdict" && <LensPicker lenses={d.lenses} />}
              {b.id === "verdict" && <EntityScorecards dossier={d} />}

              {b.id === "verdict" && (
                <div className="mt-6 max-w-[54ch]">
                  {subjectHeading && <p className="text-[13.5px] leading-relaxed text-ink-dim">{subjectHeading}</p>}
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
                              {a.whyNow && <span className="mt-0.5 block text-[11px] text-ink-faint">{a.whyNow}</span>}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              )}

              {!theatrical && <BeatReceipts figures={b.figures} />}
              {!theatrical && b.id === "verdict" && <EvidenceOriginGuide />}
            </section>
          ))}
          {d.sources.length > 0 && (
            <section
              id="dossier-sources"
              data-beat="sources"
              data-screen-label="Sources"
              data-settled="true"
              className={`dossier-block flex ${beatMinH} scroll-mt-28 flex-col justify-center ${theatrical ? "py-10" : "story-chapter report-section mt-7 py-6"}`}
            >
              <p className="mono text-[10px] uppercase tracking-[0.14em] text-signal-lift">Sources</p>
              <h2 className={theatrical
                ? "display mt-3 max-w-[20ch] text-[32px] leading-[1.14] text-ink"
                : "story-chapter-title mt-3 max-w-[28ch] text-ink"}>
                {d.sources.length === 1
                  ? `1 recorded source. ${d.sources[0].factsCited} ${d.sources[0].factsCited === 1 ? "fact" : "facts"} cited.`
                  : `${d.sources.length} recorded sources. ${d.sources.reduce((n, s) => n + s.factsCited, 0)} facts cited.`}
              </h2>
              <SourcesTable rows={d.sources} />
            </section>
          )}
          {theatrical && <div className="h-[28vh]" />}
        </div>

        {theatrical && <div className="dossier-pinned hidden lg:block">
          <div className={`${theatrical ? "sticky top-8 h-[calc(100vh-4rem)] py-8" : "sticky top-28 h-[calc(100vh-8rem)]"}`}>
            <div className="panel flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">The file</span>
                <span className="mono text-[10px] text-ink-faint">{(staticLayout ? beats.length : Math.max(settledIds.length, 1))} / {beats.length}</span>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                <div data-cs="mast" data-settled="true" className="dossier-block flex items-center gap-3">
                  {d.subject.avatarUrl && (
                    <img src={d.subject.avatarUrl} alt="" width={40} height={40}
                      className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover" />
                  )}
                  <div className="min-w-0">
                    <h3 className="display truncate text-[18px] text-ink">{d.subject.name}</h3>
                    <p className="mono truncate text-[11px] text-ink-faint">
                      {d.subject.handle}{d.subject.followers ? ` · ${d.subject.followers}` : ""}
                    </p>
                  </div>
                </div>

                {beats.filter((b) => b.id !== "verdict").map((b) => (
                  <div key={b.id} data-cs={b.id} data-settled={settled(b.id) ? "true" : "false"} className="dossier-block">
                    <div className="mt-4 border-t border-line pt-3.5">
                      <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">{b.label}</p>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-ink-dim">{b.heading}</p>
                      {b.figures.length > 0 && (
                        <div className="mt-2 space-y-1.5">
                          {b.figures.slice(0, 4).map((f, n) => <Figure key={`${f.label}-${n}`} figure={f} />)}
                        </div>
                      )}
                      {b.id === "coverage" && <div className="mt-3"><CoverageGrid checks={d.coverage.checks} /></div>}
                    </div>
                  </div>
                ))}

                <div data-cs="verdict" data-settled={settled("verdict") ? "true" : "false"} className="dossier-block">
                  <div className="mt-4 border-t border-line pt-3.5">
                    <p className="mono text-[10px] uppercase tracking-[0.12em] text-ink-faint">Verdict</p>
                    <div className="mt-2 flex items-baseline gap-2.5">
                      <span className="display text-[32px] text-ink">{d.verdict.call}</span>
                      {d.verdict.score !== null && <span className="mono text-[15px] text-ink-dim">{d.verdict.score}/100</span>}
                    </div>
                    {subjectHeading && <p className="mt-2 text-[12.5px] leading-relaxed text-ink-dim">{subjectHeading}</p>}
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
        </div>}
      </div>
    </div>
  );
}
