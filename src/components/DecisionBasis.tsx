import { useEffect, useId, useMemo, useState } from "react";
import type { AxisEvidenceRecord } from "../data/evidence";
import type { RoleReport, SubjectClass } from "../engine";
import { buildDecisionBasis, type DecisionBasisRow, type DecisionBasisStatus } from "../lib/decisionBasis";
import { axisLabel, ROLE_META } from "../lib/verdict";

export interface DecisionBasisProps {
  roleReport?: RoleReport;
  catalog?: AxisEvidenceRecord[];
  lineageVersion?: number;
  unavailableReason?: "routing" | "scoring";
  onRescan?: () => void;
}

const STATUS_META: Record<DecisionBasisStatus, { label: string; color: string }> = {
  grounded: { label: "Strong evidence", color: "var(--color-pass)" },
  partial: { label: "Moderate evidence", color: "var(--color-caution)" },
  contested: { label: "Mixed evidence", color: "var(--color-avoid)" },
  gap: { label: "Limited evidence", color: "var(--color-caution)" },
};

const RELATION_LABEL = {
  support: "Supports this view",
  counter: "Needs reconciliation",
  gap: "Open question",
} as const;

function safeExternalSource(value?: string): string | null {
  if (!value) return null;
  try {
    const source = new URL(value.trim());
    if ((source.protocol !== "https:" && source.protocol !== "http:") || !source.hostname || source.username || source.password) {
      return null;
    }
    return source.href;
  } catch {
    return null;
  }
}

function compactId(value: string): string {
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function capturedLabel(value?: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;
}

function roleLabel(role?: string): string {
  const known = role ? ROLE_META[role as SubjectClass] : undefined;
  return known?.label ?? (role ? role.toLowerCase().replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()) : "Governing track");
}

function defaultAxis(rows: readonly DecisionBasisRow[]): string | null {
  return rows.find((row) => row.status === "gap")?.axis
    ?? rows.find((row) => row.status === "contested")?.axis
    ?? rows.find((row) => row.status === "partial")?.axis
    ?? rows[0]?.axis
    ?? null;
}

function axisAnchorId(axis: string): string {
  return `decision-basis-${axis.replace(/[^a-z0-9_-]/gi, "-")}`;
}

function evidenceTitle(value: string): string {
  return value.replace(/\b([A-Z]{1,3}\d+_[a-z0-9_]+)\b/gi, (axis) => axisLabel(axis));
}

