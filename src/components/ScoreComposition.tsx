import { useState } from "react";
import { CaretDown } from "@phosphor-icons/react";
import { requestChallenge } from "../lib/challenge";

/* The composition strip: how the headline score is built, one row per
   weighted dimension, directly under the report hero. Each row is a bar an
   investor can read at a glance, opens in place to a plain-language "why",
   and offers two exits: jump to the evidence section, or challenge the
   score through the ask/add-info flow. Ledger-style per DESIGN.md — rows
   divided by hairlines inside one panel, never nested boxes. */

export interface CompositionRow {
  /** Stable key; also used to build the evidence anchor (#decision-basis-<axis>). */
  axis: string;
  label: string;
  /** Points earned. */
  score: number;
  /** Points available — the dimension's weight in the 100-point rubric. */
  weight: number;
  /** Investor-worded reason the dimension scored where it did. */
  rationale: string;
  supportCount?: number;
  counterCount?: number;
  questionCount?: number;
  /** Where "Read the evidence" lands; defaults to #decision-basis-<axis>;
      null hides the link. */
  evidenceHref?: `#${string}` | null;
  /** Overrides the ratio-band color/word: a group with one flag reads
      flagged even when most of its checks are clean. */
  tone?: "pass" | "caution" | "fail";
  /** Replaces the "<weight>% of the score" chip (e.g. "6 checks"). */
  sublabel?: string;
  /** Replaces the sources/questions counts line under the rationale. */
  countsLine?: string;
}

function bandColor(ratio: number): string {
  if (ratio >= 0.7) return "var(--color-pass)";
  if (ratio >= 0.4) return "var(--color-caution)";
  return "var(--color-fail)";
}

function bandWord(ratio: number): string {
  if (ratio >= 0.7) return "strong";
  if (ratio >= 0.4) return "mixed";
  return "weak";
}

const TONE_COLOR: Record<NonNullable<CompositionRow["tone"]>, string> = {
  pass: "var(--color-pass)",
  caution: "var(--color-caution)",
  fail: "var(--color-fail)",
};

/** The same band color the composition strip uses. ScoreRing pieces reuse it. */
export function compositionRowColor(row: Pick<CompositionRow, "score" | "weight" | "tone">): string {
  if (row.tone) return TONE_COLOR[row.tone];
  const ratio = row.weight > 0 ? Math.max(0, Math.min(1, row.score / row.weight)) : 0;
  return bandColor(ratio);
}
const TONE_WORD: Record<NonNullable<CompositionRow["tone"]>, string> = {
  pass: "clear",
  caution: "warning",
  fail: "flagged",
};

