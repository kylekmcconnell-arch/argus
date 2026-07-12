import { useState } from "react";

export interface SnapshotEvidenceControlProps {
  snapshotVersion: number;
  capturedAt: string;
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
        ? "Private result · supplemental panels are paused to avoid shared cache traces · not saved to a case, graph, watchlist, or activity feed"
        : persisted
          ? "Live supplemental intelligence · fetched after the core scan · not included in the immutable Share payload or scored verdict"
          : "Live supplemental intelligence · outside the core scan · not included in a saved Share payload or scored verdict"}
    </p>
  );
}

function capturedTime(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
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
      aria-label={`Snapshot v${snapshotVersion} evidence mode`}
      className="panel px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip tint-signal">
          SNAPSHOT v{snapshotVersion}
        </span>
        <time dateTime={capturedAt} className="mono text-[11px] text-ink-faint">
          captured {capturedTime(capturedAt)}
        </time>
      </div>

      {enabled ? (
        <p
          role="status"
          className="tint-caution mt-2 rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed"
        >
          Current intelligence · fetched now · not part of snapshot v{snapshotVersion} · does not change stored verdict
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-ink-dim">
            Current intelligence panels are paused. They sit outside this snapshot and are not part of the stored verdict.
          </p>
          <button
            type="button"
            onClick={loadCurrentIntelligence}
            className="btn-chip tint-signal shrink-0"
          >
            Load current intelligence
          </button>
        </div>
      )}
    </section>
  );
}