function EvidenceRecord({ record, relation }: { record: AxisEvidenceRecord; relation: "support" | "counter" | "gap" }) {
  const source = safeExternalSource(record.sourceUrl);
  const captured = capturedLabel(record.capturedAt);
  const title = evidenceTitle(record.title);
  return (
    <li className="panel-inset px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="chip">{RELATION_LABEL[relation]}</span>
        <span className="ml-auto text-[11px] text-ink-faint">{captured ? `Captured ${captured}` : "Source captured by ARGUS"}</span>
      </div>
      <div className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink">{title}</div>
      {record.excerpt && <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{record.excerpt}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-faint">
        {source && (
          <a
            href={source}
            target="_blank"
            rel="noopener noreferrer"
            className="mono link-ext"
            aria-label={`Open source URL for ${title} in a new tab`}
          >
            View source
          </a>
        )}
      </div>
      <details className="mt-2 text-[11px] text-ink-faint">
        <summary className="cursor-pointer select-none">Verification details</summary>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          <span>{record.provider}</span>
          <span>{record.verification.replace(/_/g, " ")}</span>
          <span className="mono" title={record.artifactId}>Artifact {compactId(record.artifactId)}</span>
          <span className="mono" title={record.contentHash}>SHA-256 {compactId(record.contentHash)}</span>
        </div>
      </details>
    </li>
  );
}

export function DecisionBasis({ roleReport, catalog, lineageVersion, unavailableReason, onRescan }: DecisionBasisProps) {
  const model = useMemo(
    () => buildDecisionBasis(roleReport, catalog, lineageVersion),
    [catalog, lineageVersion, roleReport],
  );
  const generatedId = useId();
  const detailId = `${generatedId}-decision-basis-detail`;
  const [selectedAxis, setSelectedAxis] = useState<string | null>(() => defaultAxis(model.rows));

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const selectFromHash = () => {
      const axis = model.rows.find((row) => `#${axisAnchorId(row.axis)}` === window.location.hash)?.axis;
      if (axis) setSelectedAxis(axis);
    };
    selectFromHash();
    window.addEventListener("hashchange", selectFromHash);
    return () => window.removeEventListener("hashchange", selectFromHash);
  }, [model.rows]);

  if (!model.available || unavailableReason) {
    const statusLabel = unavailableReason === "routing"
      ? "Methodology unavailable"
      : unavailableReason === "scoring"
        ? "Scoring output incomplete"
        : "Lineage unavailable";
    const explanation = unavailableReason === "routing"
      ? "No evidence-backed role selected a scoring methodology, so this report contains no evidence-to-axis lineage. Collected intelligence remains visible without being converted into a score."
      : unavailableReason === "scoring"
        ? "ARGUS resolved an evidence-backed role, but the analyst did not return a complete, valid governing-axis score. Collected intelligence remains visible without being presented as decision-ready."
        : "This snapshot does not contain strict evidence-to-axis citations. ARGUS will not infer them from analyst prose or nearby sources.";
    const rescanLabel = unavailableReason === "routing"
      ? "Run corrected investigation"
      : unavailableReason === "scoring"
        ? "Retry scoring investigation"
        : "Rescan to capture lineage";
    return (
      <section aria-label="Decision basis" className="panel px-4 py-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">How ARGUS reached this view</h3>
          <span className="chip">{statusLabel}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-dim">
            {explanation}
          </p>
          {onRescan && (
            <button
              type="button"
              onClick={onRescan}
              className="btn-chip tint-signal min-h-11 shrink-0 font-medium"
            >
              {rescanLabel}
            </button>
          )}
        </div>
      </section>
    );
  }

  const activeAxis = model.rows.some((row) => row.axis === selectedAxis)
    ? selectedAxis
    : defaultAxis(model.rows);
  const selected = model.rows.find((row) => row.axis === activeAxis) ?? null;
  const selectedTriggerId = selected ? axisAnchorId(selected.axis) : undefined;
  const selectAxis = (axis: string, updateHash = false) => {
    setSelectedAxis(axis);
    if (updateHash && typeof window !== "undefined") {
      window.history.replaceState(window.history.state, "", `#${axisAnchorId(axis)}`);
    }
  };
  const moveAxisSelection = (currentIndex: number, key: string) => {
    let nextIndex: number | null = null;
    if (key === "ArrowRight" || key === "ArrowDown") nextIndex = (currentIndex + 1) % model.rows.length;
    if (key === "ArrowLeft" || key === "ArrowUp") nextIndex = (currentIndex - 1 + model.rows.length) % model.rows.length;
    if (key === "Home") nextIndex = 0;
    if (key === "End") nextIndex = model.rows.length - 1;
    if (nextIndex === null) return;
    const axis = model.rows[nextIndex]?.axis;
    if (!axis) return;
    selectAxis(axis, true);
    window.requestAnimationFrame(() => document.getElementById(axisAnchorId(axis))?.focus());
  };

  return (
    <section aria-label="Decision basis" className="panel px-4 py-3.5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h3 className="text-[13.5px] font-semibold tracking-tight text-ink">How ARGUS reached this view</h3>
        <span className="text-[12.5px] text-ink-faint">{roleLabel(model.role ?? undefined)}</span>
        <span className="ml-auto text-[11.5px] text-ink-faint">
          {model.evidenceBacked} of {model.rows.length} diligence areas have cited support
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">
        Select an area to see what supports the view, what conflicts, and what still needs to be verified.
      </p>

      {model.rows.length ? (
        <>
          <div className="mt-3 grid gap-2 md:grid-cols-2" role="tablist" aria-label="Diligence area evidence">
            {model.rows.map((row, index) => {
              const selectedTab = row.axis === selected?.axis;
              const meta = STATUS_META[row.status];
              const triggerId = axisAnchorId(row.axis);
              return (
                <div key={row.axis} role="presentation">
                  <button
                    id={triggerId}
                    type="button"
                    role="tab"
                    aria-selected={selectedTab}
                    aria-controls={detailId}
                    tabIndex={selectedTab ? 0 : -1}
                    onClick={() => selectAxis(row.axis, true)}
                    onKeyDown={(event) => {
                      if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
                      event.preventDefault();
                      moveAxisSelection(index, event.key);
                    }}
                    className="min-h-11 w-full panel-inset px-3 py-2.5 text-left transition hover:bg-panel-2/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
                  >
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{axisLabel(row.axis)}</span>
                      <span className="chip tint-var shrink-0" style={{ ["--tint" as string]: meta.color }}>{meta.label}</span>
                    </span>
                    <span className="mt-1 block text-[11px] text-ink-faint">
                      {row.support.length} cited source{row.support.length === 1 ? "" : "s"}
                      {row.counter.length ? ` · ${row.counter.length} need${row.counter.length === 1 ? "s" : ""} reconciliation` : ""}
                      {Math.max(row.gaps.length, row.gapArtifacts.length) ? ` · ${Math.max(row.gaps.length, row.gapArtifacts.length)} question${Math.max(row.gaps.length, row.gapArtifacts.length) === 1 ? "" : "s"} to verify` : ""}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-dim">
                      {evidenceTitle(row.support[0]?.title ?? row.counter[0]?.title ?? row.gapArtifacts[0]?.title ?? row.gaps[0] ?? "No qualifying frozen citation recorded")}
                    </span>
                  </button>
                </div>
              );
            })}
          </div>

          {selected && (
            <div id={detailId} role="tabpanel" aria-labelledby={selectedTriggerId} className="panel-inset mt-3 px-3 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-[12.5px] font-medium text-ink">{axisLabel(selected.axis)}</h4>
                <span className="chip tint-var" style={{ ["--tint" as string]: STATUS_META[selected.status].color }}>{STATUS_META[selected.status].label}</span>
              </div>
              <p className="mt-1 text-[11px] text-ink-faint">These are the exact sources ARGUS used for this part of the assessment.</p>

              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <h5 className="eyebrow">Why this looks credible</h5>
                  {selected.support.length ? (
                    <ul className="mt-1.5 space-y-2" aria-label={`Supporting evidence for ${axisLabel(selected.axis)}`}>
                      {selected.support.map((record) => <EvidenceRecord key={record.artifactId} record={record} relation="support" />)}
                    </ul>
                  ) : <p className="mt-1.5 text-[11px] text-ink-faint">No verified supporting source was captured.</p>}
                </div>
                <div>
                  <h5 className="eyebrow">What needs reconciliation</h5>
                  {selected.counter.length ? (
                    <ul className="mt-1.5 space-y-2" aria-label={`Counter-evidence for ${axisLabel(selected.axis)}`}>
                      {selected.counter.map((record) => <EvidenceRecord key={record.artifactId} record={record} relation="counter" />)}
                    </ul>
                  ) : <p className="mt-1.5 text-[11px] text-ink-faint">No conflicting source was captured.</p>}
                </div>
              </div>

              <div className="mt-3 border-t border-line/60 pt-2.5">
                <h5 className="eyebrow">Questions to verify</h5>
                {selected.gapArtifacts.length > 0 && (
                  <ul className="mt-1.5 space-y-2" aria-label={`Gap artifacts for ${axisLabel(selected.axis)}`}>
                    {selected.gapArtifacts.map((record) => <EvidenceRecord key={record.artifactId} record={record} relation="gap" />)}
                  </ul>
                )}
                {selected.gaps.length ? (
                  <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-caution">
                    {selected.gaps.map((gap) => <li key={gap}>{gap}</li>)}
                  </ul>
                ) : selected.gapArtifacts.length === 0 ? (
                  <p className="mt-1.5 text-[11px] text-ink-faint">No open verification question was recorded for this area.</p>
                ) : null}
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="mt-3 text-[12.5px] text-ink-dim">No diligence areas were scored in this report.</p>
      )}
    </section>
  );
}