function Row({ row, evidenceAnchor, challengeAnchor }: {
  row: CompositionRow;
  evidenceAnchor: string | null;
  challengeAnchor: string | null;
}) {
  const [open, setOpen] = useState(false);
  const ratio = row.weight > 0 ? Math.max(0, Math.min(1, row.score / row.weight)) : 0;
  const color = compositionRowColor(row);
  const word = row.tone ? TONE_WORD[row.tone] : bandWord(ratio);
  const support = row.supportCount ?? 0;
  const counter = row.counterCount ?? 0;
  const questions = row.questionCount ?? 0;
  const detailId = `composition-detail-${row.axis}`;
  return (
    <div className="score-composition-row">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
        className="score-composition-trigger grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 text-left transition hover:bg-panel-2/50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal"
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <span className="flex items-baseline gap-2">
              <span className="score-composition-label text-[13.5px] font-medium text-ink">{row.label}</span>
              <span className="score-composition-weight mono text-[10px] uppercase tracking-wide text-ink-faint max-sm:hidden">
                {row.sublabel ?? `${row.weight}% weight`}
              </span>
            </span>
            {row.tone ? (
              <span className="mono text-[11px] tabular text-ink-dim">
                <span className="font-semibold" style={{ color }}>{row.score}</span>
                <span className="text-ink-faint"> / {row.weight}</span>
                <span className="ml-2 text-ink-faint">{word}</span>
              </span>
            ) : (
              /* The Auric File presentation: the normalized score reads at a
                 glance in the band color; "drove" states the actual points
                 this dimension put into the total. */
              <span className="score-composition-value mono text-[12px] tabular text-ink-faint">
                <span className="text-[15px] font-semibold" style={{ color }}>{Math.round(ratio * 100)}</span>
                {" /100"}
                <span className="ml-2">drove {row.score} pts</span>
              </span>
            )}
          </div>
          <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-line" role="presentation">
            <div
              className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-700 motion-safe:ease-out"
              style={{ width: `${ratio * 100}%`, background: color }}
            />
          </div>
        </div>
        <CaretDown
          aria-hidden="true"
          size={14}
          className={`text-ink-faint transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      <div
        id={detailId}
        className="grid motion-safe:transition-[grid-template-rows] motion-safe:duration-300 motion-safe:ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="score-composition-detail px-4 pb-3.5 pt-0.5">
            {row.rationale && (
              <p className="max-w-[68ch] text-[13.5px] leading-relaxed text-ink">{row.rationale}</p>
            )}
            {row.countsLine ? (
              <p className="mono mt-2 text-[11px] text-ink-faint">{row.countsLine}</p>
            ) : (support > 0 || counter > 0 || questions > 0) && (
              <p className="mono mt-2 text-[11px] text-ink-faint">
                {support} {support === 1 ? "source" : "sources"} reviewed
                {counter > 0 && <span className="text-caution"> · {counter} {counter === 1 ? "disagrees" : "disagree"}</span>}
                {questions > 0 && <span className="text-caution"> · {questions} open {questions === 1 ? "question" : "questions"}</span>}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {evidenceAnchor && (
                <a
                  href={evidenceAnchor}
                  className="text-[12.5px] font-medium text-signal-lift underline-offset-2 hover:underline"
                >
                  Read the evidence ↓
                </a>
              )}
              {challengeAnchor && (
                <button
                  type="button"
                  onClick={() => requestChallenge(
                    `${row.label} · scored ${row.score}/${row.weight}`,
                    challengeAnchor.replace(/^#/, ""),
                  )}
                  className="cursor-pointer text-[12.5px] text-ink-faint underline-offset-2 hover:text-ink hover:underline"
                  title="Push back on this score: ask the report, point it at something it missed, or add a document"
                >
                  Challenge this
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ScoreComposition({ rows, totalScore, capNote, challengeAnchor = "#ask-report", heading = "How the score is built", summary }: {
  rows: CompositionRow[];
  totalScore: number | null;
  /** Present when a safety cap limited the total (rows then legitimately sum higher). */
  capNote?: string | null;
  /** Anchor of the ask/add-info flow; null hides the challenge affordance. */
  challengeAnchor?: string | null;
  /** Strip eyebrow; surfaces with a non-points model say what theirs is. */
  heading?: string;
  /** Replaces the "pts earned of" line (null hides it; undefined keeps it). */
  summary?: string | null;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="score-composition panel mt-4 overflow-hidden" aria-label={heading}>
      <div className="score-composition-header flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pb-1 pt-3.5">
        <h2 className="eyebrow">{heading}</h2>
        {summary !== null && (
          summary !== undefined ? (
            <span className="mono text-[11px] tabular text-ink-faint">{summary}</span>
          ) : totalScore != null && (
            <span className="mono text-[11px] tabular text-ink-faint">
              {rows.reduce((acc, r) => acc + r.score, 0)} pts earned of {rows.reduce((acc, r) => acc + r.weight, 0)}
              {capNote ? ` · ${capNote}` : ""}
            </span>
          )
        )}
      </div>
      <div className="divide-y divide-line/60">
        {rows.map((row) => (
          <Row
            key={row.axis}
            row={row}
            evidenceAnchor={row.evidenceHref === null ? null : row.evidenceHref ?? `#decision-basis-${row.axis}`}
            challengeAnchor={challengeAnchor}
          />
        ))}
      </div>
    </section>
  );
}
