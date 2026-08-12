import { useState } from "react";

export interface SnapshotEvidenceControlProps {
  snapshotVersion: number;
  capturedAt: string;
  subjectKind?: "person" | "token" | "investigation" | "site";
  currentIntelligenceEnabled?: boolean;
  onLoadCurrentIntelligence?: () => void;
}

export function LiveSupplementalNotice({
  private: privateSession = false,
  persisted = false,
}: {
  private?: boolean;
  persisted?: boolean;
}) {
  // Private mode is a mode disclosure and keeps the boxed treatment. The
  // fresh-scan variant used to read "New information checked after this
  // scan" in a caution box, which made every rescan look instantly stale;
  // the panels already carry their own live/saved chips, so one quiet line
  // stating the score is frozen is all this needs to say.
  if (privateSession) {
    return (
      <p
        role="status"
        className="tint-caution rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
      >
        Private report. Extra live checks are off, and nothing is added to shared cases, watchlists, or activity.
      </p>
    );
  }
  return (
    <p role="note" className="text-[11.5px] leading-relaxed text-ink-faint">
      {persisted
        ? "Extra checks below run live. They do not change the saved score or the shared report."
        : "Extra checks below run live. They do not change the saved score."}
    </p>
  );
}

function capturedTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function capturedDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, { dateStyle: "medium" });
}

// Snapshots captured before this deploy predate the web-corroboration recall
// and the trend/float/unlock disclosures, so they typically verify a fraction
// of what a fresh run does (observed: a pre-recall founder snapshot held 4
// verified facts where a post-recall project run held 18). The frozen verdict
// stays untouched and trustworthy as a record; the nudge only tells the reader
// that a re-scan now answers substantially more.
const ENGINE_RECALL_UPGRADE_AT = Date.parse("2026-07-21T16:50:00.000Z");

function predatesEngineUpgrades(capturedAt: string): boolean {
  const parsed = Date.parse(capturedAt);
  return Number.isFinite(parsed) && parsed < ENGINE_RECALL_UPGRADE_AT;
}

export function SnapshotEvidenceControl({
  snapshotVersion,
  capturedAt,
  currentIntelligenceEnabled,
  onLoadCurrentIntelligence,
}: SnapshotEvidenceControlProps) {
  const [localCurrentIntelligenceEnabled, setLocalCurrentIntelligenceEnabled] = useState(false);
  const enabled = currentIntelligenceEnabled ?? localCurrentIntelligenceEnabled;
  const loadCurrentIntelligence = () => {
    if (currentIntelligenceEnabled === undefined) setLocalCurrentIntelligenceEnabled(true);
    onLoadCurrentIntelligence?.();
  };

  return (
    <section
      aria-label={`Saved report v${snapshotVersion}`}
      className="panel px-3.5 py-2.5 max-sm:px-3 max-sm:py-2"
    >
      <div className="flex items-center gap-2.5">
        <span className="chip tint-signal shrink-0">
          SAVED REPORT v{snapshotVersion}
        </span>
        <time dateTime={capturedAt} className="mono ml-auto text-right text-[11px] text-ink-faint sm:hidden">
          saved {capturedDate(capturedAt)}
        </time>
        <time dateTime={capturedAt} className="mono ml-auto hidden text-right text-[11px] text-ink-faint sm:block">
          saved {capturedTime(capturedAt)}
        </time>
      </div>

      <div className="mt-2 hidden items-center gap-2.5 sm:flex">
        {enabled ? (
          <p role="status" className="ml-auto text-[11.5px] leading-relaxed text-caution">
            Current data is shown separately and does not change the saved score.
          </p>
        ) : (
          <>
            <p className="ml-1 min-w-52 flex-1 text-[11.5px] leading-relaxed text-ink-faint">
              This report uses data saved on {capturedTime(capturedAt)}.
            </p>
            <button
              type="button"
              onClick={loadCurrentIntelligence}
              className="btn-chip tint-signal shrink-0"
            >
              Check current data
            </button>
          </>
        )}
      </div>

      <details className="mt-1.5 border-t border-line/60 pt-1.5 text-[11.5px] sm:hidden">
        <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-ink-dim [&::-webkit-details-marker]:hidden">
          <span>{enabled ? "Current data is separate" : "Saved-data options"}</span>
          <span className="mono text-[10px] uppercase tracking-wide text-signal-lift">Details</span>
        </summary>
        <div className="pb-1 pt-1">
          {enabled ? (
            <p role="status" className="leading-relaxed text-caution">
              Current data is shown separately and does not change the saved score.
            </p>
          ) : (
            <>
              <p className="leading-relaxed text-ink-faint">
                This report uses data saved on {capturedTime(capturedAt)}.
              </p>
              <button
                type="button"
                onClick={loadCurrentIntelligence}
                className="btn-chip tint-signal mt-2 min-h-11"
              >
                Check current data
              </button>
            </>
          )}
          {predatesEngineUpgrades(capturedAt) ? (
            <p role="note" className="mt-2 border-t border-line/60 pt-2 leading-relaxed text-caution">
              ARGUS now checks more sources than when this report was saved.
              {" "}Run a new scan for a fuller report. The saved result will not change.
            </p>
          ) : null}
        </div>
      </details>

      {predatesEngineUpgrades(capturedAt) ? (
        <p
          role="note"
          className="mt-2 hidden border-t border-line/60 pt-2 text-[11.5px] leading-relaxed text-caution sm:block"
        >
          ARGUS now checks more sources than when this report was saved.
          {" "}Run a new scan for a fuller report. The saved result will not change.
        </p>
      ) : null}
    </section>
  );
}
