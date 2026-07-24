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
  return (
    <p
      role="status"
      className="tint-caution rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
    >
      {privateSession
        ? "Private report. Extra live checks are off, and nothing is added to shared cases, watchlists, or activity."
        : persisted
          ? "New information checked after this scan. It is not part of the saved score or shared report."
          : "New information checked after this scan. It is not part of the saved score."}
    </p>
  );
}

function capturedTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
      className="panel px-3.5 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <span className="chip tint-signal">
          SAVED REPORT v{snapshotVersion}
        </span>
        <time dateTime={capturedAt} className="mono text-[11px] text-ink-faint">
          saved {capturedTime(capturedAt)}
        </time>
        {enabled ? (
          <p role="status" className="w-full text-[11.5px] leading-relaxed text-caution sm:ml-auto sm:w-auto">
            Current data is shown separately and does not change the saved score.
          </p>
        ) : (
          <>
            <p className="w-full text-[11.5px] leading-relaxed text-ink-faint sm:ml-1 sm:min-w-52 sm:flex-1">
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

      {predatesEngineUpgrades(capturedAt) ? (
        <p
          role="note"
          className="mt-2 border-t border-line/60 pt-2 text-[11.5px] leading-relaxed text-caution"
        >
          ARGUS now checks more sources than when this report was saved.
          {" "}Run a new scan for a fuller report. The saved result will not change.
        </p>
      ) : null}
    </section>
  );
}
